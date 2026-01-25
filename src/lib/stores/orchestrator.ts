import { writable, derived } from "svelte/store";

// Matches Claude Code SDK AskUserQuestion format
export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;      // Full question text
  header: string;        // Short label (max 12 chars)
  options: QuestionOption[];  // 2-4 choices
  multiSelect: boolean;  // Allow multiple selections
}

export interface AskUserQuestionInput {
  id: string;
  sessionId: string;
  sessionName: string;
  questions: Question[];
  timestamp: number;
}

export interface AskUserQuestionResponse {
  questions: Question[];
  answers: Record<string, string>;  // question text -> selected label(s)
}

function createOrchestratorStore() {
  const { subscribe, set, update } = writable<AskUserQuestionInput[]>([]);

  return {
    subscribe,

    // Add new AskUserQuestion request
    push: (request: Omit<AskUserQuestionInput, "id" | "timestamp">) => {
      const newRequest: AskUserQuestionInput = {
        ...request,
        id: Date.now().toString(),
        timestamp: Date.now(),
      };
      update((queue) => [...queue, newRequest]);
      return newRequest.id;
    },

    // Remove answered request
    resolve: (id: string) => {
      update((queue) => queue.filter((r) => r.id !== id));
    },

    // Clear all requests for a session
    clearSession: (sessionId: string) => {
      update((queue) => queue.filter((r) => r.sessionId !== sessionId));
    },

    // Clear all
    clear: () => set([]),
  };
}

export const orchestratorQueue = createOrchestratorStore();

// Derived: total pending count
export const pendingCount = derived(orchestratorQueue, ($queue) => $queue.length);

// Derived: sessions with pending inputs
export const pendingSessions = derived(orchestratorQueue, ($queue) =>
  [...new Set($queue.map(r => r.sessionId))]
);
