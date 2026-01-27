// ── Tool Types ───────────────────────────────────────────────────────────────

export enum ToolType {
  TEXT = "text",          // Plain LLM explanation / answer
  BASH = "bash",          // Suggested command to run
}

export enum AgentStatus {
  PROCESSING = "processing",
  READY = "ready",
  WARNING = "warning",
  ERROR = "error",
  SUCCESS = "success",
}

// ── Response Types ──────────────────────────────────────────────────────────

export interface AgentResponse {
  tool: ToolType;
  status: AgentStatus;
  content: string;
  command?: string;       // For BASH: the suggested command
  actions?: ProposedAction[];
}

export interface ProposedAction {
  id: string;
  description: string;
  command: string;
  requiresConfirmation: boolean;
  shortcut?: string;
  isDangerous: boolean;
}
