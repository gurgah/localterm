<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import {
    createSession,
    writeToSession,
    resizeSession,
    onPtyOutput,
    onPtyExit,
    type PtyOutput,
    type PtyExit,
  } from "../utils/tauri";
  import { sessions, activeSessionId } from "../stores/sessions";
  import { parseTerminalOutput, clearSession } from "../utils/outputParser";

  export let sessionId: string;
  export let sessionName: string = "Terminal";
  export let cwd: string;
  export let autoStart: boolean = false;

  function handleFocus() {
    activeSessionId.set(sessionId);
  }

  let terminalEl: HTMLDivElement;
  let terminal: Terminal;
  let fitAddon: FitAddon;
  let unlistenOutput: (() => void) | null = null;
  let unlistenExit: (() => void) | null = null;

  const theme = {
    background: "#0d1117",
    foreground: "#e6edf3",
    cursor: "#58a6ff",
    cursorAccent: "#0d1117",
    selectionBackground: "#264f78",
    black: "#484f58",
    red: "#f85149",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#f0f6fc",
  };

  onMount(async () => {
    // Create xterm instance
    terminal = new Terminal({
      theme,
      fontFamily: "'MesloLGS NF', 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', Menlo, 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalEl);
    fitAddon.fit();

    // Get terminal dimensions
    const { cols, rows } = terminal;

    // Try to use Tauri API directly (will fail gracefully if not available)
    try {
      // Setup event listeners
      unlistenOutput = await onPtyOutput((output: PtyOutput) => {
        if (output.session_id === sessionId) {
          terminal.write(output.data);
          // Parse output to detect Claude Code questions
          parseTerminalOutput(sessionId, sessionName, output.data);
        }
      });

      unlistenExit = await onPtyExit((exit: PtyExit) => {
        if (exit.session_id === sessionId) {
          terminal.writeln("\r\n[Process exited]");
          sessions.setStatus(sessionId, "idle");
        }
      });

      // Create PTY session
      await createSession(sessionId, cwd, cols, rows);
      sessions.setStatus(sessionId, "active");

      // Auto-start Claude Code if requested
      if (autoStart) {
        // Small delay to let shell initialize
        setTimeout(() => {
          writeToSession(sessionId, "claude\n").catch(console.error);
        }, 500);
      }

      // Handle input from xterm
      terminal.onData((data) => {
        writeToSession(sessionId, data).catch(console.error);
      });

      // Set active session when terminal gets focus
      terminal.textarea?.addEventListener("focus", handleFocus);
      terminalEl.addEventListener("mousedown", handleFocus);

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        const { cols, rows } = terminal;
        resizeSession(sessionId, cols, rows).catch(console.error);
      });
      resizeObserver.observe(terminalEl);

      return () => {
        resizeObserver.disconnect();
      };
    } catch (e) {
      // Demo mode when Tauri API not available
      console.error("Tauri API error:", e);
      terminal.writeln("Demo mode - Tauri API not available");
      terminal.writeln("");
      terminal.writeln(`Error: ${e}`);
      terminal.writeln("");
      terminal.writeln("Make sure to run with: npm run tauri dev");
      sessions.setStatus(sessionId, "error");
    }
  });

  onDestroy(() => {
    if (unlistenOutput) unlistenOutput();
    if (unlistenExit) unlistenExit();
    clearSession(sessionId);
    terminal?.dispose();
  });
</script>

<div class="terminal-container">
  <div class="terminal" bind:this={terminalEl}></div>
</div>

<style>
  .terminal-container {
    flex: 1;
    padding: 8px;
    background: var(--bg-primary);
    overflow: hidden;
  }

  .terminal {
    height: 100%;
    width: 100%;
  }

  :global(.xterm) {
    padding: 4px;
  }

  :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
