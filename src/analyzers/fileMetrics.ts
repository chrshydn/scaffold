import * as path from 'path';
import { ImportGraph } from '../models/graph';
import { DirectoryStats, FileNode } from '../models/types';

/**
 * Calculates file and directory metrics from the import graph
 */
export class FileMetricsCalculator {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get directory statistics grouped by category
   */
  getDirectoryStats(graph: ImportGraph): DirectoryStats[] {
    const nodes = graph.getAllNodes();
    const dirCounts = new Map<string, number>();

    // Count files per directory
    for (const node of nodes) {
      const dir = path.dirname(node.relativePath);
      const topDir = this.getTopLevelDir(dir);

      if (topDir) {
        dirCounts.set(topDir, (dirCounts.get(topDir) || 0) + 1);
      }
    }

    // Convert to DirectoryStats array
    const stats: DirectoryStats[] = [];
    for (const [dirPath, count] of dirCounts) {
      stats.push({
        path: dirPath,
        name: path.basename(dirPath) || dirPath,
        fileCount: count,
        category: this.categorizeDirectory(dirPath)
      });
    }

    // Sort by file count descending
    return stats.sort((a, b) => b.fileCount - a.fileCount);
  }

  /**
   * Get the top-level directory from a path
   */
  private getTopLevelDir(dirPath: string): string | null {
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
  static getImportanceTier(node: FileNode): 'critical' | 'high' | 'medium' | 'low' {
    const score = node.metrics.importanceScore;
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
  }
}

export { FileMetricsCalculator as default };
