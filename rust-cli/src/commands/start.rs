//! Start Firefox browser if not running

use anyhow::{anyhow, Result};
use std::process::Command;
use std::time::{Duration, Instant};
use tokio::time::sleep;
use tokio_tungstenite::connect_async;

use crate::config::ws_url;

/// Check if we can connect to the WebSocket server
async fn is_connected() -> bool {
    match connect_async(ws_url()).await {
        Ok((_, _)) => true,
        Err(_) => false,
    }
}

/// Start Firefox and wait for connection
pub async fn run(url: Option<&str>, timeout_secs: u64) -> Result<()> {
    // First check if already connected
    if is_connected().await {
        println!("Firefox is already running and connected");
        return Ok(());
    }

    println!("Starting Firefox...");

    // Build the Firefox command. On Windows, Firefox is commonly registered in
    // App Paths but not present on PATH, so use the shell's `start` resolution.
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", "firefox"]);
        if let Some(url) = url {
            cmd.arg(url);
        }
        cmd
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut cmd = Command::new("firefox");
        if let Some(url) = url {
            cmd.arg(url);
        }
        cmd
    };

    // Spawn Firefox in background (detached)
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| anyhow!("Failed to start Firefox: {}", e))?;

    // Wait for connection with timeout
    let start = Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    println!("Waiting for Firefox extension to connect...");

    loop {
        if start.elapsed() > timeout {
            return Err(anyhow!(
                "Timeout waiting for Firefox extension to connect.\n\
                Make sure the Firefox Agent Bridge extension is installed and enabled.\n\
                You can load it from: about:debugging -> This Firefox -> Load Temporary Add-on"
            ));
        }

        if is_connected().await {
            println!("Connected to Firefox Agent Bridge");
            return Ok(());
        }

        sleep(Duration::from_millis(500)).await;
    }
}
