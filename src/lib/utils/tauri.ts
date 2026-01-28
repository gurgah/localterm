import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Log Tauri detection on load
if (typeof window !== "undefined") {
  console.log("Tauri detection:", {
    __TAURI__: "__TAURI__" in window,
    __TAURI_INTERNALS__: "__TAURI_INTERNALS__" in window,
    __TAURI_IPC__: "__TAURI_IPC__" in window,
  });
}

// Types matching Rust structs
export interface PtyOutput {
  session_id: string;
  data: string;
}

export interface PtyExit {
  session_id: string;
  code: number | null;
}

// Tauri commands
export async function createSession(
  sessionId: string,
  cwd: string | null,
  cols: number,
  rows: number
): Promise<void> {
  return invoke("create_session", {
    sessionId,
    cwd,
    cols,
    rows,
  });
}

export async function writeToSession(
  sessionId: string,
  data: string
): Promise<void> {
  return invoke("write_to_session", { sessionId, data });
}

export async function resizeSession(
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke("resize_session", { sessionId, cols, rows });
}

export async function closeSession(sessionId: string): Promise<void> {
  return invoke("close_session", { sessionId });
}

export async function getHomeDir(): Promise<string | null> {
  return invoke("get_home_dir");
}

export async function getDefaultShell(): Promise<string> {
  return invoke("get_default_shell");
}

export async function isClaudeRunning(sessionId: string): Promise<boolean> {
  return invoke("is_claude_running", { sessionId });
}

export async function createSessionWithEnv(
  sessionId: string,
  cwd: string | null,
  cols: number,
  rows: number,
  envVars: [string, string][]
): Promise<void> {
  return invoke("create_session_with_env", {
    sessionId,
    cwd,
    cols,
    rows,
    envVars,
  });
}

// Event listeners
export function onPtyOutput(
  callback: (output: PtyOutput) => void
): Promise<UnlistenFn> {
  return listen<PtyOutput>("pty-output", (event) => {
    callback(event.payload);
  });
}

export function onPtyExit(
  callback: (exit: PtyExit) => void
): Promise<UnlistenFn> {
  return listen<PtyExit>("pty-exit", (event) => {
    callback(event.payload);
  });
}

// File dialog
export async function openFileDialog(
  filters?: { name: string; extensions: string[] }[]
): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    multiple: false,
    filters,
  });
  if (result && typeof result === "string") return result;
  return null;
}

// Check if running in Tauri
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  // Tauri v2 detection methods
  return (
    "__TAURI__" in window ||
    "__TAURI_INTERNALS__" in window ||
    "__TAURI_IPC__" in window ||
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined
  );
}

// Window controls
export async function closeWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().close();
}

export async function minimizeWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().minimize();
}

export async function maximizeWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const isMaximized = await win.isMaximized();
  if (isMaximized) {
    return win.unmaximize();
  } else {
    return win.maximize();
  }
}
