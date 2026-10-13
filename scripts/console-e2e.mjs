#!/usr/bin/env node
/**
 * End-to-end proof for the instance shell, run on a Mac against staging.
 *
 * It drives the two halves the app uses, with no simulator:
 *
 *   1. the app's control plane, `src/resources/console/control-plane.ts`
 *      (shell access checks, `ShellSession`: create, watch until
 *      SessionReady, connect, delete), loaded with Node's type stripping;
 *   2. the shell client the WebView runs: compute's console WASM
 *      (`assets/console/console-session.wasm` + `wasm_exec.js`, built by
 *      `scripts/build-console-wasm.sh`) through the same adapter,
 *      `native/console-web/src/wasm-adapter.ts`. Node 24 has the `fetch` and
 *      `WebSocket` the client uses to reach the iroh relays.
 *
 * Usage (staging only; needs `datumctl` logged in to staging):
 *
 *   scripts/build-console-wasm.sh
 *   node scripts/console-e2e.mjs --project matt-jenkinson-yz0y92 --instance prism-demo-default-us-east-1-0
 *
 * Options: --command (default /bin/sh), --run CMD (repeatable; typed into the
 * shell in order, then `exit`; default `uname -a`), --force (create the
 * session even when the app wouldn't offer a shell, to see the refusal).
 *
 * The access token comes from `datumctl auth get-token --output=token` and is
 * never written anywhere. The session is deleted when the shell ends, and the
 * script checks that it's gone.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';

import * as cp from '../src/resources/console/control-plane.ts';
import { loadConsoleClient } from '../native/console-web/src/wasm-adapter.ts';

const API = 'https://api.staging.env.datum.net';
const root = path.resolve(import.meta.dirname, '..');

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    instance: { type: 'string' },
    command: { type: 'string', default: cp.DEFAULT_SHELL_COMMAND },
    run: { type: 'string', multiple: true },
    // Create the session even when the app wouldn't offer one (to see the refusal).
    force: { type: 'boolean', default: false },
  },
});
if (!values.project || !values.instance) {
  console.error('usage: node scripts/console-e2e.mjs --project PROJECT --instance INSTANCE [--run CMD]...');
  process.exit(2);
}
const runs = values.run?.length ? values.run : ['uname -a'];
const base = `${API}/apis/resourcemanager.miloapis.com/v1alpha1/projects/${values.project}/control-plane`;
const started = Date.now();
const log = (msg) => console.error(`[${String(Date.now() - started).padStart(5)} ms] ${msg}`);

// --- HTTP: the API client's semantics (bearer, one retry on 401) ----------
let token = '';
function refreshToken() {
  token = execFileSync('datumctl', ['auth', 'get-token', '--output=token'], { encoding: 'utf8' }).trim();
}
/** @type {cp.ConsoleFetch} */
async function consoleFetch(p, init = {}) {
  for (let attempt = 0; ; attempt += 1) {
    if (!token) refreshToken();
    const res = await fetch(`${base}${p}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers, Authorization: `Bearer ${token}` },
    });
    if (res.status !== 401 || attempt > 0) return res;
    token = '';
  }
}
const http = { fetch: consoleFetch };

// --- Shell access: what decides whether the app shows "Open shell" --------
const access = await cp.fetchShellAccess(http);
const rawInstance = await (await consoleFetch(
  `/apis/compute.datumapis.com/v1alpha/namespaces/default/instances/${values.instance}`
)).json();
const containers = (rawInstance.spec?.runtime?.sandbox?.containers ?? []).map((c) => c.name);
const runtimeClass = cp.resolveRuntimeClass(rawInstance.spec?.runtime?.class, access.runtimeClasses);
log(
  `access: create=${access.canCreateSessions} allowance=${access.sessionAllowance} ` +
    `runtime=${runtimeClass?.name} exec=${runtimeClass?.features.includes(cp.EXEC_FEATURE)} ` +
    `containers=${containers.join(',')}`
);
if (!cp.canShowShell({ ...access, runtimeClass, containers })) {
  console.error('The app would not offer a shell for this instance.');
  if (!values.force) process.exit(1);
}

// --- The WASM client, as the WebView's worker runs it ---------------------
createRequire(import.meta.url)(path.join(root, 'assets/console/wasm_exec.js'));
const client = await loadConsoleClient(await readFile(path.join(root, 'assets/console/console-session.wasm')));
log(`console client loaded, features=${client.features.join(',')}`);

/** @type {cp.ShellConnector} */
let stream;
const connector = {
  load: async () => client.publicKey(),
  connect(target, size, onOutput, onEnd, onConnected) {
    log(`connect uid=${target.uid} endpoint=${target.endpointID.slice(0, 12)}… relays=${target.relayURLs.join(',')}`);
    stream = client.connect(target, size, onOutput, onEnd, onConnected);
  },
  write: (data) => stream?.write(data),
  resize: (size) => stream?.resize(size),
  dispose: () => stream?.close(),
};

const decoder = new TextDecoder();
let resolveEnded;
const ended = new Promise((resolve) => (resolveEnded = resolve));
let sessionName;
const session = new cp.ShellSession(cp.httpSessionDeps(http, () => connector), {
  instanceName: values.instance,
  instanceUid: rawInstance.metadata.uid,
  onOutput: (bytes) => process.stdout.write(decoder.decode(bytes, { stream: true })),
  onState: (state) => {
    sessionName ??= session.sessionName;
    log(`state ${state.phase}${state.phase === 'ended' ? `: ${state.message} (${state.reason ?? '-'})` : ''}${
      session.sessionName ? ` [${session.sessionName}]` : ''
    }`);
    if (state.phase === 'connected') void typeCommands();
    if (state.phase === 'ended') resolveEnded(state);
  },
});

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function typeCommands() {
  await pause(800);
  for (const line of runs) {
    session.write(`${line}\n`);
    await pause(1200);
  }
  session.write('exit\n');
}

const parsed = cp.parseCommand(values.command);
if (!parsed.ok) throw new Error(parsed.error);
const watchdog = setTimeout(() => {
  log('timed out; closing the session');
  session.dispose();
  resolveEnded({ phase: 'ended', message: 'timed out' });
}, 90_000);
void session.open(containers[0], parsed.argv, () => ({ cols: 100, rows: 30 }));
const final = await ended;
clearTimeout(watchdog);

// --- The session is deleted when the shell ends --------------------------
let gone = false;
for (let i = 0; i < 20 && sessionName; i += 1) {
  const res = await consoleFetch(`/apis/compute.datumapis.com/v1alpha/namespaces/default/instanceconsolesessions/${sessionName}`);
  if (res.status === 404) {
    gone = true;
    break;
  }
  await pause(500);
}
log(
  `ended: ${final.message}; ${
    sessionName ? `session ${sessionName} ${gone ? 'deleted' : 'STILL PRESENT'}` : 'no session was created'
  }`
);
process.exit((gone || !sessionName) && final.reason === 'Completed' ? 0 : 1);
