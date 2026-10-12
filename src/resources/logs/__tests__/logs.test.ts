import { ApiError } from '@/api/errors';
import { buildAlbLogQL } from '@/lib/logs';
import { accessLogStream, streams } from '@/lib/logs/__tests__/fixtures';

import { accessReviewService } from '../../access-reviews/service';
import { findCachedAlbStream, logKeys, logsPermissionStatus, retryLogs } from '../queries';
import { LOGS_ACCESS_REVIEWS, logsService, O11Y_LOGS_QUERY_RANGE_PATH } from '../service';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api', () => {
  const scopes = jest.requireActual('@/api/scopes');
  const errors = jest.requireActual('@/api/errors');
  return {
    ...scopes,
    ApiError: errors.ApiError,
    api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  };
});

// The persisted cache (AsyncStorage) isn't needed to test the pure pieces.
jest.mock('@/lib/query', () => ({ useLiveRefetchInterval: () => false }));

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

const BASE = '/apis/resourcemanager.miloapis.com/v1alpha1/projects/proj-a/control-plane';

describe('logsService.queryRange', () => {
  test('GETs the project-scoped Loki query_range path', async () => {
    const response = streams(accessLogStream('1'));
    mockGet.mockResolvedValueOnce(response);
    const query = buildAlbLogQL('gw-1');
    await expect(
      logsService.queryRange('proj-a', {
        query,
        start: '2026-10-12T19:30:00.000Z',
        end: '2026-10-12T20:00:00.000Z',
        limit: 500,
      })
    ).resolves.toBe(response);
    expect(mockGet).toHaveBeenCalledWith(`${BASE}${O11Y_LOGS_QUERY_RANGE_PATH}`, {
      signal: undefined,
      query: {
        query,
        start: '2026-10-12T19:30:00.000Z',
        end: '2026-10-12T20:00:00.000Z',
        limit: 500,
        direction: 'backward',
      },
    });
  });

  test('turns a Loki error envelope into a 400 ApiError', async () => {
    mockGet.mockResolvedValueOnce({ status: 'error', error: 'logql: unclosed stream selector' });
    const error = await logsService
      .queryRange('proj-a', { query: '{', start: '1', end: '2', limit: 1 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: 'logql: unclosed stream selector' });
  });
});

describe('logs access reviews', () => {
  test('posts both portal reviews to the project control plane with an empty namespace', async () => {
    mockPost.mockResolvedValue({ status: { allowed: true } });
    const scope = { kind: 'project', project: 'proj-a' } as const;
    await expect(accessReviewService.review(scope, LOGS_ACCESS_REVIEWS.proxy)).resolves.toEqual({
      allowed: true,
      denied: false,
      reason: undefined,
    });
    await accessReviewService.review(scope, LOGS_ACCESS_REVIEWS.query);
    expect(mockPost.mock.calls.map((call) => [call[0], call[1].spec.resourceAttributes])).toEqual([
      [
        `${BASE}/apis/authorization.k8s.io/v1/selfsubjectaccessreviews`,
        { namespace: '', verb: 'get', group: 'o11y.miloapis.com', resource: 'logs', subresource: 'api', name: 'loki' },
      ],
      [
        `${BASE}/apis/authorization.k8s.io/v1/selfsubjectaccessreviews`,
        { namespace: '', verb: 'query', group: 'o11y.miloapis.com', resource: 'logs' },
      ],
    ]);
    expect(mockPost.mock.calls[0][1]).toMatchObject({
      apiVersion: 'authorization.k8s.io/v1',
      kind: 'SelfSubjectAccessReview',
    });
  });

  test('a review without a status reads as not allowed', async () => {
    mockPost.mockResolvedValueOnce({});
    await expect(
      accessReviewService.review({ kind: 'project', project: 'p' }, LOGS_ACCESS_REVIEWS.query)
    ).resolves.toMatchObject({ allowed: false });
  });
});

describe('logsPermissionStatus', () => {
  const yes = { data: { allowed: true }, isPending: false };
  const no = { data: { allowed: false }, isPending: false };
  const pending = { isPending: true };
  const failed = { isPending: false };

  test('needs both reviews to allow', () => {
    expect(logsPermissionStatus(yes, yes)).toBe('allowed');
    expect(logsPermissionStatus(yes, no)).toBe('denied');
    expect(logsPermissionStatus(no, pending)).toBe('denied');
    expect(logsPermissionStatus(yes, pending)).toBe('checking');
    expect(logsPermissionStatus(yes, failed)).toBe('unknown');
  });
});

describe('retryLogs', () => {
  test('does not retry bad queries or denials', () => {
    for (const status of [400, 401, 403, 404]) expect(retryLogs(0, new ApiError(status, 'x', '/'))).toBe(false);
    expect(retryLogs(0, new ApiError(503, 'x', '/'))).toBe(true);
    expect(retryLogs(2, new Error('offline'))).toBe(false);
  });
});

describe('findCachedAlbStream', () => {
  test('finds one line across cached pages and narrows it to that value', () => {
    const page = streams(accessLogStream('2', { request_id: 'b' }), {
      ...accessLogStream('1', { request_id: 'a' }),
      values: [
        ['1', ''],
        ['0', ''],
      ],
    });
    const found = findCachedAlbStream([[logKeys.alb('p', 'gw'), page]], '1', 'a');
    expect(found?.data?.result).toHaveLength(1);
    expect(found?.data?.result[0]?.values).toEqual([['1', '']]);
    expect(findCachedAlbStream([[[], page]], '1', 'other')).toBeUndefined();
    expect(findCachedAlbStream([[[], undefined]], '1')).toBeUndefined();
  });
});

describe('logKeys', () => {
  test('every ALB query sits under the proxy key, so an entry lookup can scan them', () => {
    const alb = logKeys.alb('p', 'gw');
    expect(logKeys.albRange('p', 'gw', '{}', '30m', 500).slice(0, alb.length)).toEqual(alb);
    expect(logKeys.albEntry('p', 'gw', '1').slice(0, alb.length)).toEqual(alb);
  });
});
