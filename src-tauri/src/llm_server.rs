use crate::llm::{ChatMessage, LlmEngine};
use axum::{
    extract::State,
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio_stream::wrappers::UnboundedReceiverStream;

/// Port for the local API server
pub const DEFAULT_PORT: u16 = 11435;

// ══════════════════════════════════════════════════════════════════════════════
// Server State
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
struct ServerState {
    engine: Arc<LlmEngine>,
    tool_calling_enabled: Arc<AtomicBool>,
}

// ══════════════════════════════════════════════════════════════════════════════
// Anthropic Messages API Types
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
struct AnthropicRequest {
    #[allow(dead_code)]
    model: Option<String>,
    max_tokens: i32,
    #[serde(default)]
    system: Option<serde_json::Value>,
    #[serde(default)]
    tools: Option<Vec<AnthropicTool>>,
    messages: Vec<AnthropicMessage>,
    #[serde(default)]
    stream: Option<bool>,
    #[serde(default)]
    temperature: Option<f32>,
}

#[derive(Debug, Deserialize)]
struct AnthropicTool {
    name: String,
    #[serde(default)]
    description: Option<String>,
    input_schema: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct AnthropicMessage {
    role: String,
    content: serde_json::Value, // string or array of content blocks
}

// ── Response types ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct AnthropicResponse {
    id: String,
    #[serde(rename = "type")]
    type_: String,
    role: String,
    content: Vec<serde_json::Value>,
    model: String,
    stop_reason: String,
    stop_sequence: Option<String>,
    usage: AnthropicUsage,
}

#[derive(Debug, Clone, Serialize)]
struct AnthropicUsage {
    input_tokens: u32,
    output_tokens: u32,
}

// ── Streaming event types ───────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct StreamMessageStart {
    #[serde(rename = "type")]
    type_: String,
    message: StreamMessageMeta,
}

#[derive(Debug, Serialize)]
struct StreamMessageMeta {
    id: String,
    #[serde(rename = "type")]
    type_: String,
    role: String,
    content: Vec<serde_json::Value>,
    model: String,
    stop_reason: Option<String>,
    stop_sequence: Option<String>,
    usage: AnthropicUsage,
}

#[derive(Debug, Serialize)]
struct StreamContentBlockStart {
    #[serde(rename = "type")]
    type_: String,
    index: u32,
    content_block: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct StreamContentBlockDelta {
    #[serde(rename = "type")]
    type_: String,
    index: u32,
    delta: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct StreamContentBlockStop {
    #[serde(rename = "type")]
    type_: String,
    index: u32,
}

#[derive(Debug, Serialize)]
struct StreamMessageDelta {
    #[serde(rename = "type")]
    type_: String,
    delta: serde_json::Value,
    usage: AnthropicUsage,
}

#[derive(Debug, Serialize)]
struct StreamMessageStop {
    #[serde(rename = "type")]
    type_: String,
}

// ══════════════════════════════════════════════════════════════════════════════
// OpenAI-compatible Types (kept for backward compat)
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
struct OaiChatRequest {
    model: Option<String>,
    messages: Vec<OaiMessage>,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
    stream: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct OaiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct OaiChatResponse {
    id: String,
    object: String,
    created: u64,
    model: String,
    choices: Vec<OaiChoice>,
    usage: OaiUsage,
}

#[derive(Debug, Serialize)]
struct OaiChoice {
    index: u32,
    message: OaiResponseMessage,
    finish_reason: String,
}

#[derive(Debug, Serialize)]
struct OaiResponseMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct OaiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

#[derive(Debug, Serialize)]
struct OaiStreamChunk {
    id: String,
    object: String,
    created: u64,
    model: String,
    choices: Vec<OaiStreamChoice>,
}

#[derive(Debug, Serialize)]
struct OaiStreamChoice {
    index: u32,
    delta: OaiDelta,
    finish_reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct OaiDelta {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
}

#[derive(Debug, Serialize)]
struct OaiModelsResponse {
    object: String,
    data: Vec<OaiModelInfo>,
}

#[derive(Debug, Serialize)]
struct OaiModelInfo {
    id: String,
    object: String,
    owned_by: String,
}

// ══════════════════════════════════════════════════════════════════════════════
// Tool Calling — Prompt Formatting & Parsing
// ══════════════════════════════════════════════════════════════════════════════

/// Convert Anthropic tool definitions into a system prompt section
/// that teaches the LLM about available tools (Qwen3/Hermes format).
fn format_tools_prompt(tools: &[AnthropicTool]) -> String {
    let mut prompt = String::new();
    prompt.push_str("\n\n# Tools\n\n");
    prompt.push_str("You may call one or more functions to assist with the user query.\n\n");
    prompt.push_str("You are provided with function signatures within <tools></tools> XML tags:\n");
    prompt.push_str("<tools>\n");

    for tool in tools {
        let tool_json = serde_json::json!({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description.as_deref().unwrap_or(""),
                "parameters": tool.input_schema,
            }
        });
        prompt.push_str(&serde_json::to_string(&tool_json).unwrap_or_default());
        prompt.push('\n');
    }

    prompt.push_str("</tools>\n\n");
    prompt.push_str("For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\n");
    prompt.push_str("<tool_call>\n");
    prompt.push_str("{\"name\": \"function_name\", \"arguments\": {\"arg1\": \"value1\"}}\n");
    prompt.push_str("</tool_call>\n");
    prompt.push_str("\nYou can call multiple tools by using multiple <tool_call> blocks.\n");
    prompt.push_str("If no tool is needed, respond normally without <tool_call> tags.\n");

    prompt
}

/// Parsed tool call from LLM output
#[derive(Debug)]
struct ParsedToolCall {
    name: String,
    arguments: serde_json::Value,
}

/// Parse `<tool_call>...</tool_call>` blocks from LLM output.
/// Returns the cleaned text (with tool_call tags removed) and parsed tool calls.
fn parse_tool_calls(output: &str) -> (String, Vec<ParsedToolCall>) {
    let mut tool_calls = Vec::new();
    let mut cleaned = String::new();
    let mut remaining = output;

    while let Some(start) = remaining.find("<tool_call>") {
        // Add text before the tag
        cleaned.push_str(&remaining[..start]);

        let after_open = &remaining[start + "<tool_call>".len()..];
        if let Some(end) = after_open.find("</tool_call>") {
            let json_str = after_open[..end].trim();
            // Try parsing as JSON
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                let name = val
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let arguments = val
                    .get("arguments")
                    .cloned()
                    .unwrap_or(serde_json::json!({}));
                if !name.is_empty() {
                    tool_calls.push(ParsedToolCall { name, arguments });
                }
            }
            remaining = &after_open[end + "</tool_call>".len()..];
        } else {
            // Unclosed tag — include it as text
            cleaned.push_str(&remaining[..start + "<tool_call>".len()]);
            remaining = after_open;
        }
    }
    cleaned.push_str(remaining);

    // Trim the cleaned text
    let cleaned = cleaned.trim().to_string();

    (cleaned, tool_calls)
}

/// Convert Anthropic messages (with content blocks) to ChatML messages.
/// Handles: string content, text blocks, tool_use blocks, tool_result blocks.
fn convert_anthropic_messages(
    messages: &[AnthropicMessage],
    system: Option<&str>,
    tools_prompt: Option<&str>,
) -> Vec<ChatMessage> {
    let mut chat_messages = Vec::new();

    // Build system prompt
    let mut sys = system.unwrap_or("").to_string();
    if let Some(tp) = tools_prompt {
        sys.push_str(tp);
    }
    if !sys.is_empty() {
        chat_messages.push(ChatMessage {
            role: "system".to_string(),
            content: sys,
        });
    }

    for msg in messages {
        let role = &msg.role;
        let content_str = match &msg.content {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Array(blocks) => {
                let mut parts = Vec::new();
                for block in blocks {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match block_type {
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                parts.push(text.to_string());
                            }
                        }
                        "tool_use" => {
                            // Convert tool_use block back to <tool_call> format
                            let name = block
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let input = block
                                .get("input")
                                .cloned()
                                .unwrap_or(serde_json::json!({}));
                            let call_json = serde_json::json!({
                                "name": name,
                                "arguments": input,
                            });
                            parts.push(format!(
                                "<tool_call>\n{}\n</tool_call>",
                                serde_json::to_string(&call_json).unwrap_or_default()
                            ));
                        }
                        "tool_result" => {
                            let tool_use_id = block
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            // tool_result content can be string or array
                            let result_content = if let Some(s) =
                                block.get("content").and_then(|v| v.as_str())
                            {
                                s.to_string()
                            } else if let Some(arr) =
                                block.get("content").and_then(|v| v.as_array())
                            {
                                arr.iter()
                                    .filter_map(|b| {
                                        if b.get("type").and_then(|v| v.as_str()) == Some("text") {
                                            b.get("text").and_then(|v| v.as_str()).map(String::from)
                                        } else {
                                            None
                                        }
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\n")
                            } else {
                                String::new()
                            };
                            let is_error = block
                                .get("is_error")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            parts.push(format!(
                                "<tool_response>\ntool_use_id: {}\n{}{}\n</tool_response>",
                                tool_use_id,
                                if is_error { "ERROR: " } else { "" },
                                result_content,
                            ));
                        }
                        _ => {}
                    }
                }
                parts.join("\n")
            }
            _ => String::new(),
        };

        if !content_str.is_empty() {
            chat_messages.push(ChatMessage {
                role: role.clone(),
                content: content_str,
            });
        }
    }

    chat_messages
}

/// Extract system prompt text from Anthropic `system` field.
fn extract_system_text(system: &Option<serde_json::Value>) -> Option<String> {
    match system {
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        Some(serde_json::Value::Array(blocks)) => {
            let texts: Vec<String> = blocks
                .iter()
                .filter_map(|b| {
                    if b.get("type").and_then(|v| v.as_str()) == Some("text") {
                        b.get("text").and_then(|v| v.as_str()).map(String::from)
                    } else {
                        None
                    }
                })
                .collect();
            if texts.is_empty() {
                None
            } else {
                Some(texts.join("\n"))
            }
        }
        _ => None,
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Server
// ══════════════════════════════════════════════════════════════════════════════

/// Start the API server with both Anthropic and OpenAI endpoints.
pub async fn start_server(
    engine: Arc<LlmEngine>,
    tool_calling_enabled: Arc<AtomicBool>,
    port: u16,
) -> Result<(), String> {
    let state = ServerState {
        engine,
        tool_calling_enabled,
    };

    let app = Router::new()
        // Anthropic Messages API
        .route("/v1/messages", post(anthropic_messages))
        // OpenAI-compatible endpoints
        .route("/v1/chat/completions", post(oai_chat_completions))
        .route("/v1/models", get(oai_list_models))
        // Health
        .route("/health", get(health))
        .with_state(state);

    let addr = format!("127.0.0.1:{}", port);
    eprintln!("[LlmServer] Starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind: {}", e))?;

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Server error: {}", e))?;

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// Anthropic Messages API Handler
// ══════════════════════════════════════════════════════════════════════════════

async fn anthropic_messages(
    State(state): State<ServerState>,
    Json(req): Json<AnthropicRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let tool_calling = state.tool_calling_enabled.load(Ordering::SeqCst);
    let stream = req.stream.unwrap_or(false);
    let max_tokens = req.max_tokens;
    let temperature = req.temperature.unwrap_or(0.7);

    // Extract system prompt
    let system_text = extract_system_text(&req.system);

    // Build tools prompt if tool calling enabled and tools provided
    let tools_prompt = if tool_calling {
        req.tools.as_ref().map(|t| format_tools_prompt(t))
    } else {
        None
    };

    // Convert messages to ChatML
    let chat_messages = convert_anthropic_messages(
        &req.messages,
        system_text.as_deref(),
        tools_prompt.as_deref(),
    );

    let model_name = {
        let status = state.engine.status();
        status.model_name.unwrap_or_else(|| "local".to_string())
    };

    let msg_id = format!("msg_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));

    if stream {
        // ── Streaming response ──────────────────────────────────────────
        // Buffer full response, parse tool calls, then emit SSE events.
        let engine = state.engine.clone();
        let msg_id_clone = msg_id.clone();
        let model_clone = model_name.clone();
        let has_tools = tool_calling && req.tools.is_some();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        // Run generation in blocking thread
        let gen_handle = tokio::task::spawn_blocking(move || {
            engine.chat_completion(chat_messages, max_tokens, temperature, tx)
        });

        // Collect all tokens
        let mut full_output = String::new();
        while let Some(token) = rx.recv().await {
            full_output.push_str(&token);
        }

        let gen_result = gen_handle
            .await
            .map_err(|e| {
                let err = serde_json::json!({
                    "type": "error",
                    "error": {"type": "api_error", "message": format!("Task error: {}", e)}
                });
                (StatusCode::INTERNAL_SERVER_ERROR, Json(err))
            })?
            .map_err(|e| {
                let err = serde_json::json!({
                    "type": "error",
                    "error": {"type": "api_error", "message": e}
                });
                (StatusCode::INTERNAL_SERVER_ERROR, Json(err))
            })?;

        // Use gen_result (= full_output but from engine)
        let output = gen_result;

        // Parse tool calls
        let (text, tool_calls) = if has_tools {
            parse_tool_calls(&output)
        } else {
            (output.clone(), vec![])
        };

        let stop_reason = if !tool_calls.is_empty() {
            "tool_use"
        } else {
            "end_turn"
        };

        // Build SSE events
        let sse_stream = async_stream::stream! {
            // 1. message_start
            let msg_start = StreamMessageStart {
                type_: "message_start".to_string(),
                message: StreamMessageMeta {
                    id: msg_id_clone.clone(),
                    type_: "message".to_string(),
                    role: "assistant".to_string(),
                    content: vec![],
                    model: model_clone.clone(),
                    stop_reason: None,
                    stop_sequence: None,
                    usage: AnthropicUsage { input_tokens: 0, output_tokens: 0 },
                },
            };
            yield Ok::<_, Infallible>(
                Event::default()
                    .event("message_start")
                    .data(serde_json::to_string(&msg_start).unwrap())
            );

            let mut block_index: u32 = 0;

            // 2. Text content block (if any text)
            if !text.is_empty() {
                // content_block_start
                let cbs = StreamContentBlockStart {
                    type_: "content_block_start".to_string(),
                    index: block_index,
                    content_block: serde_json::json!({"type": "text", "text": ""}),
                };
                yield Ok(Event::default()
                    .event("content_block_start")
                    .data(serde_json::to_string(&cbs).unwrap()));

                // Stream text in chunks for a more natural feel
                let chunk_size = 20; // characters per chunk
                let chars: Vec<char> = text.chars().collect();
                for chunk in chars.chunks(chunk_size) {
                    let chunk_text: String = chunk.iter().collect();
                    let cbd = StreamContentBlockDelta {
                        type_: "content_block_delta".to_string(),
                        index: block_index,
                        delta: serde_json::json!({
                            "type": "text_delta",
                            "text": chunk_text,
                        }),
                    };
                    yield Ok(Event::default()
                        .event("content_block_delta")
                        .data(serde_json::to_string(&cbd).unwrap()));
                }

                // content_block_stop
                let cbe = StreamContentBlockStop {
                    type_: "content_block_stop".to_string(),
                    index: block_index,
                };
                yield Ok(Event::default()
                    .event("content_block_stop")
                    .data(serde_json::to_string(&cbe).unwrap()));

                block_index += 1;
            }

            // 3. Tool use content blocks
            for tc in &tool_calls {
                let tool_id = format!("toolu_{}", uuid::Uuid::new_v4().to_string().replace("-", "")[..24].to_string());

                // content_block_start
                let cbs = StreamContentBlockStart {
                    type_: "content_block_start".to_string(),
                    index: block_index,
                    content_block: serde_json::json!({
                        "type": "tool_use",
                        "id": tool_id,
                        "name": tc.name,
                        "input": {},
                    }),
                };
                yield Ok(Event::default()
                    .event("content_block_start")
                    .data(serde_json::to_string(&cbs).unwrap()));

                // content_block_delta with full input JSON
                let input_json = serde_json::to_string(&tc.arguments).unwrap_or("{}".to_string());
                let cbd = StreamContentBlockDelta {
                    type_: "content_block_delta".to_string(),
                    index: block_index,
                    delta: serde_json::json!({
                        "type": "input_json_delta",
                        "partial_json": input_json,
                    }),
                };
                yield Ok(Event::default()
                    .event("content_block_delta")
                    .data(serde_json::to_string(&cbd).unwrap()));

                // content_block_stop
                let cbe = StreamContentBlockStop {
                    type_: "content_block_stop".to_string(),
                    index: block_index,
                };
                yield Ok(Event::default()
                    .event("content_block_stop")
                    .data(serde_json::to_string(&cbe).unwrap()));

                block_index += 1;
            }

            // 4. message_delta
            let md = StreamMessageDelta {
                type_: "message_delta".to_string(),
                delta: serde_json::json!({
                    "stop_reason": stop_reason,
                    "stop_sequence": null,
                }),
                usage: AnthropicUsage { input_tokens: 0, output_tokens: 0 },
            };
            yield Ok(Event::default()
                .event("message_delta")
                .data(serde_json::to_string(&md).unwrap()));

            // 5. message_stop
            let ms = StreamMessageStop {
                type_: "message_stop".to_string(),
            };
            yield Ok(Event::default()
                .event("message_stop")
                .data(serde_json::to_string(&ms).unwrap()));
        };

        Ok(Sse::new(sse_stream)
            .keep_alive(KeepAlive::default())
            .into_response())
    } else {
        // ── Non-streaming response ──────────────────────────────────────
        let engine = state.engine.clone();
        let has_tools = tool_calling && req.tools.is_some();

        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        let result = tokio::task::spawn_blocking(move || {
            engine.chat_completion(chat_messages, max_tokens, temperature, tx)
        })
        .await
        .map_err(|e| {
            let err = serde_json::json!({
                "type": "error",
                "error": {"type": "api_error", "message": format!("Task error: {}", e)}
            });
            (StatusCode::INTERNAL_SERVER_ERROR, Json(err))
        })?
        .map_err(|e| {
            let err = serde_json::json!({
                "type": "error",
                "error": {"type": "api_error", "message": e}
            });
            (StatusCode::INTERNAL_SERVER_ERROR, Json(err))
        })?;

        // Parse tool calls from output
        let (text, tool_calls) = if has_tools {
            parse_tool_calls(&result)
        } else {
            (result.clone(), vec![])
        };

        // Build content blocks
        let mut content: Vec<serde_json::Value> = Vec::new();

        if !text.is_empty() {
            content.push(serde_json::json!({
                "type": "text",
                "text": text,
            }));
        }

        for tc in &tool_calls {
            let tool_id = format!(
                "toolu_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")[..24].to_string()
            );
            content.push(serde_json::json!({
                "type": "tool_use",
                "id": tool_id,
                "name": tc.name,
                "input": tc.arguments,
            }));
        }

        // Ensure at least one content block
        if content.is_empty() {
            content.push(serde_json::json!({
                "type": "text",
                "text": "",
            }));
        }

        let stop_reason = if !tool_calls.is_empty() {
            "tool_use"
        } else {
            "end_turn"
        };

        let response = AnthropicResponse {
            id: msg_id,
            type_: "message".to_string(),
            role: "assistant".to_string(),
            content,
            model: model_name,
            stop_reason: stop_reason.to_string(),
            stop_sequence: None,
            usage: AnthropicUsage {
                input_tokens: 0,
                output_tokens: 0,
            },
        };

        Ok(Json(response).into_response())
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// OpenAI Chat Completions Handler (backward compat)
// ══════════════════════════════════════════════════════════════════════════════

async fn oai_chat_completions(
    State(state): State<ServerState>,
    Json(req): Json<OaiChatRequest>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let messages: Vec<ChatMessage> = req
        .messages
        .into_iter()
        .map(|m| ChatMessage {
            role: m.role,
            content: m.content,
        })
        .collect();

    let max_tokens = req.max_tokens.unwrap_or(512);
    let temperature = req.temperature.unwrap_or(0.7);
    let stream = req.stream.unwrap_or(false);
    let model_name = req.model.unwrap_or_else(|| "local".to_string());

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let req_id = format!("chatcmpl-{}", uuid::Uuid::new_v4());

    if stream {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        let engine = state.engine.clone();
        let req_id_clone = req_id.clone();
        let model_clone = model_name.clone();

        tokio::task::spawn_blocking(move || {
            let _ = engine.chat_completion(messages, max_tokens, temperature, tx);
        });

        let stream = UnboundedReceiverStream::new(rx);
        let req_id_for_stream = req_id_clone;
        let model_for_stream = model_clone;

        let sse_stream = async_stream::stream! {
            let first = OaiStreamChunk {
                id: req_id_for_stream.clone(),
                object: "chat.completion.chunk".to_string(),
                created: now,
                model: model_for_stream.clone(),
                choices: vec![OaiStreamChoice {
                    index: 0,
                    delta: OaiDelta {
                        role: Some("assistant".to_string()),
                        content: None,
                    },
                    finish_reason: None,
                }],
            };
            yield Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&first).unwrap()));

            use tokio_stream::StreamExt;
            let mut token_stream = stream;
            while let Some(token) = token_stream.next().await {
                let chunk = OaiStreamChunk {
                    id: req_id_for_stream.clone(),
                    object: "chat.completion.chunk".to_string(),
                    created: now,
                    model: model_for_stream.clone(),
                    choices: vec![OaiStreamChoice {
                        index: 0,
                        delta: OaiDelta {
                            role: None,
                            content: Some(token),
                        },
                        finish_reason: None,
                    }],
                };
                yield Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&chunk).unwrap()));
            }

            let done = OaiStreamChunk {
                id: req_id_for_stream.clone(),
                object: "chat.completion.chunk".to_string(),
                created: now,
                model: model_for_stream.clone(),
                choices: vec![OaiStreamChoice {
                    index: 0,
                    delta: OaiDelta { role: None, content: None },
                    finish_reason: Some("stop".to_string()),
                }],
            };
            yield Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&done).unwrap()));
            yield Ok::<_, Infallible>(Event::default().data("[DONE]".to_string()));
        };

        Ok(Sse::new(sse_stream)
            .keep_alive(KeepAlive::default())
            .into_response())
    } else {
        let engine = state.engine.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        let result = tokio::task::spawn_blocking(move || {
            engine.chat_completion(messages, max_tokens, temperature, tx)
        })
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Task error: {}", e)))?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

        let response = OaiChatResponse {
            id: req_id,
            object: "chat.completion".to_string(),
            created: now,
            model: model_name,
            choices: vec![OaiChoice {
                index: 0,
                message: OaiResponseMessage {
                    role: "assistant".to_string(),
                    content: result,
                },
                finish_reason: "stop".to_string(),
            }],
            usage: OaiUsage {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
            },
        };

        Ok(Json(response).into_response())
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Other Handlers
// ══════════════════════════════════════════════════════════════════════════════

async fn health() -> &'static str {
    "ok"
}

async fn oai_list_models(State(state): State<ServerState>) -> Json<OaiModelsResponse> {
    let status = state.engine.status();
    let models = if let Some(name) = status.model_name {
        vec![OaiModelInfo {
            id: name,
            object: "model".to_string(),
            owned_by: "localterm".to_string(),
        }]
    } else {
        vec![]
    };

    Json(OaiModelsResponse {
        object: "list".to_string(),
        data: models,
    })
}
