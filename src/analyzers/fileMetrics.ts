import * as path from 'path';
import { ImportGraph } from '../models/graph';
import { DirectoryStats, FileNode, FileSummary, ImportanceTier } from '../models/types';

/**
 * Calculates file and directory metrics from the import graph
 */
export class FileMetricsCalculator {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Group files by top-level directory and compute per-directory stats
   * (sorted by file count descending)
   */
  getDirectoryStats(graph: ImportGraph): {
    directories: DirectoryStats[];
    filesByDirectory: Record<string, FileSummary[]>;
  } {
    const filesByDirectory: Record<string, FileSummary[]> = {};
    for (const node of graph.getAllNodes()) {
      const topDir = FileMetricsCalculator.getTopLevelDir(node.relativePath);
      if (topDir) {
        (filesByDirectory[topDir] ??= []).push(ImportGraph.toSummary(node));
      }
    }

    const directories: DirectoryStats[] = Object.entries(filesByDirectory).map(([dirPath, files]) => ({
      path: dirPath,
      name: path.basename(dirPath) || dirPath,
      fileCount: files.length,
      category: this.categorizeDirectory(dirPath)
    }));

    return { directories: directories.sort((a, b) => b.fileCount - a.fileCount), filesByDirectory };
  }

  /**
   * Get the top-level directory for a workspace-relative file path
   * (descends one level into `src/`). Returns null for root-level files.
   */
  private static getTopLevelDir(relativePath: string): string | null {
    const dirPath = path.dirname(relativePath);
    if (!dirPath || dirPath === '.') {
      return null;
    }

    const parts = dirPath.split(/[/\\]/);
    // Skip 'src' if it's the first part
    if (parts[0] === 'src' && parts.length > 1) {
      return `src/${parts[1]}`;
    }
    return parts[0];
  }

  /**
   * Categorize a directory based on common naming conventions
   */
  private categorizeDirectory(
    dirPath: string
  ): DirectoryStats['category'] {
    const name = path.basename(dirPath).toLowerCase();
    const fullPath = dirPath.toLowerCase();

    if (this.matchesAny(name, ['component', 'components', 'ui'])) {
      return 'components';
    }
    if (this.matchesAny(name, ['hook', 'hooks'])) {
      return 'hooks';
    }
    if (this.matchesAny(name, ['service', 'services', 'api', 'apis'])) {
      return 'services';
    }
    if (this.matchesAny(name, ['util', 'utils', 'helper', 'helpers', 'lib'])) {
      return 'utils';
    }
    if (this.matchesAny(name, ['screen', 'screens', 'view', 'views'])) {
      return 'screens';
    }
    if (this.matchesAny(name, ['page', 'pages', 'routes'])) {
      return 'pages';
    }
    if (this.matchesAny(fullPath, ['api/', 'apis/', '/api', 'server/'])) {
      return 'api';
    }

    return 'other';
  }

  /**
   * Check if a string matches any of the patterns
   */
  private matchesAny(str: string, patterns: string[]): boolean {
    return patterns.some(p => str.includes(p));
  }

  /**
   * Get load-bearing files (files imported by many others)
   */
  getLoadBearingFiles(graph: ImportGraph, limit: number = 20): FileNode[] {
    return graph.getLoadBearingFiles(limit);
  }

  /**
   * Get leaf files (files not imported by any other file)
   */
  getLeafFiles(graph: ImportGraph): FileNode[] {
    return graph.getLeafFiles();
  }

  /**
   * Get metrics for a specific file
   */
  getFileMetrics(graph: ImportGraph, filePath: string): FileNode | undefined {
    return graph.getNode(filePath);
  }

  /**
   * Calculate summary statistics
   */
  getSummaryStats(graph: ImportGraph): {
    totalFiles: number;
    leafFileCount: number;
    loadBearingCount: number;
    averageImports: number;
    averageImportedBy: number;
  } {
    const nodes = graph.getAllNodes();
    const total = nodes.length;

    if (total === 0) {
      return {
        totalFiles: 0,
        leafFileCount: 0,
        loadBearingCount: 0,
        averageImports: 0,
        averageImportedBy: 0
      };
    }

    const leafCount = nodes.filter(n => n.metrics.isLeaf).length;
    const loadBearingCount = nodes.filter(n => n.metrics.isLoadBearing).length;
    const totalImports = nodes.reduce((sum, n) => sum + n.metrics.outDegree, 0);
    const totalImportedBy = nodes.reduce((sum, n) => sum + n.metrics.inDegree, 0);

    return {
      totalFiles: total,
      leafFileCount: leafCount,
      loadBearingCount: loadBearingCount,
      averageImports: Math.round((totalImports / total) * 10) / 10,
      averageImportedBy: Math.round((totalImportedBy / total) * 10) / 10
    };
  }

  /**
   * Get importance tier for a file based on its metrics
   */
  static getImportanceTier(node: FileNode): ImportanceTier {
    return node.metrics.tier;
  }
}

export { FileMetricsCalculator as default };
