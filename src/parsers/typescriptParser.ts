import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { ImportInfo, ParsedFile, ExportInfo } from '../models/types';

/**
 * TypeScript/TSX parser for extracting imports and exports
 */
export class TypeScriptParser {
  private compilerOptions: ts.CompilerOptions;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.compilerOptions = this.loadCompilerOptions();
  }

  /**
   * Load tsconfig.json compiler options if available
   */
  private loadCompilerOptions(): ts.CompilerOptions {
    const tsconfigPath = ts.findConfigFile(
      this.workspaceRoot,
      ts.sys.fileExists,
      'tsconfig.json'
    );

    if (tsconfigPath) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (!configFile.error) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(tsconfigPath)
        );
        return parsed.options;
      }
    }

    // Default options
    return {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      baseUrl: this.workspaceRoot,
    };
  }

  /**
   * Parse a TypeScript/TSX file and extract imports/exports
   */
  parseFile(filePath: string): ParsedFile | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parseContent(filePath, content);
    } catch (error) {
      console.error(`Failed to parse ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Parse content string (useful for testing or virtual files)
   */
  parseContent(filePath: string, content: string): ParsedFile {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.ESNext,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];
    let hasJsx = false;

    const visit = (node: ts.Node) => {
      // Check for JSX
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        hasJsx = true;
      }

      // Import declarations
      if (ts.isImportDeclaration(node)) {
        const importInfo = this.parseImportDeclaration(node, filePath);
        if (importInfo) {
          imports.push(importInfo);
        }
      }

      // Export declarations
      if (ts.isExportDeclaration(node)) {
        const exportInfos = this.parseExportDeclaration(node);
        exports.push(...exportInfos);
      }

      // Export assignment (export default)
      if (ts.isExportAssignment(node)) {
        exports.push({
          name: 'default',
          isDefault: true,
          isType: false
        });
      }

      // Named exports on declarations
      if (this.hasExportModifier(node)) {
        const exportInfo = this.parseExportedDeclaration(node);
        if (exportInfo) {
          exports.push(exportInfo);
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);

    return {
      filePath,
      imports,
      exports,
      hasJsx
    };
  }

  /**
   * Parse an import declaration node
   */
  private parseImportDeclaration(node: ts.ImportDeclaration, importerPath: string): ImportInfo | null {
    const moduleSpecifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) {
      return null;
    }

    const source = moduleSpecifier.text;
    const isExternal = !source.startsWith('.') && !source.startsWith('/');
    const isTypeOnly = node.importClause?.isTypeOnly ?? false;

    const importedNames: string[] = [];
    let hasDefault = false;
    let hasNamespace = false;

    const importClause = node.importClause;
    if (importClause) {
      // Default import
      if (importClause.name) {
        hasDefault = true;
      }

      // Named bindings
      if (importClause.namedBindings) {
        if (ts.isNamespaceImport(importClause.namedBindings)) {
          // import * as name
          hasNamespace = true;
        } else if (ts.isNamedImports(importClause.namedBindings)) {
          // import { a, b, c }
          for (const element of importClause.namedBindings.elements) {
            importedNames.push(element.name.text);
          }
        }
      }
    }

    // Resolve the import path
    let resolvedPath: string | undefined;
    if (!isExternal) {
      resolvedPath = this.resolveImportPath(source, importerPath);
    }

    return {
      source,
      resolvedPath,
      isExternal,
      isTypeOnly,
      importedNames,
      hasDefault,
      hasNamespace
    };
  }

  /**
   * Resolve an import path to an absolute file path
   */
  resolveImportPath(importSource: string, importerPath: string): string | undefined {
    const importerDir = path.dirname(importerPath);

    // Handle relative imports
    if (importSource.startsWith('.')) {
      return this.resolveRelativeImport(importSource, importerDir);
    }

    // Handle path aliases from tsconfig
    if (this.compilerOptions.paths && this.compilerOptions.baseUrl) {
      const resolved = this.resolvePathAlias(importSource);
      if (resolved) {
        return resolved;
      }
    }

    // Try resolving from baseUrl
    if (this.compilerOptions.baseUrl) {
      const fromBase = this.resolveRelativeImport(importSource, this.compilerOptions.baseUrl);
      if (fromBase) {
        return fromBase;
      }
    }

    return undefined;
  }

  /**
   * Resolve a relative import
   */
  private resolveRelativeImport(importSource: string, fromDir: string): string | undefined {
    const basePath = path.resolve(fromDir, importSource);

    // Try exact path first
    const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];

    for (const ext of extensions) {
      const fullPath = basePath + ext;
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fullPath;
      }
    }

    // Try index files
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const indexPath = path.join(basePath, `index${ext}`);
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }

    return undefined;
  }

  /**
   * Resolve path alias from tsconfig
   */
  private resolvePathAlias(importSource: string): string | undefined {
    const paths = this.compilerOptions.paths;
    const baseUrl = this.compilerOptions.baseUrl;

    if (!paths || !baseUrl) {
      return undefined;
    }

    for (const [pattern, mappings] of Object.entries(paths)) {
      const regex = new RegExp(
        '^' + pattern.replace('*', '(.*)') + '$'
      );
      const match = importSource.match(regex);

      if (match) {
        for (const mapping of mappings) {
          const resolved = mapping.replace('*', match[1] || '');
          const fullPath = path.resolve(baseUrl, resolved);
          const result = this.resolveRelativeImport('./' + path.basename(fullPath), path.dirname(fullPath));
          if (result) {
            return result;
          }
          // Try the resolved path directly
          const directResult = this.resolveRelativeImport(resolved, baseUrl);
          if (directResult) {
            return directResult;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Parse an export declaration
   */
  private parseExportDeclaration(node: ts.ExportDeclaration): ExportInfo[] {
    const exports: ExportInfo[] = [];
    const isTypeOnly = node.isTypeOnly;

    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        exports.push({
          name: element.name.text,
          isDefault: false,
          isType: isTypeOnly
        });
      }
    }

    return exports;
  }

  /**
   * Check if a node has export modifier
   */
  private hasExportModifier(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) {
      return false;
    }
    const modifiers = ts.getModifiers(node);
    return modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  /**
   * Parse an exported declaration (function, class, variable, etc.)
   */
  private parseExportedDeclaration(node: ts.Node): ExportInfo | null {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isDefault = modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;

    if (ts.isFunctionDeclaration(node) && node.name) {
      return { name: node.name.text, isDefault, isType: false };
    }
    if (ts.isClassDeclaration(node) && node.name) {
      return { name: node.name.text, isDefault, isType: false };
    }
    if (ts.isInterfaceDeclaration(node)) {
      return { name: node.name.text, isDefault: false, isType: true };
    }
    if (ts.isTypeAliasDeclaration(node)) {
      return { name: node.name.text, isDefault: false, isType: true };
    }
    if (ts.isEnumDeclaration(node)) {
      return { name: node.name.text, isDefault: false, isType: false };
    }
    if (ts.isVariableStatement(node)) {
      const declaration = node.declarationList.declarations[0];
      if (declaration && ts.isIdentifier(declaration.name)) {
        return { name: declaration.name.text, isDefault, isType: false };
      }
    }

    return null;
  }
}

export { TypeScriptParser as default };
