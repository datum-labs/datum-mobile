#!/bin/sh
# Build the instance shell client (compute's cmd/console-wasm, Go compiled to
# WebAssembly) from a pinned compute commit, for the shell's WebView.
#
#   scripts/build-console-wasm.sh
#   COMPUTE_REF=<commit> scripts/build-console-wasm.sh     # try another commit
#
# Output (gitignored; plugins/with-console-assets.js copies assets/console into
# the app bundle and fails the build if anything is missing):
#   assets/console/console-session.wasm   the client (about 17 MB raw)
#   assets/console/wasm_exec.js           Go's loader from the same toolchain
#   assets/console/BUILD.json             compute commit, Go version, sizes
#
# The loader must come from the Go toolchain that built the module, so both
# come from this one run. The sources are read with `git archive` from a local
# compute checkout when it has the commit (COMPUTE_DIR, default ../compute),
# otherwise from a shallow clone of COMPUTE_REPO. The checkout isn't changed.
# Needs Go at the version compute's go.mod names (GOTOOLCHAIN=auto fetches it).
set -eu

# compute main as of 2026-10-12 (af9d7d3b, "Merge pull request #472"). The
# console client, its session API and the portal's shell UI are unchanged
# from 285fb19d.
COMPUTE_REF=${COMPUTE_REF:-af9d7d3b1256f5c650da2d4d8fb72134f3375ffc}
COMPUTE_REPO=${COMPUTE_REPO:-https://github.com/datum-cloud/compute.git}

ROOT=$(cd "$(dirname "$0")/.." && pwd)
COMPUTE_DIR=${COMPUTE_DIR:-$ROOT/../compute}
OUT="$ROOT/assets/console"

command -v go >/dev/null || {
  echo "error: Go isn't installed. Install the version compute's go.mod names, then run this again." >&2
  exit 1
}

WORK=$(mktemp -d "${TMPDIR:-/tmp}/console-wasm.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

if git -C "$COMPUTE_DIR" cat-file -e "$COMPUTE_REF^{commit}" 2>/dev/null; then
  echo "==> compute $COMPUTE_REF from $COMPUTE_DIR"
  git -C "$COMPUTE_DIR" archive --format=tar "$COMPUTE_REF" | tar -x -C "$WORK"
else
  echo "==> compute $COMPUTE_REF from $COMPUTE_REPO"
  git -C "$WORK" init -q
  git -C "$WORK" fetch -q --depth 1 "$COMPUTE_REPO" "$COMPUTE_REF"
  git -C "$WORK" checkout -q FETCH_HEAD
fi

echo "==> make build-console-wasm ($(go version | cut -d' ' -f3))"
make -C "$WORK" build-console-wasm

mkdir -p "$OUT"
install -m 0644 "$WORK/bin/console-session.wasm" "$OUT/console-session.wasm"
install -m 0644 "$WORK/bin/console-session-wasm_exec.js" "$OUT/wasm_exec.js"

RAW=$(wc -c < "$OUT/console-session.wasm" | tr -d ' ')
GZIP=$(gzip -9c "$OUT/console-session.wasm" | wc -c | tr -d ' ')
SHA=$(shasum -a 256 "$OUT/console-session.wasm" | cut -d' ' -f1)
GO_VERSION=$(cd "$WORK" && go env GOVERSION)
cat > "$OUT/BUILD.json" <<EOF
{
  "computeCommit": "$COMPUTE_REF",
  "goVersion": "$GO_VERSION",
  "wasmBytes": $RAW,
  "wasmGzipBytes": $GZIP,
  "wasmSha256": "$SHA"
}
EOF
echo "==> $OUT/console-session.wasm: $RAW bytes raw, $GZIP gzip ($GO_VERSION)"
