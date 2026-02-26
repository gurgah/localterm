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
    id: "qwen3-4b-instruct-2507",
    name: "Qwen3 4B Instruct (Jul 2025)",
    description:
      "Best small model for tool calling. Fine-tuned for instruction following and tool use.",
    size: "2.5 GB",
    quantization: "Q4_K_M",
    url: "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    sha256: "",
    contextLength: 262144,
    supportsToolCalling: true,
    recommended: true,
    tags: ["fast", "tool-calling", "instruct"],
  },
];

export function getVerifiedModel(id: string): VerifiedModel | undefined {
  return VERIFIED_MODELS.find((m) => m.id === id);
}

export function getRecommendedModel(): VerifiedModel {
  return VERIFIED_MODELS.find((m) => m.recommended) ?? VERIFIED_MODELS[0];
}
