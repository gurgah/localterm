# Claude Code Terminal - High Level Design

> Minimal, multi-session terminal for Claude Code with orchestrator capabilities

## Vision

VS Code ~800MB RAM kullanırken, sadece Claude Code için optimize edilmiş ~50MB'lık minimal bir terminal uygulaması.

---

## Core Features

### 1. Multi-Tab Sessions
- Her tab bağımsız bir Claude Code session
- Session başına ayrı working directory
- Session state persistence (kapanınca kaybolmaz)
- Tab states: 🟢 active | 🟡 waiting input | 🔴 error | ⚫ idle

### 2. Orchestrator Mode
- Tüm session'ları tek panelden izleme
- Input bekleyen session'ları öne çıkarma
- Quick response: `[1] [2] [3] [other]` butonları
- Notification queue (priority-based)

### 3. Minimal UI
- Dark mode default
- Distraction-free design
- Vibe coder friendly (non-technical users)
- Keyboard-first, mouse-optional

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLAUDE CODE TERMINAL                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                   SVELTE FRONTEND                         │ │
│  │                                                           │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐ │ │
│  │  │ TabBar  │ │Terminal │ │Orchest- │ │ Settings Panel  │ │ │
│  │  │         │ │  View   │ │  rator  │ │                 │ │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘ │ │
│  │                     │                                     │ │
│  │              ┌──────┴──────┐                              │ │
│  │              │  xterm.js   │                              │ │
│  │              │  (per tab)  │                              │ │
│  │              └─────────────┘                              │ │
│  └───────────────────────────────────────────────────────────┘ │
│                           │                                     │
│                           │ Tauri IPC                           │
│                           ▼                                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    RUST BACKEND                           │ │
│  │                                                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │ │
│  │  │   Session    │  │    Output    │  │  Orchestrator  │  │ │
│  │  │   Manager    │  │    Parser    │  │     Core       │  │ │
│  │  └──────┬───────┘  └──────────────┘  └────────────────┘  │ │
│  │         │                                                 │ │
│  │         ▼                                                 │ │
│  │  ┌──────────────────────────────────────────────────┐    │ │
│  │  │              PTY Manager (portable-pty)          │    │ │
│  │  │                                                  │    │ │
│  │  │   PTY 1          PTY 2          PTY 3           │    │ │
│  │  │   (claude)       (claude)       (claude)        │    │ │
│  │  └──────────────────────────────────────────────────┘    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### Frontend (Svelte + TypeScript)

| Component | Responsibility |
|-----------|----------------|
| `App.svelte` | Main layout, routing |
| `TabBar.svelte` | Session tabs, add/close |
| `Terminal.svelte` | xterm.js wrapper, resize handling |
| `Orchestrator.svelte` | Input queue panel, quick buttons |
| `QuickButtons.svelte` | [1] [2] [3] response buttons |
| `StatusBadge.svelte` | Session status indicator |
| `Settings.svelte` | Theme, shortcuts, preferences |

### Backend (Rust)

| Module | Responsibility |
|--------|----------------|
| `main.rs` | Tauri app entry, window setup |
| `session.rs` | Session CRUD, state persistence |
| `pty.rs` | PTY spawn, read/write, resize |
| `parser.rs` | Output analysis, input detection |
| `orchestrator.rs` | Multi-session coordination |
| `commands.rs` | Tauri IPC command handlers |

---

## Data Flow

### Normal Flow
```
User Input → Frontend → IPC → Rust → PTY Write → Claude Code
Claude Output → PTY Read → Rust → Parser → IPC → Frontend → xterm.js
```

### Orchestrator Flow
```
PTY Output → Parser detects "[1] [2]" pattern
         → Orchestrator queues input request
         → Frontend shows notification
         → User clicks [1]
         → IPC → PTY Write "1\n"
         → Claude continues
```

---

## Input Detection

### Patterns to Detect

```
Type 1: Numbered Options
┌────────────────────────────────────────┐
│ Which framework do you want to use?    │
│                                        │
│ [1] React (Recommended)                │
│ [2] Vue                                │
│ [3] Svelte                             │
│ [other] Type custom                    │
└────────────────────────────────────────┘
Regex: \[(\d+)\]\s*(.+?)(?=\[|\n|$)

Type 2: Yes/No
┌────────────────────────────────────────┐
│ Do you want to continue? (y/n)         │
└────────────────────────────────────────┘
Regex: \(y/n\)\s*$

Type 3: Free Text
┌────────────────────────────────────────┐
│ Enter your API key:                    │
└────────────────────────────────────────┘
Regex: Enter .+?:\s*$

Type 4: Confirmation
┌────────────────────────────────────────┐
│ Press Enter to continue...             │
└────────────────────────────────────────┘
Regex: Press Enter
```

---

## Session States

```
┌─────────┐     create      ┌─────────┐
│  NULL   │ ───────────────▶│ CREATED │
└─────────┘                 └────┬────┘
                                 │ spawn PTY
                                 ▼
                            ┌─────────┐
              ┌────────────▶│ ACTIVE  │◀────────────┐
              │             └────┬────┘             │
              │                  │                  │
         user input         detects input      response
              │              request            sent
              │                  │                  │
              │                  ▼                  │
              │             ┌─────────┐            │
              └─────────────│ WAITING │────────────┘
                            └────┬────┘
                                 │ error
                                 ▼
                            ┌─────────┐
                            │  ERROR  │
                            └────┬────┘
                                 │ close
                                 ▼
                            ┌─────────┐
                            │ CLOSED  │
                            └─────────┘
```

---

## UI Layout

### Default View (Single Session Focus)
```
┌─────────────────────────────────────────────────────────────┐
│  [session1] [session2] [session3]  [+]              [⚙️]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ~/my-project                                               │
│                                                             │
│  $ claude "add login feature"                               │
│                                                             │
│  I'll help you add a login feature...                       │
│                                                             │
│  Reading src/App.tsx                                        │
│  Reading src/api/auth.ts                                    │
│                                                             │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Orchestrator View (Multi-Session Monitor)
```
┌─────────────────────────────────────────────────────────────┐
│  [Orchestrator Mode]                                [⚙️]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  🔔 PENDING INPUT (1)                                       │
│  ┌────────────────────────────────────────────────────────┐│
│  │ session2: Which database?                              ││
│  │ [1] PostgreSQL  [2] MySQL  [3] SQLite  [type...]      ││
│  └────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │ 🟢 session1         │  │ 🟡 session2         │          │
│  │ ~/frontend          │  │ ~/backend           │          │
│  │ Working on UI...    │  │ Waiting for input   │          │
│  │ ████████░░ 80%      │  │                     │          │
│  └─────────────────────┘  └─────────────────────┘          │
│                                                             │
│  ┌─────────────────────┐                                   │
│  │ 🟢 session3         │                                   │
│  │ ~/tests             │                                   │
│  │ Running tests...    │                                   │
│  └─────────────────────┘                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Framework | Tauri v2 | Lightweight (~15MB), cross-platform |
| Frontend | Svelte 5 | Minimal bundle, reactive, simple |
| Terminal | xterm.js | Battle-tested, VS Code uses it |
| Styling | Tailwind CSS | Utility-first, dark mode easy |
| Backend | Rust | Performance, memory safety |
| PTY | portable-pty | Cross-platform PTY handling |
| IPC | Tauri Commands | Type-safe, async |
| Storage | JSON files | Simple, no DB needed |

---

## Resource Budget

| Component | Target RAM | Notes |
|-----------|------------|-------|
| Tauri shell | 15MB | Rust binary |
| WebView | 25MB | System WebView |
| Svelte app | 5MB | Small bundle |
| Per session | 10MB | PTY + buffer |
| **Total (3 sessions)** | **~75MB** | vs VS Code ~800MB |

---

## File Structure

```
claude-code-terminal/
├── docs/
│   └── HIGH-LEVEL-DESIGN.md      # This document
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── session.rs            # Session management
│   │   ├── pty.rs                # PTY operations
│   │   ├── parser.rs             # Output parsing
│   │   ├── orchestrator.rs       # Multi-session logic
│   │   └── commands.rs           # IPC handlers
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── TabBar.svelte
│   │   │   ├── Terminal.svelte
│   │   │   ├── Orchestrator.svelte
│   │   │   └── QuickButtons.svelte
│   │   └── stores/
│   │       ├── sessions.ts
│   │       └── orchestrator.ts
│   ├── App.svelte
│   ├── app.css
│   └── main.ts
├── package.json
├── svelte.config.js
├── vite.config.ts
└── README.md
```

---

## MVP Milestones

### M1: Single Terminal
- [ ] Tauri + Svelte scaffold
- [ ] xterm.js integration
- [ ] PTY spawn and communication
- [ ] Basic styling

### M2: Multi-Tab
- [ ] Tab component
- [ ] Session creation/deletion
- [ ] Tab switching
- [ ] Session persistence

### M3: Orchestrator
- [ ] Output parser
- [ ] Input detection
- [ ] Notification queue
- [ ] Quick response buttons

### M4: Polish
- [ ] Keyboard shortcuts
- [ ] Settings panel
- [ ] Error handling
- [ ] Cross-platform testing

---

## Non-Goals (Out of Scope)

- Code editing (use VS Code/other editors)
- File browser (use system file manager)
- Git UI (use CLI or dedicated tools)
- AI chat history (Claude Code handles this)
- Plugin system (keep it simple)
