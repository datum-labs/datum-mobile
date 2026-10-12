#!/usr/bin/env node
/**
 * End-to-end proof for "connect this phone to a project VPC", run on a Mac.
 *
 * Network Extensions can't run in the Simulator, so this drives the same two
 * halves the iOS app uses, against a real project:
 *
 *   1. the app's control plane, `src/resources/connect/control-plane.ts`
 *      (activation, Connector enrollment and Lease, nearest gateway,
 *      ConnectNetworkBinding), loaded with Node's TypeScript type stripping;
 *   2. the Network Extension's Rust core, through `connect-probe`, which calls
 *      `start_session` / `write_packet` / `on_packet` and pings a VPC address
 *      with ICMPv6.
 *
 * Usage (staging only; needs `datumctl` logged in to staging):
 *
 *   cargo build --manifest-path native/connect-core/Cargo.toml -p connect-probe
 *   node scripts/connect-e2e.mjs --project matt-jenkinson-yz0y92 --network default
 *
 * Options: --target ADDR (repeatable; default: two workload instances on the
 * network, nearest location first, then the Connect gateway's own instance),
 * --tcp PORT (also send a TCP SYN to each target), --keep (leave the binding
 * and Connector), --probe PATH.
 *
 * The access token comes from `datumctl auth get-token --output=token` on
 * demand and is never written anywhere. The Connector key is generated per run
 * and handed to the probe on stdin.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';

import * as cp from '../src/resources/connect/control-plane.ts';

const API = 'https://api.staging.env.datum.net';
const root = path.resolve(import.meta.dirname, '..');

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    network: { type: 'string', default: 'default' },
    target: { type: 'string', multiple: true },
    keep: { type: 'boolean', default: false },
    probe: {
      type: 'string',
      default: path.join(root, 'native/connect-core/target/debug/connect-probe'),
    },
    count: { type: 'string', default: '3' },
    tcp: { type: 'string', multiple: true },
  },
});
if (!values.project) {
  console.error('usage: node scripts/connect-e2e.mjs --project PROJECT [--network NAME] [--target ADDR]');
  process.exit(2);
}
const project = values.project;
const network = values.network;

// --- HTTP: the daemon's request() semantics -------------------------------
let token = '';
function refreshToken() {
  token = execFileSync('datumctl', ['auth', 'get-token', '--output=token'], { encoding: 'utf8' }).trim();
}
class HttpError extends Error {
  constructor(status, message, method, url) {
    super(`${method} ${url.replace(API, '')} -> HTTP ${status}: ${message}`);
    this.status = status;
  }
}
async function request(method, url, body) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!token) refreshToken();
    const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && attempt === 0) {
      token = '';
      continue;
    }
    const text = await res.text();
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) {
      let message = text.slice(0, 300);
      try {
        message = JSON.parse(text).message ?? message;
      } catch {}
      throw new HttpError(res.status, message, method, url);
    }
    return text ? JSON.parse(text) : null;
  }
  throw new HttpError(401, 'unauthorized', method, url);
}
const http = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  delete: async (p, b) => {
    await request('DELETE', p, b);
  },
};

const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

const deps = {
  http,
  sha256Hex: async (input) => createHash('sha256').update(input, 'utf8').digest('hex'),
  edgeInfo: async () => (await fetch(cp.EDGE_INFO_URL)).text(),
  onProgress: (stage, detail) => log(`stage=${stage}${detail ? ` (${detail})` : ''}`),
};

// --- Connector key: ed25519 seed, as the iOS app's CryptoKit key -----------
const { privateKey } = generateKeyPairSync('ed25519');
const jwk = privateKey.export({ format: 'jwk' });
const secretKeyHex = Buffer.from(jwk.d, 'base64url').toString('hex');
const publicKey = Buffer.from(jwk.x, 'base64url').toString('hex');
const connectorName = cp.defaultConnectorName(publicKey);

async function instanceTargets(location) {
  const base = cp.projectBase(project);
  const list = await http.get(`${base}/apis/compute.datumapis.com/v1alpha/namespaces/default/instances`);
  const found = [];
  for (const item of list?.items ?? []) {
    const ready = (item.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True');
    for (const nic of item.status?.networkInterfaces ?? []) {
      const spec = (item.spec?.networkInterfaces ?? []).find((n) => n.name === nic.name);
      if (spec?.network?.name !== network) continue;
      for (const a of nic.addresses ?? []) {
        if (a.family !== 'IPv6') continue;
        found.push({
          name: item.metadata.name,
          location: item.spec?.location?.name,
          ready,
          address: a.address.split('/')[0],
        });
      }
    }
  }
  // Ready workloads in the gateway's location first; the Connect gateway's
  // own instance (connect-gw-*) last.
  const gw = (i) => i.name.startsWith('connect-gw-');
  found.sort(
    (a, b) =>
      Number(gw(a)) - Number(gw(b)) ||
      Number(b.ready) - Number(a.ready) ||
      Number(b.location === location) - Number(a.location === location)
  );
  return found;
}

async function main() {
  log(`project=${project} network=${network} api=${API}`);
  log(`connector=${connectorName} publicKey=${publicKey}`);

  const activation = await cp.ensureActivated(deps, project);
  log(`activation: ${activation.service.canonicalName} is ${activation.state} (${activation.service.enablementMode})`);

  const homeRelayUrls = cp.homeRelaysFor(API);
  const started = Date.now();
  const join = await cp.joinGatewayNetwork(deps, { project, network, publicKey, connectorName, homeRelayUrls });
  const g = join.grant;
  log(`binding ${g.bindingName} accepted in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  log(`  gateway        ${g.gatewayName} (${g.gatewayLocation}) created=${join.gatewayCreated}`);
  log(`  endpoint       ${g.gatewayEndpointId}`);
  log(`  client         ${g.clientAddress}`);
  log(`  gateway peer   ${g.gatewayAddress}`);
  log(`  routes         ${g.routes.join(', ')}`);
  log(`  relays         ${g.relayUrls.join(', ')}`);
  log(`  mtu            ${g.mtu}`);

  let targets = values.target ?? [];
  if (targets.length === 0) {
    const instances = await instanceTargets(g.gatewayLocation);
    for (const i of instances) log(`  instance       ${i.name} ${i.location} ${i.address}${i.ready ? '' : ' (not ready)'}`);
    const workloads = instances.filter((i) => !i.name.startsWith('connect-gw-')).slice(0, 2);
    const gateway = instances.filter((i) => i.name.startsWith('connect-gw-')).slice(0, 1);
    targets = [...workloads, ...gateway].map((i) => i.address);
  }
  if (targets.length === 0) throw new Error(`no instance addresses on network ${network}; pass --target`);

  // Keep the Connector live while the probe runs (daemon: every 10 s).
  const liveness = setInterval(() => {
    cp.renewConnectorLiveness(deps, project, connectorName, publicKey).catch((e) => log(`lease renewal failed: ${e.message}`));
  }, 10_000);

  const input = {
    secretKeyHex,
    network,
    gatewayEndpointId: g.gatewayEndpointId,
    relayUrls: g.relayUrls,
    homeRelayUrls: homeRelayUrls.length ? homeRelayUrls : g.relayUrls,
    clientAddress: g.clientAddress,
    gatewayAddress: g.gatewayAddress,
    routes: g.routes,
    mtu: g.mtu,
    targets,
    count: Number(values.count),
    timeoutSeconds: 5,
    tcpPorts: (values.tcp ?? []).map(Number),
  };
  log(`probe: ${values.probe} targets=${targets.join(', ')}`);
  const code = await new Promise((resolve) => {
    const child = spawn(values.probe, [], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('exit', (c) => resolve(c ?? 1));
    child.stdin.end(JSON.stringify(input));
  });
  clearInterval(liveness);
  return code;
}

async function cleanup() {
  if (values.keep) {
    log(`--keep: leaving binding and Connector ${connectorName}`);
    return;
  }
  try {
    const left = await cp.leaveGatewayNetwork(deps, { project, network, connectorName });
    log(`cleanup: binding ${left ? 'deleted' : 'not present'}`);
  } catch (e) {
    log(`cleanup: binding delete failed: ${e.message}`);
  }
  try {
    const connector = await http.get(cp.connectPath(project, 'connectors', connectorName));
    if (connector && connector.spec?.publicKey === publicKey) {
      await http.delete(cp.connectPath(project, 'connectors', connectorName), {
        apiVersion: 'v1',
        kind: 'DeleteOptions',
        preconditions: { uid: connector.metadata.uid },
      });
      log(`cleanup: Connector ${connectorName} deleted`);
    }
  } catch (e) {
    log(`cleanup: Connector delete failed: ${e.message}`);
  }
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  log(`FAILED: ${error.code ? `[${error.code}] ` : ''}${error.message}`);
} finally {
  await cleanup();
}
log(exitCode === 0 ? 'E2E PASS' : 'E2E FAIL');
process.exit(exitCode);
