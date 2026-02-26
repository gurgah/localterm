import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ──────────────────────────────────────────────────────────────────

export type LlmStatus = "idle" | "loading" | "ready" | "generating" | "error";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmStatusInfo {
  status: LlmStatus;
  model_name: string | null;
  model_path: string | null;
  error: string | null;
}

export interface DownloadProgress {
  url: string;
  downloaded: number;
  total: number | null;
  percent: number;
  speed_mbps: number;
}

// ── Service ────────────────────────────────────────────────────────────────

export const llmService = {
  async loadModel(path: string): Promise<void> {
    await invoke("llm_load_model", { path });
  },

  async unloadModel(): Promise<void> {
    await invoke("llm_unload_model");
  },

  async getStatus(): Promise<LlmStatusInfo> {
    return await invoke("llm_status");
  },

  /**
   * Send a chat completion request with streaming tokens.
   * Tokens arrive via the "llm-token" event.
   */
  async chat(
    messages: ChatMessage[],
    sessionId: string,
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<string> {
    return await invoke("llm_chat", {
      messages,
      sessionId,
      maxTokens: options?.maxTokens ?? 512,
      temperature: options?.temperature ?? 0.7,
    });
  },

  async classify(input: string): Promise<string> {
    return await invoke("llm_classify", { input });
  },

  async stopGeneration(): Promise<void> {
    await invoke("llm_stop_generation");
  },

  /**
   * Download a GGUF model. Progress arrives via "llm-download-progress" event.
   * Returns the local file path.
   */
  async downloadModel(url?: string): Promise<string> {
    return await invoke("llm_download_model", { url: url ?? null });
  },

  /**
   * Cancel an in-progress download.
   * cleanup=false → pause (keep .part file for resume)
   * cleanup=true  → cancel (delete .part file)
   */
  async cancelDownload(cleanup: boolean, url?: string): Promise<void> {
    await invoke("llm_cancel_download", { url: url ?? null, cleanup });
  },

  /** Delete a downloaded model file. Unloads first if loaded. */
  async deleteModel(path: string): Promise<void> {
    await invoke("llm_delete_model", { path });
  },

  /** Check if a model file exists. Returns path if exists, null otherwise. */
  async checkModelExists(filename: string): Promise<string | null> {
    return await invoke("llm_check_model_exists", { filename });
  },

  /** Check if a partial download (.part file) exists for resume. */
  async hasPartialDownload(filename: string): Promise<boolean> {
    return await invoke("llm_has_partial_download", { filename });
  },

  async listModels(): Promise<string[]> {
    return await invoke("llm_list_models");
  },

  async getModelsDir(): Promise<string> {
    return await invoke("llm_models_dir");
  },

  /** Start the local OpenAI-compatible HTTP server. Returns the port. */
  async startServer(port?: number): Promise<number> {
    return await invoke("llm_start_server", { port: port ?? null });
  },

  /** Check if the local server is running. */
  async isServerRunning(): Promise<boolean> {
    return await invoke("llm_server_status");
  },

  /** Set tool calling enabled/disabled on the backend. */
  async setToolCalling(enabled: boolean): Promise<void> {
    await invoke("llm_set_tool_calling", { enabled });
  },

  /** Get tool calling status from the backend. */
  async getToolCalling(): Promise<boolean> {
    return await invoke("llm_get_tool_calling");
  },

  /** Create a PTY session with extra env vars (e.g. ANTHROPIC_BASE_URL). */
  async createSessionWithEnv(
    sessionId: string,
    cwd: string | null,
    cols: number,
    rows: number,
    envVars: [string, string][]
  ): Promise<void> {
    await invoke("create_session_with_env", {
      sessionId,
      cwd,
      cols,
      rows,
      envVars,
    });
  },

  // ── Event Listeners ────────────────────────────────────────────────────

  onToken(
    callback: (data: { session_id: string; token: string }) => void
  ): Promise<() => void> {
    return listen("llm-token", (event) => {
      callback(event.payload as { session_id: string; token: string });
    }).then((unlisten) => unlisten);
  },

  onDownloadProgress(
    callback: (progress: DownloadProgress) => void
  ): Promise<() => void> {
    return listen("llm-download-progress", (event) => {
      callback(event.payload as DownloadProgress);
    }).then((unlisten) => unlisten);
  },
};
