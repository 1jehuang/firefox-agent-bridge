use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

const DEFAULT_DEBUG_PORT: u16 = 6000;

#[derive(Debug, Serialize)]
struct RdpMessage {
    to: String,
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "addonPath")]
    addon_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "addonId")]
    addon_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RdpResponse {
    #[serde(default)]
    from: String,
    #[serde(default)]
    #[serde(rename = "type")]
    msg_type: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    #[serde(rename = "addonsActor")]
    addons_actor: Option<String>,
    #[serde(default)]
    addon: Option<AddonInfo>,
    #[serde(default)]
    traits: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Clone)]
struct AddonInfo {
    id: String,
    #[serde(default)]
    name: Option<String>,
}

struct RdpClient {
    stream: BufReader<TcpStream>,
}

impl RdpClient {
    async fn connect(port: u16) -> Result<Self> {
        let stream = TcpStream::connect(format!("127.0.0.1:{}", port))
            .await
            .context(format!(
                "Failed to connect to Firefox debugger on port {}.\n\
                 Make sure Firefox is running with: firefox --start-debugger-server {}",
                port, port
            ))?;

        let mut client = Self {
            stream: BufReader::new(stream),
        };

        // Read initial greeting
        let greeting = client.read_message().await?;
        if greeting.addons_actor.is_none() && greeting.traits.is_none() {
            // Might be an older protocol, try to continue anyway
        }

        Ok(client)
    }

    async fn read_message(&mut self) -> Result<RdpResponse> {
        // Firefox RDP format: <length>:<json>
        // Read until we get the colon to find the length
        let mut length_str = String::new();
        loop {
            let mut byte = [0u8; 1];
            self.stream.read_exact(&mut byte).await?;
            if byte[0] == b':' {
                break;
            }
            length_str.push(byte[0] as char);
        }

        let length: usize = length_str.parse()
            .context(format!("Invalid message length: {}", length_str))?;

        // Read the JSON payload
        let mut buffer = vec![0u8; length];
        self.stream.read_exact(&mut buffer).await?;

        let json_str = String::from_utf8(buffer)?;
        let response: RdpResponse = serde_json::from_str(&json_str)
            .context(format!("Failed to parse RDP response: {}", json_str))?;

        Ok(response)
    }

    async fn send_message(&mut self, msg: &RdpMessage) -> Result<()> {
        let json = serde_json::to_string(msg)?;
        let formatted = format!("{}:{}", json.len(), json);
        self.stream.get_mut().write_all(formatted.as_bytes()).await?;
        Ok(())
    }

    async fn get_addons_actor(&mut self) -> Result<String> {
        // Request root actor info to get addons actor
        let msg = RdpMessage {
            to: "root".to_string(),
            msg_type: "getRoot".to_string(),
            addon_path: None,
            addon_id: None,
        };

        self.send_message(&msg).await?;
        let response = self.read_message().await?;

        match response.addons_actor {
            Some(actor) => Ok(actor),
            None => Err(anyhow!(
                "Could not get addons actor from Firefox. Response from: {}",
                response.from
            )),
        }
    }

    async fn install_temporary_addon(&mut self, addons_actor: &str, path: &str) -> Result<AddonInfo> {
        let msg = RdpMessage {
            to: addons_actor.to_string(),
            msg_type: "installTemporaryAddon".to_string(),
            addon_path: Some(path.to_string()),
            addon_id: None,
        };

        self.send_message(&msg).await?;
        let response = self.read_message().await?;

        if let Some(error) = response.error {
            let detail = response.message.unwrap_or_default();
            return Err(anyhow!("Failed to install addon: {} - {}", error, detail));
        }

        match response.addon {
            Some(addon) => Ok(addon),
            None => Err(anyhow!(
                "No addon info in response from: {}",
                response.from
            )),
        }
    }

    async fn reload_addon(&mut self, addons_actor: &str, addon_id: &str) -> Result<()> {
        let msg = RdpMessage {
            to: addons_actor.to_string(),
            msg_type: "reloadAddon".to_string(),
            addon_path: None,
            addon_id: Some(addon_id.to_string()),
        };

        self.send_message(&msg).await?;
        let response = self.read_message().await?;

        if let Some(error) = response.error {
            let detail = response.message.unwrap_or_default();
            return Err(anyhow!("Failed to reload addon: {} - {}", error, detail));
        }

        Ok(())
    }
}

pub async fn run(source_dir: Option<&str>, port: Option<u16>, watch: bool) -> Result<()> {
    let port = port.unwrap_or(DEFAULT_DEBUG_PORT);

    // Determine extension source directory
    let source_path = match source_dir {
        Some(dir) => std::path::PathBuf::from(dir),
        None => {
            // Default to ./extension or find it relative to the binary
            let cwd = std::env::current_dir()?;
            let extension_dir = cwd.join("extension");
            if extension_dir.exists() {
                extension_dir
            } else {
                // Try to find it relative to the executable
                let exe_path = std::env::current_exe()?;
                let exe_dir = exe_path.parent().unwrap();
                let possible_paths = [
                    exe_dir.join("extension"),
                    exe_dir.join("../extension"),
                    exe_dir.join("../../extension"),
                    dirs::home_dir().unwrap().join("firefox-agent-bridge/extension"),
                ];
                possible_paths.into_iter()
                    .find(|p| p.exists())
                    .ok_or_else(|| anyhow!(
                        "Could not find extension directory. Specify with --source-dir"
                    ))?
            }
        }
    };

    // Verify the manifest exists
    let manifest_path = source_path.join("manifest.json");
    if !manifest_path.exists() {
        return Err(anyhow!(
            "manifest.json not found in {}\nMake sure you're pointing to the extension source directory.",
            source_path.display()
        ));
    }

    let canonical_path = source_path.canonicalize()?;
    let path_str = canonical_path.to_string_lossy();

    println!("Connecting to Firefox debugger on port {}...", port);

    let mut client = RdpClient::connect(port).await?;

    println!("Getting addons actor...");
    let addons_actor = client.get_addons_actor().await?;

    println!("Installing temporary addon from: {}", path_str);
    let addon = client.install_temporary_addon(&addons_actor, &path_str).await?;

    println!("✓ Addon installed: {} ({})",
        addon.name.as_deref().unwrap_or("unknown"),
        addon.id
    );

    if watch {
        println!("\nWatching for changes... (Ctrl+C to stop)");
        println!("Tip: You can also use 'browser reload' to manually reload.\n");

        watch_and_reload(&mut client, &addons_actor, &addon.id, &canonical_path).await?;
    } else {
        println!("\nTo reload after changes, run: browser reload");
        println!("Or run with --watch to auto-reload on file changes.");
    }

    Ok(())
}

async fn watch_and_reload(
    client: &mut RdpClient,
    addons_actor: &str,
    addon_id: &str,
    source_path: &Path,
) -> Result<()> {
    use std::time::{Duration, SystemTime};
    use std::collections::HashMap;

    let mut last_modified: HashMap<String, SystemTime> = HashMap::new();

    // Initial scan
    scan_files(source_path, &mut last_modified)?;

    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;

        let mut changed = false;
        let mut current_files: HashMap<String, SystemTime> = HashMap::new();
        scan_files(source_path, &mut current_files)?;

        // Check for new or modified files
        for (path, mtime) in &current_files {
            if let Some(old_mtime) = last_modified.get(path) {
                if mtime > old_mtime {
                    println!("Changed: {}", path);
                    changed = true;
                }
            } else {
                println!("New: {}", path);
                changed = true;
            }
        }

        // Check for deleted files
        for path in last_modified.keys() {
            if !current_files.contains_key(path) {
                println!("Deleted: {}", path);
                changed = true;
            }
        }

        if changed {
            println!("Reloading extension...");
            match client.reload_addon(addons_actor, addon_id).await {
                Ok(()) => println!("✓ Reloaded successfully\n"),
                Err(e) => eprintln!("✗ Reload failed: {}\n", e),
            }
            last_modified = current_files;
        }
    }
}

fn scan_files(dir: &Path, files: &mut std::collections::HashMap<String, std::time::SystemTime>) -> Result<()> {
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();

            // Skip hidden files and common non-source directories
            let name = path.file_name().unwrap().to_string_lossy();
            if name.starts_with('.') || name == "node_modules" || name == "web-ext-artifacts" {
                continue;
            }

            if path.is_dir() {
                scan_files(&path, files)?;
            } else {
                // Only watch relevant file types
                if let Some(ext) = path.extension() {
                    let ext = ext.to_string_lossy();
                    if matches!(ext.as_ref(), "js" | "json" | "html" | "css" | "svg" | "png") {
                        let mtime = entry.metadata()?.modified()?;
                        files.insert(path.to_string_lossy().to_string(), mtime);
                    }
                }
            }
        }
    }
    Ok(())
}
