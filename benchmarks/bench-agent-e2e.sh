#!/bin/bash
# E2E Agent Benchmark - measures real agent task completion time

TASK="${1:-search}"
RESULTS_DIR="$(dirname "$0")/results"
mkdir -p "$RESULTS_DIR"

echo "📊 E2E Agent Benchmark"
echo "Task: $TASK"
echo "========================"

case "$TASK" in
  search)
    PROMPT='Using the firefox-browser skill, search DuckDuckGo for "weather seattle" and tell me the first result. Commands: node ~/.claude/skills/firefox-browser/client.js <action> '"'"'<json>'"'"'. Do NOT use sleep.'
    ;;
  complaint)
    PROMPT='Using the firefox-browser skill, go to https://brightairindustries.com/?audience=community and find the complaint form. List the form field names. Use scout first. Commands: node ~/.claude/skills/firefox-browser/client.js <action> '"'"'<json>'"'"'. Do NOT use sleep.'
    ;;
  parallel)
    PROMPT='Using firefox-browser skill, use the parallel command to get titles from example.com, httpbin.org/html, and iana.org simultaneously. Commands: node ~/.claude/skills/firefox-browser/client.js <action> '"'"'<json>'"'"''
    ;;
  *)
    echo "Unknown task. Use: search, complaint, parallel"
    exit 1
    ;;
esac

START=$(date +%s%3N)

# Run claude and capture output
OUTPUT=$(claude --print --dangerously-skip-permissions -p "$PROMPT" 2>&1)

END=$(date +%s%3N)
TOTAL_MS=$((END - START))

# Count commands executed
CMD_COUNT=$(echo "$OUTPUT" | grep -c "client.js")

# Extract timing if available
echo ""
echo "--- Results ---"
echo "Total time: $((TOTAL_MS / 1000)).$((TOTAL_MS % 1000 / 100))s"
echo "Commands executed: $CMD_COUNT"
if [ $CMD_COUNT -gt 0 ]; then
  echo "Avg time/command: $((TOTAL_MS / CMD_COUNT))ms"
fi

# Save results
RESULT_FILE="$RESULTS_DIR/e2e-$TASK-$(date +%s).json"
cat > "$RESULT_FILE" << EOF
{
  "task": "$TASK",
  "timestamp": "$(date -Iseconds)",
  "totalMs": $TOTAL_MS,
  "commandCount": $CMD_COUNT,
  "avgMsPerCommand": $((CMD_COUNT > 0 ? TOTAL_MS / CMD_COUNT : 0))
}
EOF

echo ""
echo "📄 Saved to $RESULT_FILE"
echo ""
echo "--- Agent Output (last 50 lines) ---"
echo "$OUTPUT" | tail -50
