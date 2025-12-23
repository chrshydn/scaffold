import * as vscode from 'vscode';
import * as path from 'path';
import { ImportGraphBuilder } from '../analyzers/importGraphBuilder';

/**
 * Watches for file changes and triggers incremental graph updates
 */
export class FileWatcher {
  private workspaceRoot: string;
  private graphBuilder: ImportGraphBuilder;
  private watcher: vscode.FileSystemWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingUpdates: Set<string> = new Set();
  private pendingDeletes: Set<string> = new Set();
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
    this.onUpdateCallback = onUpdate;

    // Watch TypeScript/TSX files
    const pattern = new vscode.RelativePattern(
      this.workspaceRoot,
      '**/*.{ts,tsx}'
    );

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidCreate((uri) => this.handleCreate(uri));
    this.watcher.onDidChange((uri) => this.handleChange(uri));
    this.watcher.onDidDelete((uri) => this.handleDelete(uri));
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

  /**
   * Handle file creation
   */
  private handleCreate(uri: vscode.Uri): void {
    if (this.shouldIgnore(uri.fsPath)) {
      return;
    }

    this.pendingUpdates.add(uri.fsPath);
    this.scheduleFlush();
  }

  /**
   * Handle file change
   */
  private handleChange(uri: vscode.Uri): void {
    if (this.shouldIgnore(uri.fsPath)) {
      return;
    }

    this.pendingUpdates.add(uri.fsPath);
    this.scheduleFlush();
  }

  /**
   * Handle file deletion
   */
  private handleDelete(uri: vscode.Uri): void {
    if (this.shouldIgnore(uri.fsPath)) {
      return;
    }

    // Remove from pending updates if present
    this.pendingUpdates.delete(uri.fsPath);
    this.pendingDeletes.add(uri.fsPath);
    this.scheduleFlush();
  }

  /**
   * Check if a file should be ignored
   */
  private shouldIgnore(filePath: string): boolean {
    // Ignore node_modules
    if (filePath.includes('node_modules')) {
      return true;
    }

    // Ignore files outside workspace
    const normalized = filePath.replace(/\\/g, '/');
    const rootNormalized = this.workspaceRoot.replace(/\\/g, '/');
    if (!normalized.startsWith(rootNormalized)) {
      return true;
    }

    // Ignore non-TypeScript files
    const ext = path.extname(filePath);
    if (!['.ts', '.tsx'].includes(ext)) {
      return true;
    }

    return false;
  }

  /**
   * Schedule a debounced flush of pending updates
   */
  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushUpdates();
    }, this.DEBOUNCE_MS);
  }

  /**
   * Flush all pending updates
   */
  private async flushUpdates(): Promise<void> {
    const updates = Array.from(this.pendingUpdates);
    const deletes = Array.from(this.pendingDeletes);

    this.pendingUpdates.clear();
    this.pendingDeletes.clear();

    // Process deletes first
    for (const filePath of deletes) {
      this.graphBuilder.removeFile(filePath);
    }

    // Process updates
    for (const filePath of updates) {
      try {
        await this.graphBuilder.updateFile(filePath);
      } catch (error) {
        console.error(`Failed to update ${filePath}:`, error);
      }
    }

    // Trigger callback if any changes were made
    if ((updates.length > 0 || deletes.length > 0) && this.onUpdateCallback) {
      this.onUpdateCallback();
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
