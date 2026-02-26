import { writable, derived } from "svelte/store";
import type { LlmStatus, LlmStatusInfo } from "../services/llmService";

export interface LlmState {
  status: LlmStatus;
  modelName: string | null;
  modelPath: string | null;
  error: string | null;
  downloadPercent: number | null;
  downloadSpeedMbps: number | null;
  downloadedBytes: number | null;
  downloadTotalBytes: number | null;
  downloadingModelId: string | null;
}

const DEFAULT_STATE: LlmState = {
  status: "idle",
  modelName: null,
  modelPath: null,
  error: null,
  downloadPercent: null,
  downloadSpeedMbps: null,
  downloadedBytes: null,
  downloadTotalBytes: null,
  downloadingModelId: null,
};

function createLlmStore() {
  const { subscribe, set, update } = writable<LlmState>(DEFAULT_STATE);

  return {
    subscribe,

    updateFromStatus(info: LlmStatusInfo) {
      update((s) => ({
        ...s,
        status: info.status,
        modelName: info.model_name,
        modelPath: info.model_path,
        error: info.error,
      }));
    },

    setStatus(status: LlmStatus) {
      update((s) => ({ ...s, status }));
    },

    setError(error: string | null) {
      update((s) => ({ ...s, error, status: error ? "error" : s.status }));
    },

    setDownloadProgress(percent: number, speedMbps: number, downloaded?: number, total?: number | null) {
      update((s) => ({
        ...s,
        downloadPercent: percent,
        downloadSpeedMbps: speedMbps,
        downloadedBytes: downloaded ?? s.downloadedBytes,
        downloadTotalBytes: total !== undefined ? (total ?? s.downloadTotalBytes) : s.downloadTotalBytes,
      }));
    },

    setDownloadingModel(modelId: string | null) {
      update((s) => ({ ...s, downloadingModelId: modelId }));
    },

    clearDownloadProgress() {
      update((s) => ({
        ...s,
        downloadPercent: null,
        downloadSpeedMbps: null,
        downloadedBytes: null,
        downloadTotalBytes: null,
        downloadingModelId: null,
      }));
    },

    reset() {
      set(DEFAULT_STATE);
    },
  };
}

export const llmStore = createLlmStore();

// Derived stores
export const isModelLoaded = derived(
  llmStore,
  ($llm) => $llm.status === "ready" || $llm.status === "generating"
);

export const isGenerating = derived(
  llmStore,
  ($llm) => $llm.status === "generating"
);

export const isDownloading = derived(
  llmStore,
  ($llm) => $llm.downloadPercent !== null && $llm.downloadPercent < 100
);
