import type { Terminal } from "@xterm/xterm";

/**
 * Normalize text from wide terminals where Ink renders one character per line.
 * Detects char-per-line mode and collapses into readable text.
 */
function normalizeWideTerminalText(text: string): string {
  const lines = text.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  const shortLines = nonEmptyLines.filter(l => l.trim().length <= 2);

  // Only trigger if >60% of non-empty lines are very short (1-2 chars)
  // and we have enough lines to be confident
  if (nonEmptyLines.length <= 10 || shortLines.length / nonEmptyLines.length <= 0.6) {
    return text;
  }

  // Collapse all trimmed non-empty lines into one string
  let result = lines.map(l => l.trim()).filter(l => l.length > 0).join(' ');
  // Clean up multiple spaces
  result = result.replace(/\s+/g, ' ');

  // Re-insert line breaks before structural markers that detectors rely on
  result = result
    .replace(/(Esc to)/gi, '\n$1')
    .replace(/(Tab to)/gi, '\n$1')
    .replace(/(\? for shortcuts)/gi, '\n$1')
    .replace(/(Thinking)/gi, '\n$1')
    .replace(/(Do you want)/gi, '\n$1')
    .replace(/(Would you like)/gi, '\n$1')
    .replace(/(\d\.)/g, '\n$1')
    .replace(/(Yes,)/g, '\n$1')
    .replace(/\b(No)\b/g, '\n$1')
    .replace(/(\/ide for)/gi, '\n$1');

  return result;
}

/**
 * Strip problematic Unicode characters that break regex detection.
 * Keeps ASCII, common Latin characters, and whitespace.
 * Replaces box-drawing, spinners, and decorative Unicode with ASCII equivalents.
 */
function normalizeUnicode(text: string): string {
  return text
    // Replace common Unicode prompt characters with ASCII equivalents
    .replace(/[❯›»▸▶⟩]/g, '>')
    .replace(/[❮‹«◂◀⟨]/g, '<')
    .replace(/[✓✔☑]/g, '[x]')
    .replace(/[✗✘☒✖]/g, '[!]')
    .replace(/[●◉⬤]/g, '*')
    .replace(/[○◯◌]/g, 'o')
    .replace(/[─━—–]/g, '-')
    .replace(/[│┃|]/g, '|')
    .replace(/[┌┍┎┏╔╒╓]/g, '+')
    .replace(/[┐┑┒┓╗╕╖]/g, '+')
    .replace(/[└┕┖┗╚╘╙]/g, '+')
    .replace(/[┘┙┚┛╝╛╜]/g, '+')
    .replace(/[├┝┞┟┠┡┢┣╠╞╟]/g, '+')
    .replace(/[┤┥┦┧┨┩┪┫╣╡╢]/g, '+')
    .replace(/[┬┭┮┯┰┱┲┳╦╤╥]/g, '+')
    .replace(/[┴┵┶┷┸┹┺┻╩╧╨]/g, '+')
    .replace(/[┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋╬╪╫]/g, '+')
    // Replace spinner/progress Unicode
    .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷]/g, '*')
    // Replace fancy arrows
    .replace(/[→⟶⇒⟹➔➜➙➛]/g, '->')
    .replace(/[←⟵⇐⟸]/g, '<-')
    .replace(/[↑⬆⇑]/g, '^')
    .replace(/[↓⬇⇓]/g, 'v')
    // Replace fancy quotes with ASCII
    .replace(/[""„‟]/g, '"')
    .replace(/[''‛‚]/g, "'")
    // Replace ellipsis
    .replace(/…/g, '...')
    // Remove zero-width and invisible characters
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, '')
    // Remove variation selectors (emoji modifiers)
    .replace(/[\uFE00-\uFE0F]/g, '')
    // Remove combining diacritical marks that may sneak in
    .replace(/[\u0300-\u036F]/g, '');
}

/**
 * Reads the visible text from xterm.js buffer
 * This gives us the RENDERED text, not raw PTY output
 * No ANSI stripping needed - xterm already processed everything
 */
export function getTerminalText(terminal: Terminal, lastNLines?: number): string {
  const buffer = terminal.buffer.active;
  const totalLines = buffer.length;

  const startLine = lastNLines ? Math.max(0, totalLines - lastNLines) : 0;

  let text = '';
  for (let i = startLine; i < totalLines; i++) {
    const line = buffer.getLine(i);
    if (line) {
      text += line.translateToString(true) + '\n';
    }
  }

  const normalized = normalizeWideTerminalText(text.trim());
  return normalizeUnicode(normalized);
}

/**
 * Get just the last N lines for efficient checking
 */
export function getLastLines(terminal: Terminal, n: number = 10): string {
  return getTerminalText(terminal, n);
}

/**
 * Get the current cursor line content
 */
export function getCurrentLine(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const cursorY = buffer.cursorY + buffer.viewportY;
  const line = buffer.getLine(cursorY);
  return line ? line.translateToString(true).trim() : '';
}
