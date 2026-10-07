#![cfg(unix)]
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::timeout;

fn cli(runtime: &std::path::Path, url: &str) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_browser"));
    command
        .env("XDG_RUNTIME_DIR", runtime)
        .env("FAB_WS_URL", url)
        .env_remove("BROWSER_SESSION")
        .kill_on_drop(true);
    command
}

async fn start(runtime: &std::path::Path, url: &str) -> (Child, Value) {
    let mut child = cli(runtime, url)
        .args(["session", "start", "test", "--bind-window"])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    timeout(
        Duration::from_secs(10),
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line),
    )
    .await
    .unwrap()
    .unwrap();
    (child, serde_json::from_str(&line).unwrap())
}

async fn stop(runtime: &std::path::Path, url: &str) {
    assert!(cli(runtime, url)
        .args(["session", "stop", "test"])
        .status()
        .await
        .unwrap()
        .success());
    assert!(!runtime.join("browser-session-test.sock").exists());
    assert!(!runtime.join("browser-session-test.pid").exists());
    assert!(!runtime.join("browser-session-test.window.json").exists());
}

#[tokio::test]
async fn session_reuses_window_after_crash_and_closes_it_on_stop() {
    let runtime = tempfile::Builder::new()
        .prefix("fab-")
        .tempdir_in("/tmp")
        .unwrap();
    let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}", server.local_addr().unwrap());
    // (created windows, currently open window)
    let windows = Arc::new(Mutex::new((0, None::<i64>)));
    let state = windows.clone();
    let server = tokio::spawn(async move {
        loop {
            let (stream, _) = server.accept().await.unwrap();
            let state = state.clone();
            tokio::spawn(async move {
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                ws.send(tokio_tungstenite::tungstenite::Message::Text(
                    json!({"type":"ready", "sessionId":"fixture"}).to_string(),
                ))
                .await
                .unwrap();
                while let Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) =
                    ws.next().await
                {
                    let request: Value = serde_json::from_str(&text).unwrap();
                    let result = {
                        let mut windows = state.lock().unwrap();
                        match request["action"].as_str().unwrap() {
                            "newSession" => {
                                windows.0 += 1;
                                windows.1 = Some(windows.0);
                                json!({"windowId":windows.0,"tabId":windows.0})
                            }
                            "getActiveTab" | "setActiveTab" if windows.1.is_some() => {
                                json!({"windowId":windows.1,"tabId":windows.1})
                            }
                            "closeWindow" => {
                                assert_eq!(request["params"]["windowId"], json!(windows.1));
                                windows.1 = None;
                                json!({"closed":true})
                            }
                            "listTabs" => json!({"windows":[{"windowId":windows.1}],"totalTabs":1}),
                            "ping" => json!({"pong":true}),
                            _ => Value::Null,
                        }
                    };
                    ws.send(tokio_tungstenite::tungstenite::Message::Text(
                        json!({"id":request["id"],"ok":!result.is_null(),"result":result,"error":if result.is_null() {json!("missing window")} else {Value::Null}}).to_string())).await.unwrap();
                }
            });
        }
    });
    let (mut child, first) = start(runtime.path(), &url).await;
    assert!(String::from_utf8(
        cli(runtime.path(), &url)
            .args(["session", "list"])
            .output()
            .await
            .unwrap()
            .stdout
    )
    .unwrap()
    .contains("running"));
    for _ in 0..5 {
        let output = cli(runtime.path(), &url)
            .env("BROWSER_SESSION", "test")
            .arg("listTabs")
            .output()
            .await
            .unwrap();
        assert!(output.status.success());
        let tabs: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(tabs["windows"][0]["windowId"], first["windowId"]);
    }
    assert_eq!(windows.lock().unwrap().0, 1);
    child.kill().await.unwrap();
    child.wait().await.unwrap();
    let (mut replacement, second) = start(runtime.path(), &url).await;
    assert_eq!(second["windowId"], first["windowId"]);
    assert_eq!(
        windows.lock().unwrap().0,
        1,
        "crash recovery must reuse window"
    );
    stop(runtime.path(), &url).await;
    assert!(replacement.wait().await.unwrap().success());
    assert!(windows.lock().unwrap().1.is_none());

    // SIGTERM (including external session supervisors) uses the same cleanup.
    let (mut signalled, _) = start(runtime.path(), &url).await;
    unsafe {
        libc::kill(signalled.id().unwrap() as i32, libc::SIGTERM);
    }
    assert!(timeout(Duration::from_secs(5), signalled.wait())
        .await
        .unwrap()
        .unwrap()
        .success());
    assert!(windows.lock().unwrap().1.is_none());

    // Stopping a crashed session must still clean its saved window.
    let (mut crashed, _) = start(runtime.path(), &url).await;
    crashed.kill().await.unwrap();
    crashed.wait().await.unwrap();
    stop(runtime.path(), &url).await;
    assert!(windows.lock().unwrap().1.is_none());

    // A manually closed saved window must be replaced once.
    let (mut closed, _) = start(runtime.path(), &url).await;
    closed.kill().await.unwrap();
    closed.wait().await.unwrap();
    windows.lock().unwrap().1 = None;
    let (mut replacement, _) = start(runtime.path(), &url).await;
    assert_eq!(windows.lock().unwrap().0, 5);
    stop(runtime.path(), &url).await;
    assert!(replacement.wait().await.unwrap().success());
    server.abort();
}

#[tokio::test]
async fn stopping_a_stale_pid_file_never_signals_an_unrelated_process() {
    let runtime = tempfile::Builder::new()
        .prefix("fab-")
        .tempdir_in("/tmp")
        .unwrap();
    std::fs::write(
        runtime.path().join("browser-session-test.pid"),
        std::process::id().to_string(),
    )
    .unwrap();
    stop(runtime.path(), "ws://127.0.0.1:1").await;
}
