#!/bin/bash
# Run Playwright vs Firefox Agent Bridge comparison benchmarks

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "========================================"
echo "Playwright vs Firefox Comparison"
echo "========================================"
echo ""

# Check test server
echo "Checking test server..."
if ! curl -s http://localhost:3456/api/health > /dev/null 2>&1; then
    echo "❌ Test server not running!"
    echo "   Start with: node benchmarks/test-server.js"
    exit 1
fi
echo "✓ Test server running"

# Check Firefox bridge
echo "Checking Firefox Agent Bridge..."
if ! node ~/.claude/skills/firefox-browser/client.js ping > /dev/null 2>&1; then
    echo "❌ Firefox Agent Bridge not running!"
    echo "   Make sure Firefox is running with the extension loaded."
    exit 1
fi
echo "✓ Firefox Agent Bridge running"

echo ""
echo "Running comparison benchmarks..."
echo ""

node benchmarks/bench-playwright-comparison.js all
