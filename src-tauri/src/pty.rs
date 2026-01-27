use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
pub struct PtyOutput {
    pub session_id: String,
    pub data: String,
}

#[derive(Clone, serde::Serialize)]
pub struct PtyExit {
    pub session_id: String,
    pub code: Option<i32>,
}

struct PtySession {
    pair: PtyPair,
    writer: Box<dyn Write + Send>,
    #[allow(dead_code)]
    child: Box<dyn portable_pty::Child + Send + Sync>,
    shell_pid: Option<u32>,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_session(
        &self,
        app: AppHandle,
        session_id: String,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Get default shell (platform-aware)
        let shell = if cfg!(target_os = "windows") {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        };

        let mut cmd = CommandBuilder::new(&shell);
        if !cfg!(target_os = "windows") {
            cmd.arg("-l"); // Login shell (Unix only)
        }

        // Set working directory
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        } else if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }

        // Set environment
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        // Clear AppImage-injected env vars that break child processes
        // (e.g. PYTHONHOME/PYTHONPATH from AppImage mount causes claude to fail)
        cmd.env_remove("PYTHONHOME");
        cmd.env_remove("PYTHONPATH");
        cmd.env_remove("APPIMAGE");
        cmd.env_remove("APPDIR");
        cmd.env_remove("OWD");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let shell_pid = child.process_id();

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        // Store session
        {
            let mut sessions = self.sessions.lock();
            sessions.insert(
                session_id.clone(),
                PtySession {
                    pair,
                    writer,
                    child,
                    shell_pid,
                },
            );
        }

        // Spawn reader thread
        let session_id_clone = session_id.clone();
        let sessions_clone = self.sessions.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF - process exited
                        let _ = app.emit("pty-exit", PtyExit {
                            session_id: session_id_clone.clone(),
                            code: None,
                        });
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit("pty-output", PtyOutput {
                            session_id: session_id_clone.clone(),
                            data,
                        });
                    }
                    Err(e) => {
                        eprintln!("PTY read error: {}", e);
                        break;
                    }
                }
            }

            // Cleanup session
            let mut sessions = sessions_clone.lock();
            sessions.remove(&session_id_clone);
        });

        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        if let Some(session) = sessions.get_mut(session_id) {
            session
                .writer
                .write_all(data.as_bytes())
                .map_err(|e| format!("Failed to write to PTY: {}", e))?;
            session
                .writer
                .flush()
                .map_err(|e| format!("Failed to flush PTY: {}", e))?;
            Ok(())
        } else {
            Err(format!("Session not found: {}", session_id))
        }
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(session_id) {
            session
                .pair
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Failed to resize PTY: {}", e))?;
            Ok(())
        } else {
            Err(format!("Session not found: {}", session_id))
        }
    }

    /// Check if a "claude" process is running as a descendant of the session's shell.
    /// Uses `pgrep -P <pid>` to walk the process tree.
    pub fn is_claude_running(&self, session_id: &str) -> Result<bool, String> {
        let sessions = self.sessions.lock();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        let shell_pid = session
            .shell_pid
            .ok_or_else(|| "Shell PID not available".to_string())?;

        Ok(Self::has_claude_descendant(shell_pid))
    }

    /// Recursively check if any descendant process is "claude"
    #[cfg(not(target_os = "windows"))]
    fn has_claude_descendant(pid: u32) -> bool {
        let output = std::process::Command::new("pgrep")
            .arg("-P")
            .arg(pid.to_string())
            .output();

        let output = match output {
            Ok(o) => o,
            Err(_) => return false,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Ok(child_pid) = line.trim().parse::<u32>() {
                if Self::is_process_claude(child_pid) {
                    return true;
                }
                if Self::has_claude_descendant(child_pid) {
                    return true;
                }
            }
        }
        false
    }

    #[cfg(target_os = "windows")]
    fn has_claude_descendant(pid: u32) -> bool {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Use WMIC to find child processes on Windows (hidden, no console window)
        let output = std::process::Command::new("wmic")
            .args(["process", "where", &format!("ParentProcessId={}", pid), "get", "ProcessId,Name", "/format:csv"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let output = match output {
            Ok(o) => o,
            Err(_) => return false,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() >= 3 {
                let name = parts[1].trim().to_lowercase();
                if name.contains("claude") {
                    return true;
                }
                if let Ok(child_pid) = parts[2].trim().parse::<u32>() {
                    if child_pid != pid && Self::has_claude_descendant(child_pid) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Check if a process with the given PID has "claude" in its command name
    fn is_process_claude(pid: u32) -> bool {
        #[cfg(not(target_os = "windows"))]
        {
            let output = std::process::Command::new("ps")
                .arg("-p")
                .arg(pid.to_string())
                .arg("-o")
                .arg("comm=")
                .output();

            match output {
                Ok(o) => {
                    let comm = String::from_utf8_lossy(&o.stdout).trim().to_lowercase();
                    comm.contains("claude")
                }
                Err(_) => false,
            }
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let output = std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();

            match output {
                Ok(o) => {
                    let out = String::from_utf8_lossy(&o.stdout).to_lowercase();
                    out.contains("claude")
                }
                Err(_) => false,
            }
        }
    }

    pub fn close(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        if sessions.remove(session_id).is_some() {
            Ok(())
        } else {
            Err(format!("Session not found: {}", session_id))
        }
    }
}
