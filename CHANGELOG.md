# Changelog

## 0.2.0

### Fixed
- Imports through tsconfig path aliases (e.g. `@/components/Button`) are now counted
- Re-exports (`export * from`, `export { x } from`), `require()` and dynamic `import()` are now counted, so barrel `index.ts` files show their dependencies
- ESM-style `./file.js` imports now resolve to `file.ts`
- Architecture file lists, the current-file panel and the status bar now stay in sync with file changes
- Creating a file now resolves existing imports that pointed to it
- Long lists in the sidebar are no longer cut off

### Changed
- Declaration files (`.d.ts`) are no longer listed
- Analysis progress shows inside the view instead of as a notification
- The extension activates only when the Scaffold view is opened or a Scaffold command is run
- React web projects are labeled "React (Web)"

### Performance
- Full analysis is about 2.4x faster and no longer blocks the editor
- Saves that don't change imports no longer trigger any recomputation
- No work is done while the view is hidden
- Package size reduced from 88 files (including all of TypeScript) to a single 1 MB bundle
