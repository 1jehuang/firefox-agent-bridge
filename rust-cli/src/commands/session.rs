use anyhow::{anyhow, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpStream, UnixListener, UnixStream};
use tokio::sync::{mpsc, Mutex};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::config::{TIMEOUT_MS, WS_URL};

fn runtime_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
        PathBuf::from(dir)
    } else {
        PathBuf::from("/tmp")
    }
}

pub fn session_socket_path(name: &str) -> PathBuf {
    runtime_dir().join(format!("browser-session-{}.sock", name))
}

pub fn session_pid_path(name: &str) -> PathBuf {
    runtime_dir().join(format!("browser-session-{}.pid", name))
}

fn cleanup_socket(name: &str) {
    let path = session_socket_path(name);
    let _ = std::fs::remove_file(&path);
    let pid_path = session_pid_path(name);
    let _ = std::fs::remove_file(&pid_path);
}

pub fn is_session_running(name: &str) -> bool {
    let pid_path = session_pid_path(name);
    if let Ok(pid_str) = std::fs::read_to_string(&pid_path) {
        if let Ok(pid) = pid_str.trim().parse::<u32>() {
            let proc_path = format!("/proc/{}", pid);
            if std::path::Path::new(&proc_path).exists() {
                return true;
            }
        }
    }
    false
}

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct SessionState {
    ws_write: futures_util::stream::SplitSink<WsStream, Message>,
    pending: std::collections::HashMap<String, mpsc::Sender<Value>>,
    counter: u64,
    session_id: Option<String>,
}

pub async fn run(name: &str) -> Result<()> {
    let sock_path = session_socket_path(name);
    let pid_path = session_pid_path(name);

    if sock_path.exists() {
        if is_session_running(name) {
            return Err(anyhow!("Session '{}' is already running", name));
        }
        cleanup_socket(name);
    }

    eprintln!("[session:{}] Connecting to browser bridge...", name);

    let (ws_stream, _) = connect_async(WS_URL).await.map_err(|e| {
        anyhow!(
            "WebSocket error: {}\nIs Firefox running with the Browser Agent Bridge extension?",
            e
        )
    })?;

    let (ws_write, mut ws_read) = ws_stream.split();

    let state = Arc::new(Mutex::new(SessionState {
        ws_write,
        pending: std::collections::HashMap::new(),
        counter: 0,
        session_id: None,
    }));

    // Read the ready message to get session ID
    if let Some(Ok(Message::Text(text))) = ws_read.next().await {
        if let Ok(msg) = serde_json::from_str::<Value>(&text) {
            if msg.get("type").and_then(|v| v.as_str()) == Some("ready") {
                let sid = msg.get("sessionId").and_then(|v| v.as_str()).map(|s| s.to_string());
                state.lock().await.session_id = sid.clone();
                eprintln!(
                    "[session:{}] Connected (session: {})",
                    name,
                    sid.as_deref().unwrap_or("unknown")
                );
            }
        }
    }

    // Write PID file
    std::fs::write(&pid_path, std::process::id().to_string())?;

    // Create Unix socket listener
    let listener = UnixListener::bind(&sock_path)?;
    eprintln!("[session:{}] Listening on {}", name, sock_path.display());

    // Print ready JSON to stdout so callers can detect startup
    println!(
        "{}",
        json!({
            "ready": true,
            "session": name,
            "socket": sock_path.to_string_lossy(),
            "pid": std::process::id(),
        })
    );

    // Task: read WebSocket responses and dispatch to pending requests
    let state_ws = state.clone();
    let ws_reader = tokio::spawn(async move {
        while let Some(msg) = ws_read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(response) = serde_json::from_str::<Value>(&text) {
                        if let Some(id) =
                            response.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
                        {
                            let tx = state_ws.lock().await.pending.remove(&id);
                            if let Some(tx) = tx {
                                let _ = tx.send(response).await;
                            }
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    eprintln!("[session] WebSocket closed by server");
                    break;
                }
                Err(e) => {
                    eprintln!("[session] WebSocket error: {}", e);
                    break;
                }
                _ => {}
            }
        }
    });

    // Task: accept Unix socket connections and proxy commands
    let state_accept = state.clone();
    let name_owned = name.to_string();
    let acceptor = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let state_clone = state_accept.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_unix_client(stream, state_clone).await {
                            eprintln!("[session] Client error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    eprintln!("[session:{}] Accept error: {}", name_owned, e);
                    break;
                }
            }
        }
    });

    // Wait for either task to finish (WebSocket disconnect or signal)
    tokio::select! {
        _ = ws_reader => {
            eprintln!("[session:{}] WebSocket reader exited", name);
        }
        _ = acceptor => {
            eprintln!("[session:{}] Acceptor exited", name);
        }
        _ = tokio::signal::ctrl_c() => {
            eprintln!("[session:{}] Shutting down", name);
        }
    }

    cleanup_socket(name);
    Ok(())
}

async fn handle_unix_client(
    stream: UnixStream,
    state: Arc<Mutex<SessionState>>,
) -> Result<()> {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    let mut line = String::new();
    while reader.read_line(&mut line).await? > 0 {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            line.clear();
            continue;
        }

        let mut message: Value = serde_json::from_str(trimmed).map_err(|e| {
            anyhow!("Invalid JSON: {}", e)
        })?;

        let (id, rx) = {
            let mut st = state.lock().await;
            st.counter += 1;
            let id = format!("sess_{}_{}", st.session_id.as_deref().unwrap_or("x"), st.counter);
            message["id"] = json!(&id);

            let (tx, rx) = mpsc::channel::<Value>(1);
            st.pending.insert(id.clone(), tx);

            let msg_str = message.to_string();
            st.ws_write
                .send(Message::Text(msg_str))
                .await
                .map_err(|e| anyhow!("WS send error: {}", e))?;

            (id, rx)
        };

        let response = match timeout(Duration::from_millis(TIMEOUT_MS), rx_recv_owned(rx)).await {
            Ok(Some(resp)) => resp,
            Ok(None) => {
                state.lock().await.pending.remove(&id);
                json!({"ok": false, "error": "Channel closed"})
            }
            Err(_) => {
                state.lock().await.pending.remove(&id);
                json!({"ok": false, "error": "Timeout"})
            }
        };

        let mut out = response.to_string();
        out.push('\n');
        write_half.write_all(out.as_bytes()).await?;

        line.clear();
    }

    Ok(())
}

async fn rx_recv_owned(mut rx: mpsc::Receiver<Value>) -> Option<Value> {
    rx.recv().await
}

pub async fn send_via_session(
    session_name: &str,
    action: &str,
    params: Value,
) -> Result<Value> {
    let sock_path = session_socket_path(session_name);
    if !sock_path.exists() {
        return Err(anyhow!(
            "Session '{}' not running (no socket at {})",
            session_name,
            sock_path.display()
        ));
    }

    let stream = UnixStream::connect(&sock_path).await.map_err(|e| {
        anyhow!("Failed to connect to session '{}': {}", session_name, e)
    })?;

    let (read_half, mut write_half) = stream.into_split();

    let request = json!({
        "action": action,
        "params": params,
    });

    let mut msg = request.to_string();
    msg.push('\n');
    write_half.write_all(msg.as_bytes()).await?;

    let mut reader = BufReader::new(read_half);
    let mut response_line = String::new();
    let bytes_read = timeout(Duration::from_millis(TIMEOUT_MS), reader.read_line(&mut response_line))
        .await
        .map_err(|_| anyhow!("Timeout waiting for session response"))??;

    if bytes_read == 0 {
        return Err(anyhow!("Session closed connection"));
    }

    let response: Value = serde_json::from_str(response_line.trim())?;
    Ok(response)
}

pub async fn stop(name: &str) -> Result<()> {
    let pid_path = session_pid_path(name);
    if let Ok(pid_str) = std::fs::read_to_string(&pid_path) {
        if let Ok(pid) = pid_str.trim().parse::<u32>() {
            let _ = std::process::Command::new("kill")
                .arg(pid.to_string())
                .status();
            eprintln!("Sent SIGTERM to session '{}' (pid {})", name, pid);
        }
    }
    cleanup_socket(name);
    Ok(())
}

pub fn list() -> Result<()> {
    let dir = runtime_dir();
    let mut found = false;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("browser-session-") && name_str.ends_with(".pid") {
                let session_name = name_str
                    .strip_prefix("browser-session-")
                    .unwrap_or("")
                    .strip_suffix(".pid")
                    .unwrap_or("");
                let running = is_session_running(session_name);
                let pid = std::fs::read_to_string(entry.path())
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                println!(
                    "{}  pid={}  {}",
                    session_name,
                    pid,
                    if running { "running" } else { "dead" }
                );
                found = true;
            }
        }
    }
    if !found {
        println!("No active browser sessions");
    }
    Ok(())
}
