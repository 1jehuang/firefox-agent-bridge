// Windows known-folder APIs ignore HOME/APPDATA overrides, so this harness
// cannot safely isolate the host's vault configuration there.
#![cfg(unix)]

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

struct Host(Child);

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn send_hello(host: &mut Host, browser: &str) {
    let message = serde_json::to_vec(&json!({ "type": "hello", "browser": browser })).unwrap();
    let stdin = host.0.stdin.as_mut().unwrap();
    stdin
        .write_all(&(message.len() as u32).to_le_bytes())
        .unwrap();
    stdin.write_all(&message).unwrap();
    stdin.flush().unwrap();
}

fn check_registration(early_hello: bool) {
    let dir = tempfile::tempdir().unwrap();
    let registry = dir.path().join("browser-agent-bridge");
    std::fs::create_dir(&registry).unwrap();
    let firefox_path = registry.join("host-8766.json");
    let firefox = json!({ "port": 8766, "pid": 123, "browser": "firefox", "process": null });
    let firefox_bytes = serde_json::to_vec(&firefox).unwrap();
    std::fs::write(&firefox_path, &firefox_bytes).unwrap();

    // Never load a developer's vault, credentials, or native-host settings.
    let mut command = Command::new(env!("CARGO_BIN_EXE_firefox-agent-bridge-host"));
    command.env_clear();
    for name in ["HOME", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "TMPDIR"] {
        command.env(name, dir.path());
    }
    let mut host = Host(
        command
            .env("FAB_WS_HOST", "127.0.0.1")
            // Let the host reserve its own port atomically, without a
            // release-before-spawn window where another process can bind it.
            .env("FAB_WS_PORT", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let (tx, rx) = mpsc::channel();
    let stderr = host.0.stderr.take().unwrap();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            if tx.send(line.unwrap()).is_err() {
                break;
            }
        }
    });
    if early_hello {
        send_hello(&mut host, "edge");
    }

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut address = None;
    let mut hello = false;
    while address.is_none() || !hello {
        let line = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("host did not bind and process hello before the deadline");
        assert!(
            !line.contains("Failed to bind the agent WebSocket"),
            "host failed to bind: {line}"
        );
        if let Some((_, value)) = line.split_once("WebSocket server listening on ws://") {
            let bound: SocketAddr = value.trim().parse().unwrap();
            assert_ne!(bound.port(), 0, "host must report its actual bound port");
            address = Some(bound);
            if !early_hello {
                send_hello(&mut host, "edge");
            }
        }
        if line.contains("Received event from browser:") && line.contains("hello") {
            hello = true;
        }
    }

    let address = address.unwrap();
    let port = address.port();
    assert_ne!(port, 8766);
    let _connection = TcpStream::connect_timeout(&address, Duration::from_secs(1))
        .expect("reported host port must accept connections");

    assert_eq!(
        std::fs::read(&firefox_path).unwrap(),
        firefox_bytes,
        "an early hello must not overwrite the other browser's default-port entry"
    );
    let edge: Value =
        serde_json::from_slice(&std::fs::read(registry.join(format!("host-{port}.json"))).unwrap())
            .unwrap();
    assert_eq!(edge["port"], port);
    assert_eq!(edge["pid"], host.0.id());
    assert_eq!(
        edge["browser"], "edge",
        "initial registration must not erase hello"
    );
}

#[test]
fn early_hello_keeps_browser_identity_on_its_own_port() {
    // Exercise scheduling around startup, not just registry serialization.
    for _ in 0..32 {
        check_registration(true);
    }
}

#[test]
fn hello_after_binding_updates_its_own_port() {
    check_registration(false);
}
