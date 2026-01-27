use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "browser",
    version,
    about = "Control Firefox browser from LLM agents via WebSocket",
    long_about = None
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,

    /// Action to send to Firefox (e.g., ping, navigate, click)
    #[arg(value_name = "ACTION")]
    pub action: Option<String>,

    /// JSON parameters for the action
    #[arg(value_name = "PARAMS")]
    pub params: Option<String>,

    /// Include timing breakdown in output (total, connect, roundtrip in ms)
    #[arg(short, long)]
    pub timing: bool,
}

#[derive(Subcommand)]
pub enum Command {
    /// Show full documentation
    Docs,

    /// Install Claude Code skill files or print docs
    Setup {
        /// Target: claude (install skill files) or generic (print docs)
        #[arg(default_value = "claude")]
        target: String,
    },

    /// Start Firefox if not running and wait for connection
    Start {
        /// URL to open in Firefox
        #[arg(short, long)]
        url: Option<String>,

        /// Timeout in seconds to wait for connection
        #[arg(short, long, default_value = "30")]
        timeout: u64,
    },

    /// Load extension from source for development (auto-reload on changes)
    Dev {
        /// Path to extension source directory
        #[arg(short, long)]
        source_dir: Option<String>,

        /// Firefox debugger port (default: 6000)
        #[arg(short, long)]
        port: Option<u16>,

        /// Watch for file changes and auto-reload
        #[arg(short, long)]
        watch: bool,
    },
}
