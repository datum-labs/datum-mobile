#!/bin/sh
# Build the Datum Connect core (native/connect-core) for Android: the shared
# library for arm64 and its UniFFI Kotlin bindings, for the DatumVpn module's
# VpnService (modules/datum-vpn/android).
#
#   scripts/build-connect-core-android.sh            # release
#   PROFILE=debug scripts/build-connect-core-android.sh
#
# Output (gitignored; modules/datum-vpn/android/build.gradle reads it):
#   native/connect-core/build/android/jniLibs/arm64-v8a/libdatum_connect_core.so
#   native/connect-core/build/android/kotlin/uniffi/datum_connect_core/*.kt
#
# Needs the NDK (ANDROID_NDK_HOME, or the 27.1 NDK under ANDROID_HOME) and
# cargo-ndk (`cargo install cargo-ndk`).
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CRATE="$ROOT/native/connect-core"
OUT="$CRATE/build/android"
PROFILE=${PROFILE:-release}
TARGET=aarch64-linux-android
ABI=arm64-v8a
: "${ANDROID_HOME:=$(brew --prefix 2>/dev/null)/share/android-commandlinetools}"
: "${ANDROID_NDK_HOME:=$ANDROID_HOME/ndk/27.1.12297006}"
export ANDROID_HOME ANDROID_NDK_HOME

cd "$CRATE"
rustup target add "$TARGET" >/dev/null
if [ "$PROFILE" = release ]; then FLAG=--release; else FLAG=; fi

# The crate is a staticlib for iOS; Android loads a shared library through JNA.
echo "==> cargo ndk ($PROFILE) $ABI"
cargo ndk -t "$ABI" --platform 26 rustc -p datum-connect-core --lib $FLAG --locked --crate-type cdylib

rm -rf "$OUT"
mkdir -p "$OUT/jniLibs/$ABI" "$OUT/kotlin"
cp "target/$TARGET/$PROFILE/libdatum_connect_core.so" "$OUT/jniLibs/$ABI/"

echo "==> uniffi-bindgen (kotlin)"
cargo run -q -p uniffi-bindgen --locked -- generate \
  --library "target/$TARGET/$PROFILE/libdatum_connect_core.so" \
  --language kotlin \
  --no-format \
  --out-dir "$OUT/kotlin"

du -sh "$OUT/jniLibs/$ABI/libdatum_connect_core.so"
find "$OUT/kotlin" -name '*.kt'
