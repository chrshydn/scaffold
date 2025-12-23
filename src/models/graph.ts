import { FileNode, FileMetrics } from './types';

/**
 * Import graph data structure
 * Manages the directed graph of file dependencies
 */
export class ImportGraph {
  private nodes: Map<string, FileNode> = new Map();
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Add a file node to the graph
   */
  addNode(filePath: string): FileNode {
    if (!this.nodes.has(filePath)) {
      const relativePath = this.getRelativePath(filePath);
      const node: FileNode = {
        filePath,
        relativePath,
        imports: [],
        importedBy: [],
        metrics: {
          inDegree: 0,
          outDegree: 0,
          isLeaf: true,
          isLoadBearing: false,
          importanceScore: 0
        }
      };
      this.nodes.set(filePath, node);
    }
    return this.nodes.get(filePath)!;
  }

  /**
   * Add an edge from importer to imported file
   */
  addEdge(importerPath: string, importedPath: string): void {
    const importer = this.addNode(importerPath);
    const imported = this.addNode(importedPath);

    if (!importer.imports.includes(importedPath)) {
      importer.imports.push(importedPath);
    }
    if (!imported.importedBy.includes(importerPath)) {
      imported.importedBy.push(importerPath);
    }
  }

  /**
   * Remove a file from the graph
   */
  removeNode(filePath: string): void {
    const node = this.nodes.get(filePath);
    if (!node) return;

    // Remove this file from other files' imports lists
    for (const importedPath of node.imports) {
      const imported = this.nodes.get(importedPath);
      if (imported) {
        imported.importedBy = imported.importedBy.filter(p => p !== filePath);
      }
    }

    // Remove this file from other files' importedBy lists
    for (const importerPath of node.importedBy) {
      const importer = this.nodes.get(importerPath);
      if (importer) {
        importer.imports = importer.imports.filter(p => p !== filePath);
      }
    }

    this.nodes.delete(filePath);
  }

  /**
   * Clear all edges for a file (used before re-parsing)
   */
  clearEdgesFor(filePath: string): void {
    const node = this.nodes.get(filePath);
    if (!node) return;

    // Remove from imported files' importedBy lists
    for (const importedPath of node.imports) {
      const imported = this.nodes.get(importedPath);
      if (imported) {
        imported.importedBy = imported.importedBy.filter(p => p !== filePath);
      }
    }

    node.imports = [];
  }

  /**
   * Calculate metrics for all nodes
   */
  calculateMetrics(): void {
    const maxInDegree = Math.max(1, ...Array.from(this.nodes.values()).map(n => n.importedBy.length));

    for (const node of this.nodes.values()) {
      const inDegree = node.importedBy.length;
      const outDegree = node.imports.length;

      node.metrics = {
        inDegree,
        outDegree,
        isLeaf: inDegree === 0,
        isLoadBearing: inDegree >= 5, // Threshold for "load-bearing"
        importanceScore: Math.round((inDegree / maxInDegree) * 100)
      };
    }
  }

  /**
   * Get a node by file path
   */
  getNode(filePath: string): FileNode | undefined {
    return this.nodes.get(filePath);
  }

  /**
   * Get all nodes
   */
  getAllNodes(): FileNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get load-bearing files (sorted by importance)
   */
  getLoadBearingFiles(limit: number = 20): FileNode[] {
    return this.getAllNodes()
      .filter(n => n.metrics.inDegree > 0)
      .sort((a, b) => b.metrics.inDegree - a.metrics.inDegree)
      .slice(0, limit);
  }

  /**
   * Get leaf files (files with no dependents)
   */
  getLeafFiles(): FileNode[] {
    return this.getAllNodes()
      .filter(n => n.metrics.isLeaf)
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  /**
   * Get total file count
   */
  getFileCount(): number {
    return this.nodes.size;
  }

  /**
   * Get relative path from workspace root
   */
  private getRelativePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const rootNormalized = this.workspaceRoot.replace(/\\/g, '/');
    if (normalized.startsWith(rootNormalized)) {
      return normalized.slice(rootNormalized.length + 1);
    }
    return normalized;
  }

  /**
   * Serialize the graph for storage/transfer
   */
  serialize(): { nodes: FileNode[]; workspaceRoot: string } {
    return {
      nodes: this.getAllNodes(),
      workspaceRoot: this.workspaceRoot
    };
  }

  /**
   * Deserialize a graph from storage
   */
  static deserialize(data: { nodes: FileNode[]; workspaceRoot: string }): ImportGraph {
    const graph = new ImportGraph(data.workspaceRoot);
    for (const node of data.nodes) {
      graph.nodes.set(node.filePath, node);
    }
    return graph;
  }
}
