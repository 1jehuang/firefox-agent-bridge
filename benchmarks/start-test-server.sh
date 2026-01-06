#!/bin/bash
# Start the test server for benchmarks

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${TEST_PORT:-3456}"

echo "Starting test server on port $PORT..."
node "$SCRIPT_DIR/test-server.js"
