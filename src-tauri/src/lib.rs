use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerStatus {
    pub connected: bool,
    pub health: serde_json::Value,
    pub props: serde_json::Value,
    pub models: serde_json::Value,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}

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

#[tauri::command]
async fn send_completion(url: String, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    let resp = client()
        .post(format!("{url}/completion"))
        .json(&body)
        .timeout(Duration::from_secs(120))
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
async fn send_chat_completion(url: String, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let url = url.trim_end_matches('/');
    let resp = client()
        .post(format!("{url}/v1/chat/completions"))
        .json(&body)
        .timeout(Duration::from_secs(120))
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

/// Start a llama-server process in the background
#[tauri::command]
async fn start_server(binary: String, port: String, extra_args: String) -> Result<String, String> {
    let mut cmd = Command::new(&binary);
    cmd.arg("--port").arg(&port);

    // Parse extra args (simple shell-like splitting)
    if !extra_args.is_empty() {
        let args: Vec<&str> = extra_args.split_whitespace().collect();
        cmd.args(&args);
    }

    // Spawn as detached background process
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    cmd.spawn()
        .map_err(|e| format!("Failed to start server: {e}"))?;

    Ok(format!("Server started on port {port}"))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            connect,
            get_health,
            get_props,
            get_models,
            get_slots,
            list_available_models,
            load_model,
            unload_model,
            start_server,
            send_completion,
            send_chat_completion,
            tokenize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
