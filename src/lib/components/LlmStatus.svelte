<script lang="ts">
  import { llmStore, isModelLoaded, isGenerating } from "../stores/llm";
  import { llmService } from "../services/llmService";
  import { settings } from "../stores/settings";
  import { onMount, onDestroy } from "svelte";

  let statusPollTimer: ReturnType<typeof setInterval> | null = null;
  let serverRunning = false;

  onMount(() => {
    // Poll LLM status every 5 seconds
    refreshStatus();
    statusPollTimer = setInterval(refreshStatus, 5000);
  });

  onDestroy(() => {
    if (statusPollTimer) clearInterval(statusPollTimer);
  });

  async function refreshStatus() {
    try {
      const info = await llmService.getStatus();
      llmStore.updateFromStatus(info);
      serverRunning = await llmService.isServerRunning();
    } catch (e) {
      // Backend not ready yet
    }
  }

  async function handleLoadModel() {
    const modelPath = $settings.llm.modelPath || $settings.llm.customModelPath;
    if (!modelPath) return;
    try {
      llmStore.setStatus("loading");
      await llmService.loadModel(modelPath);
      await refreshStatus();
    } catch (e: any) {
      llmStore.setError(e?.toString() ?? "Load failed");
    }
  }

  async function handleUnloadModel() {
    try {
      await llmService.unloadModel();
      await refreshStatus();
    } catch (e: any) {
      llmStore.setError(e?.toString() ?? "Unload failed");
    }
  }

  async function handleStartServer() {
    try {
      await llmService.startServer();
      serverRunning = true;
    } catch (e: any) {
      llmStore.setError(e?.toString() ?? "Server start failed");
    }
  }

  function statusColor(status: string): string {
    switch (status) {
      case "ready": return "#4ade80";
      case "generating": return "#da7756";
      case "loading": return "#facc15";
      case "error": return "#ef4444";
      default: return "#6b7280";
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case "ready": return "Ready";
      case "generating": return "Generating...";
      case "loading": return "Loading...";
      case "error": return "Error";
      default: return "Idle";
    }
  }
</script>

<div class="llm-status">
  <div class="status-row">
    <span class="dot" style="background-color: {statusColor($llmStore.status)}"></span>
    <span class="label">LLM: {statusLabel($llmStore.status)}</span>
    {#if $llmStore.modelName}
      <span class="model-name">{$llmStore.modelName}</span>
    {/if}
  </div>

  {#if $llmStore.error}
    <div class="error">{$llmStore.error}</div>
  {/if}

  <div class="actions">
    {#if !$isModelLoaded && $llmStore.status !== "loading"}
      <button class="btn" on:click={handleLoadModel} disabled={!$settings.llm.modelPath && !$settings.llm.customModelPath}>
        Load Model
      </button>
    {:else if $isModelLoaded}
      <button class="btn btn-secondary" on:click={handleUnloadModel}>
        Unload
      </button>
    {/if}
    {#if $isModelLoaded && !serverRunning && $settings.llm.useForClaudeCode}
      <button class="btn" on:click={handleStartServer}>
        Start Server
      </button>
    {/if}
  </div>

  {#if serverRunning && $settings.llm.useForClaudeCode}
    <div class="server-info">
      API: localhost:11435/v1/messages — Claude Code will use local model
    </div>
  {/if}
</div>

<style>
  .llm-status {
    padding: 8px 12px;
    border-top: 1px solid #333;
    font-size: 12px;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .label {
    color: #ccc;
    font-weight: 500;
  }

  .model-name {
    color: #888;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error {
    color: #ef4444;
    font-size: 11px;
    margin-top: 4px;
    word-break: break-word;
  }

  .actions {
    margin-top: 6px;
    display: flex;
    gap: 6px;
  }

  .btn {
    background: #da7756;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 11px;
    cursor: pointer;
  }

  .btn:hover {
    opacity: 0.9;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: #444;
  }

  .btn-secondary:hover {
    background: #555;
  }

  .server-info {
    margin-top: 6px;
    font-size: 10px;
    color: #4ade80;
    padding: 4px 8px;
    background: rgba(74, 222, 128, 0.1);
    border-radius: 4px;
  }
</style>
