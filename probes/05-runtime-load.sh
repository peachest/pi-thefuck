#!/bin/bash
# Probe 5: Test extension loads at runtime and basic APIs work
# This runs pi in print mode and verifies the extension loads

set -e

EXT_DIR="/mnt/disk1/hyx/projects/pi-mypackage/pi-thefuck"
TEST_EXT="$EXT_DIR/test-ext.ts"

cd /mnt/disk1/hyx/projects/pi-mypackage/wishlist

echo "=== Probe 5: Runtime Extension Loading Test ==="
echo ""

# Test 1: Extension loads with -p (print mode)
echo "Test 1: Extension loads in print mode"
timeout 15 pi -p -e "$TEST_EXT" "test" 2>&1 | grep -E "\[pi-thefuck-test\]" | head -10
echo ""

# Test 2: Extension registers /fuck-test command
echo "Test 2: Extension registers commands"
timeout 15 pi -p -e "$TEST_EXT" "/fuck-test" 2>&1 | grep -E "\[pi-thefuck-test\]" | head -20
echo ""

echo "=== Probe 5 Complete ==="