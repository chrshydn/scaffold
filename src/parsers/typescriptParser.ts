import * as ts from 'typescript';
import * as path from 'path';

/** Files the graph scans, parses and watches */
export const SOURCE_GLOB = '**/*.{ts,tsx}';

export function isSourceFile(filePath: string): boolean {
  return /\.tsx?$/.test(filePath) && !filePath.endsWith('.d.ts');
}

/** Files an import may resolve to (JS targets become graph nodes too) */
const LOCAL_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

/**
 * Extracts local import edges from TypeScript/TSX files.
 *
 * Uses the TypeScript pre-processor (a token scanner, much cheaper than a
 * full parse) to find every module specifier — static imports, re-exports
 * (`export * from`), `require()` and dynamic `import()` — and resolves them
 * with the compiler's own module resolution, so tsconfig `paths`, `baseUrl`,
 * index files and `.js` -> `.ts` mapping all behave as they do in tsc.
 */
export class TypeScriptParser {
  private compilerOptions: ts.CompilerOptions;
  private workspaceRoot: string;
  private resolutionCache!: ts.ModuleResolutionCache;
  // Module resolution hits the filesystem heavily; memoize every host call
  private fileExistsCache = new Map<string, boolean>();
  private directoryExistsCache = new Map<string, boolean>();
  private realpathCache = new Map<string, string>();
  private host: ts.ModuleResolutionHost;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.compilerOptions = this.loadCompilerOptions();
    this.host = {
      fileExists: memoize(this.fileExistsCache, ts.sys.fileExists),
      directoryExists: memoize(this.directoryExistsCache, ts.sys.directoryExists!),
      realpath: memoize(this.realpathCache, ts.sys.realpath ?? ((p: string) => p)),
      readFile: ts.sys.readFile,
      getCurrentDirectory: () => this.workspaceRoot
    };
    this.invalidateCache();
  }

  /**
   * Drop cached resolutions. Call when files are created or deleted,
   * since either can change what an import resolves to.
   */
  invalidateCache(): void {
    this.fileExistsCache.clear();
    this.directoryExistsCache.clear();
    this.realpathCache.clear();
    this.resolutionCache = ts.createModuleResolutionCache(
      this.workspaceRoot,
      (fileName) => (ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase()),
      this.compilerOptions
    );
  }

  /**
   * Load tsconfig.json compiler options if available
   */
  private loadCompilerOptions(): ts.CompilerOptions {
    // Always resolve JS files so mixed JS/TS projects produce edges
    const overrides: ts.CompilerOptions = { allowJs: true, noEmit: true };

    const tsconfigPath = ts.findConfigFile(this.workspaceRoot, ts.sys.fileExists, 'tsconfig.json');
    if (tsconfigPath) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (!configFile.error) {
        // Empty readDirectory: we only need options, not tsconfig's file list
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          { ...ts.sys, readDirectory: () => [] },
          path.dirname(tsconfigPath)
        );
        return { ...parsed.options, ...overrides };
      }
    }

    return {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.React,
      ...overrides
    };
  }

  /**
   * Return the workspace files a source file imports
   */
  parseImports(filePath: string, content: string): string[] {
    const resolved = new Set<string>();
    for (const { fileName } of ts.preProcessFile(content, true, true).importedFiles) {
      const target = this.resolveImportPath(fileName, filePath);
      if (target && target !== filePath) {
        resolved.add(target);
      }
    }
    return Array.from(resolved);
  }

  /**
   * Resolve an import specifier to an absolute path inside the workspace,
   * or undefined if it is an external package or can't be resolved.
   */
  resolveImportPath(importSource: string, importerPath: string): string | undefined {
    const { resolvedModule } = ts.resolveModuleName(
      importSource,
      importerPath,
      this.compilerOptions,
      this.host,
      this.resolutionCache
    );

    if (!resolvedModule || resolvedModule.isExternalLibraryImport) {
      return undefined;
    }

    // Skip .d.ts and other non-source resolutions
    const resolved = path.normalize(resolvedModule.resolvedFileName);
    if (resolved.endsWith('.d.ts') || !LOCAL_EXTENSIONS.has(path.extname(resolved))) {
      return undefined;
    }

    // Keep the importer's drive-letter casing so graph keys stay consistent
    // with the paths VS Code hands us.
    return this.matchDriveCase(resolved, importerPath);
  }

  private matchDriveCase(filePath: string, reference: string): string {
    if (/^[a-zA-Z]:/.test(filePath) && /^[a-zA-Z]:/.test(reference)) {
      return reference[0] + filePath.slice(1);
    }
    return filePath;
  }
}

function memoize<T>(cache: Map<string, T>, fn: (key: string) => T): (key: string) => T {
  return (key) => {
    let value = cache.get(key);
    if (value === undefined) {
      value = fn(key);
      cache.set(key, value);
    }
    return value;
  };
}

export { TypeScriptParser as default };
