import { writable, derived } from "svelte/store";
import type { ClaudeState } from "../services/claudeDetector";

export interface Session {
  id: string;
  name: string;
  cwd: string;
  status: "active" | "waiting" | "idle" | "error" | "connecting" | "shell";
  claudeRunning: boolean;
}

function createSessionStore() {
  const { subscribe, set, update } = writable<Session[]>([]);

  return {
    subscribe,

    add: (name: string, cwd: string): string => {
      const id = crypto.randomUUID();
      update((sessions) => [
        ...sessions,
        { id, name, cwd, status: "shell", claudeRunning: false },
      ]);
      return id;
    },

    remove: (id: string) => {
      update((sessions) => sessions.filter((s) => s.id !== id));
    },

    setStatus: (id: string, status: Session["status"]) => {
      update((sessions) =>
        sessions.map((s) => (s.id === id ? { ...s, status } : s))
      );
    },

    setName: (id: string, name: string) => {
      update((sessions) =>
        sessions.map((s) => (s.id === id ? { ...s, name } : s))
      );
    },

    setCwd: (id: string, cwd: string) => {
      update((sessions) =>
        sessions.map((s) => (s.id === id ? { ...s, cwd } : s))
      );
    },

    setClaudeRunning: (id: string, claudeRunning: boolean) => {
      update((sessions) =>
        sessions.map((s) => (s.id === id ? { ...s, claudeRunning } : s))
      );
    },

    /**
     * Update session state from ClaudeDetector result
     */
    updateFromDetector: (id: string, state: ClaudeState) => {
      update((sessions) =>
        sessions.map((s) => {
          if (s.id !== id) return s;
          return {
            ...s,
            claudeRunning: state.isRunning,
            status: state.status,
          };
        })
      );
    },

    getById: (id: string, sessionsArray: Session[]): Session | undefined => {
      return sessionsArray.find((s) => s.id === id);
    },

    clear: () => set([]),
  };
}

export const sessions = createSessionStore();
export const activeSessionId = writable<string | null>(null);

// Derived: active session
export const activeSession = derived(
  [sessions, activeSessionId],
  ([$sessions, $activeSessionId]) =>
    $activeSessionId ? $sessions.find((s) => s.id === $activeSessionId) : null
);

// Derived: has sessions
export const hasSessions = derived(sessions, ($sessions) => $sessions.length > 0);
