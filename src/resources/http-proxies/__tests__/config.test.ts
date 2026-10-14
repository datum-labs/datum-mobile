import type { RawHttpProxy } from '@/api/types';

import {
  albHealth,
  durationLabel,
  healthCheckView,
  hostHeaderOverride,
  hstsEnabled,
  lastUpdatedAt,
  loadBalancingLabel,
  noteText,
  originTls,
  poolRows,
  shareLabels,
  wafCategoriesView,
} from '../config';
import { toHttpProxy } from '../model';

const proxy = (spec: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ metadata: { name: 'p', ...extra }, spec: { hostnames: [], ...spec } }) as unknown as RawHttpProxy;

const withFilters = (filters: unknown[]) =>
  proxy({ rules: [{ backends: [{ endpoint: 'https://origin.example' }], filters }] });

describe('shareLabels', () => {
  it('splits evenly and rounds to 100%', () => {
    expect(shareLabels([50, 50])).toEqual(['50%', '50%']);
    expect(shareLabels([1, 1, 1])).toEqual(['34%', '33%', '33%']);
  });
  it('marks weight 0 as drained and tiny shares as <1%', () => {
    expect(shareLabels([1000, 0, 1])).toEqual(['100%', 'Drained', '<1%']);
    expect(shareLabels([0, 0])).toEqual(['Drained', 'Drained']);
  });
});

describe('poolRows', () => {
  it('defaults weight to 1 and names the transport', () => {
    const rows = poolRows([
      { kind: 'endpoint', endpoint: 'https://a.example' },
      { kind: 'connector', connector: 'laptop' },
      { kind: 'endpoint', endpoint: 'https://b.example', tlsHostname: 'b.internal', weight: 2 },
    ]);
    expect(rows.map((r) => [r.weight, r.share, r.transport])).toEqual([
      [1, '25%', 'HTTPS'],
      [1, '25%', 'Galactic VPC'],
      [2, '50%', 'SNI · b.internal'],
    ]);
  });
});

describe('loadBalancingLabel', () => {
  it('defaults to least request', () => {
    expect(loadBalancingLabel(proxy({}))).toBe('Least request');
    expect(loadBalancingLabel(proxy({ loadBalancer: { type: 'RoundRobin' } }))).toBe('Round robin');
  });
  it('names the consistent-hash key', () => {
    expect(loadBalancingLabel(proxy({ loadBalancer: { type: 'ConsistentHash' } }))).toBe('Consistent hash · IP');
    expect(
      loadBalancingLabel(
        proxy({ loadBalancer: { type: 'ConsistentHash', consistentHash: { type: 'Header', header: { name: 'x-user' } } } })
      )
    ).toBe('Consistent hash · x-user');
  });
});

describe('healthCheckView', () => {
  it('is off without spec.healthCheck, with portal defaults', () => {
    expect(healthCheckView(proxy({}))).toEqual({
      enabled: false,
      consecutive5xxErrors: 5,
      baseEjectionTime: '30s',
      maxEjectionPercent: 50,
    });
  });
  it('reads passive settings', () => {
    const view = healthCheckView(proxy({ healthCheck: { passive: { consecutive5xxErrors: 3, baseEjectionTime: '1m' } } }));
    expect(view).toMatchObject({ enabled: true, consecutive5xxErrors: 3, baseEjectionTime: '1m' });
    expect(durationLabel(view.baseEjectionTime)).toBe('1 minute');
    expect(durationLabel('30s')).toBe('30 seconds');
  });
});

describe('headers', () => {
  it('reads the Host override and HSTS from the backend rule', () => {
    const raw = withFilters([
      { type: 'RequestHeaderModifier', requestHeaderModifier: { set: [{ name: 'Host', value: 'app.internal' }] } },
      { type: 'ResponseHeaderModifier', responseHeaderModifier: { set: [{ name: 'Strict-Transport-Security', value: 'max-age=31536000' }] } },
    ]);
    expect(hostHeaderOverride(raw)).toBe('app.internal');
    expect(hstsEnabled(raw)).toBe(true);
    expect(hostHeaderOverride(withFilters([]))).toBeUndefined();
    expect(hstsEnabled(withFilters([]))).toBe(false);
  });
});

describe('originTls', () => {
  it('covers override, origin URL, per backend and connector', () => {
    expect(originTls([{ kind: 'endpoint', endpoint: 'https://o.example', tlsHostname: 'sni.example' }])).toEqual({
      kind: 'override',
      hostname: 'sni.example',
    });
    expect(originTls([{ kind: 'endpoint', endpoint: 'https://o.example:8443/x' }])).toEqual({
      kind: 'fromOrigin',
      hostname: 'o.example',
    });
    expect(originTls([{ kind: 'connector' }])).toEqual({ kind: 'connector' });
    expect(originTls([{ kind: 'endpoint' }, { kind: 'endpoint' }])).toEqual({ kind: 'perBackend' });
    expect(originTls([])).toBeUndefined();
  });
});

describe('lastUpdatedAt', () => {
  it('takes the newest non-status managedFields time', () => {
    const raw = proxy(
      {},
      {
        managedFields: [
          { time: '2026-10-01T00:00:00Z', subresource: undefined },
          { time: '2026-10-09T00:00:00Z', subresource: 'status' },
          { time: '2026-10-05T00:00:00Z' },
        ],
      }
    );
    expect(lastUpdatedAt(raw)).toBe('2026-10-05T00:00:00Z');
  });
});

describe('noteText', () => {
  it('turns note HTML into plain text', () => {
    expect(noteText('<p>Serves the <strong>marketing</strong> site &amp; docs</p><p>Owner: web</p>')).toBe(
      'Serves the marketing site & docs\nOwner: web'
    );
  });
});

describe('wafCategoriesView', () => {
  it('summarises enabled and excluded categories', () => {
    expect(wafCategoriesView([]).summary).toBe('10 of 10 categories');
    const view = wafCategoriesView(['attack-java', 'attack-injection-php']);
    expect(view.summary).toBe('8 of 10 categories · 2 excluded');
    expect(view.excluded.map((c) => c.label)).toEqual(['PHP injection', 'Java attacks']);
  });
});

describe('albHealth', () => {
  const ready = {
    conditions: [
      { type: 'Accepted', status: 'True', reason: 'Accepted', message: '' },
      { type: 'Programmed', status: 'True', reason: 'Programmed', message: '' },
    ],
  };
  it('summarises a healthy proxy', () => {
    const p = toHttpProxy({
      ...proxy({ rules: [{ backends: [{ endpoint: 'https://a' }, { endpoint: 'https://b' }] }] }),
      status: ready,
    } as unknown as RawHttpProxy);
    expect(albHealth(p)).toEqual({ tone: 'success', title: 'Serving traffic normally', detail: '2 backends · 0 custom hostnames' });
  });
  it('flags a deleted workload', () => {
    const p = toHttpProxy({
      ...proxy({}, { labels: { 'compute.datumapis.com/workload-name': 'web' } }),
      status: ready,
    } as unknown as RawHttpProxy);
    expect(albHealth(p, { workloadMissing: true })).toMatchObject({ title: 'No backend available' });
  });
  it('surfaces the retry reference', () => {
    const p = toHttpProxy({
      ...proxy({}),
      status: {
        conditions: [
          { type: 'Accepted', status: 'True', reason: 'Accepted', message: '' },
          { type: 'Programmed', status: 'False', reason: 'Pending', message: 'internal error and will be retried (ref: 0a1b2c3d)' },
        ],
      },
    } as unknown as RawHttpProxy);
    expect(albHealth(p)).toMatchObject({ title: 'Retrying after an internal error', retryRef: '0a1b2c3d' });
  });
  it('reports a programming error', () => {
    const p = toHttpProxy({
      ...proxy({}),
      status: { conditions: [{ type: 'Accepted', status: 'False', reason: 'Invalid', message: 'bad backend' }] },
    } as unknown as RawHttpProxy);
    expect(albHealth(p)).toMatchObject({ tone: 'error', title: 'Configuration failed to program', detail: 'bad backend' });
  });
});
