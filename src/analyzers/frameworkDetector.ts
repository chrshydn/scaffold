import * as fs from 'fs';
import * as path from 'path';
import { Framework, FrameworkInfo } from '../models/types';

/**
 * Detects the React framework used in a workspace
 */
export class FrameworkDetector {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Detect the framework used in the workspace
   */
  detect(): FrameworkInfo {
    const packageJson = this.readPackageJson();
    if (!packageJson) {
      return { framework: 'unknown' };
    }

    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };

    // Check for Expo first (takes priority over react-native)
    if (deps['expo']) {
      return {
        framework: 'expo',
        version: this.extractVersion(deps['expo']),
        configFile: this.findConfigFile(['app.json', 'app.config.js', 'app.config.ts'])
      };
    }

    // Check for React Native (without Expo)
    if (deps['react-native']) {
      return {
        framework: 'react-native',
        version: this.extractVersion(deps['react-native']),
        configFile: this.findConfigFile(['metro.config.js', 'react-native.config.js'])
      };
    }

    // Check for Next.js
    if (deps['next']) {
      return {
        framework: 'nextjs',
        version: this.extractVersion(deps['next']),
        configFile: this.findConfigFile(['next.config.js', 'next.config.mjs', 'next.config.ts'])
      };
    }

    // Check for React (web)
    if (deps['react']) {
      // Determine build tool
      const configFile = this.findConfigFile([
        'vite.config.ts',
        'vite.config.js',
        'webpack.config.js',
        'craco.config.js'
      ]);

      return {
        framework: 'react-web',
        version: this.extractVersion(deps['react']),
        configFile
      };
    }

    return { framework: 'unknown' };
  }

  /**
   * Read and parse package.json
   */
  private readPackageJson(): any | null {
    const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Extract version number from dependency string
   */
  private extractVersion(versionString: string): string {
    // Remove ^ or ~ prefix
    return versionString.replace(/^[\^~]/, '');
  }

  /**
   * Find the first existing config file from a list
   */
  private findConfigFile(candidates: string[]): string | undefined {
    for (const candidate of candidates) {
      const fullPath = path.join(this.workspaceRoot, candidate);
      if (fs.existsSync(fullPath)) {
        return candidate;
      }
    }
    return undefined;
  }

  /**
   * Get framework display name
   */
  static getDisplayName(framework: Framework): string {
    switch (framework) {
      case 'expo': return 'Expo';
      case 'react-native': return 'React Native';
      case 'nextjs': return 'Next.js';
      case 'react-web': return 'React (Web)';
      default: return 'Unknown';
    }
  }
}

export { FrameworkDetector as default };
