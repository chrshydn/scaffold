/**
 * Detected framework types
 */
export type Framework = 'expo' | 'react-native' | 'nextjs' | 'react-web' | 'unknown';

/**
 * Framework detection result
 */
export interface FrameworkInfo {
  framework: Framework;
  version?: string;
  configFile?: string;
}

/**
 * Entry point information
 */
export interface EntryPoint {
  filePath: string;
  type: 'main' | 'app' | 'page' | 'layout' | 'index';
  framework: Framework;
}

/**
 * Import information extracted from a file
 */
export interface ImportInfo {
  source: string;           // The import source string (e.g., './utils', 'react')
  resolvedPath?: string;    // Resolved absolute path (for local imports)
  isExternal: boolean;      // True if node_modules import
  isTypeOnly: boolean;      // True if `import type`
  importedNames: string[];  // Named imports
  hasDefault: boolean;      // Has default import
  hasNamespace: boolean;    // Has namespace import (import * as)
}

/**
 * Parsed file information
 */
export interface ParsedFile {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  hasJsx: boolean;
}

/**
 * Export information
 */
export interface ExportInfo {
  name: string;
  isDefault: boolean;
  isType: boolean;
}

/**
 * File node in the import graph
 */
export interface FileNode {
  filePath: string;
  relativePath: string;
  imports: string[];        // Files this file imports (outgoing edges)
  importedBy: string[];     // Files that import this file (incoming edges)
  metrics: FileMetrics;
}

/**
 * Metrics calculated for a file
 */
export interface FileMetrics {
  inDegree: number;         // Number of files that import this file
  outDegree: number;        // Number of files this file imports
  isLeaf: boolean;          // True if no files import this (inDegree === 0)
  isLoadBearing: boolean;   // True if many files depend on this
  importanceScore: number;  // Calculated importance (0-100)
}

/**
 * Navigation/routing information
 */
export interface NavigationRoute {
  name: string;
  filePath?: string;
  type: 'screen' | 'page' | 'layout' | 'navigator' | 'route';
  children?: NavigationRoute[];
}

/**
 * Navigation structure detection result
 */
export interface NavigationStructure {
  type: 'react-navigation' | 'nextjs-pages' | 'nextjs-app' | 'react-router' | 'none';
  routes: NavigationRoute[];
  configFile?: string;
}

/**
 * Directory statistics
 */
export interface DirectoryStats {
  path: string;
  name: string;
  fileCount: number;
  category?: 'components' | 'hooks' | 'services' | 'utils' | 'screens' | 'pages' | 'api' | 'other';
}

/**
 * Complete analysis result
 */
export interface AnalysisResult {
  framework: FrameworkInfo;
  entryPoints: EntryPoint[];
  navigation: NavigationStructure;
  directories: DirectoryStats[];
  loadBearingFiles: FileNode[];
  leafFiles: FileNode[];
  totalFiles: number;
  timestamp: number;
}

/**
 * Message types for webview communication
 */
export type WebviewMessage =
  | { type: 'refresh' }
  | { type: 'openFile'; filePath: string }
  | { type: 'requestData' }
  | { type: 'analysisResult'; data: AnalysisResult }
  | { type: 'analysisProgress'; progress: number; message: string }
  | { type: 'error'; message: string };
