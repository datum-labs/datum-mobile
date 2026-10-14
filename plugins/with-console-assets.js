// Instance shell: bundles the terminal page and compute's console WASM
// (assets/console, gitignored) into the app as `console/`, where the shell
// screen's WebView loads them from (`console/terminal.html`, a file URL, so
// no Metro or network is involved and the 17 MB module isn't in the JS bundle).
//
// Adds a "Bundle shell client" run-script phase to the app target that copies
// the two files into the .app. Both prebuild and that phase fail with the
// commands to run when the files are missing:
//
//   scripts/build-console-wasm.sh       (Go: console-session.wasm, wasm_exec.js)
//   node scripts/build-console-web.mjs  (esbuild: terminal.html)
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['terminal.html', 'console-session.wasm'];
const PHASE = 'Bundle shell client';
const HINT = 'Run scripts/build-console-wasm.sh and node scripts/build-console-web.mjs (README, Instance shell).';

const SCRIPT = [
  'set -e',
  'SRC="${PROJECT_DIR}/../assets/console"',
  'DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/console"',
  `for f in ${FILES.join(' ')}; do`,
  '  if [ ! -s "$SRC/$f" ]; then',
  `    echo "error: assets/console/$f is missing. ${HINT}"`,
  '    exit 1',
  '  fi',
  'done',
  'mkdir -p "$DEST"',
  `for f in ${FILES.join(' ')}; do cp "$SRC/$f" "$DEST/$f"; done`,
  '',
].join('\n');

function assertBuilt() {
  const missing = FILES.filter((f) => {
    const file = path.join(ROOT, 'assets/console', f);
    return !fs.existsSync(file) || fs.statSync(file).size === 0;
  });
  if (missing.length > 0) {
    throw new Error(`with-console-assets: assets/console/${missing.join(', assets/console/')} missing. ${HINT}`);
  }
}

/**
 * Android: copy the files into the APK's assets (`file:///android_asset/console/`)
 * at prebuild. Unlike iOS there's no build phase; re-run prebuild after
 * rebuilding the WASM.
 */
function withAndroidConsoleAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      assertBuilt();
      const dest = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/assets/console');
      fs.mkdirSync(dest, { recursive: true });
      for (const f of FILES) fs.copyFileSync(path.join(ROOT, 'assets/console', f), path.join(dest, f));
      return cfg;
    },
  ]);
}

module.exports = function withConsoleAssets(config) {
  config = withAndroidConsoleAssets(config);
  // Checked in the mod, not here: plugins also run when Metro or `expo
  // export` read the config, which don't need the files.
  return withXcodeProject(config, (cfg) => {
    assertBuilt();
    const project = cfg.modResults;
    const target = project.getFirstTarget().uuid;
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    const exists = Object.values(phases).some((p) => typeof p === 'object' && p.name === `"${PHASE}"`);
    if (!exists) {
      project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE, target, {
        shellPath: '/bin/sh',
        shellScript: SCRIPT,
        inputPaths: FILES.map((f) => `"$(PROJECT_DIR)/../assets/console/${f}"`),
        outputPaths: FILES.map((f) => `"$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/console/${f}"`),
      });
    }
    return cfg;
  });
};
