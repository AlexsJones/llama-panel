use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerStatus {
    pub connected: bool,
    pub health: serde_json::Value,
    pub props: serde_json::Value,
    pub models: serde_json::Value,
}

#[derive(Serialize)]
struct LocalModel {
    name: String,
    filename: String,
    path: String,
    size: u64,
}

#[derive(Clone, Serialize)]
struct ServerInstance {
    pid: u32,
    port: u16,
    model: String,
}

/// Tracks all server processes we've spawned
struct OwnedServers(Mutex<Vec<ServerInstance>>);

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}

fn hf_hub_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".cache")
        .join("huggingface")
        .join("hub")
}

fn repo_dir(repo: &str) -> PathBuf {
    hf_hub_dir().join(format!("models--{}", repo.replace('/', "--")))
}

// ── Connection & Server Info ─────────────────────────────────────────

#[tauri::command]
async fn connect(url: String) -> Result<ServerStatus, String> {
    let c = client();
    let url = url.trim_end_matches('/');

    let health: serde_json::Value = c
        .get(format!("{url}/health"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))?;

    let props = match c.get(format!("{url}/props")).send().await {
        Ok(r) => r.json().await.unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };

    let models = match c.get(format!("{url}/v1/models")).send().await {
        Ok(r) => r.json().await.unwrap_or(serde_json::json!({"data": []})),
        Err(_) => serde_json::json!({"data": []}),
    };

    Ok(ServerStatus {
        connected: true,
        health,
        props,
        models,
    })
}

#[tauri::command]
async fn get_health(url: String) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    client()
        .get(format!("{url}/health"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_props(url: String) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    client()
        .get(format!("{url}/props"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_models(url: String) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    client()
        .get(format!("{url}/v1/models"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_slots(url: String) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    client()
        .get(format!("{url}/slots"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

/// List all models known to the server (router mode)
#[tauri::command]
async fn list_available_models(url: String) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    client()
        .get(format!("{url}/models"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

/// Load a model by name or HF repo (router mode: POST /models/load)
#[tauri::command]
async fn load_model(url: String, model: String) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    let resp = client()
        .post(format!("{url}/models/load"))
        .json(&serde_json::json!({"model": model}))
        .timeout(Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Server error {status}: {text}"));
    }

    resp.json().await.map_err(|e| e.to_string())
}

/// Unload a model (router mode: POST /models/unload)
#[tauri::command]
async fn unload_model(url: String, model: String) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    let resp = client()
        .post(format!("{url}/models/unload"))
        .json(&serde_json::json!({"model": model}))
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Server error {status}: {text}"));
    }

    resp.json().await.map_err(|e| e.to_string())
}

// ── Completions ──────────────────────────────────────────────────────

#[tauri::command]
async fn send_completion(
    url: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    let resp = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .unwrap()
        .post(format!("{url}/completion"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Server error {status}: {text}"));
    }

    resp.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn send_chat_completion(
    url: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    let resp = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .unwrap()
        .post(format!("{url}/v1/chat/completions"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Server error {status}: {text}"));
    }

    resp.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn tokenize(url: String, content: String) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    client()
        .post(format!("{url}/tokenize"))
        .json(&serde_json::json!({"content": content}))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

// ── Binary Detection ────────────────────────────────────────────────

#[tauri::command]
async fn detect_binary() -> Result<String, String> {
    if let Ok(output) = Command::new("which").arg("llama-server").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(path);
            }
        }
    }

    let candidates = [
        "/usr/local/bin/llama-server",
        "/opt/homebrew/bin/llama-server",
        "/usr/bin/llama-server",
    ];
    for p in candidates {
        if std::path::Path::new(p).exists() {
            return Ok(p.to_string());
        }
    }

    if let Some(home) = std::env::var_os("HOME") {
        let home_path = PathBuf::from(home);
        for sub in [
            "llama.cpp/build/bin/llama-server",
            "llama.cpp/llama-server",
            ".local/bin/llama-server",
        ] {
            let candidate = home_path.join(sub);
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().to_string());
            }
        }
    }

    Err("llama-server not found".to_string())
}

// ── Server Process Management ───────────────────────────────────────

#[tauri::command]
async fn stop_server(
    state: tauri::State<'_, OwnedServers>,
    port: u16,
) -> Result<String, String> {
    let mut servers = state.0.lock().unwrap();
    let idx = servers
        .iter()
        .position(|s| s.port == port)
        .ok_or("No server on that port")?;
    let srv = servers.remove(idx);
    unsafe {
        libc::kill(srv.pid as i32, libc::SIGTERM);
    }
    Ok(format!("Server on port {} stopped", srv.port))
}

#[tauri::command]
async fn stop_all_servers(state: tauri::State<'_, OwnedServers>) -> Result<String, String> {
    let mut servers = state.0.lock().unwrap();
    for srv in servers.drain(..) {
        unsafe {
            libc::kill(srv.pid as i32, libc::SIGTERM);
        }
    }
    Ok("All servers stopped".to_string())
}

#[tauri::command]
async fn list_servers(state: tauri::State<'_, OwnedServers>) -> Result<Vec<ServerInstance>, String> {
    Ok(state.0.lock().unwrap().clone())
}

#[tauri::command]
async fn pick_random_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind: {e}"))?;
    Ok(listener.local_addr().unwrap().port())
}

#[tauri::command]
async fn open_in_browser(url: String) -> Result<(), String> {
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open browser: {e}"))?;
    Ok(())
}

/// Start a llama-server process with a local model file
#[tauri::command]
async fn start_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, OwnedServers>,
    binary: String,
    port: String,
    extra_args: String,
    model_path: Option<String>,
) -> Result<String, String> {
    use tauri::Emitter;

    let port_num: u16 = port.parse().map_err(|_| "Invalid port")?;

    let mut cmd = Command::new(&binary);
    cmd.arg("--port").arg(&port);

    if let Some(ref mp) = model_path {
        cmd.arg("-m").arg(mp);
    }

    if !extra_args.is_empty() {
        let args: Vec<&str> = extra_args.split_whitespace().collect();
        cmd.args(&args);
    }

    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start server: {e}"))?;

    let pid = child.id();
    let model_label = model_path.clone().unwrap_or_default();

    state.0.lock().unwrap().push(ServerInstance {
        pid,
        port: port_num,
        model: model_label,
    });

    // Stream stderr for model loading progress
    let port_tag = port_num;
    let stderr = child.stderr.take();
    if let Some(stderr) = stderr {
        std::thread::spawn(move || {
            use std::io::Read;
            let mut reader = std::io::BufReader::new(stderr);
            let mut buf = [0u8; 4096];
            let mut line_buf = String::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]);
                        for ch in chunk.chars() {
                            if ch == '\r' || ch == '\n' {
                                if !line_buf.is_empty() {
                                    let _ = app.emit(
                                        "server-log",
                                        serde_json::json!({"port": port_tag, "line": line_buf}),
                                    );
                                    line_buf.clear();
                                }
                            } else {
                                line_buf.push(ch);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
            if !line_buf.is_empty() {
                let _ = app.emit(
                    "server-log",
                    serde_json::json!({"port": port_tag, "line": line_buf}),
                );
            }
        });
    }

    Ok(format!("Server started on port {port}"))
}

// ── HuggingFace Search ──────────────────────────────────────────────

#[tauri::command]
async fn search_hf_models(query: String) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://huggingface.co/api/models?search={}&filter=gguf&sort=downloads&direction=-1&limit=8",
        urlencoded(&query)
    );
    client()
        .get(&url)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("HF search failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))
}

/// List GGUF files in a HuggingFace repo, grouped into model bundles.
/// Split models (e.g. model-00001-of-00003.gguf) are grouped together.
#[tauri::command]
async fn list_hf_files(repo: String) -> Result<serde_json::Value, String> {
    let c = client();

    // Get commit SHA
    let model_info: serde_json::Value = c
        .get(format!("https://huggingface.co/api/models/{repo}"))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch repo info: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))?;

    let commit_sha = model_info["sha"].as_str().unwrap_or("main").to_string();

    // Get file tree
    let resp: serde_json::Value = c
        .get(format!("https://huggingface.co/api/models/{repo}/tree/main"))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch repo: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))?;

    let empty = vec![];
    let gguf_files: Vec<&serde_json::Value> = resp
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .filter(|f| {
            f["path"]
                .as_str()
                .map(|p| p.ends_with(".gguf") && !p.ends_with(".part"))
                .unwrap_or(false)
        })
        .collect();

    if gguf_files.is_empty() {
        return Err("No GGUF files found in this repo".to_string());
    }

    // Group split models: "foo-00001-of-00003.gguf" → base "foo"
    // Single files stay as-is
    use std::collections::BTreeMap;
    let split_re_str = r"-(\d{5})-of-(\d{5})\.gguf$";
    let split_re = regex::Regex::new(split_re_str).unwrap();

    let mut bundles: BTreeMap<String, Vec<serde_json::Value>> = BTreeMap::new();

    for f in &gguf_files {
        let path = f["path"].as_str().unwrap_or("");
        let key = if let Some(caps) = split_re.captures(path) {
            // Group key is everything before the split suffix
            let prefix = &path[..caps.get(0).unwrap().start()];
            format!("{prefix}.gguf")
        } else {
            path.to_string()
        };

        // LFS files have an lfs.oid (SHA256), non-LFS use oid directly
        let blob_hash = f["lfs"]["oid"]
            .as_str()
            .or_else(|| f["oid"].as_str())
            .unwrap_or("")
            .to_string();

        bundles
            .entry(key)
            .or_default()
            .push(serde_json::json!({
                "path": path,
                "size": f["size"].as_u64().unwrap_or(0),
                "hash": blob_hash,
            }));
    }

    // Sort files within each bundle by name
    for files in bundles.values_mut() {
        files.sort_by(|a, b| {
            a["path"].as_str().unwrap_or("").cmp(b["path"].as_str().unwrap_or(""))
        });
    }

    let result: Vec<serde_json::Value> = bundles
        .into_iter()
        .map(|(name, files)| {
            let total_size: u64 = files.iter().map(|f| f["size"].as_u64().unwrap_or(0)).sum();
            let file_count = files.len();
            serde_json::json!({
                "name": name,
                "files": files,
                "total_size": total_size,
                "file_count": file_count,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "commit": commit_sha,
        "bundles": result,
    }))
}

// ── Model Download ──────────────────────────────────────────────────

/// Download one or more files from a HuggingFace repo into the HF hub cache.
/// Files are stored as blobs/{sha256} with symlinks in snapshots/{commit}/{filename}.
/// `files` is a JSON array of [{path, hash}, ...].
/// Returns the snapshot path to the first file (for llama-server `-m`).
#[tauri::command]
async fn download_hf_model(
    app: tauri::AppHandle,
    repo: String,
    commit: String,
    files: Vec<serde_json::Value>,
) -> Result<String, String> {
    use tauri::Emitter;

    let rdir = repo_dir(&repo);
    let blobs_dir = rdir.join("blobs");
    let snap_dir = rdir.join("snapshots").join(&commit);
    let refs_dir = rdir.join("refs");

    std::fs::create_dir_all(&blobs_dir).map_err(|e| format!("Failed to create blobs dir: {e}"))?;
    std::fs::create_dir_all(&snap_dir).map_err(|e| format!("Failed to create snapshot dir: {e}"))?;
    std::fs::create_dir_all(&refs_dir).map_err(|e| format!("Failed to create refs dir: {e}"))?;

    // Write refs/main
    std::fs::write(refs_dir.join("main"), &commit)
        .map_err(|e| format!("Failed to write ref: {e}"))?;

    let dl_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap();

    // Build list of files to download (skip if blob already exists)
    struct DlFile {
        filename: String,
        hash: String,
    }
    let mut to_download: Vec<DlFile> = Vec::new();

    for f in &files {
        let filename = f["path"].as_str().unwrap_or("").to_string();
        let hash = f["hash"].as_str().unwrap_or("").to_string();

        let blob_path = blobs_dir.join(&hash);
        let snap_link = snap_dir.join(&filename);

        // Create symlink if blob exists but symlink doesn't
        if blob_path.exists() {
            if !snap_link.exists() {
                let rel = format!("../../blobs/{hash}");
                let _ = std::os::unix::fs::symlink(&rel, &snap_link);
            }
        } else {
            to_download.push(DlFile { filename, hash });
        }
    }

    if to_download.is_empty() {
        let _ = app.emit(
            "download-progress",
            serde_json::json!({"downloaded": 1, "total": 1, "pct": 100.0}),
        );
        let first_name = files[0]["path"].as_str().unwrap_or("");
        return Ok(snap_dir.join(first_name).to_string_lossy().to_string());
    }

    // Use known sizes from the API for accurate progress
    let total_files = files.len();
    let grand_total: u64 = files
        .iter()
        .map(|f| f["size"].as_u64().unwrap_or(0))
        .sum();
    // Already-downloaded bytes count toward progress
    let already_done: u64 = files
        .iter()
        .filter(|f| {
            let h = f["hash"].as_str().unwrap_or("");
            blobs_dir.join(h).exists()
        })
        .map(|f| f["size"].as_u64().unwrap_or(0))
        .sum();
    let mut cumulative: u64 = already_done;
    let mut last_emit = std::time::Instant::now();

    for (file_idx, dlf) in to_download.iter().enumerate() {
        let url = format!(
            "https://huggingface.co/{repo}/resolve/main/{}",
            dlf.filename
        );

        let mut resp = dl_client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Download failed for {}: {e}", dlf.filename))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Download failed for {}: HTTP {}",
                dlf.filename,
                resp.status()
            ));
        }

        // Write to blobs/{hash}
        let blob_path = blobs_dir.join(&dlf.hash);
        let tmp = blobs_dir.join(format!("{}.downloadInProgress", dlf.hash));
        let mut file =
            std::fs::File::create(&tmp).map_err(|e| format!("Failed to create file: {e}"))?;

        use std::io::Write;

        // Label shows position within total files, not just files-to-download
        let file_label = format!(
            "{} ({}/{})",
            dlf.filename,
            total_files - to_download.len() + file_idx + 1,
            total_files
        );

        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| format!("Download error: {e}"))?
        {
            file.write_all(&chunk)
                .map_err(|e| format!("Write error: {e}"))?;
            cumulative += chunk.len() as u64;

            if last_emit.elapsed() > Duration::from_millis(250) {
                let pct = if grand_total > 0 {
                    (cumulative as f64 / grand_total as f64 * 100.0).min(99.9)
                } else {
                    0.0
                };
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({
                        "downloaded": cumulative,
                        "total": grand_total,
                        "pct": pct,
                        "file": file_label,
                    }),
                );
                last_emit = std::time::Instant::now();
            }
        }

        file.flush().map_err(|e| format!("Flush error: {e}"))?;
        drop(file);

        // Rename to final blob path
        std::fs::rename(&tmp, &blob_path)
            .map_err(|e| format!("Failed to finalize {}: {e}", dlf.filename))?;

        // Create symlink: snapshots/{commit}/{filename} → ../../blobs/{hash}
        let snap_link = snap_dir.join(&dlf.filename);
        if !snap_link.exists() {
            let rel = format!("../../blobs/{}", dlf.hash);
            std::os::unix::fs::symlink(&rel, &snap_link)
                .map_err(|e| format!("Failed to create symlink: {e}"))?;
        }
    }

    let _ = app.emit(
        "download-progress",
        serde_json::json!({"downloaded": grand_total, "total": grand_total, "pct": 100.0}),
    );

    let first_name = files[0]["path"].as_str().unwrap_or("");
    Ok(snap_dir.join(first_name).to_string_lossy().to_string())
}

// ── Local Model Management ──────────────────────────────────────────

#[tauri::command]
async fn list_local_models() -> Result<Vec<LocalModel>, String> {
    let hub = hf_hub_dir();
    let mut models = Vec::new();
    let split_re = regex::Regex::new(r"-\d{5}-of-\d{5}\.gguf$").unwrap();
    let of_re = regex::Regex::new(r"-\d{5}-of-(\d{5})\.gguf$").unwrap();

    if !hub.exists() {
        return Ok(models);
    }

    // Scan models--*/ directories
    let entries = std::fs::read_dir(&hub).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let dir_name = entry.file_name().to_string_lossy().to_string();
        if !dir_name.starts_with("models--") {
            continue;
        }
        let repo = dir_name
            .strip_prefix("models--")
            .unwrap_or("")
            .replacen("--", "/", 1);

        // Find the latest snapshot directory
        let snap_base = entry.path().join("snapshots");
        if !snap_base.exists() {
            continue;
        }
        let snap_dirs: Vec<_> = match std::fs::read_dir(&snap_base) {
            Ok(d) => d.flatten().filter(|e| e.path().is_dir()).collect(),
            Err(_) => continue,
        };
        let Some(snap_dir) = snap_dirs.last() else {
            continue;
        };

        // Collect GGUF files in the snapshot (these are symlinks to blobs)
        let snap_files = match std::fs::read_dir(snap_dir.path()) {
            Ok(f) => f,
            Err(_) => continue,
        };

        use std::collections::BTreeMap;
        let mut bundles: BTreeMap<String, (Vec<String>, u64)> = BTreeMap::new();

        for file in snap_files.flatten() {
            let fname = file.file_name().to_string_lossy().to_string();
            if !fname.ends_with(".gguf") {
                continue;
            }
            // Follow symlink to get real file size
            let size = std::fs::metadata(file.path())
                .map(|m| m.len())
                .unwrap_or(0);

            let key = if split_re.is_match(&fname) {
                split_re.replace(&fname, ".gguf").to_string()
            } else {
                fname.clone()
            };

            let bentry = bundles.entry(key).or_insert_with(|| (Vec::new(), 0));
            bentry.0.push(fname);
            bentry.1 += size;
        }

        for (base_name, (mut file_list, total_size)) in bundles {
            file_list.sort();

            // Check if split bundle is complete
            if file_list.len() > 1 || of_re.is_match(&file_list[0]) {
                if let Some(caps) = of_re.captures(&file_list[0]) {
                    let expected: usize = caps[1].parse().unwrap_or(0);
                    if file_list.len() < expected {
                        continue; // incomplete
                    }
                }
            }

            let first_path = snap_dir.path().join(&file_list[0]);
            let display_name = if file_list.len() > 1 {
                format!("{repo}/{base_name} ({} parts)", file_list.len())
            } else {
                format!("{repo}/{base_name}")
            };
            models.push(LocalModel {
                name: display_name,
                filename: file_list[0].clone(),
                path: first_path.to_string_lossy().to_string(),
                size: total_size,
            });
        }
    }

    Ok(models)
}

/// Delete a model — removes symlinks from snapshot and the underlying blobs.
/// For split models, deletes all parts.
#[tauri::command]
async fn delete_local_model(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let fname = p
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or("Invalid path")?;
    let snap_dir = p.parent().ok_or("Invalid path")?;

    let split_re = regex::Regex::new(r"-\d{5}-of-\d{5}\.gguf$").unwrap();

    // Collect symlinks to delete (single file or all split parts)
    let mut to_delete: Vec<PathBuf> = Vec::new();

    if split_re.is_match(fname) {
        let base = split_re.replace(fname, "").to_string();
        if let Ok(entries) = std::fs::read_dir(snap_dir) {
            for entry in entries.flatten() {
                let entry_name = entry.file_name().to_string_lossy().to_string();
                if entry_name.starts_with(&base) && entry_name.ends_with(".gguf") {
                    to_delete.push(entry.path());
                }
            }
        }
    } else {
        to_delete.push(p.to_path_buf());
    }

    for link in &to_delete {
        // Resolve the symlink to find the blob, then delete both
        if let Ok(blob_path) = std::fs::read_link(link) {
            let resolved = snap_dir.join(&blob_path);
            let _ = std::fs::remove_file(&resolved);
        }
        let _ = std::fs::remove_file(link);
    }

    // Clean up empty snapshot dir → repo dir
    let _ = std::fs::remove_dir(snap_dir);
    if let Some(snaps) = snap_dir.parent() {
        let _ = std::fs::remove_dir(snaps);
        if let Some(repo) = snaps.parent() {
            let _ = std::fs::remove_dir(repo);
        }
    }
    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────

fn urlencoded(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

pub fn run() {
    tauri::Builder::default()
        .manage(OwnedServers(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            connect,
            get_health,
            get_props,
            get_models,
            get_slots,
            list_available_models,
            load_model,
            unload_model,
            detect_binary,
            stop_server,
            stop_all_servers,
            list_servers,
            pick_random_port,
            open_in_browser,
            start_server,
            search_hf_models,
            list_hf_files,
            download_hf_model,
            list_local_models,
            delete_local_model,
            send_completion,
            send_chat_completion,
            tokenize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
