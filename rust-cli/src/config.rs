/// WebSocket URL to connect to the Firefox extension via native host
pub const WS_URL: &str = "ws://127.0.0.1:8766";

/// Timeout for WebSocket responses in milliseconds
pub const TIMEOUT_MS: u64 = 30000;

/// Version from Cargo.toml
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
