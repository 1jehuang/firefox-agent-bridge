use anyhow::{anyhow, Result};
use std::fs;
use std::path::PathBuf;

use super::docs::print_docs;

/// Embedded SKILL.md content
const SKILL_MD: &str = include_str!("../../resources/SKILL.md");

/// Run setup for specified target
pub fn run(target: &str) -> Result<()> {
    match target {
        "claude" => setup_claude(),
        "generic" => {
            print_docs();
            Ok(())
        }
        _ => {
            eprintln!("Unknown setup target: {}", target);
            eprintln!("Available: claude, generic");
            std::process::exit(1);
        }
    }
}

/// Install Claude Code skill files
fn setup_claude() -> Result<()> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Could not determine home directory"))?;
    let skill_dir = home.join(".claude").join("skills").join("firefox-browser");

    // Create directory
    fs::create_dir_all(&skill_dir)?;

    // Write SKILL.md
    let skill_md_path = skill_dir.join("SKILL.md");

    // Update SKILL.md to use 'browser' command instead of client.js path
    let updated_skill_md = SKILL_MD
        .replace("node ~/.claude/skills/firefox-browser/client.js", "browser")
        .replace("client.js", "browser");

    fs::write(&skill_md_path, updated_skill_md)?;
    println!("Created SKILL.md at {}", skill_md_path.display());

    println!("Claude Code skill installed at {}", skill_dir.display());
    println!("\nClaude Code will now recognize the \"browser\" command.");

    Ok(())
}

/// Get the skill directory path
pub fn get_skill_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("skills").join("firefox-browser"))
}
