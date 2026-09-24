import * as vscode from 'vscode';
import * as fs from 'fs';
import { ImportGraph } from '../models/graph';
import { TypeScriptParser, SOURCE_GLOB, isSourceFile } from '../parsers/typescriptParser';

/** Files read concurrently per batch; also the yield interval for the event loop */
const BATCH_SIZE = 64;

/**
 * Builds and maintains the import graph for the workspace
 */
export class ImportGraphBuilder {
  private workspaceRoot: string;
  private parser: TypeScriptParser;
  private graph: ImportGraph;

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
    const graph = new ImportGraph(this.workspaceRoot);
    this.parser.invalidateCache();

    const files = await this.findSourceFiles();
    progress?.report({ message: `Parsing ${files.length} files` });

    let reportedPercent = 0;
    await this.parseFiles(files, (filePath, imports) => {
      graph.addNode(filePath);
      for (const target of imports) {
        graph.addEdge(filePath, target);
      }
    }, (done) => {
      const percent = Math.floor((done / files.length) * 100);
      progress?.report({ message: `Parsing ${done}/${files.length} files`, increment: percent - reportedPercent });
      reportedPercent = percent;
    });

    graph.calculateMetrics();
    this.graph = graph;
    return graph;
  }

  /**
   * Re-parse changed files. Returns true if any file's imports changed.
   */
  async applyChanges(updated: string[]): Promise<boolean> {
    let changed = false;

    await this.parseFiles(updated, (filePath, imports) => {
      const before = this.graph.getNode(filePath)?.imports;
      if (before && before.length === imports.length && imports.every(p => before.includes(p))) {
        return;
      }
      changed = true;
      this.graph.clearEdgesFor(filePath);
      this.graph.addNode(filePath);
      for (const target of imports) {
        this.graph.addEdge(filePath, target);
      }
    });

    if (changed) {
      this.graph.calculateMetrics();
    }
    return changed;
  }

  /**
   * Get the current graph
   */
  getGraph(): ImportGraph {
    return this.graph;
  }

  private async findSourceFiles(): Promise<string[]> {
    const pattern = new vscode.RelativePattern(this.workspaceRoot, SOURCE_GLOB);
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
    return files.map(f => f.fsPath).filter(isSourceFile);
  }

  /**
   * Read files in parallel batches (keeping the extension host responsive)
   * and hand each file's resolved imports to `onFile`.
   */
  private async parseFiles(
    files: string[],
    onFile: (filePath: string, imports: string[]) => void,
    onBatch?: (done: number) => void
  ): Promise<void> {
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const contents = await Promise.all(
        batch.map(file => fs.promises.readFile(file, 'utf-8').catch(() => null))
      );

      batch.forEach((filePath, j) => {
        const content = contents[j];
        if (content === null) {
          return;
        }
        try {
          onFile(filePath, this.parser.parseImports(filePath, content));
        } catch (error) {
          console.error(`Failed to parse ${filePath}:`, error);
        }
      });

      onBatch?.(i + batch.length);
    }
  }
}

export { ImportGraphBuilder as default };
