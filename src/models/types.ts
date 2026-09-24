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
 * Lightweight file reference sent to the webview (no edge lists)
 */
export interface FileSummary {
  filePath: string;
  relativePath: string;
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
  tier: ImportanceTier;     // Bucketed importanceScore
}

export type ImportanceTier = 'critical' | 'high' | 'medium' | 'low';

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
  framework: FrameworkInfo & { displayName: string };
  entryPoints: EntryPoint[];
  navigation: NavigationStructure;
  directories: DirectoryStats[];
  filesByDirectory: Record<string, FileSummary[]>;
  loadBearingFiles: FileSummary[];
  leafFiles: FileSummary[];
  totalFiles: number;
}

/**
 * Dependency info for the file open in the active editor
 */
export interface CurrentFileInfo {
  relativePath: string;
  imports: FileSummary[];
  importedBy: FileSummary[];
}

/**
 * Message types for webview communication
 */
export type WebviewMessage =
  | { type: 'refresh' }
  | { type: 'openFile'; filePath: string }
  | { type: 'requestData' }
  | { type: 'analysisResult'; data: AnalysisResult }
  | { type: 'currentFile'; data: CurrentFileInfo | null }
  | { type: 'error'; message: string };
