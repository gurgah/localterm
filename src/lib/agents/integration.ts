import { ToolType, AgentStatus, type AgentResponse } from "./types";

// ── Input Detection ─────────────────────────────────────────────────────────

/**
 * Determine if user input should be routed to the agent system.
 * Currently: inputs starting with "?" are routed.
 */
export function shouldRouteToAgent(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  return trimmed.startsWith("?");
}

// ── Agent Processing ────────────────────────────────────────────────────────

/**
 * Process input through the LLM agent system.
 * Returns an AgentResponse with tool type based on LLM response.
 * When tool_calling is ON, the LLM server returns tool_use blocks.
 * When tool_calling is OFF, returns plain text.
 */
export async function processAgentInput(
  input: string,
  _context: { cwd: string; recentCommands: string[]; isGitRepo: boolean },
  _useLlm = true
): Promise<AgentResponse | null> {
  // Placeholder: will be replaced by llm_server /v1/messages call
  return {
    tool: ToolType.TEXT,
    status: AgentStatus.READY,
    content: `Agent query: ${input}`,
  };
}

/**
 * Trigger error recovery when a command fails.
 */
export async function triggerErrorRecovery(
  output: string,
  _exitCode: number,
  _context: { cwd: string; lastOutput?: string; lastExitCode?: number; recentCommands: string[]; isGitRepo: boolean }
): Promise<AgentResponse | null> {
  // Placeholder: will be replaced by llm_server call
  return {
    tool: ToolType.TEXT,
    status: AgentStatus.WARNING,
    content: `Error detected:\n${output.split("\n").slice(-5).join("\n")}`,
  };
}
