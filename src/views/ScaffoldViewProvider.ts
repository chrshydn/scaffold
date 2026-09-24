import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { AnalysisResult, CurrentFileInfo, FileNode, WebviewMessage } from '../models/types';
import { ImportGraph } from '../models/graph';
import {
  FrameworkDetector,
  EntryPointFinder,
  ImportGraphBuilder,
  NavigationAnalyzer,
  FileMetricsCalculator
} from '../analyzers';
import { FileWatcher } from '../watchers/fileWatcher';

const LOAD_BEARING_LIMIT = 15;

/**
 * WebView provider for the Scaffold sidebar panel
 */
export class ScaffoldViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'scaffold.structureView';

  private _view?: vscode.WebviewView;
  private workspaceRoot: string;
  private graphBuilder: ImportGraphBuilder;
  private fileWatcher: FileWatcher;
  private metricsCalculator: FileMetricsCalculator;
  private analysisResult?: AnalysisResult;
  private analysisPromise?: Promise<void>;
  private currentFilePath?: string;
  /** Graph changed while the view was hidden; refresh on next show */
  private graphDirty = false;

  private readonly _onDidUpdateGraph = new vscode.EventEmitter<void>();
  /** Fires whenever the import graph changes (full analysis or incremental update) */
  public readonly onDidUpdateGraph = this._onDidUpdateGraph.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    workspaceRoot: string
  ) {
    this.workspaceRoot = workspaceRoot;
    this.graphBuilder = new ImportGraphBuilder(workspaceRoot);
    this.fileWatcher = new FileWatcher(workspaceRoot, this.graphBuilder);
    this.metricsCalculator = new FileMetricsCalculator(workspaceRoot);
  }

  /**
   * Called when the webview is created
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    const messageListener = webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message)
    );
    webviewView.onDidDispose(() => {
      messageListener.dispose();
      this._view = undefined;
    });

    this.fileWatcher.start(() => this.onFileChanged());

    if (!this.analysisResult) {
      this.runAnalysis();
    }
  }

  /**
   * Handle messages from the webview
   */
  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'refresh':
        await this.runAnalysis();
        break;

      case 'openFile': {
        const doc = await vscode.workspace.openTextDocument(message.filePath);
        await vscode.window.showTextDocument(doc);
        break;
      }

      case 'requestData':
        // Sent whenever the webview (re)loads, e.g. after being hidden
        if (this.analysisResult) {
          this.publishResult();
        } else {
          await this.runAnalysis();
        }
        break;
    }
  }

  /**
   * Update current file tracking and send to webview
   */
  public updateCurrentFile(filePath: string | undefined): void {
    if (filePath === this.currentFilePath) {
      return;
    }
    this.currentFilePath = filePath;
    this.sendCurrentFileInfo();
  }

  /**
   * Send current file dependency info to webview
   */
  private sendCurrentFileInfo(): void {
    if (!this._view) {
      return;
    }
    this.sendMessage({ type: 'currentFile', data: this.getCurrentFileInfo() });
  }

  private getCurrentFileInfo(): CurrentFileInfo | null {
    if (!this.currentFilePath) {
      return null;
    }

    const graph = this.graphBuilder.getGraph();
    const node = graph.getNode(this.currentFilePath);
    if (!node) {
      return null;
    }

    // Edges always point at nodes (addEdge creates both ends)
    const toSummary = (p: string) => ImportGraph.toSummary(graph.getNode(p)!);
    return {
      relativePath: node.relativePath,
      imports: node.imports.map(toSummary),
      importedBy: node.importedBy.map(toSummary)
    };
  }

  /**
   * Run the full analysis. Concurrent callers share the in-flight run.
   */
  public runAnalysis(): Promise<void> {
    if (!this.analysisPromise) {
      this.analysisPromise = this.doAnalysis().finally(() => {
        this.analysisPromise = undefined;
      });
    }
    return this.analysisPromise;
  }

  public get isAnalyzing(): boolean {
    return this.analysisPromise !== undefined;
  }

  private async doAnalysis(): Promise<void> {
    try {
      await vscode.window.withProgress(
        {
          // Show progress inside the view rather than as a popup notification
          location: { viewId: ScaffoldViewProvider.viewType },
          title: 'Scaffold: Analyzing codebase...'
        },
        async (progress) => {
          const framework = new FrameworkDetector(this.workspaceRoot).detect();
          const entryPoints = new EntryPointFinder(this.workspaceRoot).findEntryPoints(framework);

          // Navigation analysis is independent of the graph; run them together
          const [graph, navigation] = await Promise.all([
            this.graphBuilder.buildGraph(progress),
            new NavigationAnalyzer(this.workspaceRoot).analyze(framework.framework)
          ]);

          this.analysisResult = {
            framework: { ...framework, displayName: FrameworkDetector.getDisplayName(framework.framework) },
            entryPoints,
            navigation,
            ...this.graphDerivedResult(graph)
          };
          this.publishResult();
          this._onDidUpdateGraph.fire();
        }
      );
    } catch (error) {
      console.error('Analysis failed:', error);
      this.sendMessage({
        type: 'error',
        message: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  /**
   * Handle incremental changes from the watcher
   */
  private onFileChanged(): void {
    this._onDidUpdateGraph.fire();
    if (!this.analysisResult) {
      return;
    }
    // Skip the work while hidden: the webview re-requests data when shown
    this.graphDirty = true;
    if (this._view?.visible) {
      this.publishResult();
    }
  }

  private graphDerivedResult(graph: ImportGraph) {
    return {
      ...this.metricsCalculator.getDirectoryStats(graph),
      loadBearingFiles: graph.getLoadBearingFiles(LOAD_BEARING_LIMIT).map(ImportGraph.toSummary),
      leafFiles: graph.getLeafFiles().map(ImportGraph.toSummary),
      totalFiles: graph.getFileCount()
    };
  }

  /**
   * Push the current result (refreshed if the graph changed) and current file to the webview
   */
  private publishResult(): void {
    if (!this.analysisResult) {
      return;
    }
    if (this.graphDirty) {
      this.analysisResult = { ...this.analysisResult, ...this.graphDerivedResult(this.graphBuilder.getGraph()) };
      this.graphDirty = false;
    }
    this.sendMessage({ type: 'analysisResult', data: this.analysisResult });
    this.sendCurrentFileInfo();
  }

  /**
   * Send a message to the webview
   */
  private sendMessage(message: WebviewMessage): void {
    this._view?.webview.postMessage(message);
  }

  /**
   * Get file metrics for a specific file (for status bar)
   */
  public getFileMetrics(filePath: string): FileNode | undefined {
    return this.graphBuilder.getGraph().getNode(filePath);
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.fileWatcher.stop();
    this._onDidUpdateGraph.dispose();
  }

  /**
   * Generate the HTML shell for the webview
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const mediaUri = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', file));
    const nonce = crypto.randomBytes(16).toString('base64');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${mediaUri('webview.css')}">
  <title>Scaffold</title>
</head>
<body>
  <div class="container" id="app">
    <div class="loading">
      <div class="loading-spinner"></div>
      <div>Analyzing codebase...</div>
    </div>
  </div>
  <script nonce="${nonce}" src="${mediaUri('webview.js')}"></script>
</body>
</html>`;
  }
}

export { ScaffoldViewProvider as default };
