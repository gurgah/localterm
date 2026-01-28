# Local LLM Integration Plan — llama.cpp Embedded Runtime

## Summary

`claude-code-terminal` (Tauri/Svelte/Rust) uygulamasina **llama.cpp** gomulu olarak ekleniyor. Tek runtime, tum platformlar, sifir harici dependency. Apple Silicon'da Metal GPU + unified memory kullanimi. Sonrasinda `local-terminal` projesindeki expert agent sistemi port edilecek.

---

## Decision: Why llama.cpp?

| Kriter | llama.cpp | MLX | Ollama | llamafile |
|--------|-----------|-----|--------|-----------|
| Rust bindings | `llama-cpp-2` crate | Yok | N/A | N/A |
| Tum platformlar | macOS/Win/Linux | Sadece macOS | macOS/Win/Linux | macOS/Win/Linux |
| GPU acceleration | Metal + CUDA + Vulkan | Metal only | Metal + CUDA | CPU only (cosmopolitan) |
| Apple Silicon unified memory | Evet (Metal) | Evet | Evet (llama.cpp uzerinde) | Hayir |
| Harici dependency | Sifir (statik link) | Python + pip | 4.6 GB app kurulumu | Sidecar process |
| Performans vs Ollama | 1.3-1.8x hizli | 2-3x hizli | Baz | llama.cpp seviyesi |
| Build-time gereksinim | C++ compiler + CMake | N/A | N/A | N/A |

**Sonuc**: llama.cpp tek cozum — Rust bindings var, tum platformlar, GPU acceleration, unified memory, sifir runtime dependency.

MLX daha hizli ama sadece macOS + Python — Rust bindings yok.

---

## Architecture Plan

### 1. LLM Engine (Rust Backend — `llama-cpp-2` crate)

**`src-tauri/src/llm.rs`**:
```rust
pub struct LlmEngine {
    model: Option<LlamaModel>,
    ctx: Option<LlamaContext>,
    status: LlmStatus,      // idle/loading/ready/generating/error
    model_path: PathBuf,     // ~/.localterm/models/
}

impl LlmEngine {
    pub fn load_model(path: &Path) -> Result<Self>
    pub fn unload_model(&mut self)                    // 2 min idle auto-unload
    pub fn chat_completion(&self, messages: Vec<ChatMessage>,
                           stream_tx: Sender<String>) -> Result<String>
    pub fn classify(&self, input: &str) -> Result<ExpertType>  // 10 token classification
    pub fn status(&self) -> LlmStatus
}
```

**Cargo.toml**:
```toml
[dependencies]
llama-cpp-2 = { version = "0.1", features = [] }

[target.'cfg(target_os = "macos")'.dependencies]
llama-cpp-2 = { version = "0.1", features = ["metal"] }

[target.'cfg(target_os = "windows")'.dependencies]
llama-cpp-2 = { version = "0.1", features = ["vulkan"] }

[target.'cfg(target_os = "linux")'.dependencies]
llama-cpp-2 = { version = "0.1", features = ["vulkan"] }
```

**Platform GPU backends**:
- macOS Apple Silicon → **Metal** (unified memory, GPU acceleration)
- macOS Intel → CPU only
- Windows → **Vulkan** (NVIDIA + AMD + Intel)
- Linux → **Vulkan** (NVIDIA + AMD + Intel)

> Not: CUDA yerine Vulkan — tek backend ile tum GPU'lar desteklenir, CUDA Toolkit (4GB+) gerektirmez.

### 2. Model Management

**Model deposu**: `~/.localterm/models/`

**Varsayilan model**: Qwen3-4B Q4_K_M (2.3 GB GGUF)
- local-terminal'de fine-tuned versiyon 98% accuracy
- ChatML prompt format
- Terminal komutlari icin optimize

**Model indirme**:
- HuggingFace'den GGUF indirme (HTTP range requests ile resume destegi)
- Progress bar UI
- Checksum dogrulama

**Auto-unload**: 2 dakika idle sonrasi modeli bellekten cikar (local-terminal'deki gibi)

### 3. Tauri Commands (IPC Bridge)

**`src-tauri/src/commands.rs`** — yeni komutlar:
```rust
#[tauri::command]
async fn llm_load_model(path: String) -> Result<(), String>

#[tauri::command]
async fn llm_unload_model() -> Result<(), String>

#[tauri::command]
async fn llm_chat(messages: Vec<ChatMessage>, session_id: String) -> Result<(), String>
// Streaming: Tauri event "llm-token" ile token token gonderir

#[tauri::command]
async fn llm_classify(input: String) -> Result<String, String>

#[tauri::command]
async fn llm_status() -> Result<LlmStatus, String>

#[tauri::command]
async fn llm_download_model(url: String) -> Result<(), String>
// Progress: Tauri event "llm-download-progress"
```

### 4. Frontend Service (TS)

**`src/lib/services/llmService.ts`**:
```typescript
export const llmService = {
  loadModel(path: string): Promise<void>,
  unloadModel(): Promise<void>,
  chat(messages: ChatMessage[], onToken: (token: string) => void): Promise<string>,
  classify(input: string): Promise<ExpertType>,
  getStatus(): Promise<LlmStatus>,
  downloadModel(url: string, onProgress: (pct: number) => void): Promise<void>,
};
```

### 5. Claude Code + Local Model Integration

Claude Code'u local modele yonlendirmek icin PTY session'a env var inject:

**`src-tauri/src/pty.rs`** degisiklik:
```rust
// Settings'den local model aktifse:
if settings.use_local_for_claude {
    cmd.env("ANTHROPIC_BASE_URL", "http://localhost:PORT");
    cmd.env("ANTHROPIC_AUTH_TOKEN", "localterm");
}
```

> Not: llama.cpp embedded oldugu icin, bir HTTP server katmani gerekiyor (OpenAI-compatible).
> Ya `llama-server` sidecar olarak calistirilir, ya da minimal Rust HTTP server (axum/actix) ile `/v1/chat/completions` endpoint expose edilir.

**Onerilen**: Minimal Rust HTTP server (axum) — uygulama icinde, extra process yok:
```rust
// axum ile OpenAI-compatible endpoint
// localhost:PORT/v1/chat/completions
// Claude Code bu endpoint'e baglanir
```

### 6. Expert Agent System (Port from local-terminal)

**`src/lib/agents/`** dizini:
```
src/lib/agents/
  ├── types.ts          — AgentResponse, TerminalContext, ProposedAction, ExpertType
  ├── orchestrator.ts   — Agent koordinasyonu, cross-expert consultation
  ├── router.ts         — IntentRouter (7 seviye)
  │                       1. Exact shortcut (c→commit, f→find, ?→command)
  │                       2. Log paste detection (3+ satir timestamp)
  │                       3. Direct command check (ls, cd, npm...)
  │                       4. Keyword matching (expert basina)
  │                       5. LLM fallback (10 token classification)
  │                       6. Natural language detection
  │                       7. Passthrough (normal komut)
  ├── experts/
  │   ├── errorExpert.ts    — 31+ regex pattern, LLM fallback, fix onerileri
  │   ├── commandExpert.ts  — 93 hazir pattern + LLM generation
  │   ├── gitExpert.ts      — commit msg gen, status parsing, push/pull
  │   └── fileSearchExpert.ts — fd/rg + find/grep fallback, NL query
  └── integration.ts    — Terminal ↔ Agent bridge
```

### 7. UI Integration

**Orchestrator panelinde** (buyuk responses):
- Agent response cards (error fix, git commit, proje analizi)
- Action buttons (Run, Edit, Cancel)
- LLM status indicator (loading/ready/generating)
- Model download progress bar

**Terminal inline** (kucuk responses):
- Command suggestions (ANSI renkli)
- Error hints (typo correction, install suggestion)
- Autocomplete (106 komut, 20 git subcommand, path completion)

### 8. Settings

```typescript
interface LlmSettings {
  enabled: boolean;
  modelPath: string;           // ~/.localterm/models/qwen3-4b-q4.gguf
  autoLoadModel: boolean;      // App acilinca modeli yukle
  autoUnloadMinutes: number;   // Idle timeout (default: 2)
  useForClaudeCode: boolean;   // Claude Code'u local modele yonlendir
  gpuLayers: number;           // Metal/Vulkan GPU layer sayisi (-1 = all)
  contextLength: number;       // Default: 4096
}
```

---

## File Changes

### New Files

| Dosya | Amac |
|-------|------|
| `src-tauri/src/llm.rs` | LlmEngine — llama-cpp-2 wrapper, model load/unload, chat, classify |
| `src-tauri/src/llm_server.rs` | Minimal axum HTTP server (OpenAI-compatible, Claude Code icin) |
| `src-tauri/src/model_manager.rs` | Model download, cache, checksum |
| `src/lib/services/llmService.ts` | Frontend LLM service (Tauri IPC) |
| `src/lib/agents/types.ts` | Agent type definitions |
| `src/lib/agents/orchestrator.ts` | Agent koordinasyonu |
| `src/lib/agents/router.ts` | IntentRouter (7 seviye) |
| `src/lib/agents/experts/errorExpert.ts` | Error detection + fix |
| `src/lib/agents/experts/commandExpert.ts` | NL → shell command |
| `src/lib/agents/experts/gitExpert.ts` | Git workflow |
| `src/lib/agents/experts/fileSearchExpert.ts` | File search |
| `src/lib/agents/integration.ts` | Terminal ↔ Agent bridge |
| `src/lib/stores/llm.ts` | LLM state store |
| `src/lib/components/LlmStatus.svelte` | LLM status indicator |
| `src/lib/components/ModelDownload.svelte` | Model download UI |
| `src/lib/components/AgentResponse.svelte` | Agent response card |

### Modified Files

| Dosya | Degisiklik |
|-------|-----------|
| `src-tauri/Cargo.toml` | `llama-cpp-2`, `axum`, `tokio` dependencies |
| `src-tauri/src/lib.rs` | LlmEngine state, yeni commands register |
| `src-tauri/src/commands.rs` | LLM Tauri commands |
| `src-tauri/src/pty.rs` | ANTHROPIC_BASE_URL env var inject |
| `src/App.svelte` | LLM status, agent panel toggle |
| `src/lib/components/Orchestrator.svelte` | Agent response gosterimi |
| `src/lib/components/Terminal.svelte` | Error detection → agent trigger |
| `src/lib/stores/settings.ts` | LLM settings |

---

## Implementation Order

### Phase 1: LLM Engine (Rust)
1. `Cargo.toml` — llama-cpp-2 dependency + platform feature flags
2. `llm.rs` — LlmEngine: model load, chat completion, streaming, auto-unload
3. `commands.rs` — Tauri IPC commands (load, chat, status)
4. `model_manager.rs` — GGUF model download + cache
5. Build test: macOS Metal, verify GPU acceleration works

### Phase 2: Frontend + Model UI
6. `llmService.ts` — Tauri IPC client
7. `llm.ts` store — state management
8. `ModelDownload.svelte` — Download progress UI
9. `LlmStatus.svelte` — Status indicator
10. Settings UI — model path, GPU layers, context length

### Phase 3: Claude Code Local Model
11. `llm_server.rs` — Minimal axum OpenAI-compatible HTTP server
12. `pty.rs` — ANTHROPIC_BASE_URL env var inject
13. Settings toggle — "Use local model for Claude Code"
14. Test: Claude Code → local model ile calismasi

### Phase 4: Expert Agents
15. Agent types + orchestrator + router
16. ErrorExpert (31+ pattern, LLM fallback)
17. CommandExpert (93 pattern + LLM generation)
18. GitExpert (commit msg, status, diff)
19. FileSearchExpert (fd/rg + NL query)
20. Terminal ↔ Agent integration
21. Agent response UI (Orchestrator + inline)

---

## Build & CI/CD

### GitHub Actions Changes

```yaml
# macOS build
- name: Build (macOS)
  run: cargo build --release --features metal

# Windows build
- name: Build (Windows)
  run: cargo build --release --features vulkan

# Linux build
- name: Build (Linux)
  run: cargo build --release --features vulkan
```

**Ek gereksinimler**:
- macOS runner: Xcode CLT + CMake (mevcut)
- Windows runner: MSVC + CMake + Vulkan SDK
- Linux runner: GCC + CMake + Vulkan SDK (libvulkan-dev)

### Build Time Impact
- llama.cpp C++ compilation: +2-5 min (clean build)
- Incremental build: minimal etki (C++ kodu nadiren degisir)
- `[profile.dev.package.llama-cpp-sys-2] opt-level = 3` — debug build'de bile optimize

---

## Performance Expectations

| Platform | GPU Backend | 4B Q4 Model | 7B Q4 Model |
|----------|------------|-------------|-------------|
| macOS M1/M2/M3/M4 | Metal (unified mem) | 40-80 tok/s | 25-50 tok/s |
| macOS Intel | CPU only | 5-15 tok/s | 3-8 tok/s |
| Windows (RTX 3060+) | Vulkan | 30-60 tok/s | 20-40 tok/s |
| Linux (RTX 3060+) | Vulkan | 30-60 tok/s | 20-40 tok/s |
| Windows/Linux (CPU) | CPU | 5-15 tok/s | 3-8 tok/s |

> Ollama ayni modellerde 1.3-1.8x daha yavas (HTTP overhead + model management).

---

## Test Plan

1. Model load/unload (tum platformlar)
2. Metal GPU acceleration (Apple Silicon)
3. Vulkan GPU acceleration (Windows/Linux)
4. Streaming token generation
5. Auto-unload (2 min idle)
6. Model download + resume
7. Claude Code → local model (axum HTTP server)
8. Error detection → fix onerisi
9. Command generation → execution
10. Git commit message generation
11. Memory kullanimi (unified memory dogrulama)

---

## References

- llama-cpp-2 crate: https://crates.io/crates/llama-cpp-2
- llama.cpp: https://github.com/ggml-org/llama.cpp
- llama.cpp Apple Silicon benchmarks: https://github.com/ggml-org/llama.cpp/discussions/4167
- llama.cpp vs Ollama comparison: https://www.openxcell.com/blog/llama-cpp-vs-ollama/
- tauri-local-lm (example project): https://github.com/dillondesilva/tauri-local-lm
- local-terminal source: /Users/drs/Code/local-terminal
