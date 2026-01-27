#!/bin/bash
# LocalTerm Download Statistics
# Analyzes CloudFront logs for download counts

BUCKET="localterm-logs-aleonis"
PREFIX="cloudfront/"
PROFILE="mlxstudio"
TEMP_DIR="/tmp/localterm-logs"

echo "=== LocalTerm Download Statistics ==="
echo ""

# Create temp directory
mkdir -p "$TEMP_DIR"

# Download recent logs (last 7 days worth)
echo "Downloading logs from S3..."
aws s3 sync "s3://$BUCKET/$PREFIX" "$TEMP_DIR" --profile "$PROFILE" --quiet 2>/dev/null

# Check if we have any logs
LOG_COUNT=$(ls -1 "$TEMP_DIR"/*.gz 2>/dev/null | wc -l)
if [ "$LOG_COUNT" -eq 0 ]; then
    echo "No logs found yet. CloudFront logs are delivered with ~1 hour delay."
    echo "Check back later!"
    exit 0
fi

echo "Processing $LOG_COUNT log files..."
echo ""

# Decompress and analyze
echo "=== Download Counts by File ==="
zcat "$TEMP_DIR"/*.gz 2>/dev/null | \
    grep -E "releases/.*\.(dmg|exe|AppImage)" | \
    awk '{print $8}' | \
    sed 's/.*releases\///' | \
    sort | uniq -c | sort -rn

echo ""
echo "=== Downloads by Platform ==="
echo -n "macOS ARM64 (.dmg arm64): "
zcat "$TEMP_DIR"/*.gz 2>/dev/null | grep -c "LocalTerm-macos-arm64.dmg" || echo "0"
echo -n "macOS Intel (.dmg x64):   "
zcat "$TEMP_DIR"/*.gz 2>/dev/null | grep -c "LocalTerm-macos-x64.dmg" || echo "0"
echo -n "Windows (.exe):           "
zcat "$TEMP_DIR"/*.gz 2>/dev/null | grep -c "LocalTerm-windows.*\.exe" || echo "0"
echo -n "Linux (.AppImage):        "
zcat "$TEMP_DIR"/*.gz 2>/dev/null | grep -c "\.AppImage" || echo "0"

echo ""
echo "=== Total Downloads ==="
TOTAL=$(zcat "$TEMP_DIR"/*.gz 2>/dev/null | grep -cE "releases/.*\.(dmg|exe|AppImage)")
echo "Total: $TOTAL"

echo ""
echo "=== Downloads by Date ==="
zcat "$TEMP_DIR"/*.gz 2>/dev/null | \
    grep -E "releases/.*\.(dmg|exe|AppImage)" | \
    awk '{print $1}' | \
    sort | uniq -c | sort -k2

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "=== Log Info ==="
echo "Logs bucket: s3://$BUCKET/$PREFIX"
echo "Note: CloudFront logs have ~1 hour delay"
