import * as vscode from 'vscode';
import * as path from 'path';
import {
  AnalysisResult,
  WebviewMessage,
  FrameworkInfo,
  EntryPoint,
  NavigationStructure,
  DirectoryStats,
  FileNode
} from '../models/types';
import { ImportGraph } from '../models/graph';
import {
  FrameworkDetector,
  EntryPointFinder,
  ImportGraphBuilder,
  NavigationAnalyzer,
  FileMetricsCalculator
} from '../analyzers';
import { FileWatcher } from '../watchers/fileWatcher';

/**
 * WebView provider for the Scaffold sidebar panel
 */
export class ScaffoldViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'scaffold.structureView';

  private _view?: vscode.WebviewView;
  private workspaceRoot: string;
  private graphBuilder: ImportGraphBuilder;
  private fileWatcher: FileWatcher;
  private analysisResult?: AnalysisResult;
  private isAnalyzing = false;
  private currentFilePath?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    workspaceRoot: string
  ) {
    this.workspaceRoot = workspaceRoot;
    this.graphBuilder = new ImportGraphBuilder(workspaceRoot);
    this.fileWatcher = new FileWatcher(workspaceRoot, this.graphBuilder);
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
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message)
    );

    // Start file watcher
    this.fileWatcher.start(() => this.onFileChanged());

    // Run initial analysis
    this.runAnalysis();
  }

  /**
   * Handle messages from the webview
   */
  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'refresh':
        await this.runAnalysis();
        break;

      case 'openFile':
        if ('filePath' in message) {
          const doc = await vscode.workspace.openTextDocument(message.filePath);
          await vscode.window.showTextDocument(doc);
        }
        break;

      case 'requestData':
        if (this.analysisResult) {
          this.sendMessage({ type: 'analysisResult', data: this.analysisResult });
          this.sendCurrentFileInfo();
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
    this.currentFilePath = filePath;
    this.sendCurrentFileInfo();
  }

  /**
   * Send current file dependency info to webview
   */
  private sendCurrentFileInfo(): void {
    if (!this._view || !this.currentFilePath) {
      this.sendMessage({ type: 'currentFile', data: null } as any);
      return;
    }

    const graph = this.graphBuilder.getGraph();
    const node = graph.getNode(this.currentFilePath);

    if (!node) {
      this.sendMessage({ type: 'currentFile', data: null } as any);
      return;
    }

    // Get full info for imports and importedBy
    const imports = node.imports.map(p => {
      const n = graph.getNode(p);
      return { filePath: p, relativePath: n?.relativePath || p };
    });

    const importedBy = node.importedBy.map(p => {
      const n = graph.getNode(p);
      return { filePath: p, relativePath: n?.relativePath || p };
    });

    this.sendMessage({
      type: 'currentFile',
      data: {
        filePath: this.currentFilePath,
        relativePath: node.relativePath,
        imports,
        importedBy,
        metrics: node.metrics
      }
    } as any);
  }

  /**
   * Run the full analysis
   */
  public async runAnalysis(): Promise<void> {
    if (this.isAnalyzing) {
      return;
    }

    this.isAnalyzing = true;

    try {
      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Scaffold: Analyzing codebase...',
          cancellable: false
        },
        async (progress) => {
          // Detect framework
          const frameworkDetector = new FrameworkDetector(this.workspaceRoot);
          const frameworkInfo = frameworkDetector.detect();
          progress.report({ message: `Detected: ${FrameworkDetector.getDisplayName(frameworkInfo.framework)}` });

          // Find entry points
          const entryPointFinder = new EntryPointFinder(this.workspaceRoot);
          const entryPoints = entryPointFinder.findEntryPoints(frameworkInfo);
          progress.report({ message: 'Found entry points' });

          // Build import graph
          const graph = await this.graphBuilder.buildGraph(progress);
          progress.report({ message: 'Built import graph' });

          // Analyze navigation
          const navigationAnalyzer = new NavigationAnalyzer(this.workspaceRoot);
          const navigation = await navigationAnalyzer.analyze(frameworkInfo.framework);
          progress.report({ message: 'Analyzed navigation' });

          // Calculate metrics
          const metricsCalculator = new FileMetricsCalculator(this.workspaceRoot);
          const directories = metricsCalculator.getDirectoryStats(graph);
          const loadBearingFiles = metricsCalculator.getLoadBearingFiles(graph);
          const leafFiles = metricsCalculator.getLeafFiles(graph);

          // Group files by directory
          const allNodes = graph.getAllNodes();
          const filesByDirectory: { [dir: string]: { filePath: string; relativePath: string; metrics: any }[] } = {};
          for (const node of allNodes) {
            const parts = node.relativePath.split(/[\\/]/);
            let dirKey = parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
            // Simplify to top-level dir
            const topParts = dirKey.split('/');
            if (topParts[0] === 'src' && topParts.length > 1) {
              dirKey = 'src/' + topParts[1];
            } else {
              dirKey = topParts[0];
            }
            if (!filesByDirectory[dirKey]) {
              filesByDirectory[dirKey] = [];
            }
            filesByDirectory[dirKey].push({
              filePath: node.filePath,
              relativePath: node.relativePath,
              metrics: node.metrics
            });
          }

          // Build result
          this.analysisResult = {
            framework: frameworkInfo,
            entryPoints: this.convertEntryPoints(entryPoints),
            navigation,
            directories,
            filesByDirectory,
            loadBearingFiles,
            leafFiles,
            totalFiles: graph.getFileCount(),
            timestamp: Date.now()
          } as any;

          // Send to webview
          this.sendMessage({ type: 'analysisResult', data: this.analysisResult } as any);
        }
      );
    } catch (error) {
      console.error('Analysis failed:', error);
      this.sendMessage({
        type: 'error',
        message: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      this.isAnalyzing = false;
    }
  }

  /**
   * Handle file changes from the watcher
   */
  private onFileChanged(): void {
    // Recalculate metrics
    const graph = this.graphBuilder.getGraph();
    const metricsCalculator = new FileMetricsCalculator(this.workspaceRoot);

    if (this.analysisResult) {
      this.analysisResult.loadBearingFiles = metricsCalculator.getLoadBearingFiles(graph);
      this.analysisResult.leafFiles = metricsCalculator.getLeafFiles(graph);
      this.analysisResult.directories = metricsCalculator.getDirectoryStats(graph);
      this.analysisResult.totalFiles = graph.getFileCount();
      this.analysisResult.timestamp = Date.now();

      this.sendMessage({ type: 'analysisResult', data: this.analysisResult });
    }
  }

  /**
   * Convert entry points to include relative paths
   */
  private convertEntryPoints(entryPoints: EntryPoint[]): EntryPoint[] {
    return entryPoints.map(ep => ({
      ...ep,
      filePath: ep.filePath
    }));
  }

  /**
   * Send a message to the webview
   */
  private sendMessage(message: WebviewMessage): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * Get file metrics for a specific file (for status bar)
   */
  public getFileMetrics(filePath: string): FileNode | undefined {
    const graph = this.graphBuilder.getGraph();
    return graph.getNode(filePath);
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.fileWatcher.stop();
  }

  /**
   * Generate the HTML content for the webview
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'views', 'webview', 'styles.css')
    );

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'views', 'webview', 'main.js')
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Scaffold</title>
  <style>
    :root {
      --vscode-font-family: var(--vscode-editor-font-family, 'Segoe UI', sans-serif);
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
      padding: 0;
      margin: 0;
    }

    .container {
      padding: 12px;
    }

    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      text-align: center;
    }

    .loading-spinner {
      width: 24px;
      height: 24px;
      border: 2px solid var(--vscode-progressBar-background);
      border-top-color: var(--vscode-button-background);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 12px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .section {
      margin-bottom: 16px;
    }

    .section-header {
      display: flex;
      align-items: center;
      padding: 6px 0;
      cursor: pointer;
      user-select: none;
    }

    .section-header:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .section-icon {
      margin-right: 6px;
      font-size: 10px;
      transition: transform 0.15s ease;
    }

    .section-icon.collapsed {
      transform: rotate(-90deg);
    }

    .section-title {
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground);
    }

    .section-badge {
      margin-left: auto;
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10px;
    }

    .section-content {
      padding-left: 16px;
      overflow: hidden;
      transition: max-height 0.2s ease;
    }

    .section-content.collapsed {
      max-height: 0 !important;
    }

    .item {
      display: flex;
      align-items: center;
      padding: 4px 8px;
      cursor: pointer;
      border-radius: 3px;
    }

    .item:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .item-icon {
      margin-right: 8px;
      opacity: 0.7;
    }

    .item-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-badge {
      margin-left: 8px;
      font-size: 10px;
      opacity: 0.7;
    }

    .importance-critical {
      color: var(--vscode-charts-red);
    }

    .importance-high {
      color: var(--vscode-charts-orange);
    }

    .importance-medium {
      color: var(--vscode-charts-yellow);
    }

    .importance-low {
      color: var(--vscode-charts-green);
    }

    .framework-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      background-color: var(--vscode-button-secondaryBackground);
      border-radius: 4px;
      margin-bottom: 8px;
    }

    .framework-name {
      font-weight: 600;
    }

    .framework-version {
      margin-left: 6px;
      opacity: 0.7;
      font-size: 11px;
    }

    .stats-row {
      display: flex;
      gap: 16px;
      margin-bottom: 12px;
      padding: 8px;
      background-color: var(--vscode-editor-background);
      border-radius: 4px;
    }

    .stat {
      text-align: center;
    }

    .stat-value {
      font-size: 18px;
      font-weight: 600;
      color: var(--vscode-textLink-foreground);
    }

    .stat-label {
      font-size: 10px;
      opacity: 0.7;
      text-transform: uppercase;
    }

    .empty-state {
      text-align: center;
      padding: 20px;
      opacity: 0.7;
    }

    .tree-item {
      padding-left: 12px;
    }

    .tree-children {
      padding-left: 12px;
      border-left: 1px solid var(--vscode-tree-indentGuidesStroke);
      margin-left: 6px;
    }

    .error-message {
      color: var(--vscode-errorForeground);
      padding: 12px;
      background-color: var(--vscode-inputValidation-errorBackground);
      border-radius: 4px;
      margin: 12px;
    }

    .dir-category {
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 3px;
      margin-left: 6px;
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }

    .item-readonly {
      cursor: default;
      opacity: 0.9;
    }

    .item-readonly:hover {
      background-color: transparent;
    }

    .expand-toggle {
      justify-content: center;
      color: var(--vscode-textLink-foreground);
      font-size: 11px;
      margin-top: 4px;
      opacity: 0.8;
    }

    .expand-toggle:hover {
      opacity: 1;
    }

    .current-file-section {
      background-color: var(--vscode-editor-background);
      border-radius: 6px;
      padding: 8px;
      margin-bottom: 16px;
      border: 1px solid var(--vscode-panel-border);
    }

    .current-file-header {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--vscode-panel-border);
      color: var(--vscode-textLink-foreground);
    }

    .current-file-section .section {
      margin-bottom: 8px;
    }

    .current-file-section .section-content {
      padding-left: 8px;
    }
  </style>
</head>
<body>
  <div class="container" id="app">
    <div class="loading" id="loading">
      <div class="loading-spinner"></div>
      <div>Analyzing codebase...</div>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let analysisData = null;
    let currentFileData = null;
    let collapsedSections = new Set();

    // Request initial data
    vscode.postMessage({ type: 'requestData' });

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'analysisResult':
          analysisData = message.data;
          render();
          break;
        case 'currentFile':
          currentFileData = message.data;
          render();
          break;
        case 'analysisProgress':
          updateProgress(message.progress, message.message);
          break;
        case 'error':
          showError(message.message);
          break;
      }
    });

    // Event delegation - handle all clicks
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;

      if (action === 'toggle-section') {
        const sectionId = target.dataset.section;
        toggleSection(sectionId);
      } else if (action === 'open-file') {
        const filePath = target.dataset.filepath;
        openFile(filePath);
      } else if (action === 'toggle-expand') {
        const sectionId = target.dataset.section;
        toggleSection(sectionId);
      } else if (action === 'toggle-dir') {
        const dirName = target.dataset.dir;
        toggleSection('dir-' + dirName);
      }
    });

    function render() {
      const app = document.getElementById('app');
      if (!analysisData) {
        app.innerHTML = '<div class="loading"><div class="loading-spinner"></div><div>Analyzing codebase...</div></div>';
        return;
      }

      const { framework, entryPoints, navigation, directories, loadBearingFiles, leafFiles, totalFiles } = analysisData;

      let html = '';

      // Framework info
      html += '<div class="framework-badge">';
      html += '<span class="framework-name">' + getFrameworkDisplayName(framework.framework) + '</span>';
      if (framework.version) {
        html += '<span class="framework-version">v' + escapeHtml(framework.version) + '</span>';
      }
      html += '</div>';

      // Stats row
      html += '<div class="stats-row">';
      html += '<div class="stat"><div class="stat-value">' + totalFiles + '</div><div class="stat-label">Files</div></div>';
      html += '<div class="stat"><div class="stat-value">' + loadBearingFiles.length + '</div><div class="stat-label">Core</div></div>';
      html += '<div class="stat"><div class="stat-value">' + leafFiles.length + '</div><div class="stat-label">Leaf</div></div>';
      html += '</div>';

      // Current file dependencies section
      if (currentFileData) {
        html += '<div class="current-file-section">';
        html += '<div class="current-file-header">' + escapeHtml(currentFileData.relativePath.split(/[\\\\/]/).pop()) + '</div>';

        // Files this imports
        html += renderSection('current-imports', 'This File Imports', currentFileData.imports.length, () => {
          if (currentFileData.imports.length === 0) return '<div class="empty-state">No imports</div>';
          return currentFileData.imports.map(f => renderFileItem(f.filePath, '→', null)).join('');
        });

        // Files that import this (affected by changes)
        html += renderSection('current-importedby', 'Affected By Changes', currentFileData.importedBy.length, () => {
          if (currentFileData.importedBy.length === 0) return '<div class="empty-state">No dependents (safe to modify)</div>';
          return currentFileData.importedBy.map(f => renderFileItem(f.filePath, '←', null)).join('');
        });

        html += '</div>';
      }

      // Entry Points section
      html += renderSection('entry-points', 'Entry Points', entryPoints.length, () => {
        if (entryPoints.length === 0) return '<div class="empty-state">No entry points found</div>';
        return entryPoints.map(ep => renderFileItem(ep.filePath, getEntryTypeIcon(ep.type), ep.type)).join('');
      });

      // Navigation section
      if (navigation.type !== 'none') {
        html += renderSection('navigation', 'Navigation', navigation.routes.length, () => {
          if (navigation.routes.length === 0) return '<div class="empty-state">No routes found</div>';
          return renderRouteTree(navigation.routes);
        });
      }

      // Architecture section
      html += renderSection('architecture', 'Architecture', directories.length, () => {
        if (directories.length === 0) return '<div class="empty-state">No directories found</div>';
        return directories.map(dir => renderDirectoryItem(dir)).join('');
      });

      // Load-bearing files section
      html += renderSection('load-bearing', 'Load-Bearing Files', loadBearingFiles.length, () => {
        if (loadBearingFiles.length === 0) return '<div class="empty-state">No high-impact files found</div>';
        return loadBearingFiles.slice(0, 15).map(file => {
          const tier = getImportanceTier(file.metrics.importanceScore);
          return renderFileItem(file.filePath, '⬤', file.metrics.inDegree + ' imports', 'importance-' + tier);
        }).join('');
      });

      // Leaf files section
      html += renderSection('leaf-files', 'Leaf Files', leafFiles.length, () => {
        if (leafFiles.length === 0) return '<div class="empty-state">No leaf files found</div>';
        const isExpanded = collapsedSections.has('leaf-files-expand');
        const displayLimit = isExpanded ? leafFiles.length : 20;
        const displayLeafs = leafFiles.slice(0, displayLimit);
        let result = displayLeafs.map(file => renderFileItem(file.filePath, '🍃')).join('');
        if (leafFiles.length > 20) {
          if (isExpanded) {
            result += '<div class="item expand-toggle" data-action="toggle-expand" data-section="leaf-files-expand">▲ Show less</div>';
          } else {
            result += '<div class="item expand-toggle" data-action="toggle-expand" data-section="leaf-files-expand">▼ Show ' + (leafFiles.length - 20) + ' more</div>';
          }
        }
        return result;
      });

      app.innerHTML = html;
    }

    function renderSection(id, title, count, contentFn) {
      const isCollapsed = collapsedSections.has(id);
      return '<div class="section" data-section="' + id + '">' +
        '<div class="section-header" data-action="toggle-section" data-section="' + id + '">' +
        '<span class="section-icon ' + (isCollapsed ? 'collapsed' : '') + '">▼</span>' +
        '<span class="section-title">' + escapeHtml(title) + '</span>' +
        '<span class="section-badge">' + count + '</span>' +
        '</div>' +
        '<div class="section-content ' + (isCollapsed ? 'collapsed' : '') + '" style="max-height: ' + (isCollapsed ? '0' : '2000px') + '">' +
        contentFn() +
        '</div>' +
        '</div>';
    }

    function renderFileItem(filePath, icon, badge, extraClass) {
      const name = filePath.split(/[\\\\/]/).pop();
      const relativePath = getRelativePath(filePath);
      return '<div class="item" data-action="open-file" data-filepath="' + escapeAttr(filePath) + '" title="' + escapeHtml(relativePath) + '">' +
        '<span class="item-icon ' + (extraClass || '') + '">' + icon + '</span>' +
        '<span class="item-name">' + escapeHtml(name) + '</span>' +
        (badge ? '<span class="item-badge">' + escapeHtml(String(badge)) + '</span>' : '') +
        '</div>';
    }

    function renderRouteTree(routes, depth) {
      depth = depth || 0;
      return routes.map(route => {
        let html = '<div class="tree-item">';
        if (route.filePath) {
          html += '<div class="item" data-action="open-file" data-filepath="' + escapeAttr(route.filePath) + '">';
        } else {
          html += '<div class="item">';
        }
        html += '<span class="item-icon">' + getRouteIcon(route.type) + '</span>';
        html += '<span class="item-name">' + escapeHtml(route.name) + '</span>';
        html += '</div>';
        if (route.children && route.children.length > 0) {
          html += '<div class="tree-children">' + renderRouteTree(route.children, depth + 1) + '</div>';
        }
        html += '</div>';
        return html;
      }).join('');
    }

    function renderDirectoryItem(dir) {
      const isExpanded = collapsedSections.has('dir-' + dir.path);
      const files = analysisData.filesByDirectory[dir.path] || [];

      let html = '<div class="dir-item">';
      html += '<div class="item" data-action="toggle-dir" data-dir="' + escapeAttr(dir.path) + '">';
      html += '<span class="section-icon ' + (isExpanded ? '' : 'collapsed') + '">▼</span>';
      html += '<span class="item-icon">📁</span>';
      html += '<span class="item-name">' + escapeHtml(dir.name) + '</span>';
      if (dir.category && dir.category !== 'other') {
        html += '<span class="dir-category">' + dir.category + '</span>';
      }
      html += '<span class="item-badge">' + dir.fileCount + '</span>';
      html += '</div>';

      if (isExpanded && files.length > 0) {
        html += '<div class="tree-children">';
        files.forEach(file => {
          const fileName = file.relativePath.split(/[\\\\/]/).pop();
          const tier = getImportanceTier(file.metrics.importanceScore);
          html += '<div class="item" data-action="open-file" data-filepath="' + escapeAttr(file.filePath) + '">';
          html += '<span class="item-icon importance-' + tier + '">◆</span>';
          html += '<span class="item-name">' + escapeHtml(fileName) + '</span>';
          html += '<span class="item-badge">' + file.metrics.inDegree + '↓ ' + file.metrics.outDegree + '↑</span>';
          html += '</div>';
        });
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    function toggleSection(id) {
      if (collapsedSections.has(id)) {
        collapsedSections.delete(id);
      } else {
        collapsedSections.add(id);
      }
      render();
    }

    function openFile(filePath) {
      vscode.postMessage({ type: 'openFile', filePath: filePath });
    }

    function getFrameworkDisplayName(framework) {
      const names = {
        'expo': 'Expo',
        'react-native': 'React Native',
        'nextjs': 'Next.js',
        'react-web': 'React',
        'unknown': 'Unknown'
      };
      return names[framework] || framework;
    }

    function getEntryTypeIcon(type) {
      const icons = { main: '🚀', app: '📱', page: '📄', layout: '🏗️', index: '📋' };
      return icons[type] || '📄';
    }

    function getRouteIcon(type) {
      const icons = { screen: '📱', page: '📄', layout: '🏗️', navigator: '🧭', route: '🔗' };
      return icons[type] || '📄';
    }

    function getImportanceTier(score) {
      if (score >= 75) return 'critical';
      if (score >= 50) return 'high';
      if (score >= 25) return 'medium';
      return 'low';
    }

    function getRelativePath(filePath) {
      const parts = filePath.split(/[\\\\/]/);
      return parts.slice(-3).join('/');
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function escapeAttr(str) {
      return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function updateProgress(percent, message) {
      const loading = document.getElementById('loading');
      if (loading) {
        loading.querySelector('div:last-child').textContent = message + ' (' + percent + '%)';
      }
    }

    function showError(message) {
      const app = document.getElementById('app');
      app.innerHTML = '<div class="error-message">' + escapeHtml(message) + '</div>';
    }
  </script>
</body>
</html>`;
  }

  /**
   * Generate a nonce for CSP
   */
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}

export { ScaffoldViewProvider as default };
