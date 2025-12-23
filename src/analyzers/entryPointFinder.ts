import * as fs from 'fs';
import * as path from 'path';
import { Framework, FrameworkInfo, EntryPoint } from '../models/types';

/**
 * Finds entry points based on the detected framework
 */
export class EntryPointFinder {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Find all entry points for the given framework
   */
  findEntryPoints(frameworkInfo: FrameworkInfo): EntryPoint[] {
    switch (frameworkInfo.framework) {
      case 'expo':
        return this.findExpoEntryPoints();
      case 'react-native':
        return this.findReactNativeEntryPoints();
      case 'nextjs':
        return this.findNextJsEntryPoints();
      case 'react-web':
        return this.findReactWebEntryPoints();
      default:
        return this.findGenericEntryPoints();
    }
  }

  /**
   * Find Expo entry points
   */
  private findExpoEntryPoints(): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    // Check app.json for main field
    const appJsonPath = path.join(this.workspaceRoot, 'app.json');
    if (fs.existsSync(appJsonPath)) {
      try {
        const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
        if (appJson.expo?.entryPoint) {
          const entryPath = this.resolveEntryFile(appJson.expo.entryPoint);
          if (entryPath) {
            entryPoints.push({ filePath: entryPath, type: 'main', framework: 'expo' });
          }
        }
      } catch {}
    }

    // Check for expo-router (app directory)
    const appDir = path.join(this.workspaceRoot, 'app');
    if (fs.existsSync(appDir) && fs.statSync(appDir).isDirectory()) {
      const layoutFile = this.findFirstExisting([
        path.join(appDir, '_layout.tsx'),
        path.join(appDir, '_layout.js')
      ]);
      if (layoutFile) {
        entryPoints.push({ filePath: layoutFile, type: 'layout', framework: 'expo' });
      }

      const indexFile = this.findFirstExisting([
        path.join(appDir, 'index.tsx'),
        path.join(appDir, 'index.js')
      ]);
      if (indexFile) {
        entryPoints.push({ filePath: indexFile, type: 'index', framework: 'expo' });
      }
    }

    // Standard Expo entry points
    const standardEntries = this.findFirstExisting([
      path.join(this.workspaceRoot, 'App.tsx'),
      path.join(this.workspaceRoot, 'App.js'),
      path.join(this.workspaceRoot, 'src', 'App.tsx'),
      path.join(this.workspaceRoot, 'src', 'App.js'),
      path.join(this.workspaceRoot, 'index.js'),
      path.join(this.workspaceRoot, 'index.tsx')
    ]);

    if (standardEntries && !entryPoints.some(e => e.filePath === standardEntries)) {
      entryPoints.push({ filePath: standardEntries, type: 'app', framework: 'expo' });
    }

    return entryPoints;
  }

  /**
   * Find React Native CLI entry points
   */
  private findReactNativeEntryPoints(): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    // Check package.json for main field
    const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.main) {
          const mainPath = this.resolveEntryFile(packageJson.main);
          if (mainPath) {
            entryPoints.push({ filePath: mainPath, type: 'main', framework: 'react-native' });
          }
        }
      } catch {}
    }

    // Standard React Native entry
    const indexFile = this.findFirstExisting([
      path.join(this.workspaceRoot, 'index.js'),
      path.join(this.workspaceRoot, 'index.tsx'),
      path.join(this.workspaceRoot, 'index.ts')
    ]);

    if (indexFile && !entryPoints.some(e => e.filePath === indexFile)) {
      entryPoints.push({ filePath: indexFile, type: 'index', framework: 'react-native' });
    }

    // App component
    const appFile = this.findFirstExisting([
      path.join(this.workspaceRoot, 'App.tsx'),
      path.join(this.workspaceRoot, 'App.js'),
      path.join(this.workspaceRoot, 'src', 'App.tsx'),
      path.join(this.workspaceRoot, 'src', 'App.js')
    ]);

    if (appFile && !entryPoints.some(e => e.filePath === appFile)) {
      entryPoints.push({ filePath: appFile, type: 'app', framework: 'react-native' });
    }

    return entryPoints;
  }

  /**
   * Find Next.js entry points
   */
  private findNextJsEntryPoints(): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    // App Router (app directory)
    const appDir = path.join(this.workspaceRoot, 'app');
    const srcAppDir = path.join(this.workspaceRoot, 'src', 'app');
    const actualAppDir = fs.existsSync(appDir) ? appDir :
                         fs.existsSync(srcAppDir) ? srcAppDir : null;

    if (actualAppDir) {
      const layoutFile = this.findFirstExisting([
        path.join(actualAppDir, 'layout.tsx'),
        path.join(actualAppDir, 'layout.js')
      ]);
      if (layoutFile) {
        entryPoints.push({ filePath: layoutFile, type: 'layout', framework: 'nextjs' });
      }

      const pageFile = this.findFirstExisting([
        path.join(actualAppDir, 'page.tsx'),
        path.join(actualAppDir, 'page.js')
      ]);
      if (pageFile) {
        entryPoints.push({ filePath: pageFile, type: 'page', framework: 'nextjs' });
      }
    }

    // Pages Router (pages directory)
    const pagesDir = path.join(this.workspaceRoot, 'pages');
    const srcPagesDir = path.join(this.workspaceRoot, 'src', 'pages');
    const actualPagesDir = fs.existsSync(pagesDir) ? pagesDir :
                           fs.existsSync(srcPagesDir) ? srcPagesDir : null;

    if (actualPagesDir) {
      const appFile = this.findFirstExisting([
        path.join(actualPagesDir, '_app.tsx'),
        path.join(actualPagesDir, '_app.js')
      ]);
      if (appFile) {
        entryPoints.push({ filePath: appFile, type: 'app', framework: 'nextjs' });
      }

      const indexFile = this.findFirstExisting([
        path.join(actualPagesDir, 'index.tsx'),
        path.join(actualPagesDir, 'index.js')
      ]);
      if (indexFile) {
        entryPoints.push({ filePath: indexFile, type: 'index', framework: 'nextjs' });
      }
    }

    return entryPoints;
  }

  /**
   * Find React Web entry points
   */
  private findReactWebEntryPoints(): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    // Common entry points for Vite, CRA, etc.
    const mainFile = this.findFirstExisting([
      path.join(this.workspaceRoot, 'src', 'main.tsx'),
      path.join(this.workspaceRoot, 'src', 'main.ts'),
      path.join(this.workspaceRoot, 'src', 'index.tsx'),
      path.join(this.workspaceRoot, 'src', 'index.ts'),
      path.join(this.workspaceRoot, 'src', 'index.js'),
      path.join(this.workspaceRoot, 'index.tsx'),
      path.join(this.workspaceRoot, 'index.ts')
    ]);

    if (mainFile) {
      entryPoints.push({ filePath: mainFile, type: 'main', framework: 'react-web' });
    }

    // App component
    const appFile = this.findFirstExisting([
      path.join(this.workspaceRoot, 'src', 'App.tsx'),
      path.join(this.workspaceRoot, 'src', 'App.ts'),
      path.join(this.workspaceRoot, 'src', 'App.js'),
      path.join(this.workspaceRoot, 'App.tsx')
    ]);

    if (appFile) {
      entryPoints.push({ filePath: appFile, type: 'app', framework: 'react-web' });
    }

    return entryPoints;
  }

  /**
   * Find generic entry points when framework is unknown
   */
  private findGenericEntryPoints(): EntryPoint[] {
    const candidates = [
      'src/index.tsx', 'src/index.ts', 'src/index.js',
      'src/main.tsx', 'src/main.ts', 'src/main.js',
      'src/App.tsx', 'src/App.ts', 'src/App.js',
      'index.tsx', 'index.ts', 'index.js',
      'App.tsx', 'App.ts', 'App.js'
    ];

    const entryPoints: EntryPoint[] = [];
    for (const candidate of candidates) {
      const fullPath = path.join(this.workspaceRoot, candidate);
      if (fs.existsSync(fullPath)) {
        entryPoints.push({
          filePath: fullPath,
          type: candidate.includes('index') ? 'index' : 'app',
          framework: 'unknown'
        });
        break; // Only take the first match
      }
    }

    return entryPoints;
  }

  /**
   * Resolve an entry file path
   */
  private resolveEntryFile(entryPath: string): string | null {
    const fullPath = path.join(this.workspaceRoot, entryPath);

    // Try exact path
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }

    // Try with extensions
    const extensions = ['.tsx', '.ts', '.jsx', '.js'];
    for (const ext of extensions) {
      const withExt = fullPath + ext;
      if (fs.existsSync(withExt)) {
        return withExt;
      }
    }

    return null;
  }

  /**
   * Find the first existing file from a list of paths
   */
  private findFirstExisting(paths: string[]): string | null {
    for (const p of paths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }
}

export { EntryPointFinder as default };
