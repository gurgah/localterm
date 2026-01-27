// Debug log buffer for bug reports
const MAX_LOGS = 20;

interface LogEntry {
  timestamp: string;
  type: "info" | "error" | "event";
  message: string;
}

const logBuffer: LogEntry[] = [];

export function debugLog(type: LogEntry["type"], message: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    type,
    message,
  };

  logBuffer.push(entry);

  // Keep only last MAX_LOGS entries
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }

  // Also log to console in dev
  if (import.meta.env.DEV) {
    console.log(`[${entry.type}] ${entry.message}`);
  }
}

export function getDebugLogs(): string {
  if (logBuffer.length === 0) {
    return "No recent logs";
  }

  return logBuffer
    .map(e => `[${e.timestamp}] [${e.type.toUpperCase()}] ${e.message}`)
    .join("\n");
}

export function getSystemInfo(): string {
  const info = [
    `App: LocalTerm AI v0.1.0`,
    `Platform: ${navigator.platform}`,
    `User Agent: ${navigator.userAgent}`,
    `Screen: ${window.screen.width}x${window.screen.height}`,
    `Window: ${window.innerWidth}x${window.innerHeight}`,
    `Time: ${new Date().toISOString()}`,
  ];

  return info.join("\n");
}

export function generateBugReportBody(): string {
  const sections = [
    "=== BUG DESCRIPTION ===",
    "(Please describe the issue here)",
    "",
    "=== STEPS TO REPRODUCE ===",
    "1. ",
    "2. ",
    "3. ",
    "",
    "=== SYSTEM INFO ===",
    getSystemInfo(),
    "",
    "=== DEBUG LOGS (last 20 events) ===",
    ">> Review and remove any sensitive data before sending <<",
    "",
    getDebugLogs(),
  ];

  return sections.join("\n");
}

// Convenience functions for common events
export const log = {
  info: (msg: string) => debugLog("info", msg),
  error: (msg: string) => debugLog("error", msg),
  event: (msg: string) => debugLog("event", msg),

  sessionCreated: (id: string, name: string) =>
    debugLog("event", `Session created: ${name} (${id.slice(0, 8)})`),

  sessionClosed: (id: string) =>
    debugLog("event", `Session closed: ${id.slice(0, 8)}`),

  claudeDetected: (sessionId: string) =>
    debugLog("event", `Claude detected in session ${sessionId.slice(0, 8)}`),

  claudeExited: (sessionId: string) =>
    debugLog("event", `Claude exited in session ${sessionId.slice(0, 8)}`),

  terminalError: (sessionId: string, error: string) =>
    debugLog("error", `Terminal ${sessionId.slice(0, 8)}: ${error}`),
};
