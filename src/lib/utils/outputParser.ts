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

interface ParsedQuestion {
  question: string;
  options: { number: string; label: string }[];
}

// Buffer to accumulate output for parsing
const sessionBuffers: Map<string, string> = new Map();
const activeQuestions: Map<string, string> = new Map(); // sessionId -> questionId

// Simple state tracking
interface SessionState {
  claudeRunning: boolean;
  lastClaudeDetected: number;
  lastStatus: string;  // Remember last status to avoid flickering
}

const sessionStates: Map<string, SessionState> = new Map();

function getSessionState(sessionId: string): SessionState {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = {
      claudeRunning: false,
      lastClaudeDetected: 0,
      lastStatus: "shell",
    };
    sessionStates.set(sessionId, state);
  }
  return state;
}

// Call this when user clicks "Start Claude" button
export function markClaudeStarted(sessionId: string): void {
  const state = getSessionState(sessionId);
  state.claudeRunning = true;
  state.lastClaudeDetected = Date.now();
  state.lastStatus = "active";  // Start as working until prompt appears
  sessions.setClaudeRunning(sessionId, true);
}

export function parseTerminalOutput(sessionId: string, sessionName: string, data: string): void {
  // Get or create buffer for this session
  let buffer = sessionBuffers.get(sessionId) || "";
  buffer += data;

  // Keep only last 2000 chars - smaller buffer for more responsive detection
  if (buffer.length > 2000) {
    buffer = buffer.slice(-2000);
  }
  sessionBuffers.set(sessionId, buffer);

  const clean = stripAnsi(buffer);
  // Create a normalized version for pattern matching (all whitespace collapsed)
  const normalized = clean.replace(/\s+/g, ' ').trim();
  // Create a compact version (no spaces) for detecting key phrases in char-per-line mode
  const compact = clean.replace(/\s+/g, '');
  const state = getSessionState(sessionId);

  // Debug: log buffer size and sample
  console.log(`[PARSE] ${sessionName}: buffer=${buffer.length} clean=${clean.length}`);
  console.log(`[PARSE] ${sessionName}: compact_end="${compact.slice(-100)}"`);

  // Simple detection: is Claude running right now?
  // Use normalized and compact for better pattern matching in wide terminals
  const claudeDetected = detectClaudeRunning(clean, normalized, compact);
  const shellPromptDetected = detectShellPrompt(clean);

  // Debug: always log detection state
  const lines = clean.split('\n').filter(l => l.trim().length > 0);
  const lastLine = lines.slice(-1).join('').trim();
  console.log(`[PARSE] ${sessionName}: claude=${claudeDetected} shell=${shellPromptDetected} last="${lastLine.slice(0,40)}"`);

  // Log state changes
  if (claudeDetected !== state.claudeRunning) {
    console.log(`[PARSE] ${sessionName}: STATE CHANGE → ${claudeDetected ? 'Claude started' : 'Claude exited'}`);
  }

  // Update state directly - no complex debouncing
  if (claudeDetected) {
    state.claudeRunning = true;
    state.lastClaudeDetected = Date.now();
  } else if (shellPromptDetected) {
    // Shell prompt visible and no Claude detected = Claude exited
    state.claudeRunning = false;
  }
  // If neither Claude nor shell prompt detected, keep previous state

  // Update session store
  sessions.setClaudeRunning(sessionId, state.claudeRunning);

  if (!state.claudeRunning) {
    // Shell mode - clear any pending questions
    const questionId = activeQuestions.get(sessionId);
    if (questionId) {
      orchestratorQueue.resolve(questionId);
      activeQuestions.delete(sessionId);
    }
    sessions.setStatus(sessionId, "shell");
    return;
  }

  // Claude is running - check for questions or status

  // Check if a question was cancelled (Escape pressed)
  if (activeQuestions.has(sessionId)) {
    // Use both normalized and compact for pattern matching
    const recentNormalized = normalized.slice(-500);
    const recentCompact = compact.slice(-300);

    // Check for explicit cancellation
    const hasCancelled = recentNormalized.includes("Cancelled") || recentNormalized.includes("cancelled") ||
                         recentCompact.includes("Cancelled") || recentCompact.includes("cancelled");

    // Check if permission prompt is still visible (in either format)
    const hasEscPrompt = recentNormalized.includes("Esc to cancel") || recentCompact.includes("Esctocancel");
    const hasPermissionIndicator = /Do you want to|Would you like|Select an option|Choose/i.test(recentNormalized) ||
                                   /Doyouwantto|Wouldyoulike|Selectanoption|Choose/i.test(recentCompact);

    // Only cancel if:
    // 1. Explicit "Cancelled" text appeared, OR
    // 2. Neither "Esc to cancel" nor permission question text is visible (user answered or escaped)
    const shouldCancel = hasCancelled || (!hasEscPrompt && !hasPermissionIndicator);

    if (shouldCancel) {
      const questionId = activeQuestions.get(sessionId);
      if (questionId) {
        console.log(`[PARSE] ${sessionName}: Question cancelled (esc=${hasEscPrompt} cancelled=${hasCancelled} perm=${hasPermissionIndicator})`);
        orchestratorQueue.resolve(questionId);
        activeQuestions.delete(sessionId);
      }
    }
  }

  // Try to parse question from buffer
  // Check both normalized (with spaces) and compact (no spaces) for wide terminal support
  const hasEscToCancel = normalized.includes("Esc to cancel") || compact.includes("Esctocancel");
  const hasDoYouWant = normalized.includes("Do you want to proceed") || compact.includes("Doyouwanttoproceed");
  console.log(`[PARSE] ${sessionName}: Question check - escToCancel=${hasEscToCancel} doYouWant=${hasDoYouWant} activeQ=${activeQuestions.has(sessionId)}`);

  const parsed = tryParseQuestion(clean, normalized, compact);
  console.log(`[PARSE] ${sessionName}: tryParseQuestion result = ${parsed ? `"${parsed.question}" with ${parsed.options.length} options` : 'null'}`);

  if (parsed && !activeQuestions.has(sessionId)) {
    console.log(`[PARSE] ${sessionName}: PUSHING question to orchestrator`);
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
    sessions.setStatus(sessionId, "waiting");
    // Don't trim buffer here - it may remove "Esc to cancel" and trigger false cancellation
  } else {
    const isPromptVisible = detectPrompt(clean, compact);
    const isWorking = detectWorking(clean, compact);

    if (!activeQuestions.has(sessionId)) {
      // Only change status if we have POSITIVE detection
      // This prevents flickering when terminal redraws with different format
      if (isPromptVisible) {
        state.lastStatus = "idle";
        sessions.setStatus(sessionId, "idle");
      } else if (isWorking) {
        state.lastStatus = "active";
        sessions.setStatus(sessionId, "active");
      } else {
        // Keep previous status if we can't positively detect either state
        sessions.setStatus(sessionId, state.lastStatus === "idle" ? "idle" : "active");
      }
    }
  }
}

// Detect if Claude Code is running - SIMPLE logic
function detectClaudeRunning(clean: string, normalized?: string, compact?: string): boolean {
  const lines = clean.split('\n').filter(l => l.trim().length > 0);
  const lastLine = lines.slice(-1).join('').trim();
  const last3Lines = lines.slice(-3).join('\n');
  const last5Lines = lines.slice(-5).join('\n');

  // Use normalized and compact strings for wide terminal support
  const textToCheck = normalized || clean;
  const compactText = compact || clean.replace(/\s+/g, '');

  // FIRST: Check strong Claude UI indicators
  // These take absolute priority - if visible, Claude is definitely running
  const strongIndicators = [
    /\?\s*for\s*shortcuts/i,          // Status bar hint
    /Esc\s*to\s*cancel/i,             // Permission prompt
    /Tab\s*to\s*add/i,                // Input hint
    /Esc\s*to\s*(exit|interrupt)/i,   // Exit/interrupt hint
    /Ctrl-C\s*again/i,                // First Ctrl+C warning
    /Do you want to proceed/i,        // Permission question
    /What should Claude do/i,         // Interrupted prompt
    /Interrupted/i,                   // Interrupted indicator
    /Flummoxing/i,                    // Thinking indicator
    /Forging/i,                       // Working indicator
    /Reasoning/i,                     // Reasoning indicator
    /Thinking/i,                      // Thinking indicator
    /tokens\s*remaining/i,            // Token display
    /Running\.\.\./i,                 // Running indicator
  ];

  // Compact versions of indicators (no spaces)
  const compactIndicators = [
    /\?forshortcuts/i,
    /forshortcuts/i,
    /Esctocancel/i,
    /Tabtoadd/i,
    /Tabtoaddadditional/i,
    /Escto(exit|interrupt)/i,
    /Ctrl-Cagain/i,
    /Doyouwanttoproceed/i,
    /tokensremaining/i,
    /Whatshouldclaudedoinstead/i,  // Interrupted prompt
    /Interrupted/i,
  ];

  // Check line-based, normalized, and compact versions
  const hasStrongIndicator = strongIndicators.some(p => p.test(last5Lines) || p.test(textToCheck)) ||
                             compactIndicators.some(p => p.test(compactText));

  if (hasStrongIndicator) {
    return true;  // Strong Claude UI = definitely running
  }

  // SECOND: Check for exit indicators
  const exitIndicators = [
    /Goodbye/i,                        // Claude's exit message
    /See ya/i,                         // Another exit message
    /Bye!/i,                           // Short exit
  ];

  const hasExitIndicator = exitIndicators.some(p => p.test(last3Lines));

  // THIRD: Check shell prompt - but only if no strong indicators
  const shellPatterns = [
    /^[➜→❯◆▶●◉λ]\s*[\w-]*/,          // Various prompt chars
    /^%/,                              // zsh %
    /^\$/,                             // bash $
    /^#/,                              // root #
  ];

  const isShellPrompt = shellPatterns.some(p => p.test(lastLine));

  // Shell prompt + exit indicator = definitely exited
  if (isShellPrompt && hasExitIndicator) {
    return false;
  }

  // Shell prompt alone (no strong indicator, no banner) = probably exited
  if (isShellPrompt) {
    // But check for banner first
    const bannerIndicators = [
      /Claude\s*Code\s*v\d/i,
      /Claude\s*(Max|Pro|Free)/i,
    ];
    const hasBanner = bannerIndicators.some(p => p.test(last5Lines));

    // If banner visible but shell prompt on last line, check if it's really shell
    // by looking for exit message
    if (hasBanner && !hasExitIndicator) {
      return true;  // Banner visible, no exit = Claude running (prompt is Claude's input area)
    }

    return false;  // Shell prompt, no banner or has exit = shell
  }

  // FOURTH: Check for banner (weak signal)
  const bannerIndicators = [
    /Claude\s*Code\s*v\d/i,
    /Claude\s*(Max|Pro|Free)/i,
  ];

  const hasBanner = bannerIndicators.some(p => p.test(last3Lines));

  if (hasBanner) {
    return true;
  }

  return false;
}

// Detect shell prompt at the end
function detectShellPrompt(clean: string): boolean {
  const lines = clean.split('\n').filter(l => l.trim().length > 0);
  const lastLine = lines.slice(-1).join('').trim();

  // Shell prompt patterns - various prompt characters
  // Include: ➜ → ❯ ◆ ▶ ● ◉ λ % $ > #
  const shellPatterns = [
    /^[➜→❯◆▶●◉λ]\s*[\w-]+/,     // Fancy prompt + directory
    /^[➜→❯◆▶●◉λ]\s*$/,          // Just prompt char
    /^%/,                        // zsh default %
    /^\$/,                       // bash $
    /^>/,                        // generic >
    /^#/,                        // root #
    /[\w-]+@[\w-]+.*[\$#>%]/,   // user@host format
  ];

  return shellPatterns.some(p => p.test(lastLine));
}

function tryParseQuestion(clean: string, normalized?: string, compact?: string): ParsedQuestion | null {
  // Use both normalized and compact for checking presence of key phrases
  const textToCheck = normalized || clean;
  const compactText = compact || clean.replace(/\s+/g, '');

  // Check for Esc to cancel in both forms
  const hasEscPrompt = textToCheck.includes("Esc to cancel") ||
                       textToCheck.includes("Esc to exit") ||
                       compactText.includes("Esctocancel") ||
                       compactText.includes("Esctoexit");

  if (!hasEscPrompt) {
    return null;
  }

  // Check for question text in both forms
  let questionText = "";
  const questionPatterns = [
    { normal: "Do you want to proceed?", compact: "Doyouwanttoproceed?" },
    { normal: "Do you want to", compact: "Doyouwantto" },
    { normal: "Would you like to", compact: "Wouldyouliketo" },
    { normal: "Select an option", compact: "Selectanoption" },
    { normal: "Choose", compact: "Choose" },
  ];

  for (const { normal, compact: compactPattern } of questionPatterns) {
    if (textToCheck.includes(normal) || compactText.includes(compactPattern)) {
      questionText = normal.endsWith("?") ? normal : normal + "?";
      break;
    }
  }

  if (!questionText) {
    // Default question if we found Esc prompt but no specific question
    questionText = "Do you want to proceed?";
  }

  // Try to parse options - check for patterns like "1.Yes" or "1. Yes"
  // In compact mode: "1.Yes2.Yes,andalwaysallow...3.No"
  const options: { number: string; label: string }[] = [];

  // Try normalized first (with spaces)
  let optionRegex = /(\d)\.\s*([^0-9]+?)(?=\s*\d\.|Esc|Tab|$)/g;
  let match;
  while ((match = optionRegex.exec(textToCheck)) !== null) {
    const num = match[1];
    let label = match[2].trim()
      .replace(/[-─·]+$/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (label.length >= 2 && !/^[\s\-·]+$/.test(label) && !options.find(o => o.number === num)) {
      options.push({ number: num, label });
    }
  }

  // If we didn't find enough options, try compact mode
  if (options.length < 2) {
    options.length = 0; // Clear and retry
    // Pattern for compact: "1.Yes" "2.Yes,andalways" "3.No"
    optionRegex = /(\d)\.([A-Za-z][^0-9]*?)(?=\d\.|Escto|Tabto|$)/g;
    while ((match = optionRegex.exec(compactText)) !== null) {
      const num = match[1];
      let label = match[2]
        .replace(/[-─·]+$/, "")
        .trim();

      // Add spaces back into common phrases
      label = label
        .replace(/Yes,andalwaysallowaccess/gi, "Yes, and always allow access")
        .replace(/fromthisproject/gi, "from this project")
        .replace(/,and/g, ", and ");

      if (label.length >= 2 && !options.find(o => o.number === num)) {
        options.push({ number: num, label });
      }
    }
  }

  options.sort((a, b) => parseInt(a.number) - parseInt(b.number));

  // Provide default options if we detected a permission prompt but couldn't parse options
  if (options.length < 2 && hasEscPrompt) {
    return {
      question: questionText,
      options: [
        { number: "1", label: "Yes" },
        { number: "2", label: "Yes, and always allow" },
        { number: "3", label: "No" },
      ]
    };
  }

  if (options.length < 2) {
    return null;
  }

  return { question: questionText, options };
}

export function sendResponse(sessionId: string, optionIndex: number): void {
  const questionId = activeQuestions.get(sessionId);
  if (questionId) {
    writeToSession(sessionId, String(optionIndex + 1)).catch(console.error);
    orchestratorQueue.resolve(questionId);
    activeQuestions.delete(sessionId);
    sessionBuffers.delete(sessionId);
    sessions.setStatus(sessionId, "active");
  }
}

export function clearSession(sessionId: string): void {
  const questionId = activeQuestions.get(sessionId);
  if (questionId) {
    orchestratorQueue.resolve(questionId);
  }
  activeQuestions.delete(sessionId);
  sessionBuffers.delete(sessionId);
  sessionStates.delete(sessionId);
}

// Detect if Claude is actively working (thinking, running tools)
function detectWorking(clean: string, compact?: string): boolean {
  const workingIndicators = [
    /Thinking/i,
    /Reasoning/i,
    /Flummoxing/i,
    /Forging/i,
    /Running\.\.\./i,
    /Executing/i,
    /Reading/i,
    /Writing/i,
    /Searching/i,
  ];

  const compactWorkingIndicators = [
    /Thinking/i,
    /Reasoning/i,
    /Running/i,
  ];

  for (const pattern of workingIndicators) {
    if (pattern.test(clean)) {
      return true;
    }
  }

  if (compact) {
    for (const pattern of compactWorkingIndicators) {
      if (pattern.test(compact)) {
        return true;
      }
    }
  }

  return false;
}

function detectPrompt(clean: string, compact?: string): boolean {
  const promptIndicators = [
    /\?\s+for\s+shortcuts/i,
    /\?\s*for\s*shortcuts/i,
    /\/ide\s+for/i,
    /Esc\s+to\s+exit/i,
  ];

  // Compact versions for wide terminal
  const compactIndicators = [
    /\?forshortcuts/i,
    /forshortcuts/i,
    /\/idefor/i,
    /Esctoexit/i,
  ];

  for (const pattern of promptIndicators) {
    if (pattern.test(clean)) {
      return true;
    }
  }

  // Check compact version if provided
  if (compact) {
    for (const pattern of compactIndicators) {
      if (pattern.test(compact)) {
        return true;
      }
    }
  }

  return false;
}

function stripAnsi(str: string): string {
  let result = str
    // Standard ANSI escape sequences
    .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1B\].*?(\x07|\x1B\\)/g, "")
    .replace(/\x1B[PX^_].*?\x1B\\/g, "")
    .replace(/\x1B[@-Z\\-_]/g, "")
    // Incomplete/broken escape sequences (more aggressive)
    .replace(/\[\?[0-9;]*[a-zA-Z]?/g, "")
    .replace(/\[[<>][0-9;]*[a-zA-Z]?/g, "")
    .replace(/\[[0-9;]*[a-zA-Z]/g, "")
    // Leftover ANSI fragments: ";2;153;153;153m" patterns
    .replace(/;[0-9;]+m/g, "")
    .replace(/\d+m\s*/g, "")
    // Control characters
    .replace(/\r/g, "")
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Clean up percent at line start (zsh prompt marker)
    .replace(/^%\s*/gm, "");

  // Fix character-per-line issue in wide terminals
  // Detect: many lines with only 1-2 non-whitespace characters
  const lines = result.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  const shortLines = nonEmptyLines.filter(l => l.trim().length <= 2);

  // If >60% of lines are very short, we have char-per-line mode
  if (nonEmptyLines.length > 10 && shortLines.length / nonEmptyLines.length > 0.6) {
    // Collapse but preserve spaces by adding space between each char
    result = lines.map(l => l.trim()).filter(l => l.length > 0).join(' ');
    // Clean up multiple spaces
    result = result.replace(/\s+/g, ' ');
    // Re-add line breaks at key points
    result = result
      .replace(/(\d\.)/g, '\n$1')           // "1." "2." etc on new lines
      .replace(/(Esc to)/gi, '\n$1')         // "Esc to" on new line
      .replace(/(Tab to)/gi, '\n$1')         // "Tab to" on new line
      .replace(/(Do you want)/gi, '\n$1')    // Question on new line
      .replace(/(Would you like)/gi, '\n$1')
      .replace(/(Yes,)/g, '\n$1')
      .replace(/\b(No)\b/g, '\n$1');
  }

  return result;
}
