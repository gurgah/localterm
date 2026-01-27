import { writable } from "svelte/store";

export interface Settings {
  defaultLocation: string;
  showOrchestrator: boolean;
  fontSize: number;
}

const STORAGE_KEY = "localterm-settings";
const DEFAULT_SETTINGS: Settings = {
  defaultLocation: "",
  showOrchestrator: true,
  fontSize: 13,
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

    reset: () => {
      saveSettings(DEFAULT_SETTINGS);
      set(DEFAULT_SETTINGS);
    },
  };
}

export const settings = createSettingsStore();
