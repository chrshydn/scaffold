import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ScaffoldViewProvider } from '../../src/views/ScaffoldViewProvider';

const EXTENSION_ID = 'chrshydn.scaffold-structure-map';

let api: ScaffoldViewProvider;
let root: string;

/** Absolute path in the form VS Code uses for graph keys */
const abs = (rel: string) => vscode.Uri.file(path.join(root, rel)).fsPath;
const rel = (p: string) => path.relative(root, p).replace(/\\/g, '/');

function importsOf(file: string): string[] | undefined {
  return api.getFileMetrics(abs(file))?.imports.map(rel).sort();
}

/** Resolves on the next graph update; start it before triggering the change */
function nextUpdate(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error(`No graph update within ${timeoutMs}ms`));
    }, timeoutMs);
    const sub = api.onDidUpdateGraph(() => {
      clearTimeout(timer);
      sub.dispose();
      resolve();
    });
  });
}

function assertNoUpdate(ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sub = api.onDidUpdateGraph(() => {
      sub.dispose();
      reject(new Error('Unexpected graph update'));
    });
    setTimeout(() => {
      sub.dispose();
      resolve();
    }, ms);
  });
}

describe('Scaffold extension', () => {
  before(async () => {
    root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const extension = vscode.extensions.getExtension<ScaffoldViewProvider>(EXTENSION_ID);
    assert.ok(extension, 'extension is installed');

    api = (await extension.activate())!;
    assert.ok(api, 'activate() returns the provider');

    // Analysis starts when the view is first shown
    const analyzed = nextUpdate(30000);
    await vscode.commands.executeCommand('scaffold.structureView.focus');
    await analyzed;
  });

  describe('initial analysis', () => {
    it('resolves relative, alias, type-only and dynamic imports', () => {
      assert.deepStrictEqual(importsOf('src/App.tsx'), [
        'src/components/Button.tsx',
        'src/utils/format.ts',
        'src/utils/helper.ts'
      ]);
    });

    it('resolves a path alias to a barrel index file', () => {
      assert.deepStrictEqual(importsOf('src/components/Button.tsx'), ['src/utils/index.ts']);
    });

    it('follows re-exports, including .js specifiers that map to .ts', () => {
      assert.deepStrictEqual(importsOf('src/utils/index.ts'), ['src/utils/format.ts', 'src/utils/helper.ts']);
    });

    it('skips external packages and unresolved imports', () => {
      assert.deepStrictEqual(importsOf('src/Late.ts'), []);
      assert.ok(!api.getFileMetrics(abs('node_modules/react/index.js')));
    });

    it('excludes declaration files', () => {
      assert.strictEqual(api.getFileMetrics(abs('src/types.d.ts')), undefined);
    });

    it('computes in-degree and importance tier', () => {
      const format = api.getFileMetrics(abs('src/utils/format.ts'))!;
      assert.strictEqual(format.metrics.inDegree, 2);
      assert.strictEqual(format.metrics.importanceScore, 100);
      assert.strictEqual(format.metrics.tier, 'critical');

      const app = api.getFileMetrics(abs('src/App.tsx'))!;
      assert.strictEqual(app.metrics.isLeaf, true);
      assert.strictEqual(app.metrics.tier, 'low');
    });
  });

  describe('commands', () => {
    it('shows file metrics for the active editor', async () => {
      await vscode.window.showTextDocument(vscode.Uri.file(abs('src/utils/format.ts')));
      await vscode.commands.executeCommand('scaffold.showFileMetrics');
    });

    it('refresh re-runs the analysis', async () => {
      const updated = nextUpdate();
      await vscode.commands.executeCommand('scaffold.refresh');
      await updated;
      assert.deepStrictEqual(importsOf('src/utils/index.ts'), ['src/utils/format.ts', 'src/utils/helper.ts']);
    });
  });

  describe('file watcher', () => {
    it('ignores edits that do not change imports', async () => {
      fs.appendFileSync(abs('src/utils/format.ts'), '\n// comment only\n');
      await assertNoUpdate(3000);
    });

    it('applies an added import incrementally', async () => {
      const updated = nextUpdate();
      fs.writeFileSync(abs('src/utils/helper.ts'), "import { fmt } from './format';\nexport const helper = fmt('x');\n");
      await updated;

      assert.deepStrictEqual(importsOf('src/utils/helper.ts'), ['src/utils/format.ts']);
      assert.strictEqual(api.getFileMetrics(abs('src/utils/format.ts'))!.metrics.inDegree, 3);
    });

    it('re-resolves existing imports when a missing file is created', async () => {
      const updated = nextUpdate();
      fs.writeFileSync(abs('src/willExist.ts'), 'export const late = 1;\n');
      await updated;

      assert.deepStrictEqual(importsOf('src/Late.ts'), ['src/willExist.ts']);
      assert.strictEqual(api.getFileMetrics(abs('src/willExist.ts'))!.metrics.inDegree, 1);
    });

    it('removes a deleted file and its edges', async () => {
      const updated = nextUpdate();
      fs.rmSync(abs('src/utils/helper.ts'));
      await updated;

      assert.strictEqual(api.getFileMetrics(abs('src/utils/helper.ts')), undefined);
      assert.deepStrictEqual(importsOf('src/App.tsx'), ['src/components/Button.tsx', 'src/utils/format.ts']);
      assert.deepStrictEqual(importsOf('src/utils/index.ts'), ['src/utils/format.ts']);
    });
  });
});
