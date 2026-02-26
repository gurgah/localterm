/**
 * Claude Detector Service
 * Pure functions for detecting Claude Code state from terminal text
 *
 * NOTE: `isRunning` is now determined by process-based detection (Rust backend).
 * This module provides text-based sub-status (idle/active/waiting) and
 * permission prompt parsing. The `isRunning` field in the return value is
 * a text-based hint only — the caller should override it with process detection.
 */

export interface ClaudeState {
  isRunning: boolean;
  status: 'shell' | 'active' | 'idle' | 'waiting';
  hasPermissionPrompt: boolean;
  permissionQuestion: ParsedQuestion | null;
}

export interface ParsedQuestion {
  question: string;
  options: { number: string; label: string }[];
}

const WORKING_INDICATORS = [
  /Thinking\.*$/im,
  /Reasoning\.*$/im,
  /Flummoxing/i,
  /Forging/i,
  /Running\.\.\./i,
  /Executing/i,
  /Reading\s+\S+/i,
  /Writing\s+\S+/i,
  /Searching/i,
  /Interrupted/i,
];

const PROMPT_INDICATORS = [
  />\s*$/m,  // Claude's input prompt (❯)
];

const PERMISSION_INDICATORS = [
  /Do you want to proceed\??/i,
  /Do you want to\s/i,
  /Would you like to/i,
  /Select an option/i,
];

/**
 * Main detection function - analyzes terminal text and returns Claude state.
 * The `isRunning` field is a text-based hint. The caller (Terminal.svelte)
 * overrides it with process-based detection from the Rust backend.
 */
export function detectClaudeState(text: string): ClaudeState {
  const lastLines = getLastLines(text, 15);

  // Determine sub-status from text
  const hasPermissionPrompt = detectPermissionPrompt(lastLines);
  const isWorking = WORKING_INDICATORS.some(p => p.test(lastLines));
  const isPromptVisible = PROMPT_INDICATORS.some(p => p.test(lastLines));

  let status: ClaudeState['status'] = 'active';

  if (hasPermissionPrompt) {
    status = 'waiting';
  } else if (isPromptVisible && !isWorking) {
    status = 'idle';
  } else if (isWorking) {
    status = 'active';
  }

  // Parse permission question if present
  let permissionQuestion: ParsedQuestion | null = null;
  if (hasPermissionPrompt) {
    permissionQuestion = parsePermissionQuestion(text);
  }

  return {
    isRunning: true, // hint only — caller overrides with process detection
    status,
    hasPermissionPrompt,
    permissionQuestion,
  };
}

/**
 * Detect if a permission prompt is visible
 */
function detectPermissionPrompt(text: string): boolean {
  const hasEscToCancel = /Esc\s*to\s*cancel/i.test(text);
  const hasQuestion = PERMISSION_INDICATORS.some(p => p.test(text));
  return hasEscToCancel && hasQuestion;
}

/**
 * Parse a permission question from terminal text.
 * Only looks at lines AFTER the last permission question indicator
 * to avoid matching numbered items from Claude's output content.
 */
function parsePermissionQuestion(text: string): ParsedQuestion | null {
  // Find the question and its position in the text
  let questionText = "Do you want to proceed?";
  let questionIndex = -1;

  for (const pattern of PERMISSION_INDICATORS) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      // Use the LAST occurrence — permission prompt is at the bottom
      const allMatches = [...text.matchAll(new RegExp(pattern.source, pattern.flags + (pattern.flags.includes('g') ? '' : 'g')))];
      const lastMatch = allMatches[allMatches.length - 1];
      if (lastMatch && lastMatch.index !== undefined) {
        if (lastMatch.index > questionIndex) {
          questionIndex = lastMatch.index;
          questionText = lastMatch[0];
        }
      }
    }
  }

  // Only parse options from text AFTER the permission question
  const searchText = questionIndex >= 0 ? text.slice(questionIndex) : text;

  // Find options (1. Yes, 2. Yes and always..., 3. No)
  const options: { number: string; label: string }[] = [];
  const optionRegex = /[^0-9\n]*?(\d)\.\s+([^\n]+)/g;

  let match;
  while ((match = optionRegex.exec(searchText)) !== null) {
    const num = match[1];
    let label = match[2].trim()
      .replace(/[-─]+$/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (label.length >= 2 && !options.find(o => o.number === num)) {
      options.push({ number: num, label });
    }
  }

  options.sort((a, b) => parseInt(a.number) - parseInt(b.number));

  // Return default options if we couldn't parse
  if (options.length < 2) {
    return {
      question: questionText,
      options: [
        { number: "1", label: "Yes" },
        { number: "2", label: "Yes, and always allow" },
        { number: "3", label: "No" },
      ],
    };
  }

  return { question: questionText, options };
}

/**
 * Helper to get last N lines from text
 */
function getLastLines(text: string, n: number): string {
  // Strip any remaining non-printable/control chars except newline and common whitespace
  const cleaned = text.replace(/[^\x20-\x7E\n\t]/g, '');
  const lines = cleaned.split('\n').filter(l => l.trim().length > 0);
  return lines.slice(-n).join('\n');
}
