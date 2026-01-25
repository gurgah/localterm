import { orchestratorQueue } from "../stores/orchestrator";
import { sessions } from "../stores/sessions";
import { writeToSession } from "./tauri";

// Pattern to detect Claude Code permission/question prompts
const QUESTION_PATTERNS = [
  /Do you want to proceed\?/,
  /Do you want to/,
  /Would you like to/,
  /Select an option/,
  /Choose/,
];

// Pattern to detect numbered options like "1. Yes" or "❯ 1. Yes" or "> 1. Yes"
// Also matches lines that start with spaces/arrows before the number
const OPTION_PATTERN = /^\s*[❯›>\s]*(\d+)\.\s+(.+)$/;

interface ParsedQuestion {
  question: string;
  options: { number: string; label: string }[];
}

// Buffer to accumulate output for parsing
const sessionBuffers: Map<string, string> = new Map();
const activeQuestions: Map<string, string> = new Map(); // sessionId -> questionId
const claudeDetected: Set<string> = new Set(); // Sessions where Claude Code was detected

// Patterns to detect Claude Code is running
const CLAUDE_DETECTION_PATTERNS = [
  /Claude Code/i,
  /claude-code/i,
  /Anthropic/i,
  /\? for shortcuts/,
  /\/ide for/,
];

export function parseTerminalOutput(sessionId: string, sessionName: string, data: string): void {
  console.log("[Parser] Called with data length:", data.length, "session:", sessionId);

  // Get or create buffer for this session
  let buffer = sessionBuffers.get(sessionId) || "";
  buffer += data;

  // Keep only last 2000 chars to avoid memory issues
  if (buffer.length > 2000) {
    buffer = buffer.slice(-2000);
  }
  sessionBuffers.set(sessionId, buffer);

  const clean = stripAnsi(buffer);

  // Detect if Claude Code is running
  if (!claudeDetected.has(sessionId)) {
    for (const pattern of CLAUDE_DETECTION_PATTERNS) {
      if (pattern.test(clean)) {
        claudeDetected.add(sessionId);
        sessions.setClaudeRunning(sessionId, true);
        console.log("[Parser] Claude Code detected in session:", sessionId);
        break;
      }
    }
  }

  // Only track status if Claude is running
  if (!claudeDetected.has(sessionId)) {
    // Normal shell - set to shell status
    sessions.setStatus(sessionId, "shell");
    return;
  }

  // Try to parse question from buffer
  const parsed = tryParseQuestion(buffer);

  console.log("[Parser] Buffer length:", buffer.length, "Parsed:", parsed, "Active:", activeQuestions.has(sessionId));

  if (parsed && !activeQuestions.has(sessionId)) {
    // Found a new question - add to orchestrator
    const questionId = orchestratorQueue.push({
      sessionId,
      sessionName,
      questions: [{
        question: parsed.question,
        header: "Permission",
        options: parsed.options.map(o => ({
          label: o.label,
          description: `Option ${o.number}`,
        })),
        multiSelect: false,
      }],
    });

    activeQuestions.set(sessionId, questionId);
    // Set status to waiting when there's a question
    sessions.setStatus(sessionId, "waiting");
  } else {
    // Check if prompt is visible (Claude is waiting for input)
    const isPromptVisible = detectPrompt(buffer);

    if (isPromptVisible && !activeQuestions.has(sessionId)) {
      // Prompt visible, no pending question = idle
      sessions.setStatus(sessionId, "idle");
    } else if (!activeQuestions.has(sessionId)) {
      // Output streaming, no question = active (working)
      sessions.setStatus(sessionId, "active");
    }
  }
}

function tryParseQuestion(buffer: string): ParsedQuestion | null {
  // Clean ANSI codes for parsing
  const clean = stripAnsi(buffer);

  // Debug: log a sample of cleaned buffer
  console.log("[Parser] Cleaned buffer sample:", clean.slice(-500));

  // Wait for "Esc to cancel" which indicates all options are rendered
  if (!clean.includes("Esc to cancel") && !clean.includes("Esc to exit")) {
    console.log("[Parser] Waiting for options to fully render...");
    return null;
  }

  // Search for question patterns in the entire buffer
  let questionText = "";
  for (const pattern of QUESTION_PATTERNS) {
    const match = clean.match(pattern);
    if (match) {
      questionText = match[0];
      console.log("[Parser] Found question:", questionText);
      break;
    }
  }

  if (!questionText) {
    console.log("[Parser] No question pattern found in buffer");
    return null;
  }

  // Find numbered options using global regex
  // Match patterns like "1. Yes" or "❯ 1. Yes" or "  2. No"
  const optionRegex = /[❯›>\s]*(\d)\.\s+([^\n\d❯›>]+)/g;
  const options: { number: string; label: string }[] = [];

  let match;
  while ((match = optionRegex.exec(clean)) !== null) {
    const num = match[1];
    let label = match[2].trim()
      .replace(/[-─]+$/, "")  // Remove trailing dashes
      .replace(/\s+/g, " ")   // Normalize whitespace
      .trim();

    // Skip if we already have this option or if label is empty
    if (label.length >= 2 && !options.find(o => o.number === num)) {
      options.push({ number: num, label });
      console.log("[Parser] Found option", num, ":", label);
    }
  }

  // Sort by number
  options.sort((a, b) => parseInt(a.number) - parseInt(b.number));

  console.log("[Parser] Total options found:", options.length);

  if (options.length < 2) {
    console.log("[Parser] Not enough options, need at least 2");
    return null;
  }

  return { question: questionText, options };
}

// Send response back to terminal
export function sendResponse(sessionId: string, optionIndex: number): void {
  const questionId = activeQuestions.get(sessionId);
  if (questionId) {
    // Send the number key to select the option
    writeToSession(sessionId, String(optionIndex + 1)).catch(console.error);

    // Clear the question
    orchestratorQueue.resolve(questionId);
    activeQuestions.delete(sessionId);
    sessionBuffers.delete(sessionId);

    // Set status back to active (Claude will be processing)
    sessions.setStatus(sessionId, "active");
  }
}

// Clear session data
export function clearSession(sessionId: string): void {
  const questionId = activeQuestions.get(sessionId);
  if (questionId) {
    orchestratorQueue.resolve(questionId);
  }
  activeQuestions.delete(sessionId);
  sessionBuffers.delete(sessionId);
  claudeDetected.delete(sessionId);
}

// Detect if Claude Code prompt is visible (waiting for user input)
function detectPrompt(buffer: string): boolean {
  const clean = stripAnsi(buffer);

  // Look for Claude Code prompt indicators anywhere in recent buffer
  const promptIndicators = [
    /\?\s+for\s+shortcuts/i,        // "? for shortcuts" hint
    /\/ide\s+for/i,                 // "/ide for Visual Studio Code" hint
    /Esc\s+to\s+exit/i,             // "Esc to exit" hint
  ];

  for (const pattern of promptIndicators) {
    if (pattern.test(clean)) {
      return true;
    }
  }

  return false;
}

// Strip ANSI escape codes
function stripAnsi(str: string): string {
  return str
    // Remove CSI sequences (colors, cursor movement, etc.)
    .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, "")
    // Remove OSC sequences (title bar, etc.)
    .replace(/\x1B\].*?(\x07|\x1B\\)/g, "")
    // Remove DCS/PM/APC sequences
    .replace(/\x1B[PX^_].*?\x1B\\/g, "")
    // Remove simple escape sequences
    .replace(/\x1B[@-Z\\-_]/g, "")
    // Remove private mode sequences like [?2026l
    .replace(/\[\?[0-9;]*[a-zA-Z]/g, "")
    // Replace carriage return (keep newlines)
    .replace(/\r/g, "")
    // Remove other control characters except newline
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
