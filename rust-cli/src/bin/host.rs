//! Native messaging host for Firefox Agent Bridge
//!
//! This binary replaces the Node.js host.js. It:
//! 1. Runs a WebSocket server on ws://127.0.0.1:8766
//! 2. Communicates with Firefox via native messaging (stdin/stdout)
//! 3. Routes messages between WebSocket clients and the browser extension

use std::collections::HashMap;
use std::env;
use std::io::{self, Read, Write as IoWrite};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, RwLock};
use tokio::time::timeout;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

/// Environment variable configuration
fn ws_host() -> String {
    env::var("FAB_WS_HOST").unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn ws_port() -> u16 {
    env::var("FAB_WS_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8766)
}

fn request_timeout_ms() -> u64 {
    env::var("FAB_REQUEST_TIMEOUT_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(30000)
}

/// Log to stderr (native messaging uses stdout for messages)
macro_rules! log {
    ($($arg:tt)*) => {
        eprintln!("[firefox-agent-bridge] {}", format!($($arg)*));
    };
}

/// Request counter for generating unique IDs
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_id() -> String {
    let count = REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("req_{}_{}", now, count)
}

/// Pending request tracking
struct PendingRequest {
    response_tx: mpsc::Sender<Value>,
    started: Instant,
    profile: bool,
}

type PendingMap = Arc<RwLock<HashMap<String, PendingRequest>>>;

/// Channel for sending messages to native messaging (stdout)
type NativeTx = mpsc::Sender<Value>;

/// Get MIME type from file extension
fn get_mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase()).as_deref() {
        Some("zip") => "application/zip",
        Some("xpi") => "application/x-xpinstall",
        Some("json") => "application/json",
        Some("js") => "application/javascript",
        Some("html") | Some("htm") => "text/html",
        Some("css") => "text/css",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("txt") => "text/plain",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// Process uploadFile action - read file and convert to fillForm with base64 data
fn process_upload_file(message: &mut Value) -> Result<(), String> {
    let params = message.get_mut("params").ok_or("Missing params")?;
    let file_path = params.get("filePath")
        .and_then(|v| v.as_str())
        .ok_or("Missing filePath")?
        .to_string();
    let selector = params.get("selector")
        .and_then(|v| v.as_str())
        .ok_or("Missing selector")?
        .to_string();

    let path = Path::new(&file_path);
    let file_data = std::fs::read(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let base64_data = base64::engine::general_purpose::STANDARD.encode(&file_data);
    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let mime_type = get_mime_type(path);

    // Convert to fillForm action
    message["action"] = json!("fillForm");
    message["params"] = json!({
        "fields": [{
            "selector": selector,
            "file": {
                "name": file_name,
                "type": mime_type,
                "data": base64_data
            }
        }]
    });

    Ok(())
}

/// Process fillForm with filePath in fields - read files before sending
fn process_fill_form_files(message: &mut Value) -> Result<(), String> {
    let params = match message.get_mut("params") {
        Some(p) => p,
        None => return Ok(()),
    };

    let fields = match params.get_mut("fields") {
        Some(Value::Array(f)) => f,
        _ => return Ok(()),
    };

    for field in fields.iter_mut() {
        if let Some(file_path) = field.get("filePath").and_then(|v| v.as_str()).map(|s| s.to_string()) {
            let path = Path::new(&file_path);
            let file_data = std::fs::read(path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            let base64_data = base64::engine::general_purpose::STANDARD.encode(&file_data);
            let file_name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();
            let mime_type = get_mime_type(path);

            field["file"] = json!({
                "name": file_name,
                "type": mime_type,
                "data": base64_data
            });

            // Remove filePath
            if let Value::Object(ref mut obj) = field {
                obj.remove("filePath");
            }
        }
    }

    Ok(())
}

fn mask_username(username: &str) -> String {
    if username.contains('@') {
        let parts: Vec<&str> = username.splitn(2, '@').collect();
        let local = parts[0];
        let domain = parts.get(1).unwrap_or(&"");
        if local.len() <= 2 {
            format!("{}***@{}", &local[..1], domain)
        } else {
            format!("{}***{}@{}", &local[..1], &local[local.len()-1..], domain)
        }
    } else if username.len() <= 3 {
        format!("{}***", &username[..1])
    } else {
        format!("{}***{}", &username[..1], &username[username.len()-1..])
    }
}

#[derive(Debug)]
struct GoldwardenCredential {
    username: String,
    password: String,
    uri: String,
}

fn goldwarden_vault_status() -> Result<Value, String> {
    let output = Command::new("goldwarden")
        .args(["vault", "status"])
        .output()
        .map_err(|e| format!("Failed to run goldwarden: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("goldwarden vault status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse vault status: {} (output: {})", e, stdout))
}

fn goldwarden_get_login(search: &str) -> Result<GoldwardenCredential, String> {
    let status = goldwarden_vault_status()?;
    if status.get("locked").and_then(|v| v.as_bool()).unwrap_or(true) {
        return Err("Vault is locked. Please unlock Goldwarden first (goldwarden vault unlock)".to_string());
    }
    if !status.get("loggedIn").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Err("Not logged in to Goldwarden".to_string());
    }

    let output = Command::new("goldwarden")
        .args(["logins", "get", "--name", search])
        .output()
        .map_err(|e| format!("Failed to query goldwarden: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("No login found for '{}': {}", search, stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.trim().lines().collect();

    let mut username = String::new();
    let mut password = String::new();
    let mut uri = String::new();

    for line in &lines {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("Username: ") {
            username = val.to_string();
        } else if let Some(val) = line.strip_prefix("Password: ") {
            password = val.to_string();
        } else if let Some(val) = line.strip_prefix("URI: ") {
            uri = val.to_string();
        }
    }

    if username.is_empty() && password.is_empty() {
        return Err(format!("Could not parse credentials from goldwarden output: {}", stdout));
    }

    Ok(GoldwardenCredential { username, password, uri })
}

/// Process autoLogin action — query Goldwarden and convert to a secure fill sequence.
/// The password NEVER leaves the native host → extension path (never sent to WebSocket client).
async fn process_auto_login(
    message: &Value,
    native_tx: &NativeTx,
    pending: &PendingMap,
) -> Result<Value, String> {
    let params = message.get("params").ok_or("Missing params")?;
    let domain = params.get("domain")
        .or_else(|| params.get("search"))
        .or_else(|| params.get("url"))
        .and_then(|v| v.as_str())
        .ok_or("autoLogin requires 'domain', 'search', or 'url' parameter")?;

    let search = if domain.starts_with("http") {
        url::Url::parse(domain)
            .map(|u| u.host_str().unwrap_or(domain).to_string())
            .unwrap_or_else(|_| domain.to_string())
    } else {
        domain.to_string()
    };

    let submit = params.get("submit").and_then(|v| v.as_bool()).unwrap_or(false);

    let cred = tokio::task::spawn_blocking(move || goldwarden_get_login(&search))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
        .map_err(|e| e)?;

    let masked = mask_username(&cred.username);

    let fill_id = next_id();
    let fill_msg = json!({
        "action": "secureAutoFill",
        "id": fill_id,
        "params": {
            "username": cred.username,
            "password": cred.password,
            "submit": submit
        }
    });

    let (response_tx, mut response_rx) = mpsc::channel::<Value>(1);
    {
        let mut pending_guard = pending.write().await;
        pending_guard.insert(fill_id.clone(), PendingRequest {
            response_tx,
            started: Instant::now(),
            profile: false,
        });
    }

    native_tx.send(fill_msg).await
        .map_err(|e| format!("Failed to send fill to browser: {}", e))?;

    let fill_result = match timeout(Duration::from_secs(15), response_rx.recv()).await {
        Ok(Some(resp)) => resp,
        Ok(None) => {
            pending.write().await.remove(&fill_id);
            return Err("Fill request channel closed".to_string());
        }
        Err(_) => {
            pending.write().await.remove(&fill_id);
            return Err("Fill request timed out".to_string());
        }
    };

    let fill_ok = fill_result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    let fill_error = fill_result.get("error").and_then(|v| v.as_str()).map(|s| s.to_string());

    Ok(json!({
        "autoLogin": true,
        "filled": fill_ok,
        "maskedUsername": masked,
        "matchedUri": cred.uri,
        "submitted": submit && fill_ok,
        "error": fill_error,
    }))
}

/// Handle a WebSocket client connection
async fn handle_ws_client(
    stream: tokio::net::TcpStream,
    native_tx: NativeTx,
    pending: PendingMap,
) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log!("WebSocket handshake error: {}", e);
            return;
        }
    };

    let (mut write, mut read) = ws_stream.split();

    // Send ready message
    let ready_msg = json!({
        "type": "ready",
        "host": ws_host(),
        "port": ws_port()
    });
    if let Err(e) = write.send(Message::Text(ready_msg.to_string())).await {
        log!("Failed to send ready message: {}", e);
        return;
    }

    while let Some(msg) = read.next().await {
        let msg = match msg {
            Ok(Message::Text(text)) => text,
            Ok(Message::Close(_)) => break,
            Ok(_) => continue, // Ignore ping, pong, binary
            Err(e) => {
                log!("WebSocket read error: {}", e);
                break;
            }
        };

        // Parse the incoming message
        let mut message: Value = match serde_json::from_str(&msg) {
            Ok(m) => m,
            Err(_) => {
                let error_msg = json!({"ok": false, "error": "Invalid JSON"});
                let _ = write.send(Message::Text(error_msg.to_string())).await;
                continue;
            }
        };

        // Check for action
        if message.get("action").is_none() {
            let error_msg = json!({"ok": false, "error": "Missing action"});
            let _ = write.send(Message::Text(error_msg.to_string())).await;
            continue;
        }

        // Generate ID if not provided
        let id = match message.get("id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => {
                let id = next_id();
                message["id"] = json!(id);
                id
            }
        };

        // Check for profiling flag
        let profile = message.get("profile").and_then(|v| v.as_bool()).unwrap_or(false)
            || message.get("params")
                .and_then(|p| p.get("profile"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

        let started = Instant::now();

        // Handle uploadFile action
        if message.get("action").and_then(|v| v.as_str()) == Some("uploadFile") {
            if let Err(e) = process_upload_file(&mut message) {
                let error_msg = json!({"id": id, "ok": false, "error": e});
                let _ = write.send(Message::Text(error_msg.to_string())).await;
                continue;
            }
        }

        // Handle fillForm with filePath in fields
        if message.get("action").and_then(|v| v.as_str()) == Some("fillForm") {
            if let Err(e) = process_fill_form_files(&mut message) {
                let error_msg = json!({"id": id, "ok": false, "error": e});
                let _ = write.send(Message::Text(error_msg.to_string())).await;
                continue;
            }
        }

        // Handle autoLogin — intercepted entirely by native host, credentials never sent to WS client
        if message.get("action").and_then(|v| v.as_str()) == Some("autoLogin") {
            match process_auto_login(&message, &native_tx, &pending).await {
                Ok(result) => {
                    let response = json!({"id": id, "ok": true, "result": result});
                    let _ = write.send(Message::Text(response.to_string())).await;
                }
                Err(e) => {
                    let error_msg = json!({"id": id, "ok": false, "error": e});
                    let _ = write.send(Message::Text(error_msg.to_string())).await;
                }
            }
            continue;
        }

        // Handle vaultStatus — check Goldwarden state without exposing secrets
        if message.get("action").and_then(|v| v.as_str()) == Some("vaultStatus") {
            let result = tokio::task::spawn_blocking(goldwarden_vault_status).await;
            let status_result = match result {
                Ok(inner) => inner,
                Err(e) => Err(format!("Task failed: {}", e)),
            };
            match status_result {
                Ok(status) => {
                    let response = json!({
                        "id": id,
                        "ok": true,
                        "result": {
                            "locked": status.get("locked").and_then(|v| v.as_bool()).unwrap_or(true),
                            "loggedIn": status.get("loggedIn").and_then(|v| v.as_bool()).unwrap_or(false),
                            "loginEntries": status.get("loginEntries").and_then(|v| v.as_u64()).unwrap_or(0),
                        }
                    });
                    let _ = write.send(Message::Text(response.to_string())).await;
                }
                Err(e) => {
                    let error_msg = json!({"id": id, "ok": false, "error": e});
                    let _ = write.send(Message::Text(error_msg.to_string())).await;
                }
            }
            continue;
        }

        // Create response channel for this request
        let (response_tx, mut response_rx) = mpsc::channel::<Value>(1);

        // Register pending request
        {
            let mut pending_guard = pending.write().await;
            pending_guard.insert(id.clone(), PendingRequest {
                response_tx,
                started,
                profile,
            });
        }

        // Send to native messaging
        if let Err(e) = native_tx.send(message).await {
            log!("Failed to send to native: {}", e);
            pending.write().await.remove(&id);
            let error_msg = json!({"id": id, "ok": false, "error": "Failed to send to browser"});
            let _ = write.send(Message::Text(error_msg.to_string())).await;
            continue;
        }

        // Wait for response with timeout
        let timeout_ms = request_timeout_ms();
        let response = match timeout(Duration::from_millis(timeout_ms), response_rx.recv()).await {
            Ok(Some(resp)) => resp,
            Ok(None) => {
                pending.write().await.remove(&id);
                let mut error_msg = json!({"id": id, "ok": false, "error": "Request channel closed"});
                if profile {
                    let host_ms = started.elapsed().as_secs_f64() * 1000.0;
                    error_msg["timing"] = json!({"hostMs": (host_ms * 100.0).round() / 100.0});
                }
                let _ = write.send(Message::Text(error_msg.to_string())).await;
                continue;
            }
            Err(_) => {
                pending.write().await.remove(&id);
                let mut error_msg = json!({"id": id, "ok": false, "error": "Request timed out"});
                if profile {
                    let host_ms = started.elapsed().as_secs_f64() * 1000.0;
                    error_msg["timing"] = json!({"hostMs": (host_ms * 100.0).round() / 100.0});
                }
                let _ = write.send(Message::Text(error_msg.to_string())).await;
                continue;
            }
        };

        // Send response back to client
        if let Err(e) = write.send(Message::Text(response.to_string())).await {
            log!("Failed to send response: {}", e);
            break;
        }
    }
}

/// Read native messaging input from stdin (blocking, runs in separate thread)
fn read_native_stdin(tx: mpsc::Sender<Value>) {
    let stdin = io::stdin();
    let mut stdin = stdin.lock();
    let mut len_buf = [0u8; 4];

    loop {
        // Read 4-byte length prefix (little-endian)
        if stdin.read_exact(&mut len_buf).is_err() {
            log!("Native messaging stream ended");
            break;
        }

        let len = u32::from_le_bytes(len_buf) as usize;
        if len == 0 || len > 100 * 1024 * 1024 {
            log!("Invalid message length: {}", len);
            continue;
        }

        // Read message body
        let mut msg_buf = vec![0u8; len];
        if stdin.read_exact(&mut msg_buf).is_err() {
            log!("Failed to read message body");
            continue;
        }

        // Parse JSON
        let message: Value = match serde_json::from_slice(&msg_buf) {
            Ok(m) => m,
            Err(e) => {
                log!("Failed to parse native message: {}", e);
                continue;
            }
        };

        // Send to async handler
        if tx.blocking_send(message).is_err() {
            log!("Failed to send native message to handler");
            break;
        }
    }
}

/// Write native messaging output to stdout
fn write_native_stdout(message: &Value) {
    let payload = message.to_string();
    let payload_bytes = payload.as_bytes();
    let len = payload_bytes.len() as u32;
    let len_bytes = len.to_le_bytes();

    let stdout = io::stdout();
    let mut stdout = stdout.lock();

    if stdout.write_all(&len_bytes).is_err() {
        log!("Failed to write message length");
        return;
    }
    if stdout.write_all(payload_bytes).is_err() {
        log!("Failed to write message body");
        return;
    }
    if stdout.flush().is_err() {
        log!("Failed to flush stdout");
    }
}

/// Process messages from the browser extension
async fn handle_native_messages(
    mut native_rx: mpsc::Receiver<Value>,
    pending: PendingMap,
) {
    while let Some(mut message) = native_rx.recv().await {
        // Check if this is a response to a pending request
        if let Some(id) = message.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()) {
            let entry = pending.write().await.remove(&id);
            if let Some(req) = entry {
                // Add timing if profiling
                if req.profile {
                    let host_ms = req.started.elapsed().as_secs_f64() * 1000.0;
                    let timing = message.get("timing")
                        .and_then(|t| t.as_object())
                        .cloned()
                        .unwrap_or_default();
                    let mut timing_obj = timing;
                    timing_obj.insert("hostMs".to_string(), json!((host_ms * 100.0).round() / 100.0));
                    message["timing"] = json!(timing_obj);
                }

                // Send response back to the WebSocket client
                let _ = req.response_tx.send(message).await;
                continue;
            }
        }

        // Not a response - this is an event, broadcast to all clients
        // (For now we just log it, as we don't track all connected clients for broadcasting)
        log!("Received event from browser: {}", message);
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let host = ws_host();
    let port = ws_port();
    let addr = format!("{}:{}", host, port);

    // Create pending request map
    let pending: PendingMap = Arc::new(RwLock::new(HashMap::new()));

    // Create channel for outgoing native messages
    let (native_out_tx, mut native_out_rx) = mpsc::channel::<Value>(100);

    // Create channel for incoming native messages
    let (native_in_tx, native_in_rx) = mpsc::channel::<Value>(100);

    // Spawn thread for reading native stdin (blocking I/O)
    let stdin_tx = native_in_tx.clone();
    std::thread::spawn(move || {
        read_native_stdin(stdin_tx);
        std::process::exit(0);
    });

    // Spawn task for writing to native stdout
    tokio::spawn(async move {
        while let Some(message) = native_out_rx.recv().await {
            write_native_stdout(&message);
        }
    });

    // Spawn task for handling incoming native messages
    let pending_clone = pending.clone();
    tokio::spawn(async move {
        handle_native_messages(native_in_rx, pending_clone).await;
    });

    // Start WebSocket server
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            log!("Failed to bind to {}: {}", addr, e);
            std::process::exit(1);
        }
    };

    log!("WebSocket server listening on ws://{}", addr);

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let native_tx = native_out_tx.clone();
                let pending_clone = pending.clone();
                tokio::spawn(async move {
                    handle_ws_client(stream, native_tx, pending_clone).await;
                });
            }
            Err(e) => {
                log!("Failed to accept connection: {}", e);
            }
        }
    }
}
