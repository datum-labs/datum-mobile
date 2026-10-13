#!/bin/sh
# The widget extension's pure Swift (snapshot decoding, timeline, the VPC
# control's resume checks) compiled and tested on macOS, against the fixture
# the app's snapshot builder is pinned to (src/lib/health/__tests__/fixture.test.ts).
#
#   scripts/test-widgets.sh                 run the tests
#   scripts/test-widgets.sh --render DIR    also render the views to DIR/widget-*.png
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/native/datum-widgets"
OUT=$(mktemp -d "${TMPDIR:-/tmp}/datum-widgets.XXXXXX")
trap 'rm -rf "$OUT"' EXIT
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

xcrun swiftc -parse-as-library -O -o "$OUT/model-tests" \
  "$SRC/Shared/HealthModel.swift" "$SRC/Shared/ConnectJoin.swift" "$SRC/Tests/ModelTests.swift"
"$OUT/model-tests" "$SRC/Tests/fixtures/snapshot.json"

if [ "${1:-}" = "--render" ]; then
  DEST=${2:?usage: --render DIR}
  FONT="$ROOT/node_modules/@datum-cloud/datum-ui-native/fonts/CanelaText-Regular.ttf"
  xcrun swiftc -parse-as-library -o "$OUT/render" \
    "$SRC/Shared/HealthModel.swift" "$SRC/Shared/WidgetShared.swift" "$SRC/HealthViews.swift" \
    "$SRC/Tests/RenderPreviews.swift"
  "$OUT/render" "$SRC/Tests/fixtures/snapshot.json" "$FONT" "$DEST"
fi
