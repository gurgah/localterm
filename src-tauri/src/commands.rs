use crate::llm::{ChatMessage, LlmEngine, LlmStatusInfo};
use crate::llm_server;
use crate::model_manager;
use crate::pty::PtyManager;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub pty_manager: Arc<PtyManager>,
    pub llm_engine: Arc<LlmEngine>,
    pub llm_server_running: Arc<std::sync::atomic::AtomicBool>,
    pub tool_calling_enabled: Arc<std::sync::atomic::AtomicBool>,
}

#[tauri::command]
pub async fn create_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .pty_manager
        .create_session(app, session_id, cwd, cols, rows)
}

#[tauri::command]
pub async fn create_session_with_env(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    env_vars: Vec<(String, String)>,
) -> Result<(), String> {
    state
        .pty_manager
        .create_session_with_env(app, session_id, cwd, cols, rows, env_vars)
}

#[tauri::command]
pub async fn write_to_session(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.pty_manager.write(&session_id, &data)
}

#[tauri::command]
pub async fn resize_session(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.pty_manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub async fn close_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.pty_manager.close(&session_id)
}

#[tauri::command]
pub async fn is_claude_running(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<bool, String> {
    state.pty_manager.is_claude_running(&session_id)
}

#[tauri::command]
pub fn get_home_dir() -> Option<String> {
    dirs::home_dir().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_default_shell() -> String {
    if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

// ── LLM Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn llm_load_model(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let engine = state.llm_engine.clone();
    tokio::task::spawn_blocking(move || engine.load_model(&path))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn llm_unload_model(state: State<'_, AppState>) -> Result<(), String> {
    state.llm_engine.unload_model();
    Ok(())
}

#[tauri::command]
pub async fn llm_status(state: State<'_, AppState>) -> Result<LlmStatusInfo, String> {
    Ok(state.llm_engine.status())
}

#[tauri::command]
pub async fn llm_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    messages: Vec<ChatMessage>,
    session_id: String,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
) -> Result<String, String> {
    let engine = state.llm_engine.clone();
    let max_tok = max_tokens.unwrap_or(512);
    let temp = temperature.unwrap_or(0.7);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Spawn token forwarding task
    let app_clone = app.clone();
    let sid = session_id.clone();
    tokio::spawn(async move {
        while let Some(token) = rx.recv().await {
            let _ = app_clone.emit("llm-token", serde_json::json!({
                "session_id": sid,
                "token": token,
            }));
        }
    });

    // Run generation on blocking thread
    tokio::task::spawn_blocking(move || {
        engine.chat_completion(messages, max_tok, temp, tx)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn llm_classify(
    state: State<'_, AppState>,
    input: String,
) -> Result<String, String> {
    let engine = state.llm_engine.clone();
    tokio::task::spawn_blocking(move || engine.classify(&input))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn llm_stop_generation(state: State<'_, AppState>) -> Result<(), String> {
    state.llm_engine.stop_generation();
    Ok(())
}

#[tauri::command]
pub async fn llm_download_model(
    app: AppHandle,
    state: State<'_, AppState>,
    url: Option<String>,
) -> Result<String, String> {
    let download_url = url.unwrap_or_else(|| model_manager::DEFAULT_MODEL_URL.to_string());
    let models_dir = state.llm_engine.models_dir().to_path_buf();

    let dest = model_manager::download_model(app, &download_url, &models_dir, None).await?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn llm_list_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(state.llm_engine.list_models())
}

#[tauri::command]
pub fn llm_models_dir(state: State<'_, AppState>) -> String {
    state.llm_engine.models_dir().to_string_lossy().to_string()
}

#[tauri::command]
pub async fn llm_start_server(
    state: State<'_, AppState>,
    port: Option<u16>,
) -> Result<u16, String> {
    let port = port.unwrap_or(llm_server::DEFAULT_PORT);

    if state.llm_server_running.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Server already running".to_string());
    }

    let engine = state.llm_engine.clone();
    let tool_calling = state.tool_calling_enabled.clone();
    let flag = state.llm_server_running.clone();
    flag.store(true, std::sync::atomic::Ordering::SeqCst);

    tokio::spawn(async move {
        if let Err(e) = llm_server::start_server(engine, tool_calling, port).await {
            eprintln!("[LlmServer] Error: {}", e);
        }
        flag.store(false, std::sync::atomic::Ordering::SeqCst);
    });

    Ok(port)
}

#[tauri::command]
pub fn llm_server_status(state: State<'_, AppState>) -> bool {
    state.llm_server_running.load(std::sync::atomic::Ordering::SeqCst)
}

#[tauri::command]
pub fn llm_set_tool_calling(state: State<'_, AppState>, enabled: bool) {
    state.tool_calling_enabled.store(enabled, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub fn llm_get_tool_calling(state: State<'_, AppState>) -> bool {
    state.tool_calling_enabled.load(std::sync::atomic::Ordering::SeqCst)
}
