<script lang="ts">
  import { llmStore, isDownloading } from "../stores/llm";
  import { llmService } from "../services/llmService";
  import { settings } from "../stores/settings";
  import { onMount, onDestroy } from "svelte";

  let downloading = false;
  let error = "";
  let unlistenProgress: (() => void) | null = null;

  onMount(async () => {
    unlistenProgress = await llmService.onDownloadProgress((progress) => {
      llmStore.setDownloadProgress(progress.percent, progress.speed_mbps);
    });
  });

  onDestroy(() => {
    if (unlistenProgress) unlistenProgress();
  });

  async function startDownload() {
    downloading = true;
    error = "";
    llmStore.setDownloadProgress(0, 0);

    try {
      const path = await llmService.downloadModel();
      settings.updateLlm({ modelPath: path });
      llmStore.clearDownloadProgress();
    } catch (e: any) {
      error = e?.toString() ?? "Download failed";
    } finally {
      downloading = false;
      llmStore.clearDownloadProgress();
    }
  }

  function formatSpeed(mbps: number): string {
    if (mbps < 1) return `${(mbps * 1024).toFixed(0)} KB/s`;
    return `${mbps.toFixed(1)} MB/s`;
  }

  function formatPercent(pct: number): string {
    return `${pct.toFixed(1)}%`;
  }
</script>

<div class="model-download">
  <h4>Download Model</h4>
  <p class="desc">Qwen3-4B Q4_K_M (2.3 GB GGUF)</p>

  {#if $isDownloading}
    <div class="progress-container">
      <div class="progress-bar">
        <div class="progress-fill" style="width: {$llmStore.downloadPercent ?? 0}%"></div>
      </div>
      <div class="progress-info">
        <span>{formatPercent($llmStore.downloadPercent ?? 0)}</span>
        {#if $llmStore.downloadSpeedMbps}
          <span>{formatSpeed($llmStore.downloadSpeedMbps)}</span>
        {/if}
      </div>
    </div>
  {:else}
    <button class="btn" on:click={startDownload} disabled={downloading}>
      {downloading ? "Starting..." : "Download Default Model"}
    </button>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}
</div>

<style>
  .model-download {
    padding: 12px;
    border: 1px solid #333;
    border-radius: 6px;
    margin: 8px 0;
  }

  h4 {
    margin: 0 0 4px;
    font-size: 13px;
    color: #e0e0e0;
  }

  .desc {
    margin: 0 0 8px;
    font-size: 11px;
    color: #888;
  }

  .progress-container {
    margin-top: 8px;
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    background: #333;
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #da7756;
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .progress-info {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 11px;
    color: #888;
  }

  .btn {
    background: #da7756;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    font-size: 12px;
    cursor: pointer;
    width: 100%;
  }

  .btn:hover {
    opacity: 0.9;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    color: #ef4444;
    font-size: 11px;
    margin-top: 6px;
    word-break: break-word;
  }
</style>
