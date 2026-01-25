mod commands;
mod pty;

use commands::AppState;
use pty::PtyManager;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_manager = Arc::new(PtyManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { pty_manager })
        .invoke_handler(tauri::generate_handler![
            commands::create_session,
            commands::write_to_session,
            commands::resize_session,
            commands::close_session,
            commands::get_home_dir,
            commands::get_default_shell,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
