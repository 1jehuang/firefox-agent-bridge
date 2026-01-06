#!/bin/bash
# Run all benchmarks and save results

set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./extension/manifest.json').version")
DATE=$(date +%Y-%m-%d)
RESULTS_DIR="benchmarks/results"
RESULT_FILE="$RESULTS_DIR/$DATE-v$VERSION.json"

mkdir -p "$RESULTS_DIR"

echo "🚀 Running Firefox Agent Bridge Benchmarks"
echo "Version: $VERSION"
echo "Date: $DATE"
echo ""

# Check if bridge is running
if ! node ~/.claude/skills/firefox-browser/client.js ping > /dev/null 2>&1; then
  echo "❌ Firefox bridge not running. Start Firefox with the extension first."
  exit 1
fi

echo "✓ Bridge is running"
echo ""

# Run benchmarks
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

SEARCH_RESULT=$(node benchmarks/bench-search.js 2>&1 | tail -n +2)
echo "$SEARCH_RESULT"
SEARCH_JSON=$(echo "$SEARCH_RESULT" | grep -A 100 "📄 JSON:" | tail -n +2)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PARALLEL_RESULT=$(node benchmarks/bench-parallel.js 2>&1 | tail -n +2)
echo "$PARALLEL_RESULT"
PARALLEL_JSON=$(echo "$PARALLEL_RESULT" | grep -A 100 "📄 JSON:" | tail -n +2)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

COMPLEX_RESULT=$(node benchmarks/bench-complex-nav.js 2>&1 | tail -n +2)
echo "$COMPLEX_RESULT"
COMPLEX_JSON=$(echo "$COMPLEX_RESULT" | grep -A 100 "📄 JSON:" | tail -n +2)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Combine results
echo "💾 Saving results to $RESULT_FILE"

cat > "$RESULT_FILE" << EOF
{
  "version": "$VERSION",
  "date": "$DATE",
  "benchmarks": {
    "search": $SEARCH_JSON,
    "parallel": $PARALLEL_JSON,
    "complex": $COMPLEX_JSON
  }
}
EOF

echo "✓ Done!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Additional benchmarks available:"
echo ""
echo "Agent E2E benchmarks (spawns real Claude agents):"
echo "  node benchmarks/bench-agent-e2e.js list"
echo "  node benchmarks/bench-agent-e2e.js local    # Requires test server"
echo "  node benchmarks/bench-agent-e2e.js external"
echo ""
echo "Playwright comparison:"
echo "  ./benchmarks/run-comparison.sh              # Requires test server"
