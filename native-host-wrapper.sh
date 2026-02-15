#!/bin/sh
export FAB_AUTOLOGIN_REQUIRE_FINGERPRINT=false
exec /home/jeremy/firefox-agent-bridge/rust-cli/target/release/firefox-agent-bridge-host "$@"
