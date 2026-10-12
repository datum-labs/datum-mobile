import { ApiError } from '@/api/errors';
import type { PromResponse } from '@/lib/metrics';
import { jsonResponse } from '@/test/helpers';

import { byClassView, errorRateView, percentilesView, regionsView, retryMetrics, wafView } from '../queries';
import { isMetricsUnavailable, metricsSource } from '../source';

jest.mock('@/auth/instance', () => {
  const session = {
    state: { status: 'signedIn', devToken: false } as { status: string; devToken?: boolean },
    getState: () => session.state,
    getAccessToken: jest.fn(async () => 'token-1'),
    handleUnauthorized: jest.fn(async () => 'token-2'),
    refresh: jest.fn(async () => 'token-2'),
  };
  return { session };
});
jest.mock('@/config/env', () => ({ env: { telemetryUrl: 'https://telemetry.example.test', variant: 'staging' } }));

const mockSession = jest.requireMock('@/auth/instance').session;
const mockEnv = jest.requireMock('@/config/env').env;

// The persisted cache (AsyncStorage) isn't needed to test the pure pieces.
jest.mock('@/lib/query', () => ({ useLiveRefetchInterval: () => false }));

const ok: PromResponse = { status: 'success', data: { resultType: 'vector', result: [] } };
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockSession.state = { status: 'signedIn', devToken: false };
  mockSession.handleUnauthorized.mockClear();
});

describe('metricsSource', () => {
  test('instant queries GET /metrics/api/v1/query with the bearer token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, ok));
    expect(metricsSource.available).toBe(true);
    await expect(metricsSource.query('sum(up{a="b"})', { time: 1791842400 })).resolves.toEqual(ok);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://telemetry.example.test/metrics/api/v1/query?query=${encodeURIComponent('sum(up{a="b"})')}&time=1791842400`
    );
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(init.method).toBe('GET');
  });

  test('range queries send start, end and step', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, ok));
    await metricsSource.queryRange('up', { start: 100, end: 200, step: '1m' });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://telemetry.example.test/metrics/api/v1/query_range?query=up&start=100&end=200&step=1m'
    );
  });

  test('a 401 refreshes and retries once', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, 'Jwt is expired')).mockResolvedValueOnce(jsonResponse(200, ok));
    await expect(metricsSource.query('up')).resolves.toEqual(ok);
    expect(mockSession.handleUnauthorized).toHaveBeenCalledWith('token-1');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token-2');
  });

  test("a 401 on a dev token doesn't sign the session out", async () => {
    mockSession.state = { status: 'signedIn', devToken: true };
    fetchMock.mockResolvedValueOnce(jsonResponse(401, 'Jwt is missing'));
    const error = await metricsSource.query('up').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401 });
    expect(mockSession.handleUnauthorized).not.toHaveBeenCalled();
    expect(isMetricsUnavailable(error)).toBe(true);
  });

  test('a bad query is a 422 carrying the VictoriaMetrics message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { status: 'error', errorType: '422', error: 'argList: unexpected token' })
    );
    const error = await metricsSource.query('sum(').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422, message: 'argList: unexpected token' });
    expect(isMetricsUnavailable(error)).toBe(false);
    expect(retryMetrics(0, error)).toBe(false);
  });

  test('a 200 with status "error" still throws', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'error', error: 'timeout' }));
    await expect(metricsSource.query('up')).rejects.toMatchObject({ status: 422, message: 'timeout' });
  });

  test('403 and 404 mean unavailable; 5xx and network errors are retried', () => {
    expect(isMetricsUnavailable(new ApiError(403, 'no', '/q'))).toBe(true);
    expect(isMetricsUnavailable(new ApiError(404, 'no', '/q'))).toBe(true);
    expect(isMetricsUnavailable(new ApiError(503, 'down', '/q'))).toBe(false);
    expect(retryMetrics(0, new ApiError(503, 'down', '/q'))).toBe(true);
    expect(retryMetrics(0, new Error('Network request failed'))).toBe(true);
    expect(retryMetrics(2, new Error('Network request failed'))).toBe(false);
  });
});

describe('without a telemetry URL (production)', () => {
  test('is unavailable and never fetches', async () => {
    let source: typeof import('../source') | undefined;
    mockEnv.telemetryUrl = '';
    jest.isolateModules(() => {
      source = jest.requireActual('../source');
    });
    mockEnv.telemetryUrl = 'https://telemetry.example.test';
    expect(source?.metricsSource.available).toBe(false);
    const error = await source?.metricsSource.query('up').catch((e: unknown) => e);
    expect(source?.isMetricsUnavailable(error)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const vector = (label: string, values: Record<string, string>): PromResponse => ({
  status: 'success',
  data: {
    resultType: 'vector',
    result: Object.entries(values).map(([key, value]) => ({ metric: { [label]: key }, value: [1, value] })),
  },
});

describe('ALB view models', () => {
  test('error rate: real samples win', () => {
    const points = [{ t: 1, v: 0.5 }];
    expect(errorRateView(points, [{ t: 1, v: 2 }])).toEqual({ points, current: 0.5 });
  });

  test('error rate: traffic without any 4xx/5xx series reads 0%', () => {
    const rps = [
      { t: 1, v: 0 },
      { t: 2, v: 3 },
    ];
    expect(errorRateView([], rps)).toEqual({
      points: [
        { t: 1, v: 0 },
        { t: 2, v: 0 },
      ],
      current: 0,
    });
  });

  test('error rate: no traffic is no data', () => {
    expect(errorRateView([], [{ t: 1, v: 0 }])).toEqual({ points: [], current: null });
    expect(errorRateView([], [])).toEqual({ points: [], current: null });
  });

  test('status classes: average rate × window, zero-filled', () => {
    expect(byClassView(vector('envoy_response_code_class', { '2XX': '1.5', '5XX': '0.01' }), 3600)).toEqual({
      '2XX': 5400,
      '3XX': 0,
      '4XX': 0,
      '5XX': 36,
    });
    expect(byClassView(undefined, 3600)).toBeNull();
  });

  test('WAF: null when nothing happened', () => {
    expect(wafView(vector('coraza_outcome', { allowed: '6780', blocked: '12' }))).toEqual({
      allowed: 6780,
      blocked: 12,
      dropped: 0,
    });
    expect(wafView(vector('coraza_outcome', { allowed: '0.2' }))).toBeNull();
    expect(wafView(undefined)).toBeNull();
  });

  test('regions: busiest first, unlabelled dropped', () => {
    expect(
      regionsView(vector('label_topology_kubernetes_io_region', { 'us-central-1': '0.01', 'us-east-1': '0.6', '': '9' }))
    ).toEqual([
      { region: 'us-east-1', rps: 0.6 },
      { region: 'us-central-1', rps: 0.01 },
    ]);
  });

  test('percentiles by quantile label', () => {
    expect(percentilesView(vector('quantile', { p50: '12', p99: '650' }))).toEqual({ p50: 12, p95: null, p99: 650 });
  });
});
