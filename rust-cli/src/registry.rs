//! Registry of running native hosts, one file per bound port.
//!
//! Each browser that loads the extension spawns its own native host. Only one
//! of them can own the default port, so hosts bind the first free port in
//! `DEFAULT_WS_PORT..DEFAULT_WS_PORT + PORT_RANGE` and record which browser
//! they serve here. Clients pick a host by browser name (`FAB_BROWSER`).
//!
//! Shared by the `browser` CLI and the host binary (included via `#[path]`).
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Default WebSocket port of the native host.
pub const DEFAULT_WS_PORT: u16 = 8766;
/// Number of ports hosts may bind, starting at `DEFAULT_WS_PORT`. The Safari
/// relay port (`FAB_RELAY_PORT`, 8767) is never used as an agent port, so the
/// Safari extension cannot dial another browser's host by mistake.
pub const PORT_RANGE: u16 = 10;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostEntry {
    pub port: u16,
    pub pid: u32,
    /// Browser reported by the extension's hello (`firefox`, `chrome`, ...),
    /// unknown until the extension has connected.
    #[serde(default)]
    pub browser: Option<String>,
    /// Executable of the process that spawned the host, i.e. the browser.
    /// Tells Chromium forks apart: Helium's extension reports `chrome`.
    #[serde(default)]
    pub process: Option<String>,
}

pub fn registry_dir() -> PathBuf {
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    base.join("browser-agent-bridge")
}

fn entry_path(port: u16) -> PathBuf {
    registry_dir().join(format!("host-{}.json", port))
}

pub fn write_entry(entry: &HostEntry) -> std::io::Result<()> {
    std::fs::create_dir_all(registry_dir())?;
    let path = entry_path(entry.port);
    let tmp = path.with_extension(format!("json.{}.tmp", entry.pid));
    std::fs::write(&tmp, serde_json::to_vec(entry).unwrap_or_default())?;
    std::fs::rename(tmp, path)
}

/// Remove this host's entry, unless another host has since taken the port.
pub fn remove_entry(port: u16, pid: u32) {
    let path = entry_path(port);
    if read_entry(&path).is_some_and(|e| e.pid == pid) {
        let _ = std::fs::remove_file(path);
    }
}

fn read_entry(path: &std::path::Path) -> Option<HostEntry> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// All recorded hosts, ordered by port. Entries are not checked for liveness.
pub fn entries() -> Vec<HostEntry> {
    let mut out: Vec<HostEntry> = std::fs::read_dir(registry_dir())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.starts_with("host-") && name.ends_with(".json")
        })
        .filter_map(|e| read_entry(&e.path()))
        .collect();
    out.sort_by_key(|e| e.port);
    out
}

fn chromium_family(name: &str) -> bool {
    matches!(name, "chrome" | "chromium" | "edge" | "brave")
}

/// Choose a port for `browser` among live hosts.
///
/// A host spawned by a browser executable whose path names `browser` wins
/// (`helium`, `brave`, `msedge`, ...), then the browser the extension
/// reported, then another Chromium-family browser for a Chromium-family
/// request (forks such as Helium report `chrome`). Without a
/// match, or without a requested browser, the lowest live port wins so a lone
/// host on a non-default port is still found. `None` means no live host is
/// recorded; callers fall back to `DEFAULT_WS_PORT`.
pub fn select_port(
    entries: &[HostEntry],
    browser: Option<&str>,
    is_live: impl Fn(&HostEntry) -> bool,
) -> Option<u16> {
    let live: Vec<&HostEntry> = entries.iter().filter(|e| is_live(e)).collect();
    if let Some(wanted) = browser.map(|b| b.trim().to_ascii_lowercase()) {
        if !wanted.is_empty() && wanted != "auto" {
            let reported = |e: &&HostEntry| e.browser.as_deref().map(str::to_ascii_lowercase);
            let spawned_by = |e: &&&HostEntry| {
                e.process.as_deref().is_some_and(|p| process_names_browser(p, &wanted))
            };
            if let Some(e) = live.iter().find(spawned_by) {
                return Some(e.port);
            }
            if let Some(e) = live.iter().find(|e| reported(e).as_deref() == Some(&wanted)) {
                return Some(e.port);
            }
            if chromium_family(&wanted) {
                if let Some(e) = live
                    .iter()
                    .find(|e| reported(e).is_some_and(|b| chromium_family(&b)))
                {
                    return Some(e.port);
                }
            }
        }
    }
    live.first().map(|e| e.port)
}

/// Whether the executable path `process` belongs to `browser`. Only the file
/// name and the macOS app bundle names are checked, so a directory such as
/// `/opt/google/chrome/` does not make Helium's binary count as Chrome.
fn process_names_browser(process: &str, browser: &str) -> bool {
    let lower = process.to_ascii_lowercase();
    let file = lower.rsplit(['/', '\\']).next().unwrap_or(&lower);
    let bundles = lower.split('/').filter(|part| part.ends_with(".app"));
    std::iter::once(file).chain(bundles).any(|name| name.contains(browser))
}

/// Executable of this process's parent (the browser that launched the host).
pub fn parent_process() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let ppid = std::os::unix::process::parent_id();
        std::fs::read_link(format!("/proc/{}/exe", ppid))
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
            .or_else(|| {
                std::fs::read_to_string(format!("/proc/{}/comm", ppid))
                    .ok()
                    .map(|c| c.trim().to_string())
            })
    }
    #[cfg(target_os = "macos")]
    {
        let ppid = std::os::unix::process::parent_id();
        let out = std::process::Command::new("ps")
            .args(["-o", "comm=", "-p", &ppid.to_string()])
            .output()
            .ok()?;
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!name.is_empty()).then_some(name)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        None
    }
}

/// Whether something accepts TCP connections on the local `port`.
pub fn port_is_live(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(port: u16, browser: Option<&str>) -> HostEntry {
        HostEntry { port, pid: 1, browser: browser.map(str::to_string), process: None }
    }

    #[test]
    fn spawning_browser_process_tells_chromium_forks_apart() {
        // Chrome and Helium both report "chrome"; the parent process differs.
        let mut chrome = entry(8766, Some("chrome"));
        chrome.process = Some("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".into());
        let mut helium = entry(8767, Some("chrome"));
        helium.process = Some("/Applications/Helium.app/Contents/MacOS/Helium".into());
        let hosts = [chrome, helium];
        assert_eq!(select_port(&hosts, Some("helium"), |_| true), Some(8767));
        assert_eq!(select_port(&hosts, Some("chrome"), |_| true), Some(8766));
        // A Linux fork installed under a chrome-named directory is not Chrome.
        assert!(!process_names_browser("/opt/google/chrome-fork/helium", "chrome"));
        assert!(process_names_browser("/opt/google/chrome/chrome", "chrome"));
        assert!(process_names_browser("/usr/lib/firefox/firefox", "firefox"));
    }

    #[test]
    fn exact_browser_match_wins() {
        let hosts = [entry(8766, Some("chrome")), entry(8768, Some("firefox"))];
        assert_eq!(select_port(&hosts, Some("firefox"), |_| true), Some(8768));
        assert_eq!(select_port(&hosts, Some("chrome"), |_| true), Some(8766));
    }

    #[test]
    fn chromium_request_falls_back_to_any_chromium_host() {
        // Helium and other forks report "chrome" through their user agent.
        let hosts = [entry(8766, Some("firefox")), entry(8767, Some("chrome"))];
        assert_eq!(select_port(&hosts, Some("chromium"), |_| true), Some(8767));
        assert_eq!(select_port(&hosts, Some("brave"), |_| true), Some(8767));
    }

    #[test]
    fn unmatched_or_unset_browser_takes_lowest_live_port() {
        let hosts = [entry(8766, Some("chrome")), entry(8767, None)];
        assert_eq!(select_port(&hosts, None, |_| true), Some(8766));
        assert_eq!(select_port(&hosts, Some("safari"), |_| true), Some(8766));
        assert_eq!(select_port(&hosts, Some("auto"), |_| true), Some(8766));
        // A dead 8766 must not hide a live host on a later port.
        assert_eq!(select_port(&hosts, None, |e| e.port != 8766), Some(8767));
        assert_eq!(select_port(&hosts, None, |_| false), None);
    }

    #[test]
    fn entries_round_trip_and_remove_only_own_entry() {
        let dir = std::env::temp_dir().join(format!("fab-registry-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("XDG_RUNTIME_DIR", &dir);
        let mine =
            HostEntry { port: 8770, pid: 42, browser: Some("chrome".into()), process: None };
        write_entry(&mine).unwrap();
        assert_eq!(entries(), vec![mine.clone()]);
        remove_entry(8770, 7); // another pid: must not delete
        assert_eq!(entries().len(), 1);
        remove_entry(8770, 42);
        assert!(entries().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
