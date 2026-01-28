use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use llama_cpp_2::sampling::LlamaSampler;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::mpsc;

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LlmStatus {
    Idle,
    Loading,
    Ready,
    Generating,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "system", "user", "assistant"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmStatusInfo {
    pub status: LlmStatus,
    pub model_name: Option<String>,
    pub model_path: Option<String>,
    pub error: Option<String>,
}

// ── Internal State ─────────────────────────────────────────────────────────

struct LlmInner {
    backend: Option<LlamaBackend>,
    model: Option<LlamaModel>,
    status: LlmStatus,
    model_path: Option<PathBuf>,
    model_name: Option<String>,
    error: Option<String>,
    last_use: Instant,
}

// ── LLM Engine ─────────────────────────────────────────────────────────────

pub struct LlmEngine {
    inner: Arc<Mutex<LlmInner>>,
    stop_requested: Arc<AtomicBool>,
    models_dir: PathBuf,
}

impl LlmEngine {
    pub fn new() -> Self {
        let models_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".localterm")
            .join("models");

        let _ = std::fs::create_dir_all(&models_dir);

        Self {
            inner: Arc::new(Mutex::new(LlmInner {
                backend: None,
                model: None,
                status: LlmStatus::Idle,
                model_path: None,
                model_name: None,
                error: None,
                last_use: Instant::now(),
            })),
            stop_requested: Arc::new(AtomicBool::new(false)),
            models_dir,
        }
    }

    pub fn models_dir(&self) -> &Path {
        &self.models_dir
    }

    /// Load a GGUF model from disk
    pub fn load_model(&self, path: &str) -> Result<(), String> {
        let model_path = PathBuf::from(path);

        if !model_path.exists() {
            return Err(format!("Model file not found: {}", path));
        }

        {
            let mut inner = self.inner.lock();
            if inner.status == LlmStatus::Loading {
                return Err("Already loading a model".to_string());
            }
            inner.status = LlmStatus::Loading;
            inner.error = None;
        }

        let backend = LlamaBackend::init()
            .map_err(|e| format!("Failed to init llama backend: {}", e))?;

        let model_params = LlamaModelParams::default().with_n_gpu_layers(1000);

        let model = LlamaModel::load_from_file(&backend, &model_path, &model_params).map_err(
            |e| {
                let mut inner = self.inner.lock();
                inner.status = LlmStatus::Error;
                inner.error = Some(format!("Model load failed: {}", e));
                format!("Failed to load model: {}", e)
            },
        )?;

        let model_name = model_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        {
            let mut inner = self.inner.lock();
            inner.backend = Some(backend);
            inner.model = Some(model);
            inner.status = LlmStatus::Ready;
            inner.model_path = Some(model_path);
            inner.model_name = Some(model_name);
            inner.error = None;
            inner.last_use = Instant::now();
        }

        eprintln!("[LlmEngine] Model loaded successfully from {}", path);
        Ok(())
    }

    /// Unload the current model to free memory
    pub fn unload_model(&self) {
        let mut inner = self.inner.lock();
        inner.model = None;
        inner.backend = None;
        inner.status = LlmStatus::Idle;
        inner.model_path = None;
        inner.model_name = None;
        inner.error = None;
        eprintln!("[LlmEngine] Model unloaded");
    }

    /// Get current status
    pub fn status(&self) -> LlmStatusInfo {
        let inner = self.inner.lock();
        LlmStatusInfo {
            status: inner.status.clone(),
            model_name: inner.model_name.clone(),
            model_path: inner
                .model_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            error: inner.error.clone(),
        }
    }

    /// Request generation stop
    pub fn stop_generation(&self) {
        self.stop_requested.store(true, Ordering::SeqCst);
    }

    /// Check and perform auto-unload if idle for too long
    pub fn check_auto_unload(&self, timeout_secs: u64) {
        let mut inner = self.inner.lock();
        if inner.status == LlmStatus::Ready {
            let elapsed = inner.last_use.elapsed().as_secs();
            if elapsed >= timeout_secs {
                eprintln!(
                    "[LlmEngine] Auto-unloading model after {}s idle",
                    elapsed
                );
                inner.model = None;
                inner.backend = None;
                inner.status = LlmStatus::Idle;
                inner.model_path = None;
                inner.model_name = None;
            }
        }
    }

    /// Generate a chat completion with streaming tokens via channel.
    /// This function is blocking — call from spawn_blocking.
    pub fn chat_completion(
        &self,
        messages: Vec<ChatMessage>,
        max_tokens: i32,
        _temperature: f32,
        token_tx: mpsc::UnboundedSender<String>,
    ) -> Result<String, String> {
        let prompt = format_chatml(&messages);

        // Hold lock for entire generation (context borrows model/backend)
        let mut inner = self.inner.lock();

        if inner.model.is_none() {
            return Err("No model loaded".to_string());
        }
        if inner.status == LlmStatus::Generating {
            return Err("Already generating".to_string());
        }

        inner.status = LlmStatus::Generating;
        inner.last_use = Instant::now();
        self.stop_requested.store(false, Ordering::SeqCst);

        // Generation scope — ctx borrows model/backend, must end before mutating inner
        let full_response = {
            let backend = inner.backend.as_ref().ok_or("No backend")?;
            let model = inner.model.as_ref().ok_or("No model")?;

            let ctx_params =
                LlamaContextParams::default().with_n_ctx(std::num::NonZeroU32::new(4096));

            let mut ctx = model
                .new_context(backend, ctx_params)
                .map_err(|e| format!("Failed to create context: {}", e))?;

            let tokens_list = model
                .str_to_token(&prompt, AddBos::Always)
                .map_err(|e| format!("Tokenization failed: {}", e))?;

            let mut batch = LlamaBatch::new(512, 1);
            let last_index = tokens_list.len() as i32 - 1;

            for (i, token) in (0_i32..).zip(tokens_list.into_iter()) {
                let is_last = i == last_index;
                batch
                    .add(token, i, &[0], is_last)
                    .map_err(|e| format!("Batch add failed: {}", e))?;
            }

            ctx.decode(&mut batch)
                .map_err(|e| format!("Prompt decode failed: {}", e))?;

            let mut n_cur = batch.n_tokens();
            let n_len = n_cur + max_tokens;

            let mut sampler = LlamaSampler::greedy();
            let mut response = String::new();

            while n_cur <= n_len {
                if self.stop_requested.load(Ordering::SeqCst) {
                    break;
                }

                let token = sampler.sample(&ctx, batch.n_tokens() - 1);
                sampler.accept(token);

                if token == model.token_eos() {
                    break;
                }

                let piece = model
                    .token_to_str(token, Special::Tokenize)
                    .unwrap_or_default();

                if !piece.is_empty() {
                    response.push_str(&piece);
                    let _ = token_tx.send(piece);
                }

                batch.clear();
                batch
                    .add(token, n_cur, &[0], true)
                    .map_err(|e| format!("Batch add failed: {}", e))?;

                n_cur += 1;

                ctx.decode(&mut batch)
                    .map_err(|e| format!("Decode failed: {}", e))?;
            }

            response
        }; // ctx, model ref, backend ref dropped here

        // Now safe to mutate inner
        inner.status = if inner.model.is_some() {
            LlmStatus::Ready
        } else {
            LlmStatus::Idle
        };
        inner.last_use = Instant::now();

        Ok(full_response)
    }

    /// Quick classification — generates a short response for intent routing
    pub fn classify(&self, input: &str) -> Result<String, String> {
        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: CLASSIFY_SYSTEM_PROMPT.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: input.to_string(),
            },
        ];

        let (tx, _rx) = mpsc::unbounded_channel();
        self.chat_completion(messages, 10, 0.1, tx)
    }

    /// List available GGUF models in the models directory
    pub fn list_models(&self) -> Vec<String> {
        let mut models = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&self.models_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("gguf") {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        models.push(name.to_string());
                    }
                }
            }
        }
        models.sort();
        models
    }
}

// ── ChatML Formatting ──────────────────────────────────────────────────────

fn format_chatml(messages: &[ChatMessage]) -> String {
    let mut prompt = String::new();
    for msg in messages {
        prompt.push_str(&format!(
            "<|im_start|>{}\n{}<|im_end|>\n",
            msg.role, msg.content
        ));
    }
    prompt.push_str("<|im_start|>assistant\n");
    prompt
}

// ── System Prompts ─────────────────────────────────────────────────────────

const CLASSIFY_SYSTEM_PROMPT: &str = r#"You are a terminal intent classifier. Given user input, respond with ONLY one word:
- "error" if it's an error message or stack trace
- "git" if it's about git operations
- "file" if it's about finding files
- "command" if it's a natural language command request
- "passthrough" if it's a direct shell command

Respond with ONLY the category word, nothing else."#;

pub const TERMINAL_SYSTEM_PROMPT: &str = r#"You are a terminal AI assistant. Your job is to help users with command-line tasks.

IMPORTANT RULES:
1. When the user asks how to do something, respond with ONLY the command they need
2. If you need to explain, be VERY brief (1-2 sentences max)
3. Format commands in a code block
4. For macOS/Unix/Linux commands
5. If multiple steps needed, show them numbered

RESPONSE FORMAT:
- For simple tasks: Just the command
- For complex tasks: Brief explanation + numbered commands"#;
