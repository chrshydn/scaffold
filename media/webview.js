// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {any} */
  let analysisData = null;
  /** @type {any} */
  let currentFileData = null;
  // Section ids that are toggled from their default state; persisted so the
  // view survives being hidden without retainContextWhenHidden.
  const toggledSections = new Set((vscode.getState() || {}).toggledSections || []);

  const app = /** @type {HTMLElement} */ (document.getElementById('app'));

  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
      case 'analysisResult':
        analysisData = message.data;
        scheduleRender();
        break;
      case 'currentFile':
        currentFileData = message.data;
        scheduleRender();
        break;
      case 'error':
        showError(message.message);
        break;
    }
  });

  document.addEventListener('click', e => {
    const target = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (e.target).closest('[data-action]')
    );
    if (!target) return;

    switch (target.dataset.action) {
      case 'toggle-section':
        toggleSection(target.dataset.section);
        break;
      case 'toggle-dir':
        toggleSection('dir-' + target.dataset.dir);
        break;
      case 'open-file':
        vscode.postMessage({ type: 'openFile', filePath: target.dataset.filepath });
        break;
    }
  });

  // Request data once listeners are in place
  vscode.postMessage({ type: 'requestData' });

  // Coalesce back-to-back messages (analysisResult + currentFile) into one render
  let renderPending = false;
  function scheduleRender() {
    if (!renderPending) {
      renderPending = true;
      requestAnimationFrame(() => {
        renderPending = false;
        render();
      });
    }
  }

  function render() {
    // The HTML shell shows a loading spinner until the first result arrives
    if (!analysisData) return;

    const { framework, entryPoints, navigation, directories, loadBearingFiles, leafFiles, totalFiles } = analysisData;
    let html = '';

    html += '<div class="framework-badge">';
    html += '<span class="framework-name">' + escapeHtml(framework.displayName) + '</span>';
    if (framework.version) {
      html += '<span class="framework-version">v' + escapeHtml(framework.version) + '</span>';
    }
    html += '</div>';

    html += '<div class="stats-row">';
    html += stat(totalFiles, 'Files') + stat(loadBearingFiles.length, 'Core') + stat(leafFiles.length, 'Leaf');
    html += '</div>';

    if (currentFileData) {
      html += '<div class="current-file-section">';
      html += '<div class="current-file-header">' + escapeHtml(baseName(currentFileData.relativePath)) + '</div>';

      html += renderSection('current-imports', 'This File Imports', currentFileData.imports.length, () => {
        if (currentFileData.imports.length === 0) return '<div class="empty-state">No imports</div>';
        return currentFileData.imports.map(f => renderFileItem(f, '→')).join('');
      });

      html += renderSection('current-importedby', 'Affected By Changes', currentFileData.importedBy.length, () => {
        if (currentFileData.importedBy.length === 0) return '<div class="empty-state">No dependents (safe to modify)</div>';
        return currentFileData.importedBy.map(f => renderFileItem(f, '←')).join('');
      });

      html += '</div>';
    }

    html += renderSection('entry-points', 'Entry Points', entryPoints.length, () => {
      if (entryPoints.length === 0) return '<div class="empty-state">No entry points found</div>';
      return entryPoints.map(ep => renderFileItem(ep, getEntryTypeIcon(ep.type), ep.type)).join('');
    });

    if (navigation.type !== 'none') {
      html += renderSection('navigation', 'Navigation', navigation.routes.length, () => {
        if (navigation.routes.length === 0) return '<div class="empty-state">No routes found</div>';
        return renderRouteTree(navigation.routes);
      });
    }

    html += renderSection('architecture', 'Architecture', directories.length, () => {
      if (directories.length === 0) return '<div class="empty-state">No directories found</div>';
      return directories.map(renderDirectoryItem).join('');
    });

    html += renderSection('load-bearing', 'Load-Bearing Files', loadBearingFiles.length, () => {
      if (loadBearingFiles.length === 0) return '<div class="empty-state">No high-impact files found</div>';
      return loadBearingFiles.map(file =>
        renderFileItem(file, '⬤', file.metrics.inDegree + ' imports', 'importance-' + file.metrics.tier)
      ).join('');
    });

    html += renderSection('leaf-files', 'Leaf Files', leafFiles.length, () => {
      if (leafFiles.length === 0) return '<div class="empty-state">No leaf files found</div>';
      const isExpanded = toggledSections.has('leaf-files-expand');
      const shown = isExpanded ? leafFiles : leafFiles.slice(0, 20);
      let result = shown.map(file => renderFileItem(file, '🍃')).join('');
      if (leafFiles.length > 20) {
        const label = isExpanded ? '▲ Show less' : '▼ Show ' + (leafFiles.length - 20) + ' more';
        result += '<div class="item expand-toggle" data-action="toggle-section" data-section="leaf-files-expand">' + label + '</div>';
      }
      return result;
    });

    app.innerHTML = html;
  }

  function stat(value, label) {
    return '<div class="stat"><div class="stat-value">' + value + '</div><div class="stat-label">' + label + '</div></div>';
  }

  function renderSection(id, title, count, contentFn) {
    const isCollapsed = toggledSections.has(id);
    return '<div class="section" data-section="' + id + '">' +
      '<div class="section-header" data-action="toggle-section" data-section="' + id + '">' +
      '<span class="section-icon ' + (isCollapsed ? 'collapsed' : '') + '">▼</span>' +
      '<span class="section-title">' + escapeHtml(title) + '</span>' +
      '<span class="section-badge">' + count + '</span>' +
      '</div>' +
      // Skip building content for collapsed sections
      (isCollapsed ? '' : '<div class="section-content">' + contentFn() + '</div>') +
      '</div>';
  }

  /**
   * @param {{ filePath: string, relativePath?: string }} file
   */
  function renderFileItem(file, icon, badge, extraClass) {
    const title = file.relativePath || file.filePath;
    return '<div class="item" data-action="open-file" data-filepath="' + escapeHtml(file.filePath) + '" title="' + escapeHtml(title) + '">' +
      '<span class="item-icon ' + (extraClass || '') + '">' + icon + '</span>' +
      '<span class="item-name">' + escapeHtml(baseName(file.filePath)) + '</span>' +
      (badge ? '<span class="item-badge">' + escapeHtml(String(badge)) + '</span>' : '') +
      '</div>';
  }

  function renderRouteTree(routes) {
    return routes.map(route => {
      let html = '<div class="tree-item">';
      html += route.filePath
        ? '<div class="item" data-action="open-file" data-filepath="' + escapeHtml(route.filePath) + '">'
        : '<div class="item">';
      html += '<span class="item-icon">' + getRouteIcon(route.type) + '</span>';
      html += '<span class="item-name">' + escapeHtml(route.name) + '</span>';
      html += '</div>';
      if (route.children && route.children.length > 0) {
        html += '<div class="tree-children">' + renderRouteTree(route.children) + '</div>';
      }
      return html + '</div>';
    }).join('');
  }

  function renderDirectoryItem(dir) {
    const isExpanded = toggledSections.has('dir-' + dir.path);

    let html = '<div class="dir-item">';
    html += '<div class="item" data-action="toggle-dir" data-dir="' + escapeHtml(dir.path) + '">';
    html += '<span class="section-icon ' + (isExpanded ? '' : 'collapsed') + '">▼</span>';
    html += '<span class="item-icon">📁</span>';
    html += '<span class="item-name">' + escapeHtml(dir.name) + '</span>';
    if (dir.category && dir.category !== 'other') {
      html += '<span class="dir-category">' + dir.category + '</span>';
    }
    html += '<span class="item-badge">' + dir.fileCount + '</span>';
    html += '</div>';

    const files = isExpanded ? analysisData.filesByDirectory[dir.path] || [] : [];
    if (files.length > 0) {
      html += '<div class="tree-children">';
      for (const file of files) {
        html += '<div class="item" data-action="open-file" data-filepath="' + escapeHtml(file.filePath) + '">';
        html += '<span class="item-icon importance-' + file.metrics.tier + '">◆</span>';
        html += '<span class="item-name">' + escapeHtml(baseName(file.relativePath)) + '</span>';
        html += '<span class="item-badge">' + file.metrics.inDegree + '↓ ' + file.metrics.outDegree + '↑</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    return html + '</div>';
  }

  function toggleSection(id) {
    if (toggledSections.has(id)) {
      toggledSections.delete(id);
    } else {
      toggledSections.add(id);
    }
    vscode.setState({ toggledSections: Array.from(toggledSections) });
    render();
  }

  function getEntryTypeIcon(type) {
    const icons = { main: '🚀', app: '📱', page: '📄', layout: '🏗️', index: '📋' };
    return icons[type] || '📄';
  }

  function getRouteIcon(type) {
    const icons = { screen: '📱', page: '📄', layout: '🏗️', navigator: '🧭', route: '🔗' };
    return icons[type] || '📄';
  }

  function baseName(filePath) {
    return filePath.split(/[\\/]/).pop();
  }

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ESCAPES[ch]);
  }

  function showError(message) {
    app.innerHTML = '<div class="error-message">' + escapeHtml(message) + '</div>';
  }
})();
