use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub url: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: f64,
    pub speed_mbps: f64,
}

/// Default model: Qwen3-4B Instruct 2507 Q4_K_M GGUF from HuggingFace
pub const DEFAULT_MODEL_URL: &str =
    "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
pub const DEFAULT_MODEL_FILENAME: &str = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf";

/// Download a GGUF model file with progress reporting and cancellation support
pub async fn download_model(
    app: AppHandle,
    url: &str,
    dest_dir: &Path,
    filename: Option<&str>,
    cancel_flag: Arc<AtomicBool>,
) -> Result<PathBuf, String> {
    let fname = filename.unwrap_or_else(|| {
        url.rsplit('/')
            .next()
            .unwrap_or("model.gguf")
    });

    let dest_path = dest_dir.join(fname);

    // Check if already exists
    if dest_path.exists() {
        eprintln!("[ModelManager] Model already exists at {:?}", dest_path);
        return Ok(dest_path);
    }

    // Create temp path for partial download
    let temp_path = dest_dir.join(format!("{}.part", fname));

    eprintln!("[ModelManager] Downloading {} to {:?}", url, dest_path);

    let client = reqwest::Client::new();

    // Support resume via Range header
    let mut downloaded: u64 = 0;
    let mut request = client.get(url);

    if temp_path.exists() {
        downloaded = std::fs::metadata(&temp_path)
            .map(|m| m.len())
            .unwrap_or(0);
        if downloaded > 0 {
            eprintln!("[ModelManager] Resuming from byte {}", downloaded);
            request = request.header("Range", format!("bytes={}-", downloaded));
        }
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !response.status().is_success() && response.status().as_u16() != 206 {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let total_size = response
        .content_length()
        .map(|cl| cl + downloaded);

    let mut file = if downloaded > 0 {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(&temp_path)
            .await
            .map_err(|e| format!("Failed to open temp file: {}", e))?
    } else {
        tokio::fs::File::create(&temp_path)
            .await
            .map_err(|e| format!("Failed to create temp file: {}", e))?
    };

    let mut stream = response.bytes_stream();
    let start_time = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        // Check cancellation flag
        if cancel_flag.load(Ordering::SeqCst) {
            eprintln!("[ModelManager] Download cancelled (paused). Partial file kept at {:?}", temp_path);
            return Err("Download cancelled".to_string());
        }

        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| format!("Write failed: {}", e))?;

        downloaded += chunk.len() as u64;

        let elapsed = start_time.elapsed().as_secs_f64();
        let speed_mbps = if elapsed > 0.0 {
            (downloaded as f64) / (1024.0 * 1024.0) / elapsed
        } else {
            0.0
        };

        let percent = total_size
            .map(|t| (downloaded as f64 / t as f64) * 100.0)
            .unwrap_or(0.0);

        let _ = app.emit(
            "llm-download-progress",
            DownloadProgress {
                url: url.to_string(),
                downloaded,
                total: total_size,
                percent,
                speed_mbps,
            },
        );
    }

    // Rename temp to final
    tokio::fs::rename(&temp_path, &dest_path)
        .await
        .map_err(|e| format!("Failed to rename download: {}", e))?;

    eprintln!(
        "[ModelManager] Download complete: {:?} ({:.1} MB)",
        dest_path,
        downloaded as f64 / (1024.0 * 1024.0)
    );

    Ok(dest_path)
}

/// Cancel and clean up a partial download (delete .part file)
pub fn cancel_and_cleanup(dest_dir: &Path, url: &str) {
    let fname = url.rsplit('/').next().unwrap_or("model.gguf");
    let temp_path = dest_dir.join(format!("{}.part", fname));
    if temp_path.exists() {
        if let Err(e) = std::fs::remove_file(&temp_path) {
            eprintln!("[ModelManager] Failed to remove partial download: {}", e);
        } else {
            eprintln!("[ModelManager] Removed partial download: {:?}", temp_path);
        }
    }
}

/// Delete a downloaded model file
pub fn delete_model(path: &Path) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to delete model: {}", e))?;
        eprintln!("[ModelManager] Deleted model: {:?}", path);
    }
    Ok(())
}

/// Verify a model file's SHA256 checksum
pub fn verify_checksum(path: &Path, expected_hex: &str) -> Result<bool, String> {
    let data =
        std::fs::read(path).map_err(|e| format!("Failed to read file for checksum: {}", e))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let result = hex::encode(hasher.finalize());
    Ok(result == expected_hex)
}

/// List GGUF files in a directory
pub fn list_gguf_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("gguf") {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}
