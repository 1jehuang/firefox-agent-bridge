use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::protocol::ScreenshotResult;

/// Save screenshot to file, returns the filename
pub fn save_screenshot(result: &ScreenshotResult, params_json: Option<&str>) -> Result<String> {
    // Extract filename from params if provided
    let filename = extract_filename(params_json);

    let filename = filename.unwrap_or_else(|| {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("/tmp/firefox-screenshot-{}.png", timestamp)
    });

    // Strip data URL prefix
    let base64_data = result
        .data_url
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(&result.data_url);

    // Decode base64
    let image_data = STANDARD
        .decode(base64_data)
        .map_err(|e| anyhow!("Failed to decode base64: {}", e))?;

    // Write to file
    fs::write(&filename, image_data)?;

    Ok(filename)
}

/// Extract filename from JSON params string
fn extract_filename(params_json: Option<&str>) -> Option<String> {
    params_json.and_then(|json| {
        serde_json::from_str::<serde_json::Value>(json)
            .ok()
            .and_then(|v| v.get("filename").and_then(|f| f.as_str()).map(String::from))
    })
}
