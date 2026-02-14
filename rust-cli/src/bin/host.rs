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
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bronzewarden::config::Config as BwConfig;
use bronzewarden::crypto::{EncString, MasterKey};
use bronzewarden::vault::Vault;
use bronzewarden::api::SyncResponse;

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::process::Command;
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

fn autologin_require_fingerprint() -> bool {
    env::var("FAB_AUTOLOGIN_REQUIRE_FINGERPRINT")
        .ok()
        .map(|v| {
            let normalized = v.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(true)
}

fn fingerprint_timeout_ms() -> u64 {
    env::var("FAB_FINGERPRINT_TIMEOUT_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(20000)
}

async fn verify_fingerprint() -> Result<(), String> {
    let user = env::var("USER").map_err(|_| "USER env var is not set for fingerprint verification.")?;
    let mut cmd = Command::new("fprintd-verify");
    cmd.arg(&user)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = timeout(Duration::from_millis(fingerprint_timeout_ms()), cmd.output())
        .await
        .map_err(|_| "Fingerprint verification timed out. Touch the enrolled fingerprint sensor and try again.")?
        .map_err(|e: std::io::Error| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "fprintd-verify not found. Install fprintd to use fingerprint auth.".to_string()
            } else {
                format!("Failed to run fprintd-verify: {}", e)
            }
        })?;

    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr.trim().split('\n').rev().find(|l| !l.trim().is_empty())
        .or_else(|| stdout.trim().split('\n').rev().find(|l| !l.trim().is_empty()))
        .unwrap_or("verification failed");
    Err(format!("Fingerprint verification failed: {}", detail))
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
struct VaultCredential {
    username: String,
    password: String,
    uri: String,
}

type SharedVault = Arc<RwLock<Option<Vault>>>;

fn vault_status() -> Result<Value, String> {
    let config = BwConfig::load().map_err(|e| format!("Failed to load config: {}", e))?;
    let logged_in = config.is_logged_in();
    let has_cache = BwConfig::load_vault_cache().is_ok();
    let login_entries = BwConfig::load_vault_cache()
        .map(|c| c.ciphers.iter().filter(|c| c.cipher_type == 1 && c.deleted_date.is_none()).count())
        .unwrap_or(0);

    Ok(json!({
        "locked": !has_cache,
        "loggedIn": logged_in,
        "loginEntries": login_entries,
    }))
}

fn vault_get_login(vault: &Vault, search: &str) -> Result<VaultCredential, String> {
    let results = vault.find_by_domain(search);
    let results = if results.is_empty() {
        vault.search(search)
    } else {
        results
    };

    if results.is_empty() {
        return Err(format!("No login found for '{}'", search));
    }

    let cred = &results[0];
    Ok(VaultCredential {
        username: cred.username.clone(),
        password: cred.password.clone(),
        uri: cred.uris.first().cloned().unwrap_or_else(|| search.to_string()),
    })
}

fn read_password_from_env() -> Option<String> {
    env::var("BW_PASSWORD")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn read_password_from_file() -> Option<String> {
    let path = env::var("BW_PASSWORD_FILE").ok()?;
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn read_password_from_secret_tool() -> Option<String> {
    let output = std::process::Command::new("secret-tool")
        .args([
            "lookup",
            "service",
            "firefox-agent-bridge",
            "account",
            "bronzewarden",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn resolve_bw_password() -> Result<String, String> {
    if let Some(pw) = read_password_from_env() {
        return Ok(pw);
    }
    if let Some(pw) = read_password_from_file() {
        return Ok(pw);
    }
    if let Some(pw) = read_password_from_secret_tool() {
        return Ok(pw);
    }
    Err(
        "No vault password source available. Set BW_PASSWORD, set BW_PASSWORD_FILE, or store password via secret-tool."
            .to_string(),
    )
}

fn unlock_vault_from_sources() -> Result<Vault, String> {
    let config = BwConfig::load().map_err(|e| format!("Failed to load config: {}", e))?;
    let email = config.email.as_ref()
        .ok_or("Not logged in to bronzewarden. Run `bronzewarden login` first.")?;
    let encrypted_key = config.encrypted_user_key.as_ref()
        .ok_or("No user key stored. Run `bronzewarden login` first.")?;
    let kdf_params = config.kdf_params()
        .ok_or("No KDF params stored.")?;

    let password = resolve_bw_password()?;

    let master_key = MasterKey::derive(&password, email, &kdf_params)
        .map_err(|e| format!("Key derivation failed: {}", e))?;
    let stretched = master_key.stretch()
        .map_err(|e| format!("Key stretch failed: {}", e))?;
    let user_key = EncString(encrypted_key.clone()).decrypt_to_key(&stretched)
        .map_err(|e| format!("Failed to decrypt user key: {}", e))?;

    let cache = BwConfig::load_vault_cache()
        .map_err(|e| format!("Failed to load vault cache: {}. Run `bronzewarden sync` first.", e))?;
    let sync = SyncResponse {
        profile: bronzewarden::api::SyncProfile {
            id: String::new(),
            email: config.email.clone(),
            key: config.encrypted_user_key.clone(),
            private_key: None,
        },
        ciphers: cache.ciphers,
        folders: None,
    };

    Ok(Vault::new(user_key, &sync))
}

async fn ensure_vault_unlocked(vault: &SharedVault) -> Result<(), String> {
    if vault.read().await.is_some() {
        return Ok(());
    }

    let unlocked = tokio::task::spawn_blocking(unlock_vault_from_sources)
        .await
        .map_err(|e| format!("Unlock task failed: {}", e))??;

    let mut guard = vault.write().await;
    if guard.is_none() {
        *guard = Some(unlocked);
    }
    Ok(())
}

/// Process autoLogin action — query bronzewarden vault and convert to a secure fill sequence.
/// The password NEVER leaves the native host → extension path (never sent to WebSocket client).
async fn process_auto_login(
    message: &Value,
    native_tx: &NativeTx,
    pending: &PendingMap,
    vault: &SharedVault,
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

    ensure_vault_unlocked(vault).await?;

    if autologin_require_fingerprint() {
        verify_fingerprint().await?;
    }

    let vault_guard = vault.read().await;
    let v = vault_guard.as_ref()
        .ok_or("Vault is not unlocked.")?;
    let cred = vault_get_login(v, &search)?;
    drop(vault_guard);

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
    vault: SharedVault,
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

        // Hard policy gate: configureAuth is not allowed via agent-facing API.
        if message.get("action").and_then(|v| v.as_str()) == Some("configureAuth") {
            let error_msg = json!({
                "id": id,
                "ok": false,
                "error": "configureAuth is not supported by this host build."
            });
            let _ = write.send(Message::Text(error_msg.to_string())).await;
            continue;
        }

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
            match process_auto_login(&message, &native_tx, &pending, &vault).await {
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

        // Handle vaultStatus — check bronzewarden state without exposing secrets
        if message.get("action").and_then(|v| v.as_str()) == Some("vaultStatus") {
            let _ = ensure_vault_unlocked(&vault).await;
            let vault_unlocked = vault.read().await.is_some();
            let status_result = tokio::task::spawn_blocking(vault_status).await;
            let status_result = match status_result {
                Ok(inner) => inner,
                Err(e) => Err(format!("Task failed: {}", e)),
            };
            match status_result {
                Ok(mut status) => {
                    status["locked"] = json!(!vault_unlocked);
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

    // Try to unlock the bronzewarden vault at startup
    let vault: SharedVault = Arc::new(RwLock::new(None));
    match unlock_vault_from_sources() {
        Ok(v) => {
            log!("Bronzewarden vault unlocked ({} logins)", v.login_count());
            *vault.write().await = Some(v);
        }
        Err(e) => {
            log!("Vault not unlocked at startup (will retry on demand): {}", e);
        }
    }

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
                let vault_clone = vault.clone();
                tokio::spawn(async move {
                    handle_ws_client(stream, native_tx, pending_clone, vault_clone).await;
                });
            }
            Err(e) => {
                log!("Failed to accept connection: {}", e);
            }
        }
    }
}
