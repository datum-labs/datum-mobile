import { matches, searchResults, type SearchLists } from '../model';
import { RECENTS_CAPS, withItem, withQuery, type SearchRecents } from '../recents';
import { toSearchHits, type ResourceSearchQuery } from '../service';

jest.mock('@/api', () => ({ api: {}, projectScopedBase: (p: string) => `/projects/${p}` }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));

const view = { status: 'success' as const, label: 'Ready' };

function query(results: NonNullable<ResourceSearchQuery['status']>['results']): ResourceSearchQuery {
  return {
    apiVersion: 'search.miloapis.com/v1alpha1',
    kind: 'ResourceSearchQuery',
    metadata: { name: 'q' },
    spec: { query: 'x', limit: 25, targetResources: [] },
    status: { results },
  };
}

describe('toSearchHits', () => {
  it('keeps only hits from this project', () => {
    const hits = toSearchHits(
      query([
        { resource: { kind: 'Domain', metadata: { uid: '1', name: 'mine' }, spec: { domainName: 'a.com' } }, tenant: { name: 'p1' } },
        { resource: { kind: 'Domain', metadata: { uid: '2', name: 'theirs' } }, tenant: { name: 'other' } },
        { resource: { kind: 'Domain', metadata: { uid: '3' } }, tenant: { name: 'p1' } },
      ]),
      'p1'
    );
    expect(hits.map((h) => h.name)).toEqual(['mine']);
    expect(hits[0].displayName).toBe('a.com');
  });
});

describe('matches', () => {
  it('needs every word, ignoring case', () => {
    expect(matches(['api-gateway', 'us-east-1'], 'API east')).toBe(true);
    expect(matches(['api-gateway'], 'api west')).toBe(false);
    expect(matches(['anything'], '  ')).toBe(false);
  });
});

describe('searchResults', () => {
  const lists: SearchLists = {
    proxies: [
      { uid: 'u1', name: 'shop', displayName: 'Shop', hostnames: ['shop.example.com'], view } as never,
      { uid: 'u2', name: 'blog', displayName: 'Blog', hostnames: [], view } as never,
    ],
    workloads: [
      {
        uid: 'w1',
        name: 'shop-api',
        image: 'nginx',
        locations: [],
        health: 'Healthy',
        conditions: [],
        currentReplicas: 1,
        readyReplicas: 1,
        desiredReplicas: 1,
      } as never,
    ],
  };

  it('puts server hits first, enriched from the lists, then local matches', () => {
    const groups = searchResults(
      'shop',
      [
        { uid: 'x', name: 'blog', kind: 'HTTPProxy', relevanceScore: 1, tenant: 'p1' },
        { uid: 'y', name: 'unknown', kind: 'HTTPProxy', displayName: 'Unknown', relevanceScore: 0.5, tenant: 'p1' },
      ],
      lists
    );
    expect(groups.map((g) => g.kind)).toEqual(['alb', 'workload']);
    const albs = groups[0].items;
    expect(albs.map((i) => i.name)).toEqual(['blog', 'unknown', 'shop']);
    expect(albs[0].status).toEqual(view);
    expect(albs[0].href).toBe('/alb/blog');
    expect(groups[1].items[0].href).toBe('/workloads/shop-api');
  });

  it('caps each group and counts the rest', () => {
    const many: SearchLists = {
      domains: Array.from({ length: 7 }, (_, i) => ({ uid: `${i}`, name: `d${i}`, domainName: `d${i}.shop.com`, view }) as never),
    };
    const [group] = searchResults('shop', undefined, many);
    expect(group.items).toHaveLength(5);
    expect(group.more).toBe(2);
  });
});

describe('recents', () => {
  it('dedupes and caps queries, newest first', () => {
    let r: SearchRecents = { queries: [], items: [] };
    for (let i = 0; i < 12; i++) r = withQuery(r, `q${i}`);
    r = withQuery(r, ' q5 ');
    expect(r.queries[0]).toBe('q5');
    expect(r.queries).toHaveLength(RECENTS_CAPS.queries);
    expect(new Set(r.queries).size).toBe(r.queries.length);
  });

  it('stores opened items without their status', () => {
    const r = withItem({ queries: [], items: [] }, { key: 'alb/a', kind: 'alb', name: 'a', title: 'A', href: '/alb/a', status: view });
    expect(r.items[0].status).toBeUndefined();
  });
});
