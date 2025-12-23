import * as vscode from 'vscode';
import * as path from 'path';
import { ImportGraph } from '../models/graph';
import { TypeScriptParser } from '../parsers/typescriptParser';

/**
 * Builds and maintains the import graph for the workspace
 */
export class ImportGraphBuilder {
  private workspaceRoot: string;
  private parser: TypeScriptParser;
  private graph: ImportGraph;
  private progress?: vscode.Progress<{ message?: string; increment?: number }>;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.parser = new TypeScriptParser(workspaceRoot);
    this.graph = new ImportGraph(workspaceRoot);
  }

  /**
   * Build the complete import graph by scanning all TypeScript files
   */
  async buildGraph(
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<ImportGraph> {
    this.progress = progress;
    this.graph = new ImportGraph(this.workspaceRoot);

    // Find all TypeScript files
    const files = await this.findTypeScriptFiles();
    const totalFiles = files.length;

    this.reportProgress(`Found ${totalFiles} TypeScript files`, 0);

    // Parse each file and build edges
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      await this.processFile(file);

      const percent = Math.round(((i + 1) / totalFiles) * 100);
      this.reportProgress(`Parsing: ${path.basename(file)}`, percent);
    }

    // Calculate metrics after all edges are built
    this.graph.calculateMetrics();
    this.reportProgress('Analysis complete', 100);

    return this.graph;
  }

  /**
   * Update the graph for a single changed file
   */
  async updateFile(filePath: string): Promise<void> {
    // Clear existing edges from this file
    this.graph.clearEdgesFor(filePath);

    // Re-parse and add new edges
    await this.processFile(filePath);

    // Recalculate metrics
    this.graph.calculateMetrics();
  }

  /**
   * Remove a file from the graph
   */
  removeFile(filePath: string): void {
    this.graph.removeNode(filePath);
    this.graph.calculateMetrics();
  }

  /**
   * Get the current graph
   */
  getGraph(): ImportGraph {
    return this.graph;
  }

  /**
   * Find all TypeScript/TSX files in the workspace
   */
  private async findTypeScriptFiles(): Promise<string[]> {
    const pattern = new vscode.RelativePattern(
      this.workspaceRoot,
      '**/*.{ts,tsx}'
    );

    const excludePattern = '**/node_modules/**';

    const files = await vscode.workspace.findFiles(pattern, excludePattern);
    return files.map(f => f.fsPath);
  }

  /**
   * Process a single file and add its imports to the graph
   */
  private async processFile(filePath: string): Promise<void> {
    const parsed = this.parser.parseFile(filePath);
    if (!parsed) {
      return;
    }

    // Ensure the file exists in the graph
    this.graph.addNode(filePath);

    // Add edges for each local import
    for (const importInfo of parsed.imports) {
      if (!importInfo.isExternal && importInfo.resolvedPath) {
        this.graph.addEdge(filePath, importInfo.resolvedPath);
      }
    }
  }

  /**
   * Report progress to the progress indicator
   */
  private reportProgress(message: string, percent: number): void {
    if (this.progress) {
      this.progress.report({ message, increment: 0 });
    }
  }
}

export { ImportGraphBuilder as default };
