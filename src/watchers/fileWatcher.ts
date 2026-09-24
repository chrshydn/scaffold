import * as vscode from 'vscode';
import { ImportGraphBuilder } from '../analyzers/importGraphBuilder';
import { SOURCE_GLOB, isSourceFile } from '../parsers/typescriptParser';

/**
 * Watches for file changes and keeps the import graph up to date.
 *
 * Content changes are applied incrementally. Creates and deletes trigger a
 * full rebuild, since they can change what other files' imports resolve to.
 */
export class FileWatcher {
  private workspaceRoot: string;
  private graphBuilder: ImportGraphBuilder;
  private watcher: vscode.FileSystemWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingUpdates: Set<string> = new Set();
  private structureChanged = false;
  private onUpdateCallback?: () => void;

  private readonly DEBOUNCE_MS = 500;

  constructor(workspaceRoot: string, graphBuilder: ImportGraphBuilder) {
    this.workspaceRoot = workspaceRoot;
    this.graphBuilder = graphBuilder;
  }

  /**
   * Start watching for file changes
   */
  start(onUpdate?: () => void): void {
    if (this.watcher) {
      return;
    }
    this.onUpdateCallback = onUpdate;

    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceRoot, SOURCE_GLOB)
    );

    const onStructureChange = (uri: vscode.Uri) => this.enqueue(uri, () => { this.structureChanged = true; });
    this.watcher.onDidCreate(onStructureChange);
    this.watcher.onDidDelete(onStructureChange);
    this.watcher.onDidChange((uri) => this.enqueue(uri, () => this.pendingUpdates.add(uri.fsPath)));
  }

  /**
   * Stop watching for file changes
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private enqueue(uri: vscode.Uri, record: () => void): void {
    if (this.shouldIgnore(uri.fsPath)) {
      return;
    }
    record();

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.flushUpdates(), this.DEBOUNCE_MS);
  }

  /**
   * Check if a file should be ignored
   */
  private shouldIgnore(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    const rootNormalized = this.workspaceRoot.replace(/\\/g, '/');
    return (
      normalized.includes('/node_modules/') ||
      !normalized.startsWith(rootNormalized) ||
      !isSourceFile(filePath)
    );
  }

  /**
   * Flush all pending updates
   */
  private async flushUpdates(): Promise<void> {
    this.debounceTimer = null;
    const updates = Array.from(this.pendingUpdates);
    const structureChanged = this.structureChanged;

    this.pendingUpdates.clear();
    this.structureChanged = false;

    try {
      let changed = true;
      if (structureChanged) {
        await this.graphBuilder.buildGraph();
      } else {
        changed = await this.graphBuilder.applyChanges(updates);
      }

      if (changed) {
        this.onUpdateCallback?.();
      }
    } catch (error) {
      console.error('Failed to apply file changes:', error);
    }
  }

  /**
   * Get disposable for cleanup
   */
  toDisposable(): vscode.Disposable {
    return {
      dispose: () => this.stop()
    };
  }
}

export { FileWatcher as default };
