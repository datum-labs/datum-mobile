#!/usr/bin/env node
/**
 * Bundles the shell's terminal page (native/console-web) into one
 * self-contained file, assets/console/terminal.html: xterm.js and its CSS,
 * the page script, and the worker script with Go's `wasm_exec.js` in front.
 *
 *   scripts/build-console-wasm.sh      # once per compute pin: the WASM and wasm_exec.js
 *   node scripts/build-console-web.mjs # after changing native/console-web
 *
 * Everything is inlined because the page runs from the app bundle as a file
 * URL: the WebView can read the WASM next to it with XHR, but a worker
 * script loaded by URL can't reach other bundle files. The output is
 * gitignored; plugins/with-console-assets.js copies assets/console into the
 * app and fails the build if this hasn't been run.
 */
import { build } from 'esbuild';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'native/console-web');
const out = path.join(root, 'assets/console');
const wasmExec = path.join(out, 'wasm_exec.js');

if (!existsSync(wasmExec)) {
  console.error(`error: ${path.relative(root, wasmExec)} is missing. Run scripts/build-console-wasm.sh first.`);
  process.exit(1);
}

const common = {
  bundle: true,
  write: false,
  format: 'iife',
  target: 'safari18',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
};

const worker = await build({ ...common, entryPoints: [path.join(src, 'src/worker.ts')] });
const workerSource = `${readFileSync(wasmExec, 'utf8')}\n${worker.outputFiles[0].text}`;

const page = await build({
  ...common,
  entryPoints: [path.join(src, 'src/main.ts')],
  define: { __WORKER_SOURCE__: JSON.stringify(workerSource) },
});

const require = createRequire(import.meta.url);
const xtermCss = readFileSync(require.resolve('@xterm/xterm/css/xterm.css'), 'utf8');
// A literal "</script" inside the inline script would end it early.
const pageJs = page.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const html = readFileSync(path.join(src, 'terminal.html'), 'utf8')
  .replace('/*__XTERM_CSS__*/', () => xtermCss)
  .replace('/*__CONSOLE_JS__*/', () => pageJs);
writeFileSync(path.join(out, 'terminal.html'), html);
console.log(`assets/console/terminal.html: ${Buffer.byteLength(html)} bytes`);
