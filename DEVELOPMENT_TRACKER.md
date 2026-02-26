# Development Tracker

## Known Issues

### Wide Terminal Detection Bug
**Status**: Open | **Priority**: High

When terminal is fullscreen/maximized, Claude sessions show as "Shell" instead of "Claude". Permission prompts don't appear.

**Root Cause**: Claude Code's TUI outputs differently based on terminal width (characters one-per-line with ANSI codes in wide mode).

**Workaround**: Use smaller window size.

**Files**: `claudeDetector.ts`, `terminalBuffer.ts`, `Terminal.svelte`

---

## Active Development

### feature/local-llm Branch
Embedded llama.cpp runtime for local LLM support.

**Done**:
- [x] LlmEngine (load/unload, chat completion, streaming)
- [x] OpenAI-compatible HTTP server (localhost:11435)
- [x] Model manager (GGUF download + cache)
- [x] Settings UI (verified models, custom models)
- [x] Per-session choice: "Start Claude" vs "Start Claude (Local)" vs "Command Line"

**Next**:
- [ ] Wire `integration.ts` → `llmService.ts` for agent responses
- [ ] Parse LLM response → BASH/TEXT agent cards

---

## Completed (v0.1.0)

- Tile-based layout, PTY integration, permission detection
- Keyboard shortcuts (Cmd+1-9, T, W, Q, [, ], Enter, +/-/0)
- Font size control, Settings panel, Copy/paste (Cmd+C/V)
- Session rename, text selection, max 12 tiles
- Modular architecture (services/stores/views)

---

## Roadmap

### Phase 2
- [ ] Broadcast Mode (Cmd+Shift+B)
- [ ] Terminal Search (Cmd+F)
- [ ] Theme System
- [ ] Split Pane

### Phase 3
- [ ] Error Detection + Agent suggestions
- [ ] Git/file search agents
