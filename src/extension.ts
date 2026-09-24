import * as vscode from 'vscode';
import { ScaffoldViewProvider } from './views/ScaffoldViewProvider';
import { FileMetricsCalculator } from './analyzers/fileMetrics';
import { isSourceFile } from './parsers/typescriptParser';

let viewProvider: ScaffoldViewProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): ScaffoldViewProvider | undefined {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('Scaffold: No workspace folder open');
    return;
  }

  // Create the view provider
  viewProvider = new ScaffoldViewProvider(context.extensionUri, workspaceRoot);

  // Register the webview provider
  // No retainContextWhenHidden: the webview persists its own UI state and
  // re-requests data from the cached analysis when shown again.
  context.subscriptions.push(
    viewProvider,
    vscode.window.registerWebviewViewProvider(ScaffoldViewProvider.viewType, viewProvider)
  );

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

  // Update status bar and current file on active editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateStatusBar(editor);
      if (viewProvider) {
        viewProvider.updateCurrentFile(editor?.document.uri.fsPath);
      }
    })
  );

  // Refresh status bar whenever the graph changes
  context.subscriptions.push(
    viewProvider.onDidUpdateGraph(() => updateStatusBar(vscode.window.activeTextEditor))
  );

  // Initial status bar update and current file
  updateStatusBar(vscode.window.activeTextEditor);
  viewProvider.updateCurrentFile(vscode.window.activeTextEditor?.document.uri.fsPath);

  // Exported as the extension API (used by the integration tests)
  return viewProvider;
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

  // Only show for analyzed source files
  if (!isSourceFile(filePath)) {
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
  } else if (viewProvider.isAnalyzing) {
    statusBarItem.text = '$(loading~spin) Scaffold';
    statusBarItem.tooltip = 'Scaffold: Analyzing...';
    statusBarItem.show();
  } else {
    statusBarItem.hide();
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
  viewProvider = undefined;
  statusBarItem = undefined;
}
