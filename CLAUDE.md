# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MarkText is an Electron-based WYSIWYG markdown editor built with Vue.js. The application uses a custom markdown rendering engine called Muya and follows a multi-process Electron architecture.

## Build & Development Commands

### Prerequisites
- Node.js `>=v16` but `<v17`
- yarn package manager
- Python `>=v3.6` (for node-gyp)
- C++ compiler and development tools

**Linux-specific dependencies:**
- `libX11`, `libxkbfile`, `libsecret`, `libfontconfig` (with headers)

### Core Commands

```bash
# Install dependencies
yarn install --frozen-lockfile

# Development mode (watch and auto-reload)
yarn run dev

# Linting
yarn run lint          # Check code style
yarn run lint:fix      # Auto-fix linting issues

# Testing
yarn run unit          # Run unit tests (karma)
yarn run e2e           # Run end-to-end tests (playwright)
yarn run test          # Run both unit and e2e tests
yarn run test:specs    # Run CommonMark and GFM spec tests

# Building
yarn run build         # Build for current OS
yarn run build:bin     # Build unpacked for current OS
yarn run build:dev     # Build without packaging
yarn run release:linux # Build for Linux
yarn run release:mac   # Build for macOS
yarn run release:win   # Build for Windows

# Muya (editor engine)
yarn run build:muya    # Build Muya standalone

# Utilities
yarn run rebuild       # Rebuild native modules
```

## Architecture

### Multi-Process Electron Structure

The application follows Electron's main/renderer process architecture:

**Main Process** (`src/main/`):
- Entry point: `src/main/index.js`
- Application lifecycle management (`src/main/app/index.js`)
- Window management (`src/main/windows/`)
- Menu system (`src/main/menu/`)
- File system operations (`src/main/filesystem/`)
- Keyboard shortcuts (`src/main/keyboard/`)
- IPC communication handlers
- Preferences storage (`src/main/preferences/`)

**Renderer Process** (`src/renderer/`):
- Entry point: `src/renderer/main.js`
- Vue.js application with Vuex state management
- UI components (`src/renderer/components/`)
- Editor integration with Muya
- Stores: `editor`, `layout`, `preferences`, `project`, `notification`, `autoUpdates`, `commandCenter`

**Common** (`src/common/`):
- Shared code between main and renderer processes

### Muya Editor Engine

**Location:** `src/muya/`

Muya is the custom browser-based markdown editor engine that powers MarkText's WYSIWYG editing experience.

**Key components:**
- `src/muya/lib/index.js` - Main Muya class
- `src/muya/lib/contentState/` - Document state management (30+ files)
- `src/muya/lib/parser/` - Markdown parsing and rendering
- `src/muya/lib/eventHandler/` - User input handling
- `src/muya/lib/ui/` - Editor UI components
- `src/muya/lib/selection/` - Text selection management
- Uses Snabbdom for virtual DOM rendering

### Build System

**electron-vue** based build configuration:

- `webpack.main.config.js` - Main process webpack config
- `webpack.renderer.config.js` - Renderer process webpack config
- `dev-runner.js` - Development mode orchestration
- `build.js` - Production build script

The build system uses two separate webpack configurations to bundle main and renderer processes independently.

### State Management

Vuex store modules (`src/renderer/store/`):
- **editor**: Editor state, tabs, file content
- **layout**: UI layout, sidebar, focus modes
- **preferences**: User settings
- **project**: Current project/folder state
- **commandCenter**: Command palette and actions
- **notification**: Toast notifications
- **autoUpdates**: Update checking and installation

### IPC Communication

- Main → Renderer: `src/renderer/store/listenForMain.js`
- Renderer → Main: Various `ipcRenderer.send()` calls in components
- Main process handlers: `src/main/app/index.js` (see `_listenForIpcMain()`)

### File Structure Conventions

- Components: Vue single-file components (`.vue`)
- Code style: ES6, 2-space indent, no semicolons
- Documentation: JSDoc comments
- Main branch: `develop` (not `master`)

## Development Guidelines

### Making Changes

1. PRs must target the `develop` branch
2. Run `yarn run lint` before committing
3. All CI checks must pass
4. Use JSDoc for new functions and classes
5. Follow the philosophy: keep things clean, simple, and minimal

### Code Style

- ES6 syntax and best practices
- 2-space indentation
- No semicolons
- Use JSDoc for documentation

### Testing

For unit tests, files are located in `test/unit/`.
For e2e tests, files are located in `test/e2e/` using Playwright.

### Common File Locations

- Themes: `src/renderer/assets/styles/`
- Icons: `src/renderer/assets/icons/`
- Menu templates: `src/main/menu/templates/`
- Context menus: Main in `src/main/contextMenu/`, Renderer in `src/renderer/contextMenu/`
- File type detection: `src/main/filesystem/`

## Important Implementation Notes

- The app uses `@electron/remote` for accessing main process modules from renderer (marked for deprecation - TODO migrate)
- Single instance lock prevents multiple MarkText instances (except on macOS App Store)
- CodeMirror is used for source code mode
- KaTeX for math rendering, Mermaid for diagrams, Vega for charts
- Platform detection: `isOsx`, `isWindows`, `isLinux` from `src/main/config.js`

## Environment Variables

- `NODE_ENV=development` - Development mode
- `MARKTEXT_EXIT_ON_ERROR=1` - Exit immediately on errors (used in tests)
- `MARKTEXT_ERROR_INTERACTION` - Disable error dialogs

## Logging

Uses `electron-log`:
- Main process logs: `{app data path}/logs/main.log`
- Configure in `src/main/index.js`
