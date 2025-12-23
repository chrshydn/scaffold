# Scaffold

A VS Code extension that provides a live structural map of React/React Native/Next.js TypeScript codebases.

## Features

- **Framework Detection** - Auto-detects Expo, React Native, Next.js, or web React
- **Entry Point Discovery** - Finds true entry points based on framework conventions
- **Import Graph** - Static analysis of TypeScript imports to build dependency graph
- **Load-Bearing Files** - Identifies files that are widely imported (high impact)
- **Leaf Files** - Shows files with no dependents (safe to modify)
- **Live Updates** - Watches for file changes and updates incrementally

## Installation

### From Source
```bash
git clone https://github.com/YOUR_USERNAME/scaffold.git
cd scaffold
npm install
npm run compile
```

Then press F5 in VS Code to run the extension.

### From VSIX
```bash
npm install -g @vscode/vsce
vsce package
code --install-extension scaffold-0.1.0.vsix
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
- `src/views/` - WebView UI
- `src/watchers/` - File change detection

## License

MIT
