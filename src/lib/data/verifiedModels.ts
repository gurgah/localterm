export interface VerifiedModel {
  id: string;
  name: string;
  description: string;
  size: string;
  quantization: string;
  url: string;
  sha256: string;
  contextLength: number;
  supportsToolCalling: boolean;
  recommended: boolean;
  tags: string[];
}

export const VERIFIED_MODELS: VerifiedModel[] = [
  {
    id: "qwen3-4b-q4km",
    name: "Qwen3 4B",
    description:
      "Fast, general-purpose. Best for command suggestions and error detection.",
    size: "2.3 GB",
    quantization: "Q4_K_M",
    url: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/qwen3-4b-q4_k_m.gguf",
    sha256: "",
    contextLength: 4096,
    supportsToolCalling: true,
    recommended: true,
    tags: ["fast", "general", "tool-calling"],
  },
  {
    id: "phi-3.5-mini-q4km",
    name: "Phi-3.5 Mini 3.8B",
    description:
      "Strong reasoning for its size. Good at code analysis tasks.",
    size: "2.2 GB",
    quantization: "Q4_K_M",
    url: "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
    sha256: "",
    contextLength: 4096,
    supportsToolCalling: false,
    recommended: false,
    tags: ["reasoning", "code"],
  },
  {
    id: "llama-3.2-3b-q4km",
    name: "Llama 3.2 3B",
    description:
      "Meta's latest small model. Balanced speed and quality.",
    size: "1.9 GB",
    quantization: "Q4_K_M",
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    sha256: "",
    contextLength: 8192,
    supportsToolCalling: true,
    recommended: false,
    tags: ["balanced", "tool-calling"],
  },
];

export function getVerifiedModel(id: string): VerifiedModel | undefined {
  return VERIFIED_MODELS.find((m) => m.id === id);
}

export function getRecommendedModel(): VerifiedModel {
  return VERIFIED_MODELS.find((m) => m.recommended) ?? VERIFIED_MODELS[0];
}
