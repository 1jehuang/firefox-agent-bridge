# Firefox Agent Bridge — Development Notes

## Project Structure

- `extension/` — Firefox WebExtension (content.js, background.js, manifest.json)
- `rust-cli/` — Rust CLI binary (`browser` command) and native messaging host
- `benchmarks/` — Test suites and local test pages
- `scripts/` — Build/rebuild helpers
- `SKILL.md` — Agent skill documentation (also installed to `~/.jcode/skills/firefox-browser/SKILL.md`)

## Build & Deploy

### CLI Binary
```bash
cd rust-cli && cargo build --release
cp target/release/browser ~/.cargo/bin/browser
```

### Extension
```bash
./scripts/rebuild-extension.sh
```
This rebuilds the XPI and installs it to the Firefox profile.

### Native Messaging Host
The `native-host-wrapper.sh` points to `rust-cli/target/release/firefox-agent-bridge-host` directly — no copy needed, but requires `cargo build --release` in `rust-cli/`.

## Important: Keep SKILL.md Up to Date

**When adding or changing actions/features**, update BOTH copies of SKILL.md:
1. `/home/jeremy/firefox-agent-bridge/SKILL.md` (repo copy, committed)
2. `/home/jeremy/.jcode/skills/firefox-browser/SKILL.md` (jcode skill copy, used by agents)

These must stay in sync. The easiest way:
```bash
# Edit the repo copy, then sync
cp SKILL.md ~/.jcode/skills/firefox-browser/SKILL.md
```

Things that need updating in SKILL.md when changed:
- New actions added to `extension/content.js` or `extension/background.js`
- New CLI-level actions or transformations in `rust-cli/src/main.rs`
- New CLI flags or subcommands
- Changes to action parameters or response formats
- New editor types supported by `fillForm`

## Key Technical Details

- WebSocket runs on port **8766** (not 8765)
- Extension XPI: `~/.mozilla/firefox/v5xdhgxp.default-release/extensions/browser-agent-bridge@1jehuang.github.io.xpi`
- `uploadFile` and `dropFile` are CLI-level actions that transform into `fillForm`/`dropFile` wire messages
- Rich text insertion uses `wrappedJSObject.eval()` to run in page world (bypasses Firefox Xray wrappers)
- `dropFile` dispatches DragEvents in page world for same reason — DataTransfer.files gets stripped by Xray wrappers otherwise
- `native-host-wrapper.sh` should have `FAB_AUTOLOGIN_REQUIRE_FINGERPRINT=true`

## Benchmarks

```bash
# Start test server (port 3456)
node benchmarks/test-server.js &

# Run editor/upload benchmarks (24 tests)
node benchmarks/bench-editors.js
```

Test pages in `benchmarks/test-site/`: draftjs-editor.html, lexical-editor.html, canvas-homework.html, file-upload.html
