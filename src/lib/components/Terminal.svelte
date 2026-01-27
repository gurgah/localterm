<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { Unicode11Addon } from "@xterm/addon-unicode11";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";
  import {
    createSession,
    writeToSession,
    resizeSession,
    isClaudeRunning,
    onPtyOutput,
    onPtyExit,
    type PtyOutput,
    type PtyExit,
  } from "../utils/tauri";
  import { sessions, activeSessionId } from "../stores/sessions";
  import { getTerminalText } from "../utils/terminalBuffer";
  import { detectClaudeState } from "../services/claudeDetector";
  import { orchestratorQueue } from "../stores/orchestrator";

  export let sessionId: string;
  export let sessionName: string = "Terminal";
  export let cwd: string;
  export let autoStart: boolean = false;
  export let fontSize: number = 13;

  let terminalEl: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let unlistenOutput: (() => void) | null = null;
  let unlistenExit: (() => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  let isDisposed = false;
  let detectTimeout: ReturnType<typeof setTimeout> | null = null;
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  let activeQuestionId: string | null = null;
  let windowResizeHandler: (() => void) | null = null;

  /**
   * Detect Claude state using process-based detection (isRunning)
   * and text-based detection (status: idle/active/waiting).
   * Debounced — waits 100ms after last output before detecting.
   */
  function scheduleDetection() {
    if (isDisposed || !terminal) return;

    // Debounce: wait 100ms after last output before detecting
    if (detectTimeout) clearTimeout(detectTimeout);
    detectTimeout = setTimeout(async () => {
      if (isDisposed || !terminal) return;

      // Process-based detection: is "claude" running as child of shell?
      let processRunning = false;
      try {
        processRunning = await isClaudeRunning(sessionId);
      } catch {
        // Fallback: if process check fails, use text-based detection
      }

      if (isDisposed || !terminal) return;

      // Get clean text from xterm buffer (last 50 lines)
      const text = getTerminalText(terminal, 50);

      // Text-based detection for status details
      const state = detectClaudeState(text);

      // Override isRunning with process-based detection
      // Process detection is authoritative for whether Claude is running.
      // Text detection provides the sub-status (idle/active/waiting).
      const finalState = {
        ...state,
        isRunning: processRunning,
        status: processRunning ? state.status : 'shell' as const,
      };

      // If process says running but text says shell, default to idle
      if (processRunning && state.status === 'shell') {
        finalState.status = 'idle';
      }

      // Update session store
      sessions.updateFromDetector(sessionId, finalState);

      // Handle permission prompts
      if (finalState.hasPermissionPrompt && finalState.permissionQuestion && !activeQuestionId) {
        // Push to orchestrator queue
        activeQuestionId = orchestratorQueue.push({
          sessionId,
          sessionName,
          questions: [{
            question: finalState.permissionQuestion.question,
            header: "Permission",
            options: finalState.permissionQuestion.options.map(o => ({
              label: o.label,
              description: `Option ${o.number}`,
            })),
            multiSelect: false,
          }],
        });
      } else if (!finalState.hasPermissionPrompt && activeQuestionId) {
        // Clear resolved question
        orchestratorQueue.resolve(activeQuestionId);
        activeQuestionId = null;
      }
    }, 100);
  }

  function handleFocus() {
    if (isDisposed) return;
    activeSessionId.set(sessionId);
  }

  function safeTerminalOp(fn: () => void) {
    if (isDisposed || !terminal) return;
    try {
      fn();
    } catch (e) {
      // Terminal already disposed, ignore
    }
  }

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
      fontFamily: "'MesloLGS NF', 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', Menlo, 'DejaVu Sans Mono', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', monospace",
      fontSize,
      lineHeight: 1.0,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      rightClickSelectsWord: true, // Select word on right-click
      customKeyEventHandler: (e: KeyboardEvent): boolean => {
        // Handle Cmd+C (macOS) / Ctrl+C (Linux/Windows) for copy
        if (e.type === 'keydown' && e.key === 'c' && (e.metaKey || e.ctrlKey)) {
          const selection = terminal?.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection).catch(console.error);
            return false; // Prevent xterm default
          }
          // No selection: let it pass through to terminal (SIGINT)
          return true;
        }
        // Handle Cmd+V (macOS) / Ctrl+V (Linux/Windows) for paste
        if (e.type === 'keydown' && e.key === 'v' && (e.metaKey || e.ctrlKey)) {
          navigator.clipboard.readText().then((text) => {
            if (text && !isDisposed) {
              writeToSession(sessionId, text).catch(console.error);
            }
          }).catch(console.error);
          return false; // Prevent xterm default
        }
        return true;
      },
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Load Unicode11 addon for proper emoji/unicode support
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';

    terminal.open(terminalEl);

    // Load WebGL addon for better rendering (with fallback to canvas)
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch (e) {
      console.warn("WebGL addon failed to load, using canvas renderer");
    }

    // Initial fit — do it synchronously so PTY gets correct dimensions
    try {
      fitAddon?.fit();
    } catch (e) {
      // May fail if container not ready yet, will be corrected by ResizeObserver
    }

    // Get terminal dimensions (after initial fit)
    const { cols, rows } = terminal;

    // Try to use Tauri API directly (will fail gracefully if not available)
    try {
      // Setup event listeners
      unlistenOutput = await onPtyOutput((output: PtyOutput) => {
        if (output.session_id === sessionId) {
          safeTerminalOp(() => {
            terminal?.write(output.data);
            // Schedule detection after xterm processes the data
            scheduleDetection();
          });
        }
      });

      unlistenExit = await onPtyExit((exit: PtyExit) => {
        if (exit.session_id === sessionId) {
          safeTerminalOp(() => {
            terminal?.writeln("\r\n[Process exited]");
            sessions.setStatus(sessionId, "idle");
          });
        }
      });

      // Create PTY session
      await createSession(sessionId, cwd, cols, rows);
      sessions.setStatus(sessionId, "active");

      // Second fit after PTY exists — catches any layout settling
      requestAnimationFrame(() => {
        safeTerminalOp(() => {
          fitAddon?.fit();
          if (terminal) {
            const { cols: c, rows: r } = terminal;
            if (c >= 10 && r >= 4) {
              resizeSession(sessionId, c, r).catch(console.error);
            }
          }
        });
      });

      // Auto-start Claude Code if requested
      if (autoStart) {
        setTimeout(() => {
          if (!isDisposed) {
            writeToSession(sessionId, "claude\n").catch(console.error);
          }
        }, 500);
      }

      // Handle input from xterm
      terminal.onData((data) => {
        if (!isDisposed) {
          writeToSession(sessionId, data).catch(console.error);
        }
      });

      // Set active session when terminal gets focus
      terminal.textarea?.addEventListener("focus", handleFocus);
      terminalEl?.addEventListener("mousedown", handleFocus);

      // Handle resize — don't resize PTY when tile is hidden/tiny
      // (hidden tiles get width:1px/height:1px, causing cols=2)
      resizeObserver = new ResizeObserver(() => {
        safeTerminalOp(() => {
          // Skip fitting if container is too small (tile is hidden)
          const rect = terminalEl?.getBoundingClientRect();
          if (!rect || rect.width < 50 || rect.height < 50) return;

          fitAddon?.fit();
          if (terminal) {
            const { cols, rows } = terminal;
            // Only resize PTY if dimensions are reasonable
            if (cols >= 10 && rows >= 4) {
              resizeSession(sessionId, cols, rows).catch(console.error);
            }
          }
        });

        // Debounced second fit after layout settles to fix resize corruption
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          safeTerminalOp(() => {
            const rect = terminalEl?.getBoundingClientRect();
            if (!rect || rect.width < 50 || rect.height < 50) return;

            fitAddon?.fit();
            if (terminal) {
              terminal.refresh(0, terminal.rows - 1);
              const { cols, rows } = terminal;
              if (cols >= 10 && rows >= 4) {
                resizeSession(sessionId, cols, rows).catch(console.error);
              }
            }
          });
        }, 150);
      });
      resizeObserver.observe(terminalEl);

      // Full refit: fit + refresh + sync PTY size
      function fullRefit() {
        safeTerminalOp(() => {
          const rect = terminalEl?.getBoundingClientRect();
          if (!rect || rect.width < 50 || rect.height < 50) return;

          fitAddon?.fit();
          if (terminal) {
            terminal.refresh(0, terminal.rows - 1);
            const { cols, rows } = terminal;
            if (cols >= 10 && rows >= 4) {
              resizeSession(sessionId, cols, rows).catch(console.error);
            }
          }
        });
      }

      // Refit when terminal becomes visible again (e.g. after another tile was expanded)
      intersectionObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          // Multiple refit attempts to handle CSS transitions
          requestAnimationFrame(() => fullRefit());
          setTimeout(() => fullRefit(), 100);
          setTimeout(() => fullRefit(), 300);
          setTimeout(() => fullRefit(), 600);
        }
      });
      intersectionObserver.observe(terminalEl);

      // Also refit on window resize (triggered by expand/collapse)
      windowResizeHandler = () => fullRefit();
      window.addEventListener("resize", windowResizeHandler);

    } catch (e) {
      console.error("Tauri API error:", e);
      safeTerminalOp(() => {
        terminal?.writeln("Demo mode - Tauri API not available");
        terminal?.writeln("");
        terminal?.writeln(`Error: ${e}`);
      });
      sessions.setStatus(sessionId, "error");
    }
  });

  $: if (terminal && fontSize) {
    terminal.options.fontSize = fontSize;
    safeTerminalOp(() => {
      fitAddon?.fit();
      if (terminal) {
        terminal.refresh(0, terminal.rows - 1);
        const { cols, rows } = terminal;
        if (cols >= 10 && rows >= 4) {
          resizeSession(sessionId, cols, rows).catch(console.error);
        }
      }
    });
  }

  onDestroy(() => {
    // Set disposed flag first
    isDisposed = true;

    // Clear timeouts
    if (detectTimeout) {
      clearTimeout(detectTimeout);
      detectTimeout = null;
    }
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
      resizeTimeout = null;
    }

    // Clear any active question
    if (activeQuestionId) {
      orchestratorQueue.resolve(activeQuestionId);
      activeQuestionId = null;
    }

    // Disconnect observers immediately
    resizeObserver?.disconnect();
    resizeObserver = null;
    intersectionObserver?.disconnect();
    intersectionObserver = null;

    // Remove window resize listener
    if (windowResizeHandler) {
      window.removeEventListener("resize", windowResizeHandler);
      windowResizeHandler = null;
    }

    // Remove event listeners
    if (unlistenOutput) {
      unlistenOutput();
      unlistenOutput = null;
    }
    if (unlistenExit) {
      unlistenExit();
      unlistenExit = null;
    }

    // Dispose terminal last
    if (terminal) {
      try {
        terminal.dispose();
      } catch (e) {
        // Already disposed, ignore
      }
      terminal = null;
    }
    fitAddon = null;
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
