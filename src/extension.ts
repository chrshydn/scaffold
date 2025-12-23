import * as vscode from 'vscode';
import { ScaffoldViewProvider } from './views/ScaffoldViewProvider';
import { FileMetricsCalculator } from './analyzers/fileMetrics';

let viewProvider: ScaffoldViewProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('Scaffold: No workspace folder open');
    return;
  }

  // Create the view provider
  viewProvider = new ScaffoldViewProvider(context.extensionUri, workspaceRoot);

  // Register the webview provider
  const viewProviderDisposable = vscode.window.registerWebviewViewProvider(
    ScaffoldViewProvider.viewType,
    viewProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }
  );
  context.subscriptions.push(viewProviderDisposable);

  // Register refresh command
  const refreshCommand = vscode.commands.registerCommand('scaffold.refresh', () => {
    if (viewProvider) {
      viewProvider.runAnalysis();
    }
  });
  context.subscriptions.push(refreshCommand);

  // Register show file metrics command
  const showMetricsCommand = vscode.commands.registerCommand(
    'scaffold.showFileMetrics',
    async (uri?: vscode.Uri) => {
      const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!filePath || !viewProvider) {
        return;
      }

      const metrics = viewProvider.getFileMetrics(filePath);
      if (metrics) {
        const tier = FileMetricsCalculator.getImportanceTier(metrics);
        const tierEmoji = {
          critical: '🔴',
          high: '🟠',
          medium: '🟡',
          low: '🟢'
        }[tier];

        const message = [
          `${tierEmoji} ${metrics.relativePath}`,
          ``,
          `Imported by: ${metrics.metrics.inDegree} files`,
          `Imports: ${metrics.metrics.outDegree} files`,
          `Importance: ${metrics.metrics.importanceScore}/100`,
          metrics.metrics.isLeaf ? '🍃 Leaf file (safe to modify)' : '',
          metrics.metrics.isLoadBearing ? '⚠️ Load-bearing (changes propagate widely)' : ''
        ].filter(Boolean).join('\n');

        vscode.window.showInformationMessage(message, { modal: false });
      } else {
        vscode.window.showInformationMessage('No metrics available for this file');
      }
    }
  );
  context.subscriptions.push(showMetricsCommand);

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'scaffold.showFileMetrics';
  context.subscriptions.push(statusBarItem);

  // Update status bar on active editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar)
  );

  // Initial status bar update
  updateStatusBar(vscode.window.activeTextEditor);

  console.log('Scaffold extension activated');
}

/**
 * Update the status bar with current file metrics
 */
function updateStatusBar(editor: vscode.TextEditor | undefined) {
  if (!statusBarItem || !viewProvider || !editor) {
    if (statusBarItem) {
      statusBarItem.hide();
    }
    return;
  }

  const filePath = editor.document.uri.fsPath;

  // Only show for TypeScript files
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
    statusBarItem.hide();
    return;
  }

  const metrics = viewProvider.getFileMetrics(filePath);
  if (metrics) {
    const tier = FileMetricsCalculator.getImportanceTier(metrics);
    const tierIcon = {
      critical: '$(circle-filled)',
      high: '$(circle-outline)',
      medium: '$(primitive-dot)',
      low: '$(dash)'
    }[tier];

    statusBarItem.text = `${tierIcon} ${metrics.metrics.inDegree}↓ ${metrics.metrics.outDegree}↑`;
    statusBarItem.tooltip = `Scaffold: ${metrics.metrics.inDegree} files import this, imports ${metrics.metrics.outDegree} files\nClick for details`;
    statusBarItem.show();
  } else {
    statusBarItem.text = '$(loading~spin) Scaffold';
    statusBarItem.tooltip = 'Scaffold: Analyzing...';
    statusBarItem.show();
  }
}

/**
 * Get the workspace root folder
 */
function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return undefined;
}

/**
 * Extension deactivation
 */
export function deactivate() {
  if (viewProvider) {
    viewProvider.dispose();
  }
}
