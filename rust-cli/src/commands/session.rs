use anyhow::{anyhow, Result};
#[cfg(unix)]
use futures_util::{SinkExt, StreamExt};
#[cfg(unix)]
use serde_json::json;
use serde_json::Value;
use std::path::PathBuf;
#[cfg(unix)]
use std::sync::Arc;
#[cfg(unix)]
use std::time::Duration;
#[cfg(unix)]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::TcpStream;
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};
#[cfg(unix)]
use tokio::sync::{mpsc, Mutex, Notify};
#[cfg(unix)]
use tokio::time::timeout;
#[cfg(unix)]
use tokio_tungstenite::tungstenite::Message;
#[cfg(unix)]
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

#[cfg(unix)]
use crate::config::{ws_url, TIMEOUT_MS};

fn runtime_dir() -> PathBuf {
    #[cfg(windows)]
    {
        return std::env::temp_dir();
    }

    #[cfg(not(windows))]
    {
        if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
            PathBuf::from(dir)
        } else {
            PathBuf::from("/tmp")
        }
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
    #[cfg(windows)]
    {
        let _ = name;
        return false;
    }

    #[cfg(unix)]
    {
        session_is_alive(&session_pid_path(name), &session_socket_path(name))
    }
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    // Reject process-group IDs and values that overflow pid_t.
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(unix)]
fn session_is_alive(pid_path: &std::path::Path, socket_path: &std::path::Path) -> bool {
    std::fs::read_to_string(pid_path)
        .ok()
        .and_then(|pid| pid.trim().parse::<u32>().ok())
        .is_some_and(|pid| {
            process_is_alive(pid) && std::os::unix::net::UnixStream::connect(socket_path).is_ok()
        })
}

fn window_path(name: &str) -> PathBuf {
    runtime_dir().join(format!("browser-session-{}.window.json", name))
}

#[cfg(unix)]
async fn close_bound_window(name: &str) -> Result<()> {
    let path = window_path(name);
    if !path.exists() {
        return Ok(());
    }
    let window: Value = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
    let url = window["wsUrl"]
        .as_str()
        .ok_or_else(|| anyhow!("Missing window host URL"))?;
    // A manually closed window is already clean, including with older
    // extensions that do not implement closeWindow.
    let tabs = timeout(
        Duration::from_secs(3),
        crate::client::send_command_to_url(
            url,
            "listTabs",
            json!({"windowId": window["windowId"]}),
        ),
    )
    .await
    .map_err(|_| anyhow!("Timeout checking session window"))??;
    if let crate::protocol::Response::Success {
        ok: true,
        result: Some(tabs),
    } = tabs
    {
        if let Some(windows) = tabs["windows"].as_array() {
            if !windows
                .iter()
                .any(|entry| entry["windowId"] == window["windowId"])
            {
                std::fs::remove_file(path)?;
                return Ok(());
            }
        }
    }
    let response = timeout(
        Duration::from_secs(3),
        crate::client::send_command_to_url(
            url,
            "closeWindow",
            json!({"windowId": window["windowId"], "tabId": window["tabId"]}),
        ),
    )
    .await
    .map_err(|_| anyhow!("Timeout closing session window"))??;
    match response {
        crate::protocol::Response::Success { ok: true, .. } => {
            std::fs::remove_file(path)?;
            Ok(())
        }
        _ => Err(anyhow!("Could not close session window: {:?}", response)),
    }
}

#[cfg(unix)]
async fn ws_request(
    state: &Arc<Mutex<SessionState>>,
    read: &mut futures_util::stream::SplitStream<WsStream>,
    id: &str,
    action: &str,
    params: Value,
) -> Result<Value> {
    state
        .lock()
        .await
        .ws_write
        .send(Message::Text(
            json!({"id": id, "action": action, "params": params}).to_string(),
        ))
        .await?;
    timeout(Duration::from_secs(20), async {
        while let Some(message) = read.next().await {
            if let Message::Text(text) = message? {
                let response: Value = serde_json::from_str(&text)?;
                if response["id"].as_str() == Some(id) {
                    if response["ok"].as_bool() != Some(true) {
                        return Err(anyhow!("{}: {}", action, response["error"]));
                    }
                    return Ok(response["result"].clone());
                }
            }
        }
        Err(anyhow!("Browser bridge disconnected"))
    })
    .await
    .map_err(|_| anyhow!("Timeout waiting for {}", action))?
}

#[cfg(unix)]
type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[cfg(unix)]
struct SessionState {
    ws_write: futures_util::stream::SplitSink<WsStream, Message>,
    pending: std::collections::HashMap<String, mpsc::Sender<Value>>,
    counter: u64,
    session_id: Option<String>,
    shutdown: Arc<Notify>,
}

pub async fn run(name: &str, bind_window: bool) -> Result<()> {
    #[cfg(not(unix))]
    {
        let _ = (name, bind_window);
        return Err(anyhow!(
            "Persistent browser sessions are not supported on this platform yet. Use direct browser commands instead."
        ));
    }

    #[cfg(unix)]
    {
        let sock_path = session_socket_path(name);
        let pid_path = session_pid_path(name);

        if sock_path.exists() {
            if is_session_running(name) {
                return Err(anyhow!("Session '{}' is already running", name));
            }
            cleanup_socket(name);
        }

        eprintln!("[session:{}] Connecting to browser bridge...", name);

        let (ws_stream, _) = connect_async(ws_url()).await.map_err(|e| {
            anyhow!(
                "WebSocket error: {}\nIs Firefox running with the Browser Agent Bridge extension?",
                e
            )
        })?;

        let (ws_write, mut ws_read) = ws_stream.split();

        let shutdown = Arc::new(Notify::new());
        let state = Arc::new(Mutex::new(SessionState {
            ws_write,
            pending: std::collections::HashMap::new(),
            counter: 0,
            session_id: None,
            shutdown: shutdown.clone(),
        }));

        // Read the ready message to get session ID
        if let Some(Ok(Message::Text(text))) = ws_read.next().await {
            if let Ok(msg) = serde_json::from_str::<Value>(&text) {
                if msg.get("type").and_then(|v| v.as_str()) == Some("ready") {
                    let sid = msg
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    state.lock().await.session_id = sid.clone();
                    eprintln!(
                        "[session:{}] Connected (session: {})",
                        name,
                        sid.as_deref().unwrap_or("unknown")
                    );
                }
            }
        }

        // A crash leaves window metadata behind; rebind the existing window
        // before creating another one. No extension UI changes are needed.
        let mut bound_window_id = None;
        if bind_window {
            let saved = std::fs::read_to_string(window_path(name))
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok());
            let mut bound = None;
            if let Some(saved) = saved {
                if let Ok(active) = ws_request(
                    &state,
                    &mut ws_read,
                    "sess_reuse_window",
                    "getActiveTab",
                    json!({"windowId": saved["windowId"]}),
                )
                .await
                {
                    bound = ws_request(
                        &state,
                        &mut ws_read,
                        "sess_reuse_tab",
                        "setActiveTab",
                        json!({"tabId": active["tabId"], "focus": false}),
                    )
                    .await
                    .ok();
                }
            }
            let bound = match bound {
                Some(bound) => bound,
                None => ws_request(&state, &mut ws_read, "sess_bind_window", "newSession",
                    json!({"window": true, "focus": false, "url": "about:blank", "returnContent": false})).await?,
            };
            bound_window_id = bound["windowId"].as_i64();
            if bound_window_id.is_none() {
                return Err(anyhow!("Missing bound window ID"));
            }
            std::fs::write(
                window_path(name),
                json!({
                    "windowId": bound["windowId"], "tabId": bound["tabId"], "wsUrl": ws_url(),
                })
                .to_string(),
            )?;
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
                "windowId": bound_window_id,
            })
        );

        // Task: read WebSocket responses and dispatch to pending requests
        let state_ws = state.clone();
        let mut ws_reader = tokio::spawn(async move {
            while let Some(msg) = ws_read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Ok(response) = serde_json::from_str::<Value>(&text) {
                            if let Some(id) = response
                                .get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
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
        let mut acceptor = tokio::spawn(async move {
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
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! {
            _ = &mut ws_reader => {
                eprintln!("[session:{}] WebSocket reader exited", name);
            }
            _ = &mut acceptor => {
                eprintln!("[session:{}] Acceptor exited", name);
            }
            _ = shutdown.notified() => {}
            _ = terminate.recv() => {}
            _ = tokio::signal::ctrl_c() => {
                eprintln!("[session:{}] Shutting down", name);
            }
        }

        acceptor.abort();
        ws_reader.abort();
        if let Err(error) = close_bound_window(name).await {
            eprintln!("[session:{}] {}; preserving window for reuse", name, error);
        }
        cleanup_socket(name);
        Ok(())
    }
}

#[cfg(unix)]
async fn handle_unix_client(stream: UnixStream, state: Arc<Mutex<SessionState>>) -> Result<()> {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    let mut line = String::new();
    while reader.read_line(&mut line).await? > 0 {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            line.clear();
            continue;
        }

        let mut message: Value =
            serde_json::from_str(trimmed).map_err(|e| anyhow!("Invalid JSON: {}", e))?;

        if message["action"].as_str() == Some("__stopSession") {
            write_half
                .write_all(b"{\"ok\":true,\"result\":{\"stopped\":true}}\n")
                .await?;
            state.lock().await.shutdown.notify_one();
            return Ok(());
        }

        let (id, rx) = {
            let mut st = state.lock().await;
            st.counter += 1;
            let id = format!(
                "sess_{}_{}",
                st.session_id.as_deref().unwrap_or("x"),
                st.counter
            );
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

#[cfg(unix)]
async fn rx_recv_owned(mut rx: mpsc::Receiver<Value>) -> Option<Value> {
    rx.recv().await
}

pub async fn send_via_session(session_name: &str, action: &str, params: Value) -> Result<Value> {
    #[cfg(not(unix))]
    {
        let _ = (session_name, action, params);
        return Err(anyhow!(
            "Persistent browser sessions are not supported on this platform yet. Use direct browser commands instead."
        ));
    }

    #[cfg(unix)]
    {
        let sock_path = session_socket_path(session_name);
        if !sock_path.exists() {
            return Err(anyhow!(
                "Session '{}' not running (no socket at {})",
                session_name,
                sock_path.display()
            ));
        }

        let stream = UnixStream::connect(&sock_path)
            .await
            .map_err(|e| anyhow!("Failed to connect to session '{}': {}", session_name, e))?;

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
        let bytes_read = timeout(
            Duration::from_millis(TIMEOUT_MS),
            reader.read_line(&mut response_line),
        )
        .await
        .map_err(|_| anyhow!("Timeout waiting for session response"))??;

        if bytes_read == 0 {
            return Err(anyhow!("Session closed connection"));
        }

        let response: Value = serde_json::from_str(response_line.trim())?;
        Ok(response)
    }
}

pub async fn stop(name: &str) -> Result<()> {
    #[cfg(windows)]
    {
        cleanup_socket(name);
        eprintln!("Persistent browser sessions are not supported on Windows; removed stale session files for '{}'.", name);
        return Ok(());
    }

    #[cfg(unix)]
    {
        if is_session_running(name) {
            // Stop through the socket, never signal a PID from a stale file.
            send_via_session(name, "__stopSession", json!({})).await?;
            // Cleanup can spend three seconds checking the window and another
            // three seconds closing it when the browser is unresponsive.
            let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
            while session_pid_path(name).exists() {
                if tokio::time::Instant::now() >= deadline {
                    return Err(anyhow!("Session '{}' did not stop", name));
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            if window_path(name).exists() {
                return Err(anyhow!("Session stopped, but its window could not be closed; metadata retained for reuse"));
            }
        } else {
            close_bound_window(name).await?;
            cleanup_socket(name);
        }
        Ok(())
    }
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn live_session_is_running_on_unix() {
        let temp = tempfile::Builder::new()
            .prefix("fab-")
            .tempdir_in("/tmp")
            .unwrap();
        let socket = temp.path().join("session.sock");
        let pid = temp.path().join("session.pid");
        let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        std::fs::write(&pid, std::process::id().to_string()).unwrap();
        assert!(
            session_is_alive(&pid, &socket),
            "live macOS and Linux sessions must be running"
        );
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let dead_pid = child.id();
        child.wait().unwrap();
        assert!(!process_is_alive(dead_pid));
        assert!(!process_is_alive(0));
        assert!(!process_is_alive(u32::MAX));
        std::fs::write(&pid, dead_pid.to_string()).unwrap();
        assert!(
            !session_is_alive(&pid, &socket),
            "stale dead PID must not be running"
        );
        std::fs::write(&pid, "not-a-pid").unwrap();
        assert!(!session_is_alive(&pid, &socket));
        std::fs::write(&pid, std::process::id().to_string()).unwrap();
        drop(listener);
        assert!(
            !session_is_alive(&pid, &socket),
            "socket without a listener must be dead"
        );
        std::fs::remove_file(&pid).unwrap();
        assert!(
            !session_is_alive(&pid, &socket),
            "missing PID file must be dead"
        );
    }
}
