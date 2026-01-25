# Claude Code Terminal

Minimal, lightweight terminal app for Claude Code - a VS Code alternative.

## Tech Stack

- **Frontend**: Svelte 5 + TypeScript
- **Backend**: Tauri v2 (Rust)
- **Terminal**: xterm.js + portable-pty (Rust)
- **Platform**: Cross-platform (macOS, Windows, Linux)

## Features

### Tile-Based Layout
- Orchestrator tile (always visible) + up to 12 terminal tiles
- Adaptive grid layout (1x1, 2x1, 2x2, 3x2, 3x3, 4x3)
- Expand/collapse tiles to fullscreen
- Add/remove terminal tiles dynamically

### Terminal Integration
- Full PTY support via Rust backend
- xterm.js for terminal emulation
- Auto-start Claude Code on new terminal
- "Choose Folder" option for custom working directory

### Orchestrator Panel
- **Permission Detection**: Parses terminal output to detect Claude Code permission prompts
- **Centralized Approval**: All permission requests from all terminals shown in one place
- **Terminal Status Display**: Shows status of all active terminals
  - "Working..." (green pulse) - Claude is processing
  - "Ready" - Claude is waiting for user input (prompt visible)
  - "Waiting for input" - Permission question pending

### UI/UX
- Claude orange accent color (#da7756)
- Active terminal indicated by green border
- Click anywhere on terminal to set as active
- macOS traffic lights with hidden title
- Window dragging via title bar region
- Dark theme matching Claude Code aesthetic

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    App.svelte                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Orchestrator│  │  Terminal   │  │  Terminal   │  │
│  │             │  │  (xterm.js) │  │  (xterm.js) │  │
│  │  - Status   │  │             │  │             │  │
│  │  - Perms    │  │             │  │             │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────┘
         │                   │
         ▼                   ▼
┌─────────────────────────────────────────────────────┐
│              Output Parser (TypeScript)              │
│  - Detects permission prompts                        │
│  - Detects prompt visibility (idle detection)        │
│  - Strips ANSI codes for parsing                     │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│              Tauri Backend (Rust)                    │
│  - PTY session management (portable-pty)             │
│  - Event system for output streaming                 │
│  - Window management                                 │
└─────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `src/App.svelte` | Main app with grid layout |
| `src/lib/components/Terminal.svelte` | xterm.js terminal wrapper |
| `src/lib/components/Orchestrator.svelte` | Permission queue & status display |
| `src/lib/utils/outputParser.ts` | Terminal output parsing for prompts/questions |
| `src/lib/stores/sessions.ts` | Session state management |
| `src/lib/stores/orchestrator.ts` | Permission queue state |
| `src-tauri/src/pty.rs` | Rust PTY implementation |
| `src-tauri/tauri.conf.json` | Tauri window configuration |

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run tauri dev

# Build for production
npm run tauri build
```

## Configuration

### Window Settings (tauri.conf.json)
```json
{
  "windows": [{
    "decorations": true,
    "hiddenTitle": true,
    "transparent": true
  }]
}
```

### Capabilities (capabilities/default.json)
- `core:window:allow-start-dragging` - Window dragging
- `shell:default` - Shell/PTY operations

## Status Logic

The output parser detects terminal state:

1. **Prompt Detection** (`❯` or `>` visible) → Status: `idle` (Ready)
2. **Question Detection** (numbered options) → Status: `waiting` (Waiting for input)
3. **Output Streaming** (no prompt) → Status: `active` (Working...)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+1-9` | Select terminal tile by index |
| `Cmd+T` | New terminal tile |
| `Cmd+W` | Close active terminal |
| `Cmd+[` | Previous terminal |
| `Cmd+]` | Next terminal |
| `Cmd+Enter` | Toggle fullscreen for active tile |

## Roadmap

### v0.1.0 (Current)
- [x] Tile-based layout with Orchestrator
- [x] Terminal PTY integration
- [x] Permission detection & queue
- [x] Status detection (Working/Ready/Waiting)
- [x] Traffic light controls
- [x] Keyboard shortcuts

### Phase 2 (Planned)
- [ ] **Broadcast Mode** - Type in all terminals simultaneously (`Cmd+Shift+B`)
- [ ] **Terminal Search** - Find in buffer (`Cmd+F`)
- [ ] **Font Size Control** - Zoom in/out (`Cmd+Plus/Minus/0`)
- [ ] **Theme System** - Multiple themes (Dracula, Nord, One Dark, Solarized)
- [ ] **Settings Panel** - Font, shell path, appearance options
- [ ] **Split Pane** - Horizontal/vertical splits with draggable dividers
- [ ] **Autocomplete** - Command, path, history suggestions

### Phase 3 (Future)
- [ ] **Local LLM** - Ollama integration for AI assistance
- [ ] **Error Detection** - Pattern-based error suggestions
- [ ] **Expert Agents** - Git, file search, error recovery agents

## Recent Changes (v0.1.0)

- Added keyboard shortcuts (Cmd+1-9, Cmd+T, Cmd+W, Cmd+[/], Cmd+Enter)
- Added terminal status display to Orchestrator
- **Improved Claude detection** - Status only shows when Claude Code is running
- **Shell vs Claude sessions** - Separate display for shell-only terminals
- Implemented idle detection (prompt visibility)
- Fixed permission parsing - waits for "Esc to cancel" before capturing options
- Changed accent color to Claude orange (#da7756)
- Fixed multi-line option text parsing
- Fixed grid layout for up to 12 tiles
- Added click-to-activate for terminal tiles
- **Native macOS traffic lights** with overlay title bar
- Fixed app icon with transparent corners
- Hidden tiles still receive PTY output (visibility: hidden vs display: none)
