#!/bin/bash
# Test script for uploadFile action
# Run: ./test-upload.sh

set -e

echo "=== File Upload Tests ==="
echo ""

# Create test files
TEST_DIR="/tmp/upload-test-files"
mkdir -p "$TEST_DIR"

# Create a simple PNG (1x1 red pixel)
echo -n 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==' | base64 -d > "$TEST_DIR/test.png"

# Create a simple text file
echo "This is a test file for upload testing." > "$TEST_DIR/test.txt"

# Create a simple PDF (minimal valid PDF)
cat > "$TEST_DIR/test.pdf" << 'EOF'
%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
170
%%EOF
EOF

echo "Test files created in $TEST_DIR"
echo ""

# Navigate to test page
echo "1. Opening test page..."
browser navigate '{"url": "file:///home/jeremy/firefox-agent-bridge/test-file-upload.html"}'
sleep 2

# Test 1: Twitter-style hidden input
echo ""
echo "2. Testing Twitter-style hidden input upload..."
RESULT=$(browser uploadFile "{\"selector\": \"#twitter-file-input\", \"path\": \"$TEST_DIR/test.png\"}")
echo "   Result: $RESULT"

if echo "$RESULT" | grep -q '"ok": true'; then
    echo "   ✓ Twitter-style upload PASSED"
else
    echo "   ✗ Twitter-style upload FAILED"
fi

sleep 1

# Test 2: Drag-drop hidden input
echo ""
echo "3. Testing drag-drop style hidden input..."
RESULT=$(browser uploadFile "{\"selector\": \"#drop-file-input\", \"path\": \"$TEST_DIR/test.txt\"}")
echo "   Result: $RESULT"

if echo "$RESULT" | grep -q '"ok": true'; then
    echo "   ✓ Drag-drop upload PASSED"
else
    echo "   ✗ Drag-drop upload FAILED"
fi

sleep 1

# Test 3: PDF input with accept restriction
echo ""
echo "4. Testing PDF input with accept attribute..."
RESULT=$(browser uploadFile "{\"selector\": \"#pdf-input\", \"path\": \"$TEST_DIR/test.pdf\"}")
echo "   Result: $RESULT"

if echo "$RESULT" | grep -q '"ok": true'; then
    echo "   ✓ PDF upload PASSED"
else
    echo "   ✗ PDF upload FAILED"
fi

sleep 1

# Test 4: Multiple inputs - specific targeting
echo ""
echo "5. Testing multiple inputs - targeting profile pic..."
RESULT=$(browser uploadFile "{\"selector\": \"#profile-pic\", \"path\": \"$TEST_DIR/test.png\"}")
echo "   Result: $RESULT"

if echo "$RESULT" | grep -q '"ok": true'; then
    echo "   ✓ Profile pic upload PASSED"
else
    echo "   ✗ Profile pic upload FAILED"
fi

sleep 1

# Test 5: Form with file + text fields
echo ""
echo "6. Testing form with file and text fields..."
browser fillForm '{"fields": [{"selector": "#form-title", "value": "Test Upload"}, {"selector": "#form-desc", "value": "Testing file upload with form fields"}]}'
RESULT=$(browser uploadFile "{\"selector\": \"#form-file\", \"path\": \"$TEST_DIR/test.txt\"}")
echo "   Result: $RESULT"

if echo "$RESULT" | grep -q '"ok": true'; then
    echo "   ✓ Form file upload PASSED"
else
    echo "   ✗ Form file upload FAILED"
fi

sleep 1

# Test 6: Canvas-style document embed
echo ""
echo "7. Testing Canvas-style document embed..."
RESULT=$(browser uploadFile "{\"selector\": \"#canvas-file-input\", \"path\": \"$TEST_DIR/test.pdf\"}")
echo "   Result: $RESULT"

if echo "$RESULT" | grep -q '"ok": true'; then
    echo "   ✓ Canvas-style upload PASSED"
else
    echo "   ✗ Canvas-style upload FAILED"
fi

# Take a screenshot of final state
echo ""
echo "8. Taking screenshot of test results..."
browser screenshot '{"filename": "upload-test-results"}'

echo ""
echo "=== Tests Complete ==="
echo "Screenshot saved as upload-test-results.png"
echo "Check the browser to see visual confirmation of uploads."

# Cleanup
# rm -rf "$TEST_DIR"
