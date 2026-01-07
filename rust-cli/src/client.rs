use anyhow::{anyhow, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::time::Duration;
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::config::{TIMEOUT_MS, WS_URL};
use crate::protocol::{Request, Response};

/// Send a command to Firefox via WebSocket and return the response
pub async fn send_command(action: &str, params: Value) -> Result<Response> {
    // Connect to WebSocket
    let (ws_stream, _) = connect_async(WS_URL).await.map_err(|e| {
        anyhow!(
            "WebSocket error: {}\nIs Firefox running with the Browser Agent Bridge extension enabled?",
            e
        )
    })?;

    let (mut write, mut read) = ws_stream.split();

    // Send the request
    let request = Request {
        action: action.to_string(),
        params,
    };
    let msg = serde_json::to_string(&request)?;
    write.send(Message::Text(msg)).await?;

    // Wait for response with timeout, filtering ready messages
    let response = timeout(Duration::from_millis(TIMEOUT_MS), async {
        loop {
            match read.next().await {
                Some(Ok(Message::Text(text))) => {
                    let response: Response = serde_json::from_str(&text)?;

                    // Skip ready messages
                    if response.is_ready() {
                        continue;
                    }

                    return Ok::<Response, anyhow::Error>(response);
                }
                Some(Ok(Message::Close(_))) => {
                    return Err(anyhow!("WebSocket closed unexpectedly"));
                }
                Some(Err(e)) => {
                    return Err(anyhow!("WebSocket error: {}", e));
                }
                None => {
                    return Err(anyhow!("WebSocket stream ended"));
                }
                _ => {
                    // Ignore other message types (ping, pong, binary)
                    continue;
                }
            }
        }
    })
    .await
    .map_err(|_| anyhow!("Timeout waiting for response"))??;

    Ok(response)
}
