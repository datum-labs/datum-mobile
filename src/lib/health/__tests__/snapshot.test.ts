import type { Instance, Workload } from '@/resources/compute/model';
import type { DnsZone } from '@/resources/dns/service';
import type { Domain } from '@/resources/domains/service';
import type { HttpProxy } from '@/resources/http-proxies/model';

import { attentionItems, resourcePath } from '../attention';
import {
  MAX_ITEMS,
  mergeSnapshot,
  overallStatus,
  projectHealth,
  PROJECT_TTL_MS,
  REWRITE_AFTER_MS,
  shouldWrite,
  snapshotFingerprint,
  SNAPSHOT_VERSION,
  widgetUrl,
  type HealthSnapshot,
} from '../snapshot';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const SCHEME = 'net.datum.cloud.staging';
const PROJECT = { projectId: 'matt-jenkinson-yz0y92', projectName: 'Matt', orgId: 'personal-org', orgName: 'Personal' };

const proxy = (name: string, status: 'success' | 'error' | 'pending', displayName = name) =>
  ({ name, displayName, view: { status, label: status === 'success' ? 'Active' : status === 'error' ? 'Failed' : 'Pending' } }) as HttpProxy;

const workload = (name: string, health: Workload['health']) =>
  ({
    name,
    health,
    deleting: false,
    createdAt: new Date(NOW - 60_000),
    conditions: [],
    readyReplicas: health === 'Available' ? 1 : 0,
    desiredReplicas: 1,
  }) as unknown as Workload;

const instance = (name: string, status: Instance['status']) =>
  ({ name, status, conditions: [] }) as unknown as Instance;

const domain = (name: string, verified: boolean) =>
  ({
    name,
    domainName: `${name}.example.com`,
    view: verified ? { status: 'success', label: 'Verified' } : { status: 'error', label: 'Unverified' },
  }) as Domain;

const zone = (name: string, status: 'success' | 'pending' | 'error') =>
  ({ name, domainName: `${name}.example.org`, view: { status, label: status } }) as DnsZone;

describe('attentionItems (Home "Needs attention")', () => {
  test('failing and pending resources, errors first, in Home order within a rank', () => {
    const items = attentionItems(
      {
        proxies: [proxy('web', 'pending'), proxy('api', 'error', 'API'), proxy('ok', 'success')],
        workloads: [workload('db', 'Unavailable'), workload('cache', 'Available'), workload('queue', 'Degraded')],
        domains: [domain('shop', false), domain('blog', true)],
        zones: [zone('corp', 'pending'), zone('fine', 'success')],
      },
      NOW
    );
    expect(items.map((i) => [i.kind, i.name, i.view.status])).toEqual([
      ['alb', 'api', 'error'],
      ['workload', 'db', 'error'],
      ['domain', 'shop', 'error'],
      ['alb', 'web', 'pending'],
      ['workload', 'queue', 'pending'],
      ['dns', 'corp', 'pending'],
    ]);
    expect(items[0]).toMatchObject({ title: 'API', subtitle: 'Load balancer', path: '/alb/api' });
    expect(items[2]).toMatchObject({ title: 'shop.example.com', subtitle: 'Domain', path: '/domains/shop' });
  });

  test('resource paths match the app routes', () => {
    expect(resourcePath('alb', 'web alb')).toBe('/alb/web%20alb');
    expect(resourcePath('workload', 'db')).toBe('/workloads/db');
    expect(resourcePath('domain', 'd1')).toBe('/domains/d1');
    expect(resourcePath('dns', 'z1')).toBe('/dns/z1');
  });

  test('nothing loaded, nothing to show', () => {
    expect(attentionItems({}, NOW)).toEqual([]);
  });
});

describe('widgetUrl', () => {
  test('scheme, single-slash path, project selection', () => {
    expect(widgetUrl(SCHEME, '/alb/web', PROJECT)).toBe(
      'net.datum.cloud.staging:/alb/web?org=personal-org&project=matt-jenkinson-yz0y92'
    );
  });
  test('no project, no query; adds the leading slash', () => {
    expect(widgetUrl('net.datum.cloud', 'assistant')).toBe('net.datum.cloud:/assistant');
  });
});

describe('projectHealth', () => {
  const healthy = () =>
    projectHealth({
      project: PROJECT,
      scheme: SCHEME,
      proxies: [proxy('web', 'success')],
      workloads: [workload('app', 'Available')],
      instances: [instance('app-1', 'Available'), instance('app-2', 'Failed')],
      domains: [domain('shop', true)],
      zones: [],
      now: NOW,
    });

  test('all healthy: Home tiles as counts, no items', () => {
    const h = healthy();
    expect(h).toMatchObject({
      projectId: 'matt-jenkinson-yz0y92',
      projectName: 'Matt',
      orgId: 'personal-org',
      orgName: 'Personal',
      generatedAt: '2026-10-13T12:00:00.000Z',
      complete: true,
      status: 'healthy',
      attention: { total: 0, error: 0, pending: 0, items: [] },
      url: 'net.datum.cloud.staging:/home?org=personal-org&project=matt-jenkinson-yz0y92',
    });
    expect(h.counts).toEqual({
      loadBalancers: { total: 1, error: 0, pending: 0 },
      workloads: { total: 1, error: 0, pending: 0 },
      // Home's tile counts a failed instance, but "Needs attention" doesn't list instances.
      instances: { total: 2, error: 1, pending: 0 },
      domains: { total: 1, error: 0, pending: 0 },
    });
  });

  test('failing items carry kind, badge and a deep link; at most MAX_ITEMS', () => {
    const proxies = Array.from({ length: 8 }, (_, i) => proxy(`p${i}`, 'error'));
    const h = projectHealth({ project: PROJECT, scheme: SCHEME, proxies, workloads: [workload('db', 'Degraded')], now: NOW });
    expect(h.status).toBe('error');
    expect(h.complete).toBe(false);
    expect(h.counts.instances).toBeNull();
    expect(h.attention).toMatchObject({ total: 9, error: 8, pending: 1 });
    expect(h.attention.items).toHaveLength(MAX_ITEMS);
    expect(h.attention.items[0]).toEqual({
      kind: 'alb',
      kindLabel: 'Load balancer',
      name: 'p0',
      title: 'p0',
      status: 'error',
      label: 'Failed',
      url: 'net.datum.cloud.staging:/alb/p0?org=personal-org&project=matt-jenkinson-yz0y92',
    });
  });

  test('project name falls back to the ID', () => {
    const h = projectHealth({ project: { projectId: 'p', orgId: 'o' }, scheme: SCHEME, now: NOW });
    expect(h.projectName).toBe('p');
    expect(h.status).toBe('unknown');
  });
});

describe('overallStatus', () => {
  test('error > pending > healthy; unknown while incomplete', () => {
    expect(overallStatus({ error: 1, pending: 3 }, true)).toBe('error');
    expect(overallStatus({ error: 0, pending: 3 }, false)).toBe('pending');
    expect(overallStatus({ error: 0, pending: 0 }, true)).toBe('healthy');
    expect(overallStatus({ error: 0, pending: 0 }, false)).toBe('unknown');
  });
});

describe('mergeSnapshot', () => {
  const at = (ms: number) => projectHealth({ project: PROJECT, scheme: SCHEME, now: ms });
  const other = (id: string, ms: number) =>
    projectHealth({ project: { projectId: id, orgId: 'org', projectName: id.toUpperCase() }, scheme: SCHEME, now: ms });

  test('starts empty, adds the project and lists it in the directory', () => {
    const s = mergeSnapshot(null, { project: at(NOW), currentProjectId: PROJECT.projectId, now: NOW });
    expect(s.version).toBe(SNAPSHOT_VERSION);
    expect(s.currentProjectId).toBe(PROJECT.projectId);
    expect(Object.keys(s.projects)).toEqual([PROJECT.projectId]);
    expect(s.directory).toEqual([
      { projectId: PROJECT.projectId, projectName: 'Matt', orgId: 'personal-org', orgName: 'Personal' },
    ]);
  });

  test('keeps other projects, drops expired ones, never the current one', () => {
    let s = mergeSnapshot(null, { project: other('old', NOW - PROJECT_TTL_MS - 1), now: NOW - PROJECT_TTL_MS - 1 });
    s = mergeSnapshot(s, { project: other('cur', NOW - PROJECT_TTL_MS - 5), currentProjectId: 'cur', now: NOW });
    s = mergeSnapshot(s, { project: other('new', NOW), now: NOW });
    expect(Object.keys(s.projects).sort()).toEqual(['cur', 'new']);
    expect(s.currentProjectId).toBe('cur');
  });

  test('a directory update replaces the list but keeps fresh names; null clears the selection', () => {
    let s = mergeSnapshot(null, { project: at(NOW), currentProjectId: PROJECT.projectId, now: NOW });
    s = mergeSnapshot(s, {
      directory: [
        { projectId: PROJECT.projectId, projectName: 'stale', orgId: 'personal-org' },
        { projectId: 'p2', projectName: 'Two', orgId: 'o2', orgName: 'Org 2' },
      ],
      currentProjectId: null,
      now: NOW,
    });
    expect(s.currentProjectId).toBeUndefined();
    expect(s.directory).toEqual([
      { projectId: PROJECT.projectId, projectName: 'Matt', orgId: 'personal-org', orgName: 'Personal' },
      { projectId: 'p2', projectName: 'Two', orgId: 'o2', orgName: 'Org 2' },
    ]);
  });

  test('an older snapshot version is discarded', () => {
    const old = { version: 0, projects: { x: at(NOW) }, directory: [], generatedAt: '' } as unknown as HealthSnapshot;
    expect(mergeSnapshot(old, { now: NOW }).projects).toEqual({});
  });
});

describe('shouldWrite', () => {
  const snap = (ms: number) => mergeSnapshot(null, { project: projectHealth({ project: PROJECT, scheme: SCHEME, now: ms }), now: ms });

  test('first write, changed content, or an old write', () => {
    const a = snap(NOW);
    const last = { fingerprint: snapshotFingerprint(a), at: NOW };
    expect(shouldWrite(undefined, a, NOW)).toBe(true);
    // Same content a minute later: only the timestamps moved.
    expect(shouldWrite(last, snap(NOW + 60_000), NOW + 60_000)).toBe(false);
    expect(shouldWrite(last, snap(NOW + REWRITE_AFTER_MS), NOW + REWRITE_AFTER_MS)).toBe(true);
    const failing = mergeSnapshot(a, {
      project: projectHealth({ project: PROJECT, scheme: SCHEME, proxies: [proxy('x', 'error')], now: NOW }),
      now: NOW,
    });
    expect(shouldWrite(last, failing, NOW + 1)).toBe(true);
  });
});
