use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;

use crate::client;
use crate::protocol;

static EVENT_COUNTER: AtomicU32 = AtomicU32::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingEvent {
    pub seq: u32,
    pub timestamp: f64,
    pub action: String,
    pub params_summary: Value,
    pub success: bool,
    pub error: Option<String>,
    pub timing_ms: u64,
    pub element: Option<Value>,
    pub url: Option<String>,
    pub tab_id: Option<Value>,
    pub screenshots: RecordingScreenshots,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RecordingScreenshots {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlighted: Option<String>,
}

pub struct Recorder {
    dir: PathBuf,
    screenshots_dir: PathBuf,
}

impl Recorder {
    pub async fn new(dir: &Path) -> Result<Self> {
        let screenshots_dir = dir.join("screenshots");
        fs::create_dir_all(&screenshots_dir).await?;

        let events_file = dir.join("firefox_events.jsonl");
        if !events_file.exists() {
            fs::write(&events_file, "").await?;
        }

        let start_time = now_unix();
        fs::write(
            dir.join("firefox_recording_start"),
            format!("{}", start_time),
        )
        .await?;

        Ok(Self {
            dir: dir.to_path_buf(),
            screenshots_dir,
        })
    }

    pub async fn record_action(
        &self,
        action: &str,
        params: &Value,
        response: &protocol::Response,
        timing_ms: u64,
    ) -> Result<()> {
        let seq = EVENT_COUNTER.fetch_add(1, Ordering::SeqCst);

        let screenshot_before = if should_screenshot_before(action) {
            self.take_screenshot(&format!("{:04}_before", seq)).await.ok()
        } else {
            None
        };

        let screenshot_after = self.take_screenshot(&format!("{:04}_after", seq)).await.ok();

        let (element_info, element_screenshot) = match response {
            protocol::Response::Success { result: Some(res), .. } => {
                let element = res.get("element").cloned();
                let elem_ss = if let Some(ref el) = element {
                    if let Some(rect) = el.get("rect") {
                        self.crop_element(&format!("{:04}_element", seq), &screenshot_after, rect)
                            .await
                            .ok()
                    } else {
                        None
                    }
                } else {
                    None
                };
                (element, elem_ss)
            }
            _ => (None, None),
        };

        let (success, error, url, tab_id) = match response {
            protocol::Response::Success { result, .. } => {
                let url = result
                    .as_ref()
                    .and_then(|r| r.get("url").and_then(|u| u.as_str()))
                    .map(String::from);
                let tab_id = result.as_ref().and_then(|r| r.get("tabId").cloned());
                (true, None, url, tab_id)
            }
            protocol::Response::Error { error, .. } => {
                (false, Some(error.clone()), None, None)
            }
            protocol::Response::Ready { .. } => (true, None, None, None),
        };

        let params_summary = summarize_params(action, params);

        let event = RecordingEvent {
            seq,
            timestamp: now_unix(),
            action: action.to_string(),
            params_summary,
            success,
            error,
            timing_ms,
            element: element_info,
            url,
            tab_id,
            screenshots: RecordingScreenshots {
                full_before: screenshot_before,
                full_after: screenshot_after,
                element: element_screenshot,
                highlighted: None,
            },
        };

        let mut line = serde_json::to_string(&event)?;
        line.push('\n');
        let events_file = self.dir.join("firefox_events.jsonl");
        fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&events_file)
            .await?
            .write_all(line.as_bytes())
            .await?;

        Ok(())
    }

    async fn take_screenshot(&self, name: &str) -> Result<String> {
        let response = client::send_command("screenshot", serde_json::json!({})).await?;
        match response {
            protocol::Response::Success { result: Some(res), .. } => {
                if let Some(data_url) = res.get("dataUrl").and_then(|d| d.as_str()) {
                    let base64_data = data_url
                        .strip_prefix("data:image/png;base64,")
                        .unwrap_or(data_url);
                    let bytes = STANDARD.decode(base64_data)?;
                    let filename = format!("{}.png", name);
                    let path = self.screenshots_dir.join(&filename);
                    fs::write(&path, bytes).await?;
                    Ok(format!("screenshots/{}", filename))
                } else {
                    anyhow::bail!("No dataUrl in screenshot response")
                }
            }
            _ => anyhow::bail!("Screenshot failed"),
        }
    }

    async fn crop_element(
        &self,
        name: &str,
        full_screenshot_path: &Option<String>,
        rect: &Value,
    ) -> Result<String> {
        let _full_path = match full_screenshot_path {
            Some(p) => self.dir.join(p),
            None => return Err(anyhow::anyhow!("No full screenshot to crop from")),
        };

        let x = rect.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let y = rect.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let w = rect.get("width").and_then(|v| v.as_f64()).unwrap_or(100.0);
        let h = rect.get("height").and_then(|v| v.as_f64()).unwrap_or(100.0);

        let padding = 20.0;
        let crop_x = (x - padding).max(0.0) as u32;
        let crop_y = (y - padding).max(0.0) as u32;
        let crop_w = (w + padding * 2.0) as u32;
        let crop_h = (h + padding * 2.0) as u32;

        let filename = format!("{}.png", name);
        let output_path = self.screenshots_dir.join(&filename);

        let status = tokio::process::Command::new("magick")
            .args([
                _full_path.to_str().unwrap_or(""),
                "-crop",
                &format!("{}x{}+{}+{}", crop_w, crop_h, crop_x, crop_y),
                "+repage",
                output_path.to_str().unwrap_or(""),
            ])
            .status()
            .await;

        match status {
            Ok(s) if s.success() => Ok(format!("screenshots/{}", filename)),
            _ => Err(anyhow::anyhow!("ImageMagick crop failed")),
        }
    }
}

fn now_unix() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn should_screenshot_before(action: &str) -> bool {
    matches!(
        action,
        "click" | "type" | "fillForm" | "scroll" | "navigate" | "evaluate"
    )
}

fn summarize_params(action: &str, params: &Value) -> Value {
    match action {
        "type" => {
            let mut summary = params.clone();
            if let Some(obj) = summary.as_object_mut() {
                if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
                    if text.len() > 100 {
                        obj.insert(
                            "text".to_string(),
                            Value::String(format!("{}...[{}chars]", &text[..50], text.len())),
                        );
                    }
                }
            }
            summary
        }
        "fillForm" => {
            let mut summary = params.clone();
            if let Some(obj) = summary.as_object_mut() {
                if let Some(fields) = obj.get_mut("fields") {
                    if let Some(arr) = fields.as_array_mut() {
                        for field in arr.iter_mut() {
                            if let Some(f) = field.as_object_mut() {
                                if let Some(file) = f.get_mut("file") {
                                    if let Some(fo) = file.as_object_mut() {
                                        fo.remove("data");
                                        fo.insert(
                                            "data".to_string(),
                                            Value::String("[base64 omitted]".to_string()),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
            summary
        }
        _ => params.clone(),
    }
}

use tokio::io::AsyncWriteExt;
