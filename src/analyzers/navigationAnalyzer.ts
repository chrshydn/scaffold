import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Framework, NavigationStructure, NavigationRoute } from '../models/types';

/**
 * Analyzes navigation/routing structure in the codebase
 */
export class NavigationAnalyzer {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Analyze navigation structure based on framework
   */
  async analyze(framework: Framework): Promise<NavigationStructure> {
    switch (framework) {
      case 'nextjs':
        return this.analyzeNextJs();
      case 'expo':
      case 'react-native':
        return this.analyzeReactNavigation();
      case 'react-web':
        return this.analyzeReactRouter();
      default:
        return { type: 'none', routes: [] };
    }
  }

  /**
   * Analyze Next.js routing (both App Router and Pages Router)
   */
  private async analyzeNextJs(): Promise<NavigationStructure> {
    // Check for App Router first
    const appDir = this.findDirectory(['app', 'src/app']);
    if (appDir) {
      const routes = await this.scanNextJsAppDir(appDir);
      return {
        type: 'nextjs-app',
        routes,
        configFile: path.relative(this.workspaceRoot, appDir)
      };
    }

    // Fall back to Pages Router
    const pagesDir = this.findDirectory(['pages', 'src/pages']);
    if (pagesDir) {
      const routes = await this.scanNextJsPagesDir(pagesDir);
      return {
        type: 'nextjs-pages',
        routes,
        configFile: path.relative(this.workspaceRoot, pagesDir)
      };
    }

    return { type: 'none', routes: [] };
  }

  /**
   * Scan Next.js App Router directory
   */
  private async scanNextJsAppDir(appDir: string): Promise<NavigationRoute[]> {
    const routes: NavigationRoute[] = [];
    await this.scanAppDirRecursive(appDir, appDir, routes);
    return routes;
  }

  /**
   * Recursively scan App Router directory
   */
  private async scanAppDirRecursive(
    currentDir: string,
    baseDir: string,
    routes: NavigationRoute[]
  ): Promise<void> {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(currentDir, entry.name);

        // Skip special directories
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) {
          continue;
        }

        // Check for page.tsx in this directory
        const pageFile = this.findFirstExisting([
          path.join(dirPath, 'page.tsx'),
          path.join(dirPath, 'page.js')
        ]);

        const routePath = this.getRoutePathFromDir(dirPath, baseDir);
        const route: NavigationRoute = {
          name: this.formatRouteName(entry.name),
          filePath: pageFile || undefined,
          type: pageFile ? 'page' : 'layout',
          children: []
        };

        await this.scanAppDirRecursive(dirPath, baseDir, route.children!);

        // Only add if it has a page or children with pages
        if (pageFile || (route.children && route.children.length > 0)) {
          routes.push(route);
        }
      }
    }
  }

  /**
   * Scan Next.js Pages Router directory
   */
  private async scanNextJsPagesDir(pagesDir: string): Promise<NavigationRoute[]> {
    const routes: NavigationRoute[] = [];
    await this.scanPagesDirRecursive(pagesDir, pagesDir, routes);
    return routes;
  }

  /**
   * Recursively scan Pages Router directory
   */
  private async scanPagesDirRecursive(
    currentDir: string,
    baseDir: string,
    routes: NavigationRoute[]
  ): Promise<void> {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);

      // Skip special files
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) {
        continue;
      }

      if (entry.isDirectory()) {
        const route: NavigationRoute = {
          name: this.formatRouteName(entry.name),
          type: 'page',
          children: []
        };

        await this.scanPagesDirRecursive(entryPath, baseDir, route.children!);

        if (route.children && route.children.length > 0) {
          routes.push(route);
        }
      } else if (this.isPageFile(entry.name)) {
        const name = entry.name.replace(/\.(tsx|ts|jsx|js)$/, '');
        if (name !== 'index') {
          routes.push({
            name: this.formatRouteName(name),
            filePath: entryPath,
            type: 'page'
          });
        } else {
          // Index file represents the parent route
          const parentRoute = routes[routes.length - 1];
          if (parentRoute) {
            parentRoute.filePath = entryPath;
          } else {
            routes.push({
              name: 'Home',
              filePath: entryPath,
              type: 'page'
            });
          }
        }
      }
    }
  }

  /**
   * Analyze React Navigation (for Expo/React Native)
   */
  private async analyzeReactNavigation(): Promise<NavigationStructure> {
    // Look for navigation configuration files
    const navPatterns = [
      '**/navigation/**/*.{ts,tsx}',
      '**/navigator/**/*.{ts,tsx}',
      '**/routes/**/*.{ts,tsx}',
      '**/Navigation.{ts,tsx}',
      '**/AppNavigator.{ts,tsx}',
      '**/RootNavigator.{ts,tsx}'
    ];

    const routes: NavigationRoute[] = [];
    let configFile: string | undefined;

    for (const pattern of navPatterns) {
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(this.workspaceRoot, pattern),
        '**/node_modules/**'
      );

      if (files.length > 0) {
        configFile = path.relative(this.workspaceRoot, files[0].fsPath);

        // Parse navigation files to find screens
        for (const file of files) {
          const content = fs.readFileSync(file.fsPath, 'utf-8');
          const screens = this.extractReactNavigationScreens(content, file.fsPath);
          routes.push(...screens);
        }

        break;
      }
    }

    // Also check for Expo Router (app directory)
    const appDir = this.findDirectory(['app']);
    if (appDir) {
      const expoRoutes = await this.scanExpoRouterDir(appDir);
      routes.push(...expoRoutes);
    }

    if (routes.length === 0) {
      return { type: 'none', routes: [] };
    }

    return {
      type: 'react-navigation',
      routes: this.deduplicateRoutes(routes),
      configFile
    };
  }

  /**
   * Scan Expo Router directory structure
   */
  private async scanExpoRouterDir(appDir: string): Promise<NavigationRoute[]> {
    const routes: NavigationRoute[] = [];
    const entries = fs.readdirSync(appDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) {
        continue;
      }

      const entryPath = path.join(appDir, entry.name);

      if (entry.isDirectory()) {
        // Check if it's a route group (parentheses)
        const isGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
        const children = await this.scanExpoRouterDir(entryPath);

        if (isGroup) {
          routes.push(...children);
        } else {
          routes.push({
            name: this.formatRouteName(entry.name),
            type: 'screen',
            children: children.length > 0 ? children : undefined
          });
        }
      } else if (this.isPageFile(entry.name)) {
        const name = entry.name.replace(/\.(tsx|ts|jsx|js)$/, '');
        if (name !== 'index' && name !== '_layout') {
          routes.push({
            name: this.formatRouteName(name),
            filePath: entryPath,
            type: 'screen'
          });
        }
      }
    }

    return routes;
  }

  /**
   * Extract screen names from React Navigation code
   */
  private extractReactNavigationScreens(content: string, filePath: string): NavigationRoute[] {
    const routes: NavigationRoute[] = [];

    // Match Screen components: <Stack.Screen name="ScreenName" ...
    const screenRegex = /<\w+\.Screen\s+name=["']([^"']+)["']/g;
    let match;

    while ((match = screenRegex.exec(content)) !== null) {
      routes.push({
        name: match[1],
        type: 'screen'
      });
    }

    // Match createNavigator calls with config objects
    const navigatorConfigRegex = /create\w+Navigator\s*\(\s*\{([^}]+)\}/g;
    while ((match = navigatorConfigRegex.exec(content)) !== null) {
      const screenMatches = match[1].matchAll(/(\w+)\s*:/g);
      for (const screenMatch of screenMatches) {
        if (!['initialRouteName', 'screenOptions'].includes(screenMatch[1])) {
          routes.push({
            name: screenMatch[1],
            type: 'screen'
          });
        }
      }
    }

    return routes;
  }

  /**
   * Analyze React Router (for web React)
   */
  private async analyzeReactRouter(): Promise<NavigationStructure> {
    const routePatterns = [
      '**/routes/**/*.{ts,tsx}',
      '**/router/**/*.{ts,tsx}',
      '**/App.{ts,tsx}',
      '**/main.{ts,tsx}'
    ];

    const routes: NavigationRoute[] = [];
    let configFile: string | undefined;

    for (const pattern of routePatterns) {
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(this.workspaceRoot, pattern),
        '**/node_modules/**'
      );

      for (const file of files) {
        const content = fs.readFileSync(file.fsPath, 'utf-8');

        // Check if this file uses React Router
        if (content.includes('react-router') || content.includes('<Route')) {
          if (!configFile) {
            configFile = path.relative(this.workspaceRoot, file.fsPath);
          }

          const fileRoutes = this.extractReactRouterRoutes(content);
          routes.push(...fileRoutes);
        }
      }
    }

    if (routes.length === 0) {
      return { type: 'none', routes: [] };
    }

    return {
      type: 'react-router',
      routes: this.deduplicateRoutes(routes),
      configFile
    };
  }

  /**
   * Extract routes from React Router code
   */
  private extractReactRouterRoutes(content: string): NavigationRoute[] {
    const routes: NavigationRoute[] = [];

    // Match <Route path="/path" ...
    const routeRegex = /<Route[^>]+path=["']([^"']+)["']/g;
    let match;

    while ((match = routeRegex.exec(content)) !== null) {
      const routePath = match[1];
      routes.push({
        name: this.formatRouteName(routePath),
        type: 'route'
      });
    }

    // Match route config objects: { path: "/path", ... }
    const configRegex = /\{\s*path:\s*["']([^"']+)["']/g;
    while ((match = configRegex.exec(content)) !== null) {
      routes.push({
        name: this.formatRouteName(match[1]),
        type: 'route'
      });
    }

    return routes;
  }

  /**
   * Find a directory from a list of candidates
   */
  private findDirectory(candidates: string[]): string | null {
    for (const candidate of candidates) {
      const fullPath = path.join(this.workspaceRoot, candidate);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        return fullPath;
      }
    }
    return null;
  }

  /**
   * Find the first existing file from a list
   */
  private findFirstExisting(paths: string[]): string | null {
    for (const p of paths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  /**
   * Check if a filename is a page file
   */
  private isPageFile(filename: string): boolean {
    return /\.(tsx|ts|jsx|js)$/.test(filename) && !filename.startsWith('_');
  }

  /**
   * Get route path from directory path
   */
  private getRoutePathFromDir(dirPath: string, baseDir: string): string {
    const relative = path.relative(baseDir, dirPath);
    return '/' + relative.replace(/\\/g, '/');
  }

  /**
   * Format a route name for display
   */
  private formatRouteName(name: string): string {
    // Remove dynamic route brackets
    let formatted = name.replace(/\[([^\]]+)\]/g, ':$1');

    // Remove leading slash
    formatted = formatted.replace(/^\/+/, '');

    // Convert kebab-case to Title Case
    if (formatted.includes('-')) {
      formatted = formatted
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    } else if (formatted.includes('/')) {
      // Use last segment
      formatted = formatted.split('/').pop() || formatted;
    }

    // Capitalize first letter
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  /**
   * Remove duplicate routes
   */
  private deduplicateRoutes(routes: NavigationRoute[]): NavigationRoute[] {
    const seen = new Set<string>();
    return routes.filter(route => {
      const key = route.name + (route.filePath || '');
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}

export { NavigationAnalyzer as default };
