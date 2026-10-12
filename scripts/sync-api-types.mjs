#!/usr/bin/env node
/**
 * Copies the generated control-plane OpenAPI types (types only — no SDK or
 * axios client) from cloud-portal into src/api/generated/<group>/types.gen.ts
 * and records the source commit in src/api/generated/SOURCE.json.
 *
 * Usage:
 *   node scripts/sync-api-types.mjs [--portal ../cloud-portal]
 *
 * cloud-portal regenerates these with @hey-api/openapi-ts from
 * https://api.staging.env.datum.net/openapi/v3 (see its scripts/openapi.ts).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GROUPS = ['compute', 'networking', 'networking-alpha1', 'dns-networking', 'resource-manager'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argIndex = process.argv.indexOf('--portal');
const portal = path.resolve(
  root,
  argIndex > -1 ? process.argv[argIndex + 1] : process.env.CLOUD_PORTAL_DIR ?? '../cloud-portal'
);
const srcDir = path.join(portal, 'app/modules/control-plane');
const outDir = path.join(root, 'src/api/generated');

if (!fs.existsSync(srcDir)) {
  console.error(`cloud-portal not found at ${portal} (pass --portal <dir>)`);
  process.exit(1);
}

const git = (...args) => execFileSync('git', ['-C', portal, ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--', 'app/modules/control-plane') !== '';

for (const group of GROUPS) {
  const from = path.join(srcDir, group, 'types.gen.ts');
  const to = path.join(outDir, group, 'types.gen.ts');
  const body = fs.readFileSync(from, 'utf8');
  const header =
    `// Synced from cloud-portal app/modules/control-plane/${group}/types.gen.ts\n` +
    `// at ${commit}${dirty ? ' (with uncommitted changes)' : ''} by scripts/sync-api-types.mjs.\n` +
    '// Do not edit by hand.\n';
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, header + body);
  console.log(`synced ${group}`);
}

fs.writeFileSync(
  path.join(outDir, 'SOURCE.json'),
  JSON.stringify(
    { repository: 'datum-cloud/cloud-portal', commit, dirty, groups: GROUPS, syncedAt: new Date().toISOString() },
    null,
    2
  ) + '\n'
);
