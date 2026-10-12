#!/bin/sh
# Build the Datum Connect core (native/connect-core) for the iOS Network
# Extension: a static-library xcframework for device and Apple-silicon
# simulators, plus its UniFFI Swift bindings.
#
#   scripts/build-connect-core.sh            # release
#   PROFILE=debug scripts/build-connect-core.sh
#
# Output (gitignored, consumed by plugins/with-datum-vpn.js when IOS_VPN=1):
#   native/connect-core/build/DatumConnectCore.xcframework
#   native/connect-core/build/swift/datum_connect_core.swift
#
# Needs the toolchain pinned in native/connect-core/rust-toolchain.toml
# (rustup installs it and the iOS targets on first use) and Xcode.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CRATE="$ROOT/native/connect-core"
OUT="$CRATE/build"
PROFILE=${PROFILE:-release}
LIB=libdatum_connect_core.a
TARGETS="aarch64-apple-ios aarch64-apple-ios-sim"

if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app/Contents/Developer ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
# Match the app's deployment target (expo-build-properties: iOS 26.0).
export IPHONEOS_DEPLOYMENT_TARGET=${IPHONEOS_DEPLOYMENT_TARGET:-26.0}

cd "$CRATE"
rustup target add $TARGETS >/dev/null

if [ "$PROFILE" = release ]; then FLAG=--release; else FLAG=; fi
for target in $TARGETS; do
  echo "==> cargo build ($PROFILE) $target"
  cargo build -p datum-connect-core $FLAG --target "$target" --locked
done

rm -rf "$OUT"
mkdir -p "$OUT/swift" "$OUT/headers"

echo "==> uniffi-bindgen (swift)"
cargo run -q -p uniffi-bindgen --locked -- generate \
  --library "target/aarch64-apple-ios/$PROFILE/$LIB" \
  --language swift \
  --out-dir "$OUT/swift"

# The xcframework carries the C header and a module map named for the
# generated Swift file's `import datum_connect_coreFFI`.
mv "$OUT/swift/datum_connect_coreFFI.h" "$OUT/headers/"
mv "$OUT/swift/datum_connect_coreFFI.modulemap" "$OUT/headers/module.modulemap"

echo "==> xcodebuild -create-xcframework"
xcodebuild -create-xcframework \
  -library "target/aarch64-apple-ios/$PROFILE/$LIB" -headers "$OUT/headers" \
  -library "target/aarch64-apple-ios-sim/$PROFILE/$LIB" -headers "$OUT/headers" \
  -output "$OUT/DatumConnectCore.xcframework" >/dev/null
rm -rf "$OUT/headers"

du -sh "$OUT/DatumConnectCore.xcframework" "target/aarch64-apple-ios/$PROFILE/$LIB"
echo "==> done: $OUT"
