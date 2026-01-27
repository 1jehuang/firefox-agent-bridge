mod cli;
mod client;
mod commands;
mod config;
mod error;
mod protocol;

use anyhow::Result;
use clap::Parser;

use cli::{Cli, Command};
use commands::{dev, docs, screenshot, setup, start};

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

    // Parse JSON params
    let params: serde_json::Value = match &cli.params {
        Some(p) => serde_json::from_str(p).map_err(|e| {
            anyhow::anyhow!("Invalid JSON params: {}", e)
        })?,
        None => serde_json::json!({}),
    };

    // Send to Firefox via WebSocket (with timing)
    let timed_response = client::send_command_timed(&action, params).await?;
    let response = timed_response.response;
    let timing = timed_response.timing;

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
