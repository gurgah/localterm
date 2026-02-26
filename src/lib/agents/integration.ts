import { get } from "svelte/store";
import { ToolType, AgentStatus, type AgentResponse } from "./types";
import { llmService, type ChatMessage } from "../services/llmService";
import { isModelLoaded } from "../stores/llm";
import { settings } from "../stores/settings";

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

// ── Guards ──────────────────────────────────────────────────────────────────

/**
 * Check if LLM is enabled and model is loaded.
 * Returns false if either condition is not met — callers should return null.
 */
export function isLlmReady(): boolean {
  return get(settings).llm.enabled && get(isModelLoaded);
}

// ── Response Parsing ────────────────────────────────────────────────────────

/**
 * Parse raw LLM output into an AgentResponse.
 * If the response contains a ```bash or ```sh code block, extract the command
 * and return a BASH card. Otherwise return a TEXT card.
 */
function parseResponse(raw: string, status: AgentStatus = AgentStatus.READY): AgentResponse {
  // Match ```bash or ```sh code blocks
  const codeBlockMatch = raw.match(/```(?:bash|sh)\s*\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    const command = codeBlockMatch[1].trim();
    // Use text outside the code block as explanation, or the full response
    const explanation = raw.replace(/```(?:bash|sh)\s*\n[\s\S]*?```/, "").trim();
    return {
      tool: ToolType.BASH,
      status,
      content: explanation || `Suggested command:`,
      command,
    };
  }

  return {
    tool: ToolType.TEXT,
    status,
    content: raw.trim(),
  };
}

// ── Agent Processing ────────────────────────────────────────────────────────

/**
 * Process input through the LLM agent system.
 * Returns null if LLM is not ready (disabled or model not loaded).
 */
export async function processAgentInput(
  input: string,
  context: { cwd: string; recentCommands: string[]; isGitRepo: boolean },
  _useLlm = true
): Promise<AgentResponse | null> {
  if (!isLlmReady()) return null;

  const systemMsg: ChatMessage = {
    role: "system",
    content: `You are a terminal assistant. The user's current working directory is: ${context.cwd}
When suggesting a command, wrap it in a \`\`\`bash code block.
Be concise. Answer in 1-3 sentences unless more detail is needed.`,
  };

  const userMsg: ChatMessage = {
    role: "user",
    content: input,
  };

  try {
    const response = await llmService.chat([systemMsg, userMsg], "agent", {
      maxTokens: 512,
      temperature: 0.7,
    });
    return parseResponse(response);
  } catch (err) {
    console.error("Agent LLM error:", err);
    return {
      tool: ToolType.TEXT,
      status: AgentStatus.ERROR,
      content: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Trigger error recovery when a command fails.
 * Returns null if LLM is not ready.
 */
export async function triggerErrorRecovery(
  output: string,
  exitCode: number,
  context: { cwd: string; lastOutput?: string; lastExitCode?: number; recentCommands: string[]; isGitRepo: boolean }
): Promise<AgentResponse | null> {
  if (!isLlmReady()) return null;

  const lastLines = output.split("\n").slice(-15).join("\n");

  const systemMsg: ChatMessage = {
    role: "system",
    content: `You are a terminal error recovery assistant. Analyze the error and suggest a fix.
The user's current working directory is: ${context.cwd}
When suggesting a fix command, wrap it in a \`\`\`bash code block.
Be concise.`,
  };

  const userMsg: ChatMessage = {
    role: "user",
    content: `Command failed with exit code ${exitCode}. Last output:\n${lastLines}`,
  };

  try {
    const response = await llmService.chat([systemMsg, userMsg], "agent-recovery", {
      maxTokens: 512,
      temperature: 0.4,
    });
    return parseResponse(response, AgentStatus.WARNING);
  } catch (err) {
    console.error("Error recovery LLM error:", err);
    return null;
  }
}
