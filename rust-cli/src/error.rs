use thiserror::Error;

#[derive(Error, Debug)]
pub enum BridgeError {
    #[error("WebSocket connection failed: {0}")]
    Connection(String),

    #[error("Invalid JSON parameters: {0}")]
    InvalidParams(#[from] serde_json::Error),

    #[error("Request timed out after {0}ms")]
    Timeout(u64),

    #[error("Firefox error: {0}")]
    Firefox(String),

    #[error("WebSocket error: {0}")]
    WebSocket(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
