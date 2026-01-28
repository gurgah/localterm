import { writable, derived } from "svelte/store";
import type { AgentResponse } from "../agents/types";

export interface AgentResponseItem {
  id: string;
  sessionId: string;
  response: AgentResponse;
  timestamp: number;
  dismissed: boolean;
}

function createAgentResponseStore() {
  const { subscribe, update, set } = writable<AgentResponseItem[]>([]);

  return {
    subscribe,

    push(sessionId: string, response: AgentResponse): string {
      const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const item: AgentResponseItem = {
        id,
        sessionId,
        response,
        timestamp: Date.now(),
        dismissed: false,
      };
      update((items) => [...items, item]);
      return id;
    },

    dismiss(id: string) {
      update((items) =>
        items.map((item) =>
          item.id === id ? { ...item, dismissed: true } : item
        )
      );
    },

    remove(id: string) {
      update((items) => items.filter((item) => item.id !== id));
    },

    clearForSession(sessionId: string) {
      update((items) => items.filter((item) => item.sessionId !== sessionId));
    },

    clearAll() {
      set([]);
    },
  };
}

export const agentResponses = createAgentResponseStore();

export const activeAgentResponses = derived(agentResponses, ($responses) =>
  $responses.filter((r) => !r.dismissed)
);
