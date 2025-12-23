/**
 * Scaffold WebView Main Script
 * Note: This script is inlined in the HTML for CSP compliance.
 * This file serves as documentation and for easier editing.
 */

// VS Code API
const vscode = acquireVsCodeApi();

// State
let analysisData = null;
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
    case 'analysisProgress':
      updateProgress(message.progress, message.message);
      break;
    case 'error':
      showError(message.message);
      break;
  }
});

/**
 * Main render function
 */
function render() {
  const app = document.getElementById('app');
  if (!analysisData) {
    app.innerHTML = `
      <div class="loading">
        <div class="loading-spinner"></div>
        <div>Analyzing codebase...</div>
      </div>
    `;
    return;
  }

  const { framework, entryPoints, navigation, directories, loadBearingFiles, leafFiles, totalFiles } = analysisData;

  let html = '';

  // Framework info
  html += `
    <div class="framework-badge">
      <span class="framework-name">${getFrameworkDisplayName(framework.framework)}</span>
      ${framework.version ? `<span class="framework-version">v${escapeHtml(framework.version)}</span>` : ''}
    </div>
  `;

  // Stats row
  html += `
    <div class="stats-row">
      <div class="stat"><div class="stat-value">${totalFiles}</div><div class="stat-label">Files</div></div>
      <div class="stat"><div class="stat-value">${loadBearingFiles.length}</div><div class="stat-label">Core</div></div>
      <div class="stat"><div class="stat-value">${leafFiles.length}</div><div class="stat-label">Leaf</div></div>
    </div>
  `;

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
    return directories.slice(0, 10).map(dir => `
      <div class="item">
        <span class="item-icon">📁</span>
        <span class="item-name">${escapeHtml(dir.name)}</span>
        ${dir.category && dir.category !== 'other' ? `<span class="dir-category">${dir.category}</span>` : ''}
        <span class="item-badge">${dir.fileCount}</span>
      </div>
    `).join('');
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
    const displayLeafs = leafFiles.slice(0, 20);
    return displayLeafs.map(file => renderFileItem(file.filePath, '🍃')).join('') +
      (leafFiles.length > 20 ? `<div class="empty-state">+ ${leafFiles.length - 20} more</div>` : '');
  });

  app.innerHTML = html;
}

/**
 * Render a collapsible section
 */
function renderSection(id, title, count, contentFn) {
  const isCollapsed = collapsedSections.has(id);
  return `
    <div class="section" data-section="${id}">
      <div class="section-header" onclick="toggleSection('${id}')">
        <span class="section-icon ${isCollapsed ? 'collapsed' : ''}">▼</span>
        <span class="section-title">${escapeHtml(title)}</span>
        <span class="section-badge">${count}</span>
      </div>
      <div class="section-content ${isCollapsed ? 'collapsed' : ''}" style="max-height: ${isCollapsed ? '0' : '1000px'}">
        ${contentFn()}
      </div>
    </div>
  `;
}

/**
 * Render a file item
 */
function renderFileItem(filePath, icon, badge, extraClass) {
  const name = filePath.split(/[\\/]/).pop();
  const relativePath = getRelativePath(filePath);
  return `
    <div class="item" onclick="openFile('${escapeJs(filePath)}')" title="${escapeHtml(relativePath)}">
      <span class="item-icon ${extraClass || ''}">${icon}</span>
      <span class="item-name">${escapeHtml(name)}</span>
      ${badge ? `<span class="item-badge">${escapeHtml(String(badge))}</span>` : ''}
    </div>
  `;
}

/**
 * Render route tree
 */
function renderRouteTree(routes, depth = 0) {
  return routes.map(route => `
    <div class="tree-item">
      <div class="item" ${route.filePath ? `onclick="openFile('${escapeJs(route.filePath)}')"` : ''}>
        <span class="item-icon">${getRouteIcon(route.type)}</span>
        <span class="item-name">${escapeHtml(route.name)}</span>
      </div>
      ${route.children && route.children.length > 0 ? `<div class="tree-children">${renderRouteTree(route.children, depth + 1)}</div>` : ''}
    </div>
  `).join('');
}

/**
 * Toggle section collapse
 */
function toggleSection(id) {
  if (collapsedSections.has(id)) {
    collapsedSections.delete(id);
  } else {
    collapsedSections.add(id);
  }
  render();
}

/**
 * Open a file in the editor
 */
function openFile(filePath) {
  vscode.postMessage({ type: 'openFile', filePath: filePath });
}

// Utility functions
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
  const parts = filePath.split(/[\\/]/);
  return parts.slice(-3).join('/');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeJs(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function updateProgress(percent, message) {
  const loading = document.getElementById('loading');
  if (loading) {
    loading.querySelector('div:last-child').textContent = `${message} (${percent}%)`;
  }
}

function showError(message) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
}

// Make functions available globally
window.toggleSection = toggleSection;
window.openFile = openFile;
