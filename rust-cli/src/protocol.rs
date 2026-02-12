use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Request sent to the Firefox extension
#[derive(Serialize, Debug)]
pub struct Request {
    pub action: String,
    pub params: Value,
}

/// Response from the Firefox extension
#[derive(Deserialize, Debug)]
#[serde(untagged)]
pub enum Response {
    /// Ready message sent when native host connects (should be filtered)
    Ready {
        #[serde(rename = "type")]
        msg_type: String,
        host: Option<String>,
        port: Option<u16>,
    },
    /// Error response (tried before Success because it's more specific — requires `error` field)
    Error {
        ok: bool,
        error: String,
    },
    /// Successful response
    Success {
        ok: bool,
        result: Option<Value>,
    },
}

impl Response {
    /// Check if this is a ready message that should be skipped
    pub fn is_ready(&self) -> bool {
        matches!(self, Response::Ready { msg_type, .. } if msg_type == "ready")
    }
}

/// Screenshot result structure
#[derive(Deserialize, Debug)]
pub struct ScreenshotResult {
    #[serde(rename = "tabId")]
    pub tab_id: i64,
    #[serde(rename = "dataUrl")]
    pub data_url: String,
}
