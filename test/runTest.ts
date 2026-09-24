import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const repoRoot = path.resolve(__dirname, '../..');

  // Copy the fixture so tests can create/edit/delete files freely
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-fixture-'));
  fs.cpSync(path.join(repoRoot, 'test', 'fixture'), workspace, { recursive: true });

  try {
    await runTests({
      extensionDevelopmentPath: repoRoot,
      extensionTestsPath: path.resolve(__dirname, 'suite', 'index'),
      launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
      extensionTestsEnv: { SCAFFOLD_TEST_WORKSPACE: workspace }
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Integration tests failed:', err);
  process.exit(1);
});
