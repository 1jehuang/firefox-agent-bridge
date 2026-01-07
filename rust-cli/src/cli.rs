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
}
