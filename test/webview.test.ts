import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

const SCRIPT = fs.readFileSync(path.resolve(__dirname, '../../media/webview.js'), 'utf-8');

interface Harness {
  dom: JSDOM;
  posted: any[];
  state: () => any;
  send: (message: unknown) => Promise<void>;
  $: (selector: string) => Element | null;
  $$: (selector: string) => Element[];
  click: (el: Element | null) => Promise<void>;
}

/** Load webview.js into a fresh DOM, optionally with previously saved state */
function load(savedState?: unknown): Harness {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><div class="container" id="app"><div class="loading">Analyzing codebase...</div></div></body>',
    { runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const posted: any[] = [];
  let state = savedState;
  (dom.window as any).acquireVsCodeApi = () => ({
    // Serialize like the real postMessage (also normalizes jsdom-realm objects)
    postMessage: (m: unknown) => posted.push(JSON.parse(JSON.stringify(m))),
    getState: () => state,
    setState: (s: unknown) => { state = s; }
  });
  dom.window.eval(SCRIPT);

  const nextFrame = () => new Promise<void>(r => dom.window.requestAnimationFrame(() => r()));
  const doc = dom.window.document;
  return {
    dom,
    posted,
    state: () => state,
    send: async (message) => {
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: message }));
      await nextFrame();
    },
    $: (s) => doc.querySelector(s),
    $$: (s) => Array.from(doc.querySelectorAll(s)),
    click: async (el) => {
      assert.ok(el, 'element to click exists');
      el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await nextFrame();
    }
  };
}

const metrics = (inDegree: number, tier: string) => ({
  inDegree, outDegree: 1, isLeaf: inDegree === 0, isLoadBearing: inDegree >= 5, importanceScore: 0, tier
});
const file = (relativePath: string, inDegree = 0, tier = 'low') => ({
  filePath: '/ws/' + relativePath, relativePath, metrics: metrics(inDegree, tier)
});

const EVIL = 'src/<img src=x onerror="alert(1)">.ts';
const leaves = Array.from({ length: 25 }, (_, i) => file(`src/leaf${String(i).padStart(2, '0')}.ts`));

const result = {
  framework: { framework: 'react-web', version: '18.2.0', displayName: 'React (Web)' },
  entryPoints: [{ filePath: '/ws/src/main.tsx', type: 'main', framework: 'react-web' }],
  navigation: { type: 'react-router', routes: [{ name: 'Home', type: 'route', children: [{ name: 'About', type: 'route', filePath: '/ws/src/About.tsx' }] }] },
  directories: [{ path: 'src/utils', name: 'utils', fileCount: 2, category: 'utils' }],
  filesByDirectory: { 'src/utils': [file('src/utils/format.ts', 9, 'critical'), file(EVIL, 1, 'medium')] },
  loadBearingFiles: [file('src/utils/format.ts', 9, 'critical')],
  leafFiles: leaves,
  totalFiles: 30
};

const currentFile = {
  relativePath: 'src/App.tsx',
  imports: [file('src/utils/format.ts', 9, 'critical')],
  importedBy: []
};

describe('webview', () => {
  it('requests data on load and keeps the loading shell until a result arrives', async () => {
    const h = load();
    assert.deepStrictEqual(h.posted, [{ type: 'requestData' }]);

    await h.send({ type: 'currentFile', data: currentFile });
    assert.ok(h.$('.loading'), 'current file alone does not replace the spinner');
  });

  it('renders the analysis result', async () => {
    const h = load();
    await h.send({ type: 'analysisResult', data: result });

    assert.strictEqual(h.$('.framework-name')!.textContent, 'React (Web)');
    assert.strictEqual(h.$('.framework-version')!.textContent, 'v18.2.0');
    assert.deepStrictEqual(h.$$('.stat-value').map(e => e.textContent), ['30', '1', '25']);
    assert.deepStrictEqual(
      h.$$('.section-title').map(e => e.textContent),
      ['Entry Points', 'Navigation', 'Architecture', 'Load-Bearing Files', 'Leaf Files']
    );
    assert.ok(h.$('[data-section="load-bearing"] .importance-critical'), 'tier comes from metrics.tier');
    assert.strictEqual(h.$$('[data-section="navigation"] .item-name').length, 2, 'nested routes render');
  });

  it('renders the current file section with one render for back-to-back messages', async () => {
    const h = load();
    h.dom.window.dispatchEvent(new h.dom.window.MessageEvent('message', { data: { type: 'analysisResult', data: result } }));
    await h.send({ type: 'currentFile', data: currentFile });

    assert.strictEqual(h.$('.current-file-header')!.textContent, 'App.tsx');
    assert.strictEqual(h.$$('[data-section="current-imports"] .item').length, 1);
    assert.match(h.$('[data-section="current-importedby"]')!.textContent!, /No dependents/);
  });

  it('escapes file names and round-trips paths through data attributes', async () => {
    const h = load();
    await h.send({ type: 'analysisResult', data: result });
    await h.click(h.$('[data-action="toggle-dir"]'));

    assert.strictEqual(h.$('img'), null, 'no injected elements');
    const items = h.$$('.dir-item .tree-children .item');
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[1].querySelector('.item-name')!.textContent, '<img src=x onerror="alert(1)">.ts');

    await h.click(items[1]);
    assert.deepStrictEqual(h.posted.at(-1), { type: 'openFile', filePath: '/ws/' + EVIL });
  });

  it('opens files when clicked', async () => {
    const h = load();
    await h.send({ type: 'analysisResult', data: result });
    await h.click(h.$('[data-section="entry-points"] [data-action="open-file"]'));
    assert.deepStrictEqual(h.posted.at(-1), { type: 'openFile', filePath: '/ws/src/main.tsx' });
  });

  it('expands and collapses the leaf file list', async () => {
    const h = load();
    await h.send({ type: 'analysisResult', data: result });
    const leafItems = () => h.$$('[data-section="leaf-files"] [data-action="open-file"]').length;

    assert.strictEqual(leafItems(), 20);
    await h.click(h.$('.expand-toggle'));
    assert.strictEqual(leafItems(), 25);
    await h.click(h.$('.expand-toggle'));
    assert.strictEqual(leafItems(), 20);
  });

  it('persists collapsed sections across webview reloads', async () => {
    const h = load();
    await h.send({ type: 'analysisResult', data: result });
    await h.click(h.$('[data-section="leaf-files"] .section-header'));
    assert.strictEqual(h.$('[data-section="leaf-files"] .section-content'), null, 'collapsed content is not built');

    const reloaded = load(h.state());
    await reloaded.send({ type: 'analysisResult', data: result });
    assert.strictEqual(reloaded.$('[data-section="leaf-files"] .section-content'), null);
    assert.ok(reloaded.$('[data-section="entry-points"] .section-content'), 'other sections stay open');
  });

  it('shows errors escaped', async () => {
    const h = load();
    await h.send({ type: 'error', message: 'Analysis failed: <b>boom</b>' });
    assert.strictEqual(h.$('.error-message')!.textContent, 'Analysis failed: <b>boom</b>');
    assert.strictEqual(h.$('b'), null);
  });
});
