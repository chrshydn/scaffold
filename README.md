# Scaffold

A VS Code extension that provides a live structural map of React/React Native/Next.js TypeScript codebases.

## Features

- **Framework Detection** - Auto-detects Expo, React Native, Next.js, or web React
- **Entry Point Discovery** - Finds true entry points based on framework conventions
- **Import Graph** - Static analysis of TypeScript imports (including tsconfig path aliases and re-exports) to build a dependency graph
- **Load-Bearing Files** - Identifies files that are widely imported (high impact)
- **Leaf Files** - Shows files with no dependents (safe to modify)
- **Live Updates** - Watches for file changes and updates incrementally

## Installation

### From Source
```bash
git clone https://github.com/chrshydn/scaffold.git
cd scaffold
npm install
npm run compile
```

Then press F5 in VS Code to run the extension.

### From VSIX
```bash
npm install -g @vscode/vsce
vsce package
code --install-extension scaffold-structure-map-0.2.0.vsix
```

## Usage

1. Open a React/React Native/Next.js project
2. Click the Scaffold icon in the Activity Bar (left sidebar)
3. View the structure map showing:
   - Framework info and version
   - Entry points
   - Navigation/routes (if detected)
   - Architecture overview
   - Load-bearing files (sorted by import count)
   - Leaf files

Click any file to open it in the editor.

## Contributing

Contributions welcome! The codebase is modular:

- `src/analyzers/` - Framework detection, import graph, navigation analysis
- `src/parsers/` - TypeScript import extraction
- `src/views/` - WebView provider
- `src/watchers/` - File change detection
- `media/` - WebView script and styles

### Testing

```bash
npm test          # bundles, then runs webview tests (jsdom) and integration tests in VS Code
npm run lint
```

Integration tests download a test copy of VS Code on first run and exercise the bundled
extension against the sample project in `test/fixture/`.

## License

MIT
