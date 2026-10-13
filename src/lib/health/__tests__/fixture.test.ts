/**
 * Contract with the widget extension: the snapshot the app writes is the
 * fixture `native/datum-widgets/Tests/ModelTests.swift` decodes. Regenerate
 * with UPDATE_WIDGET_FIXTURE=1 after a deliberate format change (and bump
 * SNAPSHOT_VERSION on both sides if it isn't backwards compatible).
 */
import fs from 'node:fs';
import path from 'node:path';

import type { Workload } from '@/resources/compute/model';
import type { Domain } from '@/resources/domains/service';
import type { HttpProxy } from '@/resources/http-proxies/model';

import { mergeSnapshot, projectHealth } from '../snapshot';

const FIXTURE = path.join(__dirname, '../../../../native/datum-widgets/Tests/fixtures/snapshot.json');
const NOW = Date.parse('2026-10-13T12:00:00Z');
const SCHEME = 'net.datum.cloud.staging';

function fixtureSnapshot() {
  const failing = projectHealth({
    project: { projectId: 'matt-jenkinson-yz0y92', projectName: 'Matt’s project', orgId: 'personal-org', orgName: 'Personal' },
    scheme: SCHEME,
    proxies: [
      { name: 'web', displayName: 'Web ALB', view: { status: 'error', label: 'Failed' } } as HttpProxy,
      { name: 'api', displayName: 'api', view: { status: 'success', label: 'Active' } } as HttpProxy,
    ],
    workloads: [
      {
        name: 'worker',
        health: 'Degraded',
        deleting: false,
        createdAt: new Date(NOW - 3_600_000),
        conditions: [],
        readyReplicas: 1,
        desiredReplicas: 2,
      } as unknown as Workload,
    ],
    instances: [],
    domains: [{ name: 'shop', domainName: 'shop.example.com', view: { status: 'error', label: 'Unverified' } } as Domain],
    zones: [],
    now: NOW,
  });
  const healthy = projectHealth({
    project: { projectId: 'quiet', projectName: 'Quiet', orgId: 'acme' },
    scheme: SCHEME,
    proxies: [],
    workloads: [],
    instances: [],
    domains: [],
    zones: [],
    now: NOW - 20 * 60_000,
  });
  let snapshot = mergeSnapshot(null, { owner: 'user-1', project: healthy, now: NOW - 20 * 60_000 });
  snapshot = mergeSnapshot(snapshot, {
    owner: 'user-1',
    project: failing,
    currentProjectId: 'matt-jenkinson-yz0y92',
    directory: [
      { projectId: 'matt-jenkinson-yz0y92', projectName: 'Matt’s project', orgId: 'personal-org', orgName: 'Personal' },
      { projectId: 'quiet', projectName: 'Quiet', orgId: 'acme', orgName: 'Acme' },
      { projectId: 'unseen', projectName: 'Unseen', orgId: 'acme', orgName: 'Acme' },
    ],
    now: NOW,
  });
  return snapshot;
}

test('the widget fixture is what the app writes', () => {
  const snapshot = fixtureSnapshot();
  if (process.env.UPDATE_WIDGET_FIXTURE === '1') {
    fs.writeFileSync(FIXTURE, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(snapshot)));
});
