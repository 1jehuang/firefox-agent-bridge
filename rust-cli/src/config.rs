use std::env;

/// Default WebSocket host the native host binds to.
const DEFAULT_WS_HOST: &str = "127.0.0.1";
/// Default WebSocket port the native host binds to.
const DEFAULT_WS_PORT: u16 = 8766;

/// WebSocket URL to connect to the Firefox extension via native host.
///
/// Honors `FAB_WS_HOST` / `FAB_WS_PORT` so the CLI can follow the native host
/// when it is moved off the default port (e.g. to avoid a port collision).
/// These are the same env vars the host reads, so setting them once keeps both
/// ends in sync.
pub fn ws_url() -> String {
    let host = env::var("FAB_WS_HOST").unwrap_or_else(|_| DEFAULT_WS_HOST.to_string());
    let port = env::var("FAB_WS_PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(DEFAULT_WS_PORT);
    format!("ws://{host}:{port}")
}

/// Timeout for WebSocket responses in milliseconds
pub const TIMEOUT_MS: u64 = 30000;

/// Version from Cargo.toml
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
