import { writable } from "svelte/store";

export interface LlmSettings {
  enabled: boolean;
  modelTier: "verified" | "custom";
  selectedVerifiedModel: string; // verified model ID
  customModelPath: string;
  toolCallingEnabled: boolean;
  modelPath: string; // resolved path (set after download/selection)
  autoLoadModel: boolean;
  autoUnloadMinutes: number;
  useForClaudeCode: boolean;
  gpuLayers: number; // -1 = all
  contextLength: number;
}

export interface Settings {
  defaultLocation: string;
  showOrchestrator: boolean;
  fontSize: number;
  llm: LlmSettings;
}

const STORAGE_KEY = "localterm-settings";
const DEFAULT_LLM_SETTINGS: LlmSettings = {
  enabled: false,
  modelTier: "verified",
  selectedVerifiedModel: "qwen3-4b-q4km",
  customModelPath: "",
  toolCallingEnabled: true,
  modelPath: "",
  autoLoadModel: false,
  autoUnloadMinutes: 2,
  useForClaudeCode: false,
  gpuLayers: -1,
  contextLength: 4096,
};

const DEFAULT_SETTINGS: Settings = {
  defaultLocation: "",
  showOrchestrator: true,
  fontSize: 13,
  llm: DEFAULT_LLM_SETTINGS,
};

function loadSettings(): Settings {
  if (typeof localStorage === "undefined") {
    return DEFAULT_SETTINGS;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: Settings) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

function createSettingsStore() {
  const initial = loadSettings();
  const { subscribe, set, update } = writable<Settings>(initial);

  return {
    subscribe,

    setDefaultLocation: (path: string) => {
      update((s) => {
        const newSettings = { ...s, defaultLocation: path };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    setShowOrchestrator: (show: boolean) => {
      update((s) => {
        const newSettings = { ...s, showOrchestrator: show };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    increaseFontSize: () => {
      update((s) => {
        const next = { ...s, fontSize: Math.min(s.fontSize + 1, 24) };
        saveSettings(next);
        return next;
      });
    },

    decreaseFontSize: () => {
      update((s) => {
        const next = { ...s, fontSize: Math.max(s.fontSize - 1, 8) };
        saveSettings(next);
        return next;
      });
    },

    resetFontSize: () => {
      update((s) => {
        const next = { ...s, fontSize: 13 };
        saveSettings(next);
        return next;
      });
    },

    updateLlm: (partial: Partial<LlmSettings>) => {
      update((s) => {
        const newSettings = { ...s, llm: { ...s.llm, ...partial } };
        saveSettings(newSettings);
        return newSettings;
      });
    },

    reset: () => {
      saveSettings(DEFAULT_SETTINGS);
      set(DEFAULT_SETTINGS);
    },
  };
}

export const settings = createSettingsStore();
