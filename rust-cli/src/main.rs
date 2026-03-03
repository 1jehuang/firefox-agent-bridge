mod cli;
mod client;
mod commands;
mod config;
mod error;
mod protocol;
mod recorder;

use anyhow::Result;
use base64::Engine;
use clap::Parser;

use cli::{Cli, Command, SessionAction};
use commands::{dev, docs, screenshot, session, setup, start};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Handle subcommands first
    if let Some(command) = cli.command {
        return match command {
            Command::Docs => {
                docs::print_docs();
                Ok(())
            }
            Command::Setup { target } => setup::run(&target),
            Command::Start { url, timeout } => start::run(url.as_deref(), timeout).await,
            Command::Session { action } => match action {
                SessionAction::Start { name } => session::run(&name).await,
                SessionAction::Stop { name } => session::stop(&name).await,
                SessionAction::List => session::list(),
            },
            Command::Dev { source_dir, port, watch } => {
                dev::run(source_dir.as_deref(), port, watch).await
            }
        };
    }

    // Handle action (default command)
    let action = match &cli.action {
        Some(a) => a.clone(),
        None => {
            // No action provided, show help
            docs::print_help();
            return Ok(());
        }
    };

    // Special cases
    if action == "help" || action == "--help" || action == "-h" {
        docs::print_help();
        return Ok(());
    }

    if action == "docs" {
        docs::print_docs();
        return Ok(());
    }

    if action == "--version" || action == "-v" {
        println!("{}", config::VERSION);
        return Ok(());
    }

    if action == "setup" {
        let target = cli.params.as_deref().unwrap_or("claude");
        return setup::run(target);
    }

    // Parse JSON params (support @filename to read from file)
    let params: serde_json::Value = match &cli.params {
        Some(p) if p.starts_with('@') => {
            let file_path = &p[1..];
            let content = std::fs::read_to_string(file_path)
                .map_err(|e| anyhow::anyhow!("Failed to read file '{}': {}", file_path, e))?;
            serde_json::from_str(&content)
                .map_err(|e| anyhow::anyhow!("Invalid JSON in file '{}': {}", file_path, e))?
        }
        Some(p) => serde_json::from_str(p).map_err(|e| {
            anyhow::anyhow!("Invalid JSON params: {}", e)
        })?,
        None => serde_json::json!({}),
    };

    // Check if a session daemon is available (via BROWSER_SESSION env var)
    if let Ok(session_name) = std::env::var("BROWSER_SESSION") {
        if session::is_session_running(&session_name) {
            // Route through the session daemon for tab isolation
            let response = session::send_via_session(&session_name, &action, params.clone()).await?;

            // Handle response the same way as direct mode
            let ok = response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            if !ok {
                let error = response.get("error").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                eprintln!("Error: {}", error);
                std::process::exit(1);
            }

            if let Some(result) = response.get("result") {
                // Screenshot handling
                if action == "screenshot" {
                    if let Ok(screenshot_result) = serde_json::from_value::<protocol::ScreenshotResult>(result.clone()) {
                        let filename = screenshot::save_screenshot(&screenshot_result, cli.params.as_deref())?;
                        println!("{}", serde_json::json!({"saved": filename, "tabId": screenshot_result.tab_id}));
                        return Ok(());
                    }
                }
                println!("{}", serde_json::to_string_pretty(result)?);
            }
            return Ok(());
        }
    }

    // Handle uploadFile action - transform to fillForm with base64 file data
    let (action, params) = if action == "uploadFile" {
        let selector = params.get("selector")
            .and_then(|s| s.as_str())
            .ok_or_else(|| anyhow::anyhow!("uploadFile requires 'selector' param"))?;
        let file_path = params.get("path")
            .and_then(|s| s.as_str())
            .ok_or_else(|| anyhow::anyhow!("uploadFile requires 'path' param"))?;

        // Read file and encode as base64
        let file_bytes = std::fs::read(file_path)
            .map_err(|e| anyhow::anyhow!("Failed to read file '{}': {}", file_path, e))?;
        let base64_data = base64::engine::general_purpose::STANDARD.encode(&file_bytes);

        // Get filename from path
        let filename = std::path::Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file");

        // Detect MIME type from extension
        let mime_type = match std::path::Path::new(file_path).extension().and_then(|e| e.to_str()) {
            Some("pdf") => "application/pdf",
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("gif") => "image/gif",
            Some("txt") => "text/plain",
            Some("html") | Some("htm") => "text/html",
            Some("json") => "application/json",
            Some("zip") => "application/zip",
            Some("doc") => "application/msword",
            Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Some("mp4") => "video/mp4",
            Some("mov") => "video/quicktime",
            Some("webm") => "video/webm",
            Some("webp") => "image/webp",
            Some("svg") => "image/svg+xml",
            Some("mp3") => "audio/mpeg",
            Some("wav") => "audio/wav",
            Some("ogg") => "audio/ogg",
            Some("csv") => "text/csv",
            _ => "application/octet-stream",
        };

        // Transform to fillForm params
        let fill_params = serde_json::json!({
            "fields": [{
                "selector": selector,
                "file": {
                    "name": filename,
                    "type": mime_type,
                    "data": base64_data
                }
            }]
        });

        ("fillForm".to_string(), fill_params)
    } else if action == "dropFile" {
        let selector = params.get("selector")
            .and_then(|s| s.as_str())
            .unwrap_or("[contenteditable=\"true\"]");
        let file_path = params.get("path")
            .and_then(|s| s.as_str())
            .ok_or_else(|| anyhow::anyhow!("dropFile requires 'path' param"))?;

        // Read file and encode as base64
        let file_bytes = std::fs::read(file_path)
            .map_err(|e| anyhow::anyhow!("Failed to read file '{}': {}", file_path, e))?;
        let base64_data = base64::engine::general_purpose::STANDARD.encode(&file_bytes);

        let filename = std::path::Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file");

        let mime_type = match std::path::Path::new(file_path).extension().and_then(|e| e.to_str()) {
            Some("pdf") => "application/pdf",
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("gif") => "image/gif",
            Some("txt") => "text/plain",
            Some("html") | Some("htm") => "text/html",
            Some("json") => "application/json",
            Some("zip") => "application/zip",
            Some("tex") => "application/x-tex",
            Some("doc") => "application/msword",
            Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Some("mp4") => "video/mp4",
            Some("mov") => "video/quicktime",
            Some("webm") => "video/webm",
            Some("webp") => "image/webp",
            Some("svg") => "image/svg+xml",
            Some("mp3") => "audio/mpeg",
            Some("wav") => "audio/wav",
            Some("ogg") => "audio/ogg",
            Some("csv") => "text/csv",
            _ => "application/octet-stream",
        };

        let drop_params = serde_json::json!({
            "selector": selector,
            "file": {
                "name": filename,
                "type": mime_type,
                "data": base64_data
            }
        });

        ("dropFile".to_string(), drop_params)
    } else {
        (action, params)
    };

    // Initialize recorder if --record is set or recording marker file exists
    let record_dir = cli.record.clone().or_else(|| {
        let marker = dirs::home_dir()?.join(".recording_dir");
        std::fs::read_to_string(marker).ok().map(|s| s.trim().to_string())
    });
    let rec = if let Some(ref dir) = record_dir {
        let path = std::path::Path::new(dir);
        if path.is_dir() {
            Some(recorder::Recorder::new(path).await?)
        } else {
            None
        }
    } else {
        None
    };

    // Send to Firefox via WebSocket (with timing)
    let timed_response = client::send_command_timed(&action, params.clone()).await?;
    let response = timed_response.response;
    let timing = timed_response.timing;

    // Record the action if recording
    if let Some(ref rec) = rec {
        if let Err(e) = rec.record_action(&action, &params, &response, timing.total_ms).await {
            eprintln!("Recording error: {}", e);
        }
    }

    // Handle response
    match response {
        protocol::Response::Success { result, .. } => {
            // Special handling for screenshots
            if action == "screenshot" {
                if let Some(ref res) = result {
                    if let Ok(screenshot_result) = serde_json::from_value::<protocol::ScreenshotResult>(res.clone()) {
                        let filename = screenshot::save_screenshot(&screenshot_result, cli.params.as_deref())?;
                        let mut output = serde_json::json!({
                            "saved": filename,
                            "tabId": screenshot_result.tab_id
                        });
                        if cli.timing {
                            output["_timing"] = serde_json::to_value(&timing)?;
                        }
                        println!("{}", output);
                        return Ok(());
                    }
                }
            }

            // Regular output
            if let Some(res) = result {
                if cli.timing {
                    // Merge timing into result if it's an object, otherwise wrap
                    let mut output = if res.is_object() {
                        res.clone()
                    } else {
                        serde_json::json!({ "result": res })
                    };
                    output["_timing"] = serde_json::to_value(&timing)?;
                    println!("{}", serde_json::to_string_pretty(&output)?);
                } else {
                    println!("{}", serde_json::to_string_pretty(&res)?);
                }
            } else if cli.timing {
                // No result but timing requested
                println!("{}", serde_json::json!({ "_timing": timing }));
            }
        }
        protocol::Response::Error { error, .. } => {
            if cli.timing {
                eprintln!("Error: {} (timing: {}ms total, {}ms connect, {}ms roundtrip)",
                    error, timing.total_ms, timing.connect_ms, timing.roundtrip_ms);
            } else {
                eprintln!("Error: {}", error);
            }
            std::process::exit(1);
        }
        protocol::Response::Ready { .. } => {
            // Should not happen - ready messages are filtered
            eprintln!("Unexpected ready message");
            std::process::exit(1);
        }
    }

    Ok(())
}
