/// Default WebSocket port of the native host.
pub const DEFAULT_WS_PORT: u16 = 8766;

/// WebSocket URL of the native host. `FAB_WS_URL` overrides it entirely and
/// `FAB_WS_PORT` overrides only the port, matching the host's own variable.
pub fn ws_url() -> String {
    if let Ok(url) = std::env::var("FAB_WS_URL") {
        if !url.trim().is_empty() {
            return url;
        }
    }
    let port = std::env::var("FAB_WS_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(DEFAULT_WS_PORT);
    format!("ws://127.0.0.1:{}", port)
}

/// Timeout for WebSocket responses in milliseconds
pub const TIMEOUT_MS: u64 = 30000;

/// Version from Cargo.toml
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
