import { ApiError } from '@/api/errors';

import { activityUnavailableReason, flattenActivityPages, retryActivity } from '../queries';
import {
  ACTIVITY_QUERIES_PATH,
  activityService,
  buildResourceActivityFilter,
  buildResourceActivityQuery,
  toActivityItem,
  toActivityPage,
  toSummarySegments,
  type ActivityQuery,
  type RawActivity,
} from '../service';

const mockPost = jest.fn();

jest.mock('@/api', () => {
  const scopes = jest.requireActual('@/api/scopes');
  const errors = jest.requireActual('@/api/errors');
  return { ...scopes, ApiError: errors.ApiError, api: { post: (...args: unknown[]) => mockPost(...args) } };
});

beforeEach(() => mockPost.mockReset());

const BASE = '/apis/resourcemanager.miloapis.com/v1alpha1/projects/proj-a/control-plane';
const TARGET = { kind: 'HTTPProxy', name: 'health-checks-xnffa7' };

/** Shaped like staging's response for an HTTPProxy (event origin, controller actor). */
const systemActivity: RawActivity = {
  kind: 'Activity',
  apiVersion: 'activity.miloapis.com/v1alpha1',
  metadata: { name: 'act-879402f4666a', namespace: 'default', creationTimestamp: '2026-10-12T17:12:04Z' },
  spec: {
    summary: 'Load balancer Health Checks is live',
    changeSource: 'system',
    actor: { type: 'controller', name: 'networking.datumapis.com/network-services-operator' },
    resource: {
      apiGroup: 'networking.datumapis.com',
      apiVersion: 'networking.datumapis.com/v1alpha',
      kind: 'HTTPProxy',
      name: 'health-checks-xnffa7',
      namespace: 'default',
      uid: '65d89799',
    },
    links: [{ marker: 'Health Checks', resource: { kind: 'HTTPProxy', name: 'health-checks-xnffa7', uid: '65d89799' } }],
    tenant: { type: 'Project', name: 'proj-a' },
    origin: { type: 'event', id: '6926143a' },
  },
};

/** Audit origin, user actor. */
const humanActivity: RawActivity = {
  kind: 'Activity',
  metadata: { name: 'act-2', creationTimestamp: '2026-10-08T09:02:18Z' },
  spec: {
    summary: 'alice@example.com enabled passive health checks on Health Checks',
    changeSource: 'human',
    actor: { type: 'user', name: 'alice@example.com', uid: '3494', email: 'alice@example.com' },
    resource: { apiGroup: 'networking.datumapis.com', kind: 'HTTPProxy', name: 'health-checks-xnffa7' },
    links: [{ marker: 'Health Checks', resource: { kind: 'HTTPProxy', name: 'health-checks-xnffa7' } }],
    origin: { type: 'audit', id: 'a1' },
  },
};

describe('ActivityQuery request', () => {
  test('locks the filter to the resource kind and a name substring, like the portal', () => {
    expect(buildResourceActivityFilter(TARGET)).toBe(
      'spec.resource.kind == "HTTPProxy" && spec.resource.name.contains("health-checks-xnffa7")'
    );
  });

  test('escapes quotes and backslashes in CEL string literals', () => {
    expect(buildResourceActivityFilter({ kind: 'HTTPProxy', name: 'a"b\\c' })).toBe(
      'spec.resource.kind == "HTTPProxy" && spec.resource.name.contains("a\\"b\\\\c")'
    );
  });

  test('first page: last 7 days, 30 per page, no cursor', () => {
    expect(buildResourceActivityQuery(TARGET)).toEqual({
      apiVersion: 'activity.miloapis.com/v1alpha1',
      kind: 'ActivityQuery',
      spec: {
        startTime: 'now-7d',
        endTime: 'now',
        limit: 30,
        filter: 'spec.resource.kind == "HTTPProxy" && spec.resource.name.contains("health-checks-xnffa7")',
      },
    });
  });

  test('later pages repeat the spec and pass the cursor as spec.continue', () => {
    expect(buildResourceActivityQuery(TARGET, { cursor: 'tok' }).spec).toMatchObject({
      startTime: 'now-7d',
      endTime: 'now',
      continue: 'tok',
    });
  });

  test('POSTs to the project control plane', async () => {
    const response: ActivityQuery = { ...buildResourceActivityQuery(TARGET), status: { results: [] } };
    mockPost.mockResolvedValueOnce(response);
    const signal = new AbortController().signal;
    await expect(activityService.queryResource('proj-a', TARGET, { cursor: 'tok', signal })).resolves.toBe(response);
    expect(mockPost).toHaveBeenCalledWith(
      `${BASE}${ACTIVITY_QUERIES_PATH}`,
      buildResourceActivityQuery(TARGET, { cursor: 'tok' }),
      { signal }
    );
    expect(ACTIVITY_QUERIES_PATH).toBe('/apis/activity.miloapis.com/v1alpha1/activityqueries');
  });
});

describe('toSummarySegments', () => {
  test('emphasizes each link marker', () => {
    expect(toSummarySegments('Load balancer Health Checks is live', systemActivity.spec?.links)).toEqual([
      { text: 'Load balancer ', emphasis: false },
      { text: 'Health Checks', emphasis: true },
      { text: ' is live', emphasis: false },
    ]);
  });

  test('no links is one plain segment', () => {
    expect(toSummarySegments('removed hostname a.example.com', [])).toEqual([
      { text: 'removed hostname a.example.com', emphasis: false },
    ]);
  });

  test('prefers the longest marker, drops overlaps, repeats, and uses displayName', () => {
    const resource = { kind: 'User', name: 'u1' };
    expect(
      toSummarySegments('u-123 renamed web to web-2; web', [
        { marker: 'web', resource },
        { marker: 'web-2', resource },
        { marker: 'u-123', resource, displayName: 'Alice' },
        { marker: '', resource },
      ])
    ).toEqual([
      { text: 'Alice', emphasis: true },
      { text: ' renamed ', emphasis: false },
      { text: 'web', emphasis: true },
      { text: ' to ', emphasis: false },
      { text: 'web-2', emphasis: true },
      { text: '; ', emphasis: false },
      { text: 'web', emphasis: true },
    ]);
  });
});

describe('toActivityItem', () => {
  test('system activity: controller name without its API group', () => {
    expect(toActivityItem(systemActivity)).toEqual({
      id: 'act-879402f4666a',
      summary: 'Load balancer Health Checks is live',
      segments: [
        { text: 'Load balancer ', emphasis: false },
        { text: 'Health Checks', emphasis: true },
        { text: ' is live', emphasis: false },
      ],
      actor: 'network-services-operator',
      actorType: 'controller',
      changeSource: 'system',
      resource: { kind: 'HTTPProxy', name: 'health-checks-xnffa7' },
      timestamp: '2026-10-12T17:12:04Z',
    });
  });

  test('human activity: displayName, then name', () => {
    expect(toActivityItem(humanActivity)).toMatchObject({ actor: 'alice@example.com', changeSource: 'human' });
    const named = { ...humanActivity, spec: { ...humanActivity.spec, actor: { type: 'user', name: 'x', displayName: 'Alice' } } };
    expect(toActivityItem(named as RawActivity).actor).toBe('Alice');
  });

  test('tolerates a sparse item', () => {
    expect(toActivityItem({}, 3)).toEqual({
      id: '#3',
      summary: '',
      segments: [],
      actor: 'Unknown',
      actorType: undefined,
      changeSource: undefined,
      resource: undefined,
      timestamp: undefined,
    });
  });
});

describe('pages', () => {
  test('reads status.results and status.continue', () => {
    const page = toActivityPage({
      ...buildResourceActivityQuery(TARGET),
      status: { results: [systemActivity, humanActivity], continue: 'next' },
    });
    expect(page.items.map((i) => i.id)).toEqual(['act-879402f4666a', 'act-2']);
    expect(page.continue).toBe('next');
  });

  test('no status is an empty last page', () => {
    expect(toActivityPage(buildResourceActivityQuery(TARGET))).toEqual({ items: [], continue: undefined });
    expect(toActivityPage({ ...buildResourceActivityQuery(TARGET), status: { continue: '' } }).continue).toBeUndefined();
  });

  test('flattens pages in order and drops repeats', () => {
    const a = toActivityItem(systemActivity);
    const b = toActivityItem(humanActivity);
    expect(
      flattenActivityPages({ pages: [{ items: [a] }, { items: [a, b] }], pageParams: [undefined, 'next'] })
    ).toEqual([a, b]);
  });
});

describe('errors', () => {
  test('403 and 404 are terminal and map to forbidden / unavailable', () => {
    expect(activityUnavailableReason(new ApiError(403, 'no', '/x'))).toBe('forbidden');
    expect(activityUnavailableReason(new ApiError(404, 'no', '/x'))).toBe('unavailable');
    expect(activityUnavailableReason(new ApiError(500, 'boom', '/x'))).toBeUndefined();
    expect(activityUnavailableReason(new Error('offline'))).toBeUndefined();
    expect(retryActivity(0, new ApiError(403, 'no', '/x'))).toBe(false);
    expect(retryActivity(0, new ApiError(503, 'later', '/x'))).toBe(true);
    expect(retryActivity(2, new Error('offline'))).toBe(false);
  });
});
