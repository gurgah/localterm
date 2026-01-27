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
- **New Terminal Options**: "Start Claude" or "Command Line" choice on new tile
- "Choose Folder" option for custom working directory
- Text selection and copy/paste support
- Double-click rename for terminal sessions

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
│  │   (View)    │  │  (xterm.js) │  │  (xterm.js) │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────┘
         │                   │
         ▼                   ▼
┌─────────────────────────────────────────────────────┐
│                    Services                          │
│  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │ claudeDetector  │  │ permissionHandler       │   │
│  │ (state detect)  │  │ (send responses)        │   │
│  └─────────────────┘  └─────────────────────────┘   │
└─────────────────────────────────────────────────────┘
         │                   │
         ▼                   ▼
┌─────────────────────────────────────────────────────┐
│                    Stores                            │
│  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │ sessions        │  │ orchestratorQueue       │   │
│  │ (session state) │  │ (permission queue)      │   │
│  └─────────────────┘  └─────────────────────────┘   │
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
| `src/lib/components/Terminal.svelte` | xterm.js terminal + detection trigger |
| `src/lib/components/Orchestrator.svelte` | Permission queue & status display (view) |
| `src/lib/services/claudeDetector.ts` | Claude state detection (pure functions) |
| `src/lib/services/permissionHandler.ts` | Permission response handling |
| `src/lib/utils/terminalBuffer.ts` | xterm.js buffer reader utility |
| `src/lib/stores/sessions.ts` | Session state management |
| `src/lib/stores/orchestrator.ts` | Permission queue state |
| `src-tauri/src/pty.rs` | Rust PTY implementation |
| `src-tauri/tauri.conf.json` | Tauri window configuration |

## Known Issues

### Wide Terminal Detection Bug
**Status**: Open

When terminal is fullscreen/maximized, Claude detection fails - sessions show as "Shell" instead of "Claude". Permission prompts don't appear. **Workaround**: Use smaller window size.

See `DEVELOPMENT_TRACKER.md` for details.

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
- `process:default` - App quit functionality

### Menu Structure
- **View**: New Terminal (Cmd+T), Close Terminal (Cmd+W)
- **Settings**: Default Location, Show Orchestrator
- **Help**: Report Bug... (opens mailto:melih@aleonis.co)

## Status Logic

The output parser (`outputParser.ts`) detects terminal state with robust debouncing:

### Claude Detection (with Debouncing)
- **Strong Indicators**: `? for shortcuts`, `/ide for`, `Esc to cancel/exit`, `Tab to add`, thinking/working indicators
- **Exit Conditions** (all must be true):
  1. Shell prompt visible (ends with `➜`, `$`, `>`, etc.)
  2. 3+ consecutive non-Claude detections
  3. 2+ seconds since last Claude UI detection
  4. No Claude UI in last 3 lines

### Status States
1. **Shell Mode** - No Claude running, shows shell prompt
2. **Active** (Working...) - Claude is processing, no prompt visible
3. **Idle** (Ready) - Claude prompt visible, waiting for user input
4. **Waiting** - Permission question detected, shown in Orchestrator

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+1-9` | Select terminal tile by index |
| `Cmd+T` | New terminal tile |
| `Cmd+W` | Close active terminal (with confirmation) |
| `Cmd+Q` | Quit app (with confirmation modal) |
| `Cmd+[` | Previous terminal |
| `Cmd+]` | Next terminal |
| `Cmd+Enter` | Toggle fullscreen for active tile |
| `Double-click` | Rename terminal session (on title) |

## Roadmap

### v0.1.0 (Current)
- [x] Tile-based layout with Orchestrator
- [x] Terminal PTY integration
- [x] Permission detection & queue
- [x] Status detection (Working/Ready/Waiting)
- [x] Traffic light controls
- [x] Keyboard shortcuts (Cmd+1-9, T, W, Q, [, ], Enter)
- [x] Quit confirmation modal (Cmd+Q)
- [x] Session rename (double-click)
- [x] New terminal choice screen (Claude vs Command Line)
- [x] Robust Claude detection with debouncing
- [x] Text selection in terminal
- [x] Max 12 tiles limit

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

### Latest (2026-01-26)
- **Modular Architecture Refactor**:
  - `src/lib/services/claudeDetector.ts` - Pure detection functions
  - `src/lib/services/permissionHandler.ts` - Permission response handling
  - `src/lib/utils/terminalBuffer.ts` - xterm.js buffer reader
  - Separation of concerns: Services → Stores → Views
- **xterm.js Buffer API** - Uses rendered terminal text instead of raw PTY output
- **Report Bug Menu** - Opens mailto link via Tauri shell plugin
- **Cmd+Q Quit Confirmation** - Full-screen modal overlay with blur effect
- **Session Rename** - Double-click on terminal title to rename (max 20 chars)
- **New Terminal Choice Screen** - Cmd+T shows "Start Claude" or "Command Line" options instead of auto-starting Claude
- **Terminal Text Selection** - Fixed: can now select text in terminal
- **Right-click Context Menu** - Only shows on tile header, not terminal content
- **xterm.js rightClickSelectsWord** - Right-click on word selects it for quick copy
- **Max 12 Tiles** - Enforced limit on terminal tiles
- **Fixed Terminal Close Crashes** - Proper disposal handling with isDisposed flag and safeTerminalOp wrapper
- **Orchestrator Menu Sync** - Checkbox state properly syncs with localStorage on startup

**Known Issue**: Wide terminal detection bug - see Known Issues section above.

### Earlier
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

## Deployment Status (2026-01-26)

### Live Website
- **Landing Page**: https://localterm.aleonis.co
- **OG Image**: https://localterm.aleonis.co/og-image.png

### Download Links
| Platform | URL |
|----------|-----|
| macOS ARM64 | https://localterm.aleonis.co/releases/LocalTerm-macos-arm64.dmg |
| macOS Intel | https://localterm.aleonis.co/releases/LocalTerm-macos-x64.dmg |
| Windows x64 | https://localterm.aleonis.co/releases/LocalTerm-windows-x64-setup.exe |
| Linux x64 | https://localterm.aleonis.co/releases/LocalTerm-linux-x64.AppImage |

### GitHub Repository
- **Repo**: https://github.com/gurgah/localterm
- **CI/CD**: GitHub Actions builds all platforms on tag push

### AWS Infrastructure
- **S3 Bucket**: localterm.aleonis.co (us-east-1)
- **CloudFront**: deikkbzxq2ciy.cloudfront.net
- **CloudFront ID**: `E1ZKEU71D8W5Q3`
- **SSL Certificate**: ACM (us-east-1)
- **DNS**: Namecheap CNAME → CloudFront

### Download Analytics (CloudFront Logs)
- **Log Bucket**: `s3://localterm-logs-aleonis/cloudfront/`
- **Delay**: ~1 hour (CloudFront standard)
- **Script**: `./scripts/download-stats.sh`

```bash
# View download statistics
./scripts/download-stats.sh

# Output includes:
# - Downloads by file (dmg, exe, AppImage)
# - Downloads by platform (macOS ARM/Intel, Windows, Linux)
# - Downloads by date
# - Total download count
```

### macOS Code Signing Status
- **Certificate**: Developer ID Application: Melih Gurgah (8ZPW6SCJ4T)
- **Entitlements**: `src-tauri/entitlements.plist` (sandbox disabled for PTY)
- **App Signed**: Yes (with `codesign --deep --force --options runtime`)

### Notarization Status: ⏳ IN PROGRESS
- **Submission ID**: `472a4dae-5ff0-49e1-abc2-8e149514f5cf`
- **Submitted**: 2026-01-26
- **Status**: Apple is still processing

#### Next Session Commands
```bash
# Check notarization status
xcrun notarytool info 472a4dae-5ff0-49e1-abc2-8e149514f5cf --keychain-profile "notarytool-profile"

# If status is "Accepted", staple the ticket
xcrun stapler staple "/Users/drs/Code/claude-code-terminal/src-tauri/target/release/bundle/macos/LocalTerm AI.app"

# Then recreate DMG and upload to S3
hdiutil create -volname "LocalTerm AI" -srcfolder "LocalTerm AI.app" -ov -format UDZO "LocalTerm-macos-arm64.dmg"
aws s3 cp "LocalTerm-macos-arm64.dmg" s3://localterm.aleonis.co/releases/ --profile mlxstudio
aws cloudfront create-invalidation --distribution-id E1ZKEU71D8W5Q3 --paths "/releases/*" --profile mlxstudio
```

#### Workaround for Unsigned App
Until notarization completes, users can run: Right-click → Open → Open (bypasses Gatekeeper)
