# Claude Code Terminal - Development Master Plan

> Minimal, multi-session terminal for Claude Code with orchestrator capabilities

## Project Summary

| Item | Value |
|------|-------|
| **Goal** | VS Code alternative specifically for Claude Code (~50MB vs ~800MB) |
| **Stack** | Tauri v2 + Svelte 5 + xterm.js + Rust |
| **Target** | Cross-platform (macOS, Windows, Linux) |
| **SDK** | Claude Agent SDK (AskUserQuestion, canUseTool) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLAUDE CODE TERMINAL                        │
├─────────────────────────────────────────────────────────────────┤
│  FRONTEND (Svelte)                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │   TabBar    │ │  Terminal   │ │Orchestrator │               │
│  │  (sessions) │ │  (xterm.js) │ │ (questions) │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                         │                                       │
│                    Tauri IPC                                    │
│                         │                                       │
│  BACKEND (Rust)         ▼                                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │   Session   │ │     PTY     │ │   Output    │               │
│  │   Manager   │ │   Manager   │ │   Parser    │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                         │                                       │
│                         ▼                                       │
│              ┌─────────────────────┐                           │
│              │    Claude Code      │                           │
│              │    (subprocess)     │                           │
│              └─────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 0: Project Setup [DONE]
> Foundation and proof of concept

### Completed
- [x] Project scaffold (Tauri + Svelte)
- [x] Basic UI components (TabBar, Terminal, Orchestrator)
- [x] xterm.js integration
- [x] Dark theme styling
- [x] AskUserQuestion UI (SDK-compatible)
- [x] High-level design document

### Output
- Working UI prototype at `localhost:1420`
- Demo data for orchestrator testing

---

## Phase 1: PTY Integration
> Connect real terminal sessions

### 1.1 Rust PTY Backend
```
src-tauri/src/
├── pty.rs          # PTY spawn, read, write, resize
├── session.rs      # Session lifecycle management
└── commands.rs     # Tauri IPC commands
```

**Tasks:**
- [ ] Add `portable-pty` crate dependency
- [ ] Implement `spawn_pty(shell, cwd)` → returns session_id
- [ ] Implement `write_pty(session_id, data)` → write to stdin
- [ ] Implement `read_pty(session_id)` → stream stdout via events
- [ ] Implement `resize_pty(session_id, cols, rows)`
- [ ] Implement `kill_pty(session_id)`
- [ ] Handle PTY errors gracefully

**Tauri Commands:**
```rust
#[tauri::command]
async fn create_session(cwd: String) -> Result<String, String>;

#[tauri::command]
async fn write_to_session(id: String, data: String) -> Result<(), String>;

#[tauri::command]
async fn resize_session(id: String, cols: u16, rows: u16) -> Result<(), String>;

#[tauri::command]
async fn close_session(id: String) -> Result<(), String>;
```

**Events (Rust → Frontend):**
```rust
// Emit to frontend when PTY has output
app.emit("pty-output", PtyOutput { session_id, data });
app.emit("pty-exit", PtyExit { session_id, code });
```

### 1.2 Frontend PTY Integration
**Tasks:**
- [ ] Listen to `pty-output` events
- [ ] Route output to correct terminal instance
- [ ] Send xterm.js input to `write_to_session`
- [ ] Handle terminal resize → `resize_session`
- [ ] Handle session close/exit

### 1.3 Testing
- [ ] Single session: spawn shell, type commands, see output
- [ ] Multiple sessions: switch tabs, independent sessions
- [ ] Resize: terminal resizes correctly
- [ ] Exit: clean shutdown when closing tab

---

## Phase 2: Claude Code Integration
> Spawn and manage Claude Code processes

### 2.1 Claude Code Spawner
**Tasks:**
- [ ] Detect Claude Code installation (`which claude`)
- [ ] Spawn Claude Code in PTY: `claude` or `claude "prompt"`
- [ ] Pass working directory to Claude Code
- [ ] Handle Claude Code not installed error

### 2.2 Session Types
```typescript
interface Session {
  id: string;
  name: string;
  type: "shell" | "claude";  // NEW
  cwd: string;
  status: "active" | "waiting" | "idle" | "error";
}
```

**Tasks:**
- [ ] Add session type to data model
- [ ] "New Claude Session" button/action
- [ ] "New Shell Session" option
- [ ] Visual distinction between session types

### 2.3 Working Directory
- [ ] Directory picker dialog (Tauri file dialog)
- [ ] Remember last used directories
- [ ] Display current directory in UI

---

## Phase 3: Output Parser
> Detect when Claude needs input

### 3.1 Parser Implementation
```
src-tauri/src/parser.rs
```

**Detection Patterns:**
```rust
enum DetectedInput {
    // AskUserQuestion from SDK
    AskUserQuestion {
        questions: Vec<Question>,
    },
    // Tool approval request
    ToolApproval {
        tool_name: String,
        description: String,
    },
    // Simple y/n prompt
    YesNo {
        prompt: String,
    },
    // Free text input
    FreeText {
        prompt: String,
    },
}
```

**Tasks:**
- [ ] Parse ANSI escape sequences
- [ ] Detect `[1] [2] [3]` numbered options
- [ ] Detect `(y/n)` prompts
- [ ] Detect `Enter ...:` prompts
- [ ] Detect tool approval requests
- [ ] Extract question text and options
- [ ] Handle multi-line questions

### 3.2 Parser → Orchestrator Bridge
**Tasks:**
- [ ] Emit `input-required` event when input detected
- [ ] Include parsed question data in event
- [ ] Update session status to "waiting"

### 3.3 Answer → PTY Bridge
**Tasks:**
- [ ] Receive answer from orchestrator
- [ ] Format answer for PTY (add newline)
- [ ] Write to correct session's PTY
- [ ] Update session status to "active"

---

## Phase 4: Orchestrator Enhancement
> Production-ready question handling

### 4.1 Real Data Integration
**Tasks:**
- [ ] Replace demo data with real parsed questions
- [ ] Connect to `input-required` events
- [ ] Send answers back via Tauri command

### 4.2 Multi-Session Support
**Tasks:**
- [ ] Queue questions from multiple sessions
- [ ] Show session indicator on each question
- [ ] Allow answering out of order (by session)
- [ ] Session filtering in orchestrator view

### 4.3 Tool Approval UI
```
┌─────────────────────────────────────────────────────────┐
│  Tool Approval Required                    api-server  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Claude wants to use: Bash                              │
│                                                         │
│  Command:                                               │
│  ┌───────────────────────────────────────────────────┐ │
│  │ rm -rf node_modules && npm install               │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  Description: Reinstall dependencies                   │
│                                                         │
│  [Allow]  [Deny]  [Allow & Remember]                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Tasks:**
- [ ] Tool approval component
- [ ] Show tool name, command/params, description
- [ ] Allow/Deny buttons
- [ ] "Allow & Remember" for auto-approve rules
- [ ] Dangerous command warning (rm, etc.)

---

## Phase 5: Session Persistence
> Remember sessions across restarts

### 5.1 State Storage
```
~/.claude-terminal/
├── config.json       # User preferences
├── sessions.json     # Saved sessions
└── history/          # Command history per session
```

**Tasks:**
- [ ] Save sessions on close
- [ ] Restore sessions on startup
- [ ] Save/restore terminal scroll buffer (optional)
- [ ] Save working directories

### 5.2 Configuration
```json
{
  "theme": "dark",
  "fontSize": 13,
  "fontFamily": "SF Mono",
  "defaultShell": "/bin/zsh",
  "claudePath": "claude",
  "autoApproveRules": [],
  "recentDirectories": []
}
```

**Tasks:**
- [ ] Settings panel UI
- [ ] Font size adjustment
- [ ] Font family selection
- [ ] Default shell setting
- [ ] Claude path override

---

## Phase 6: Polish & UX
> Production-ready experience

### 6.1 Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Cmd+T` | New Claude session |
| `Cmd+Shift+T` | New shell session |
| `Cmd+W` | Close current tab |
| `Cmd+1-9` | Switch to tab N |
| `Cmd+[` / `Cmd+]` | Previous/next tab |
| `Cmd+K` | Clear terminal |
| `Cmd+,` | Open settings |

**Tasks:**
- [ ] Implement keyboard shortcuts
- [ ] Show shortcuts in UI hints
- [ ] Customizable shortcuts (optional)

### 6.2 Visual Improvements
- [ ] Session rename (double-click tab)
- [ ] Tab drag-and-drop reorder
- [ ] Split view (2 terminals side by side)
- [ ] Status bar (connection status, memory usage)
- [ ] Loading states and animations

### 6.3 Notifications
- [ ] System notification when input required
- [ ] Badge count on dock icon (macOS)
- [ ] Sound notification (optional)

### 6.4 Error Handling
- [ ] Connection lost recovery
- [ ] Claude Code crash handling
- [ ] Graceful degradation
- [ ] Error messages with actions

---

## Phase 7: Build & Distribution
> Package for release

### 7.1 Build Configuration
**Tasks:**
- [ ] App icons (all sizes)
- [ ] App metadata (name, version, description)
- [ ] Code signing setup (macOS, Windows)
- [ ] Notarization (macOS)

### 7.2 Platform Builds
| Platform | Format | Status |
|----------|--------|--------|
| macOS | `.app`, `.dmg` | [ ] |
| macOS (Apple Silicon) | `.app`, `.dmg` | [ ] |
| Windows | `.exe`, `.msi` | [ ] |
| Linux | `.AppImage`, `.deb` | [ ] |

### 7.3 Auto-Update
- [ ] Tauri updater configuration
- [ ] Update server setup
- [ ] Update notification UI

### 7.4 CI/CD
```yaml
# .github/workflows/release.yml
- Build on push to main
- Create release artifacts
- Upload to GitHub Releases
```

---

## Phase 8: Advanced Features (Future)
> Nice-to-have enhancements

### 8.1 Multi-Window
- [ ] Multiple windows support
- [ ] Window sync (shared sessions)

### 8.2 Themes
- [ ] Light theme
- [ ] Custom theme support
- [ ] Import VS Code themes

### 8.3 Integrations
- [ ] Git status in tab
- [ ] Project detection (package.json, etc.)
- [ ] Quick open (Cmd+P for files)

### 8.4 Claude Code SDK Deep Integration
- [ ] Custom tools via SDK
- [ ] Hooks integration
- [ ] Permission rules UI

---

## File Structure (Final)

```
claude-code-terminal/
├── docs/
│   ├── HIGH-LEVEL-DESIGN.md
│   └── DEVELOPMENT-PLAN.md
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands.rs      # Tauri IPC handlers
│   │   ├── pty.rs           # PTY management
│   │   ├── session.rs       # Session state
│   │   ├── parser.rs        # Output parsing
│   │   ├── config.rs        # User config
│   │   └── updater.rs       # Auto-update
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
│
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── TabBar.svelte
│   │   │   ├── Terminal.svelte
│   │   │   ├── Orchestrator.svelte
│   │   │   ├── ToolApproval.svelte
│   │   │   ├── Settings.svelte
│   │   │   └── StatusBar.svelte
│   │   ├── stores/
│   │   │   ├── sessions.ts
│   │   │   ├── orchestrator.ts
│   │   │   └── settings.ts
│   │   └── utils/
│   │       ├── shortcuts.ts
│   │       └── tauri.ts
│   ├── App.svelte
│   ├── app.css
│   └── main.ts
│
├── package.json
├── vite.config.ts
├── svelte.config.js
└── README.md
```

---

## Dependencies

### Rust (Cargo.toml)
```toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
tauri-plugin-shell = "2"
portable-pty = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
regex = "1"
dirs = "5"
```

### Frontend (package.json)
```json
{
  "dependencies": {
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0",
    "@xterm/addon-search": "^0.15.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/cli": "^2.0.0",
    "svelte": "^5.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Memory usage (idle) | < 80MB |
| Memory usage (3 sessions) | < 150MB |
| Startup time | < 1s |
| Input detection accuracy | > 95% |
| Cross-platform parity | 100% |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| PTY compatibility issues | Test on all platforms early |
| Parser misses edge cases | Collect real Claude output samples |
| Tauri v2 breaking changes | Pin versions, follow release notes |
| Code signing complexity | Set up early, automate |

---

## Timeline Summary

| Phase | Focus | Dependency |
|-------|-------|------------|
| 0 | Setup & Prototype | - |
| 1 | PTY Integration | Phase 0 |
| 2 | Claude Code Integration | Phase 1 |
| 3 | Output Parser | Phase 2 |
| 4 | Orchestrator Enhancement | Phase 3 |
| 5 | Persistence | Phase 4 |
| 6 | Polish & UX | Phase 5 |
| 7 | Build & Distribution | Phase 6 |
| 8 | Advanced Features | Phase 7 |

---

## Next Steps

1. **Immediate**: Complete Phase 1 (PTY Integration)
2. **Priority**: Get single Claude session working end-to-end
3. **Validation**: Test with real Claude Code interactions
