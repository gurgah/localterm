<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { settings } from "../stores/settings";
  import { llmStore, isModelLoaded, isDownloading } from "../stores/llm";
  import { llmService } from "../services/llmService";
  import { VERIFIED_MODELS, getVerifiedModel } from "../data/verifiedModels";
  import { openFileDialog } from "../utils/tauri";
  import { open } from "@tauri-apps/plugin-dialog";

  export let show: boolean = false;
  export let initialTab: "general" | "llm" = "general";
  export let onClose: () => void = () => {};

  let activeTab: "general" | "llm" = initialTab;
  let customHfUrl: string = "";
  let downloadingCustom: boolean = false;

  // Model file state — checked on open
  let modelFileExists: Record<string, string | null> = {};
  let hasPartial: Record<string, boolean> = {};

  let unlistenProgress: (() => void) | null = null;

  $: if (show) {
    activeTab = initialTab;
    checkModelFiles();
  }

  onMount(() => {
    // Listen for download progress events
    llmService.onDownloadProgress((progress) => {
      llmStore.setDownloadProgress(
        progress.percent,
        progress.speed_mbps,
        progress.downloaded,
        progress.total,
      );
    }).then((unlisten) => {
      unlistenProgress = unlisten;
    });
  });

  onDestroy(() => {
    if (unlistenProgress) {
      unlistenProgress();
      unlistenProgress = null;
    }
  });

  async function checkModelFiles() {
    for (const model of VERIFIED_MODELS) {
      const filename = model.url.split("/").pop() ?? "";
      try {
        modelFileExists[model.id] = await llmService.checkModelExists(filename);
        hasPartial[model.id] = await llmService.hasPartialDownload(filename);
      } catch {
        modelFileExists[model.id] = null;
        hasPartial[model.id] = false;
      }
    }
    // Trigger reactivity
    modelFileExists = { ...modelFileExists };
    hasPartial = { ...hasPartial };
  }

  // ── Verified Model Actions ──
  function selectVerifiedModel(modelId: string) {
    const model = getVerifiedModel(modelId);
    if (!model) return;
    settings.updateLlm({
      modelTier: "verified",
      selectedVerifiedModel: modelId,
      toolCallingEnabled: model.supportsToolCalling,
      contextLength: model.contextLength,
    });
  }

  async function downloadVerifiedModel(modelId: string) {
    const model = getVerifiedModel(modelId);
    if (!model) return;
    try {
      llmStore.setDownloadingModel(modelId);
      llmStore.setDownloadProgress(0, 0, 0, null);
      const path = await llmService.downloadModel(model.url);
      settings.updateLlm({
        modelPath: path,
        selectedVerifiedModel: modelId,
        modelTier: "verified",
        toolCallingEnabled: model.supportsToolCalling,
      });
      modelFileExists[modelId] = path;
      modelFileExists = { ...modelFileExists };
      llmStore.clearDownloadProgress();
    } catch (e: any) {
      const msg = e?.toString() ?? "";
      if (!msg.includes("cancelled")) {
        llmStore.setError(msg || "Download failed");
      }
      llmStore.clearDownloadProgress();
    }
  }

  async function pauseDownload(modelId: string) {
    const model = getVerifiedModel(modelId);
    // Pause = cancel but keep .part file
    await llmService.cancelDownload(false, model?.url);
    hasPartial[modelId] = true;
    hasPartial = { ...hasPartial };
  }

  async function cancelDownload(modelId: string) {
    const model = getVerifiedModel(modelId);
    // Cancel = cancel and delete .part file
    await llmService.cancelDownload(true, model?.url);
    hasPartial[modelId] = false;
    hasPartial = { ...hasPartial };
    llmStore.clearDownloadProgress();
  }

  async function deleteModel(modelId: string) {
    const path = modelFileExists[modelId];
    if (!path) return;
    try {
      await llmService.deleteModel(path);
      modelFileExists[modelId] = null;
      modelFileExists = { ...modelFileExists };
      // Clear model path in settings if it was the active model
      if ($settings.llm.modelPath === path) {
        settings.updateLlm({ modelPath: "" });
        const info = await llmService.getStatus();
        llmStore.updateFromStatus(info);
      }
    } catch (e: any) {
      llmStore.setError(e?.toString() ?? "Delete failed");
    }
  }

  async function loadSelectedModel() {
    const modelPath = $settings.llm.modelPath;
    if (!modelPath) return;
    try {
      llmStore.setStatus("loading");
      await llmService.loadModel(modelPath);
      const info = await llmService.getStatus();
      llmStore.updateFromStatus(info);
    } catch (e: any) {
      llmStore.setError(e?.toString() ?? "Load failed");
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  // ── Custom Model ──
  async function browseCustomModel() {
    const path = await openFileDialog([
      { name: "GGUF Model", extensions: ["gguf"] },
    ]);
    if (path) {
      settings.updateLlm({
        customModelPath: path,
        modelPath: path,
        modelTier: "custom",
        toolCallingEnabled: false,
      });
    }
  }

  async function downloadCustomFromUrl() {
    if (!customHfUrl.trim()) return;
    downloadingCustom = true;
    try {
      llmStore.setDownloadProgress(0, 0, 0, null);
      const path = await llmService.downloadModel(customHfUrl.trim());
      settings.updateLlm({
        customModelPath: path,
        modelPath: path,
        modelTier: "custom",
        toolCallingEnabled: false,
      });
      llmStore.clearDownloadProgress();
    } catch (e: any) {
      const msg = e?.toString() ?? "";
      if (!msg.includes("cancelled")) {
        llmStore.setError(msg || "Download failed");
      }
      llmStore.clearDownloadProgress();
    } finally {
      downloadingCustom = false;
    }
  }

  // ── General Settings ──
  async function browseDefaultLocation() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Default Location",
    });
    if (selected && typeof selected === "string") {
      settings.setDefaultLocation(selected);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("settings-overlay")) {
      onClose();
    }
  }
</script>

{#if show}
  <div class="settings-overlay" onclick={handleOverlayClick} onkeydown={handleKeydown} role="dialog" tabindex="-1">
    <div class="settings-modal">
      <div class="settings-header">
        <h3>Settings</h3>
        <button class="settings-close" onclick={onClose}>&times;</button>
      </div>
      <div class="settings-body">
        <!-- Tabs -->
        <div class="settings-tabs">
          <button
            class="settings-tab"
            class:active={activeTab === "general"}
            onclick={() => (activeTab = "general")}
          >General</button>
          <button
            class="settings-tab"
            class:active={activeTab === "llm"}
            onclick={() => (activeTab = "llm")}
          >Local LLM</button>
        </div>

        <!-- Content -->
        <div class="settings-content">
          {#if activeTab === "general"}
            <!-- ═══ GENERAL TAB ═══ -->
            <div class="setting-group">
              <div class="setting-group-title">Appearance</div>
              <div class="setting-row">
                <div class="setting-label">Font Size</div>
                <div class="slider-row">
                  <input
                    type="range"
                    min="8"
                    max="24"
                    value={$settings.fontSize}
                    oninput={(e) => {
                      const val = parseInt(e.currentTarget.value);
                      settings.updateLlm({}); // trigger save
                      // Direct update for font size
                      const diff = val - $settings.fontSize;
                      if (diff > 0) {
                        for (let i = 0; i < diff; i++) settings.increaseFontSize();
                      } else if (diff < 0) {
                        for (let i = 0; i < -diff; i++) settings.decreaseFontSize();
                      }
                    }}
                    class="range-input"
                  />
                  <span class="slider-value">{$settings.fontSize}px</span>
                </div>
              </div>
            </div>

            <div class="setting-group">
              <div class="setting-group-title">Terminal</div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">Default Working Directory</div>
                  <div class="setting-desc">New terminals will start in this directory</div>
                </div>
              </div>
              <div class="input-row">
                <input
                  class="text-input"
                  placeholder="~/Projects"
                  value={$settings.defaultLocation}
                  readonly
                />
                <button class="browse-btn" onclick={browseDefaultLocation}>Browse</button>
              </div>
            </div>

            <div class="setting-group">
              <div class="setting-group-title">Orchestrator</div>
              <div class="setting-row">
                <div>
                  <div class="setting-label">Show Orchestrator Panel</div>
                  <div class="setting-desc">Display the orchestrator tile in the grid</div>
                </div>
                <button
                  class="toggle"
                  class:on={$settings.showOrchestrator}
                  onclick={() => settings.setShowOrchestrator(!$settings.showOrchestrator)}
                ></button>
              </div>
            </div>

          {:else}
            <!-- ═══ LOCAL LLM TAB ═══ -->
            <div class="setting-group">
              <div class="setting-row">
                <div>
                  <div class="setting-label">Enable Local LLM</div>
                  <div class="setting-desc">Run AI models locally using llama.cpp</div>
                </div>
                <button
                  class="toggle"
                  class:on={$settings.llm.enabled}
                  onclick={() => settings.updateLlm({ enabled: !$settings.llm.enabled })}
                ></button>
              </div>
            </div>

            {#if $settings.llm.enabled}
              <!-- Verified Models -->
              <div class="setting-group">
                <div class="setting-group-title">Verified Models</div>
                <div class="model-cards">
                  {#each VERIFIED_MODELS as model (model.id)}
                    {@const isSelected = $settings.llm.modelTier === "verified" && $settings.llm.selectedVerifiedModel === model.id}
                    {@const isLoaded = $isModelLoaded && isSelected}
                    {@const isThisDownloading = $llmStore.downloadingModelId === model.id && $isDownloading}
                    {@const fileExists = !!modelFileExists[model.id]}
                    {@const partialExists = !!hasPartial[model.id]}
                    <div
                      class="model-card"
                      class:selected={isSelected}
                      class:recommended={model.recommended}
                      onclick={() => selectVerifiedModel(model.id)}
                      role="button"
                      tabindex="0"
                    >
                      {#if model.recommended}
                        <div class="recommended-badge">Recommended</div>
                      {/if}
                      <div class="model-radio" class:selected={isSelected}></div>
                      <div class="model-info">
                        <div class="model-name">{model.name}</div>
                        <div class="model-meta">{model.quantization} &middot; {model.contextLength.toLocaleString()} ctx</div>
                        <div class="model-desc">{model.description}</div>
                        <div class="model-tags">
                          {#each model.tags as tag}
                            <span class="tag" class:tool={tag === "tool-calling"}>{tag}</span>
                          {/each}
                        </div>

                        <!-- Download Progress Bar -->
                        {#if isThisDownloading}
                          <div class="download-progress">
                            <div class="progress-bar-track">
                              <div class="progress-bar-fill" style="width: {$llmStore.downloadPercent?.toFixed(1) ?? 0}%"></div>
                            </div>
                            <div class="progress-info">
                              <span class="progress-percent">{($llmStore.downloadPercent ?? 0).toFixed(1)}%</span>
                              {#if $llmStore.downloadedBytes != null}
                                <span class="progress-bytes">{formatBytes($llmStore.downloadedBytes)}{$llmStore.downloadTotalBytes ? ` / ${formatBytes($llmStore.downloadTotalBytes)}` : ''}</span>
                              {/if}
                              {#if $llmStore.downloadSpeedMbps != null && $llmStore.downloadSpeedMbps > 0}
                                <span class="progress-speed">{$llmStore.downloadSpeedMbps.toFixed(1)} MB/s</span>
                              {/if}
                            </div>
                          </div>
                        {/if}
                      </div>

                      <div class="model-action" onclick={(e) => e.stopPropagation()}>
                        {#if isThisDownloading}
                          <!-- Downloading: Pause + Cancel -->
                          <div class="action-group">
                            <button class="icon-btn pause" onclick={() => pauseDownload(model.id)} title="Pause download">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                            </button>
                            <button class="icon-btn cancel" onclick={() => cancelDownload(model.id)} title="Cancel download">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                          </div>
                        {:else if isLoaded}
                          <!-- Loaded: show status + unload/delete -->
                          <button class="download-btn loaded">Loaded</button>
                          <div class="action-group">
                            <button class="icon-btn delete" onclick={() => deleteModel(model.id)} title="Delete model">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>
                            </button>
                          </div>
                        {:else if fileExists}
                          <!-- Downloaded but not loaded: Load + Delete -->
                          <button class="download-btn" onclick={() => { settings.updateLlm({ modelPath: modelFileExists[model.id] ?? '', selectedVerifiedModel: model.id, modelTier: 'verified', toolCallingEnabled: model.supportsToolCalling }); loadSelectedModel(); }}>Load</button>
                          <div class="action-group">
                            <button class="icon-btn delete" onclick={() => deleteModel(model.id)} title="Delete model">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>
                            </button>
                          </div>
                        {:else if partialExists}
                          <!-- Partial download exists: Resume + Cancel -->
                          <button class="download-btn resume" onclick={() => downloadVerifiedModel(model.id)}>Resume</button>
                          <div class="action-group">
                            <button class="icon-btn cancel" onclick={() => cancelDownload(model.id)} title="Delete partial download">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                          </div>
                        {:else}
                          <!-- Not downloaded: Download button -->
                          <button class="download-btn" onclick={() => downloadVerifiedModel(model.id)}>Download</button>
                          <span class="model-size">{model.size}</span>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>

              <!-- Custom Model (Advanced) -->
              <div class="setting-group">
                <details class="advanced-section">
                  <summary class="advanced-header">
                    <span>Custom Model (Advanced)</span>
                  </summary>
                  <div class="advanced-body">
                    <div class="warning-banner">
                      Custom models are not verified by LocalTerm. Tool calling and Claude Code integration may not work correctly.
                    </div>
                    <div class="field-label">GGUF File Path</div>
                    <div class="input-row">
                      <input
                        class="text-input"
                        placeholder="/path/to/model.gguf"
                        value={$settings.llm.customModelPath}
                        readonly
                      />
                      <button class="browse-btn" onclick={browseCustomModel}>Browse</button>
                    </div>
                    <div class="field-label">HuggingFace URL</div>
                    <div class="input-row">
                      <input
                        class="text-input"
                        placeholder="https://huggingface.co/.../model.gguf"
                        bind:value={customHfUrl}
                      />
                      <button
                        class="browse-btn"
                        onclick={downloadCustomFromUrl}
                        disabled={downloadingCustom || !customHfUrl.trim()}
                      >{downloadingCustom ? "..." : "Download"}</button>
                    </div>
                    <div class="setting-row">
                      <div>
                        <div class="setting-label" style="font-size:12px">Enable Tool Calling</div>
                        <div class="setting-desc">Turn on if your model supports Anthropic Messages API tool calling format</div>
                      </div>
                      <button
                        class="toggle"
                        class:on={$settings.llm.toolCallingEnabled && $settings.llm.modelTier === "custom"}
                        onclick={() => settings.updateLlm({ toolCallingEnabled: !$settings.llm.toolCallingEnabled })}
                      ></button>
                    </div>
                  </div>
                </details>
              </div>

              <!-- Auto Management -->
              <div class="setting-group">
                <div class="setting-group-title">Auto Management</div>
                <div class="setting-row">
                  <div>
                    <div class="setting-label">Auto-load on startup</div>
                    <div class="setting-desc">Load the selected model when the app starts</div>
                  </div>
                  <button
                    class="toggle"
                    class:on={$settings.llm.autoLoadModel}
                    onclick={() => settings.updateLlm({ autoLoadModel: !$settings.llm.autoLoadModel })}
                  ></button>
                </div>
                <div class="setting-row">
                  <div class="setting-label">Auto-unload after idle</div>
                  <div class="slider-row">
                    <input
                      type="range"
                      min="1"
                      max="30"
                      value={$settings.llm.autoUnloadMinutes}
                      oninput={(e) => settings.updateLlm({ autoUnloadMinutes: parseInt(e.currentTarget.value) })}
                      class="range-input"
                    />
                    <span class="slider-value">{$settings.llm.autoUnloadMinutes} min</span>
                  </div>
                </div>
              </div>

              <!-- Load/Unload Actions -->
              {#if $settings.llm.modelPath}
                <div class="setting-group">
                  <div class="model-actions">
                    {#if !$isModelLoaded && $llmStore.status !== "loading"}
                      <button class="action-btn primary" onclick={loadSelectedModel}>Load Model</button>
                    {:else if $llmStore.status === "loading"}
                      <button class="action-btn" disabled>Loading...</button>
                    {:else}
                      <button class="action-btn secondary" onclick={() => llmService.unloadModel().then(() => llmService.getStatus().then(info => llmStore.updateFromStatus(info)))}>Unload Model</button>
                    {/if}
                  </div>
                </div>
              {/if}

              <!-- Error display -->
              {#if $llmStore.error}
                <div class="setting-group">
                  <div class="error-banner">
                    <span>{$llmStore.error}</span>
                    <button class="error-dismiss" onclick={() => llmStore.setError(null)}>&times;</button>
                  </div>
                </div>
              {/if}
            {/if}
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(8px);
  }

  .settings-modal {
    width: 680px;
    max-height: 85vh;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .settings-header h3 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .settings-close {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 20px;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
  }

  .settings-close:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .settings-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .settings-tabs {
    width: 160px;
    border-right: 1px solid var(--border);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
  }

  .settings-tab {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    border: none;
    background: none;
    text-align: left;
    transition: all 0.12s ease;
  }

  .settings-tab:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .settings-tab.active {
    background: var(--bg-tertiary);
    color: var(--accent);
    font-weight: 500;
  }

  .settings-content {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .setting-group-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .setting-label {
    font-size: 13px;
    color: var(--text-primary);
  }

  .setting-desc {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .toggle {
    width: 36px;
    height: 20px;
    background: var(--border);
    border-radius: 10px;
    border: none;
    position: relative;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.2s;
    padding: 0;
  }

  .toggle.on {
    background: var(--accent);
  }

  .toggle::after {
    content: '';
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s;
  }

  .toggle.on::after {
    transform: translateX(16px);
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 180px;
  }

  .range-input {
    flex: 1;
    accent-color: var(--accent);
    height: 4px;
  }

  .slider-value {
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
    min-width: 40px;
    text-align: right;
  }

  .input-row {
    display: flex;
    gap: 8px;
  }

  .text-input {
    flex: 1;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 12px;
    color: var(--text-primary);
    outline: none;
  }

  .text-input:focus {
    border-color: var(--accent);
  }

  .browse-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-secondary);
    padding: 7px 12px;
    font-size: 12px;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.12s ease;
  }

  .browse-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .browse-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .field-label {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: -6px;
  }

  /* Model cards */
  .model-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .model-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    gap: 12px;
    cursor: pointer;
    transition: border-color 0.15s;
    position: relative;
  }

  .model-card:hover {
    border-color: var(--accent);
  }

  .model-card.selected {
    border-color: var(--accent);
    background: rgba(218, 119, 86, 0.06);
  }

  .recommended-badge {
    position: absolute;
    top: -1px;
    right: 12px;
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 9px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 0 0 4px 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .model-radio {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border);
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .model-radio.selected {
    border-color: var(--accent);
  }

  .model-radio.selected::after {
    content: '';
    width: 10px;
    height: 10px;
    background: var(--accent);
    border-radius: 50%;
  }

  .model-info {
    flex: 1;
    min-width: 0;
  }

  .model-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .model-meta {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .model-desc {
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 4px;
  }

  .model-tags {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }

  .tag {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(88, 166, 255, 0.15);
    color: #58a6ff;
    font-weight: 500;
  }

  .tag.tool {
    background: rgba(63, 185, 80, 0.15);
    color: #3fb950;
  }

  .model-action {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .download-btn {
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s;
  }

  .download-btn:hover {
    background: var(--accent-hover);
  }

  .download-btn.loaded {
    background: rgba(63, 185, 80, 0.15);
    color: #3fb950;
    cursor: default;
  }

  .model-size {
    font-size: 10px;
    color: var(--text-secondary);
  }

  /* Advanced section */
  .advanced-section {
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .advanced-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary);
    list-style: none;
  }

  .advanced-header::-webkit-details-marker {
    display: none;
  }

  .advanced-body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-top: 1px solid var(--border);
  }

  .warning-banner {
    background: rgba(210, 153, 34, 0.1);
    border: 1px solid rgba(210, 153, 34, 0.3);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    color: #d29922;
  }

  .server-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #3fb950;
    padding: 6px 10px;
    background: rgba(63, 185, 80, 0.08);
    border-radius: 6px;
  }

  .server-dot {
    width: 6px;
    height: 6px;
    background: #3fb950;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .model-actions {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s;
    border: none;
  }

  .action-btn.primary {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .action-btn.primary:hover {
    background: var(--accent-hover);
  }

  .action-btn.secondary {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .action-btn.secondary:hover {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    color: #ef4444;
    word-break: break-word;
  }

  .error-dismiss {
    background: none;
    border: none;
    color: #ef4444;
    cursor: pointer;
    font-size: 16px;
    padding: 0 4px;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .error-dismiss:hover {
    opacity: 1;
  }

  /* Download progress */
  .download-progress {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .progress-bar-track {
    width: 100%;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .progress-info {
    display: flex;
    gap: 8px;
    font-size: 10px;
    color: var(--text-secondary);
  }

  .progress-percent {
    color: var(--accent);
    font-weight: 600;
  }

  .progress-speed {
    margin-left: auto;
  }

  /* Action button group */
  .action-group {
    display: flex;
    gap: 4px;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.12s;
    padding: 0;
  }

  .icon-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
  }

  .icon-btn.pause:hover {
    border-color: #d29922;
    color: #d29922;
  }

  .icon-btn.cancel:hover {
    border-color: #ef4444;
    color: #ef4444;
  }

  .icon-btn.delete:hover {
    border-color: #ef4444;
    color: #ef4444;
  }

  .download-btn.resume {
    background: #d29922;
    color: var(--bg-primary);
  }

  .download-btn.resume:hover {
    background: #e3b341;
  }
</style>
