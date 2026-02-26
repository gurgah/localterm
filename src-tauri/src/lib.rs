mod commands;
mod llm;
mod llm_server;
mod model_manager;
mod pty;

use commands::AppState;
use llm::LlmEngine;
use pty::PtyManager;
use std::sync::{atomic::AtomicBool, Arc};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_manager = Arc::new(PtyManager::new());
    let llm_engine = Arc::new(LlmEngine::new());

    // Start auto-unload timer (checks every 30s, unloads after 2min idle)
    let llm_engine_timer = llm_engine.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(30));
            llm_engine_timer.check_auto_unload(120);
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Create Settings submenu
            let preferences = MenuItemBuilder::with_id("preferences", "Preferences...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let settings_menu = SubmenuBuilder::new(app, "Settings")
                .item(&preferences)
                .build()?;

            // Create Help submenu
            let report_bug = MenuItemBuilder::with_id("report_bug", "Report Bug...")
                .build(app)?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&report_bug)
                .build()?;


            // Create View submenu
            let new_terminal = MenuItemBuilder::with_id("new_terminal", "New Terminal")
                .accelerator("CmdOrCtrl+T")
                .build(app)?;

            let close_terminal = MenuItemBuilder::with_id("close_terminal", "Close Terminal")
                .accelerator("CmdOrCtrl+W")
                .build(app)?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&new_terminal)
                .item(&close_terminal)
                .build()?;

            // Build the main menu
            let menu = MenuBuilder::new(app)
                .item(&view_menu)
                .item(&settings_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(move |app, event| {
                let id = event.id().as_ref();
                match id {
                    "preferences" => {
                        let _ = app.emit("menu-open-settings", ());
                    }
                    "new_terminal" => {
                        let _ = app.emit("menu-new-terminal", ());
                    }
                    "close_terminal" => {
                        let _ = app.emit("menu-close-terminal", ());
                    }
                    "report_bug" => {
                        let _ = app.emit("menu-report-bug", ());
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Show quit confirmation instead of closing directly
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Emit event to frontend to show confirmation dialog
                let _ = window.emit("request-quit", ());
                api.prevent_close();
            }
        })
        .manage(AppState {
            pty_manager,
            llm_engine,
            llm_server_running: Arc::new(AtomicBool::new(false)),
            tool_calling_enabled: Arc::new(AtomicBool::new(true)),
            download_cancel_flag: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_session,
            commands::create_session_with_env,
            commands::write_to_session,
            commands::resize_session,
            commands::close_session,
            commands::is_claude_running,
            commands::get_home_dir,
            commands::get_default_shell,
            commands::llm_load_model,
            commands::llm_unload_model,
            commands::llm_status,
            commands::llm_chat,
            commands::llm_classify,
            commands::llm_stop_generation,
            commands::llm_download_model,
            commands::llm_cancel_download,
            commands::llm_delete_model,
            commands::llm_check_model_exists,
            commands::llm_has_partial_download,
            commands::llm_list_models,
            commands::llm_models_dir,
            commands::llm_start_server,
            commands::llm_server_status,
            commands::llm_set_tool_calling,
            commands::llm_get_tool_calling,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Show window when dock icon is clicked (macOS)
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
