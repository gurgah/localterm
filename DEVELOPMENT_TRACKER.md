# Development Tracker

## Known Issues

### 1. Permission prompts not showing in fullscreen/wide terminal
**Status**: Open (Needs Investigation)
**Priority**: High

**Description**: When terminal tiles are expanded to fullscreen or the window is maximized, Claude sessions show as "Shell Sessions" instead of "Claude Sessions", and permission prompts don't appear in the Orchestrator panel. Everything works correctly when the window is made smaller.

**Root Cause**: Claude Code's TUI library outputs differently based on terminal width:
- **Narrow terminal**: Normal text output, patterns match correctly
- **Wide terminal**: Characters output one-per-line with ANSI color codes between each character

**Attempted Fixes**:
1. ~~ANSI stripping improvements~~ - Didn't fully work
2. ~~Compact text detection (no spaces)~~ - Partial success
3. ~~xterm.js buffer API instead of raw PTY output~~ - Same issue persists

**Theory**: The issue may be at the xterm.js level or how Claude Code's Ink/TUI library renders to wide terminals. The xterm buffer returns the same problematic format.

**Workaround**: Use smaller window size for reliable detection.

**Files Affected**:
- `src/lib/services/claudeDetector.ts`
- `src/lib/utils/terminalBuffer.ts`
- `src/lib/components/Terminal.svelte`

---

### 2. Cmd+C / Cmd+V copy paste not working
**Status**: Open
**Priority**: High

**Description**: Standard macOS copy (Cmd+C) and paste (Cmd+V) keyboard shortcuts don't work in terminal tiles. Users cannot copy selected text or paste from clipboard.

**Expected Behavior**:
- Cmd+C should copy selected text from terminal
- Cmd+V should paste clipboard content into terminal

**Files to Investigate**:
- `src/lib/components/Terminal.svelte` - xterm.js configuration
- `src-tauri/src/lib.rs` - Menu/keyboard handling

---

## Completed Features (v0.1.0)

- [x] Tile-based layout with Orchestrator
- [x] Terminal PTY integration
- [x] Permission detection & queue
- [x] Status detection (Working/Ready/Waiting)
- [x] Traffic light controls
- [x] Keyboard shortcuts (Cmd+1-9, T, W, Q, [, ], Enter)
- [x] Quit confirmation modal (Cmd+Q)
- [x] Session rename (double-click)
- [x] New terminal choice screen (Claude vs Command Line)
- [x] Text selection in terminal
- [x] Max 12 tiles limit
- [x] Report Bug menu item (mailto link)
- [x] Modular architecture refactor (services/stores/views separation)
- [x] xterm.js buffer API for state detection

---

## TODO

- [ ] **macOS DMG**: Add Applications shortcut (use `create-dmg` tool)

---

## Roadmap

### Phase 2 (Planned)
- [ ] Broadcast Mode - Type in all terminals simultaneously (Cmd+Shift+B)
- [ ] Terminal Search - Find in buffer (Cmd+F)
- [ ] Font Size Control - Zoom in/out (Cmd+Plus/Minus/0)
- [ ] Theme System - Multiple themes
- [ ] Settings Panel - Font, shell path, appearance
- [ ] Split Pane - Horizontal/vertical splits

### Phase 3 (Future)
- [ ] Local LLM - Ollama integration
- [ ] Error Detection - Pattern-based suggestions
- [ ] Expert Agents - Git, file search agents
