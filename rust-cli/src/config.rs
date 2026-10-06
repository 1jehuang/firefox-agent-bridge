pub use crate::registry::DEFAULT_WS_PORT;

/// WebSocket URL of the native host. `FAB_WS_URL` overrides it entirely and
/// `FAB_WS_PORT` overrides only the port, matching the host's own variable.
/// Otherwise the host serving `FAB_BROWSER` is looked up in the registry, so
/// several browsers can run the bridge at once (each host binds its own port).
pub fn ws_url() -> String {
    if let Ok(url) = std::env::var("FAB_WS_URL") {
        if !url.trim().is_empty() {
            return url;
        }
    }
    let port = std::env::var("FAB_WS_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .or_else(|| {
            let browser = std::env::var("FAB_BROWSER").ok();
            crate::registry::select_port(
                &crate::registry::entries(),
                browser.as_deref(),
                |e| crate::registry::port_is_live(e.port),
            )
        })
        .unwrap_or(DEFAULT_WS_PORT);
    format!("ws://127.0.0.1:{}", port)
}

/// Timeout for WebSocket responses in milliseconds
pub const TIMEOUT_MS: u64 = 30000;

/// Version from Cargo.toml
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
