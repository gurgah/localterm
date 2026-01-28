# Local LLM Research — LocalTerm AI

Tarih: 2026-01-27

---

## 1. Platform Bazli LLM Runtime Karsilastirmasi

| Cozum | Platform | Performans | Dependency | API |
|-------|----------|-----------|------------|-----|
| **MLX (vllm-mlx)** | macOS Apple Silicon only | 230-464 tok/s | Python + pip | OpenAI `/v1` |
| **Ollama** | macOS/Win/Linux | 20-40 tok/s | Ollama app | OpenAI `/v1` |
| **llamafile** | macOS/Win/Linux/BSD | llama.cpp seviyesi | **Sifir** (tek dosya) | OpenAI `/v1` |
| **llama-cpp-2 (Rust)** | macOS/Win/Linux | llama.cpp | C++ compiler (build-time) | Native |
| **mistral.rs** | macOS/Win/Linux | Degisken | Pure Rust | Native |
| **LM Studio** | macOS/Win/Linux | MLX (Mac) + llama.cpp | App kurulumu | OpenAI `/v1` |

### MLX Detaylari (Apple Silicon)
- Apple'in kendi ML framework'u, unified memory + Metal GPU
- M5 chip ile 4x speedup (vs M4) — time-to-first-token
- M5: 14B model < 10s TTFT, 30B MoE < 3s TTFT
- Qwen, Mistral, Llama, GPT-OSS modelleri MLX formatinda mevcut
- vllm-mlx: OpenAI-compatible server, 400+ tok/s, MCP tool calling
- **Kaynak**: https://machinelearning.apple.com/research/exploring-llms-mlx-m5
- **Benchmark**: https://arxiv.org/abs/2511.05502

### Ollama Detaylari
- llama.cpp uzerine kurulu, kolay kullanim
- `localhost:11434/v1` OpenAI-compatible endpoint
- Streaming, tool calling destegi
- **Ollama v0.14.0+ Anthropic Messages API destegi** — Claude Code direkt baglanabiliyor
- Concurrent request batching (vLLM benzeri)
- **Kaynak**: https://docs.ollama.com/api/openai-compatibility
- **Claude blog**: https://ollama.com/blog/claude

### llamafile Detaylari (Zero Dependency)
- Mozilla projesi, Cosmopolitan Libc + llama.cpp
- **Tek executable** — model gomulu veya yaninda
- 6 OS destegi: macOS, Windows, Linux, FreeBSD, OpenBSD, NetBSD
- AMD64 + ARM64 ayni dosyada
- OpenAI-compatible API: `localhost:8080/v1`
- Web GUI + CLI + API server
- LocalScore benchmark araci dahil
- **Kaynak**: https://github.com/mozilla-ai/llamafile

### Rust Crate Secenekleri
- `llama_cpp` — High-level bindings, Rust 1.73+
- `llama-cpp-2` — Low-level bindings, bindgen + clang gerekli
- `rustformers/llm` — ARSIVLENMIS, artik maintain edilmiyor
- **Alternatifler**: mistral.rs (quantized, Metal+CUDA), Ratchet (wgpu-based)
- **Kaynak**: https://crates.io/crates/llama-cpp-2

---

## 2. Ollama Claude Code Entegrasyonu

Ollama v0.14.0+ Anthropic Messages API uyumlulugu sagliyor:

```bash
# Claude Code'u Ollama'ya bagla
export ANTHROPIC_AUTH_TOKEN=ollama
export ANTHROPIC_BASE_URL=http://localhost:11434

# Sonra normal claude calistir
claude
```

**Desteklenen Modeller**:
- `gpt-oss:20b` (local)
- `qwen3-coder` (local)
- `glm-4.7:cloud` (cloud via ollama.com)
- `minimax-m2.1:cloud` (cloud via ollama.com)

**Onerilen**: 32K+ context length modeller

**Desteklenen Ozellikler**:
- Messages + multi-turn conversations
- Streaming
- System prompts
- Tool calling / function calling
- Extended thinking
- Vision (image input)

---

## 3. local-terminal Projesinden Port Edilecek Sistem

### LLMEngine (Swift → Rust/TS)
- Model: Fine-tuned Qwen3-4B (4-bit, 2.3GB)
- 98% accuracy on terminal commands (388 training examples)
- ChatML prompt format
- Streaming generation with auto-unload (2 min idle)
- Download progress tracking

### Expert Agent Sistemi (Swift → TS)
7 expert agent + orchestrator + router:

| Agent | Amac | Anahtar Ozellik |
|-------|------|-----------------|
| ErrorExpert | Hata tespit + fix onerisi | 31+ regex pattern, LLM fallback, web search cascade |
| CommandExpert | Dogal dil → shell komutu | 93 hazir pattern + LLM generation |
| GitExpert | Git workflow | Commit msg generation, status parsing, push/pull |
| FileSearchExpert | Dosya arama | fd/rg + find/grep fallback, NL query parsing |
| ProjectExpert | Proje analizi | package.json/Cargo.toml parsing, LOC sayimi |
| LogExpert | Log analizi | Timestamp/level detection, pattern grouping |
| WebSearchExpert | Web arama | DuckDuckGo API, query optimization |

### IntentRouter (7 seviyeli)
1. Exact shortcut (c→git commit, f→find, ?→command)
2. Log paste detection (3+ satir timestamp)
3. Direct command check (ls, cd, npm, docker...)
4. Keyword matching (expert basina keyword listesi)
5. LLM fallback (10 token classification)
6. Natural language detection (soru kelimeleri, Turkce)
7. Passthrough (normal terminal komutu)

### Autocomplete Engine
- 106 hazir komut, 20 git subcommand
- Komut-spesifik flag onerileri
- Path completion
- History-based (son 100 komut)
- 300ms debounce

### Error Detection
- 31 typo correction (gti→git, sl→ls, nom→npm...)
- Install suggestions (python→brew install python)
- Dangerous command detection (rm, chmod, sudo)
- Multi-phase recovery: Pattern → LLM → Web Search → Fallback

---

## 4. Karar: llama.cpp Embedded (Final)

### Neden llama.cpp?
- **Tek runtime** tum platformlar icin (macOS/Windows/Linux)
- **Rust bindings**: `llama-cpp-2` crate — statik link, sifir runtime dependency
- **GPU acceleration**: Metal (Apple Silicon unified memory), Vulkan (Windows/Linux)
- **Performans**: Ollama'dan 1.3-1.8x hizli (Ollama zaten llama.cpp uzerine kurulu)
- **App size**: +90 MB (vs Ollama 4.6 GB harici kurulum)

### Neden MLX Degil?
- MLX sadece macOS + Python — **Rust bindings yok**
- llama.cpp Metal backend ile Apple Silicon unified memory'yi ayni sekilde kullaniyor
- MLX daha hizli (sustained throughput) ama cross-platform degil

### Neden Ollama Degil?
- Ollama = llama.cpp + HTTP overhead + model management abstraction
- 1.3-1.8x yavas, 50% fazla RAM, 4.6 GB harici kurulum
- Kullanicinin ayrica yuklemesi gerekiyor

### Mimari
```
Tauri App (Rust)
  └── llama-cpp-2 (statik link)
      ├── Metal backend (macOS Apple Silicon)
      ├── Vulkan backend (Windows/Linux)
      └── CPU fallback (macOS Intel, GPU olmayan sistemler)
```

### Cargo.toml Feature Flags
```toml
[target.'cfg(target_os = "macos")'.dependencies]
llama-cpp-2 = { version = "0.1", features = ["metal"] }

[target.'cfg(target_os = "windows")'.dependencies]
llama-cpp-2 = { version = "0.1", features = ["vulkan"] }

[target.'cfg(target_os = "linux")'.dependencies]
llama-cpp-2 = { version = "0.1", features = ["vulkan"] }
```

### Claude Code Entegrasyonu
- Uygulama icinde axum HTTP server (OpenAI-compatible `/v1/chat/completions`)
- PTY session'a `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` env var inject
- Claude Code otomatik olarak local modele baglanir
- Settings'den acilip kapatilabilir

### Uygulama Sirasi
1. LLM Engine (Rust — llama-cpp-2, model load/unload, streaming chat)
2. Frontend + Model UI (download, status, settings)
3. Claude Code local model (axum HTTP server + PTY env var inject)
4. Expert Agents (ErrorExpert, CommandExpert, GitExpert, FileSearchExpert)
