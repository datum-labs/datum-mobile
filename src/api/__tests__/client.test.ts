import { jsonResponse } from '@/test/helpers';

import { createApiClient, type TokenSource } from '../client';
import { ApiError, EmailNotVerifiedError } from '../errors';

const BASE = 'https://api.example';

function tokens(initial = 'at-1'): TokenSource & { current: string; refreshes: number } {
  const source = {
    current: initial,
    refreshes: 0,
    async getAccessToken() {
      return source.current;
    },
    async handleUnauthorized(rejected: string) {
      if (rejected !== source.current) return source.current;
      return source.refresh();
    },
    async refresh() {
      source.refreshes += 1;
      source.current = `at-${source.refreshes + 1}`;
      return source.current;
    },
  };
  return source;
}

const emailDenial = {
  kind: 'Status',
  status: 'Failure',
  reason: 'Forbidden',
  message: 'verify your email',
  details: { causes: [{ type: 'EmailNotVerified', message: 'unverified' }] },
  code: 403,
};

function authHeader(call: unknown[]): string {
  return ((call[1] as RequestInit).headers as Record<string, string>).Authorization;
}

describe('api client', () => {
  test('injects the bearer token and returns JSON', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { items: [] }));
    const client = createApiClient({ baseUrl: BASE, tokens: tokens(), fetchImpl });
    await expect(client.get('/apis/x', { query: { limit: 5, continue: undefined } })).resolves.toEqual({
      items: [],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example/apis/x?limit=5',
      expect.objectContaining({ method: 'GET' })
    );
    expect(authHeader(fetchImpl.mock.calls[0])).toBe('Bearer at-1');
  });

  test('on 401 refreshes once and retries with the new token', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const source = tokens();
    const client = createApiClient({ baseUrl: BASE, tokens: source, fetchImpl });
    await expect(client.get('/apis/x')).resolves.toEqual({ ok: true });
    expect(source.refreshes).toBe(1);
    expect(authHeader(fetchImpl.mock.calls[1])).toBe('Bearer at-2');
  });

  test('a second 401 is not retried again', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(401, { message: 'Unauthorized' }));
    const source = tokens();
    const client = createApiClient({ baseUrl: BASE, tokens: source, fetchImpl });
    await expect(client.get('/apis/x')).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(source.refreshes).toBe(1);
  });

  test('concurrent 401s share the refreshed token', async () => {
    const source = tokens();
    const fetchImpl = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer at-1' ? jsonResponse(401, {}) : jsonResponse(200, { ok: auth });
    });
    const client = createApiClient({ baseUrl: BASE, tokens: source, fetchImpl });
    const results = await Promise.all([client.get('/a'), client.get('/b')]);
    expect(results).toEqual([{ ok: 'Bearer at-2' }, { ok: 'Bearer at-2' }]);
    expect(source.refreshes).toBe(1);
  });

  test('email-not-verified denial retries once with a fresh token, then reports', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(403, emailDenial));
    const onEmailNotVerified = jest.fn();
    const source = tokens();
    const client = createApiClient({ baseUrl: BASE, tokens: source, fetchImpl, onEmailNotVerified });
    await expect(client.get('/apis/x')).rejects.toBeInstanceOf(EmailNotVerifiedError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(source.refreshes).toBe(1);
    expect(onEmailNotVerified).toHaveBeenCalledTimes(1);
  });

  test('email-not-verified clears when the fresh token is accepted', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(403, emailDenial))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const onEmailNotVerified = jest.fn();
    const client = createApiClient({ baseUrl: BASE, tokens: tokens(), fetchImpl, onEmailNotVerified });
    await expect(client.get('/apis/x')).resolves.toEqual({ ok: true });
    expect(onEmailNotVerified).not.toHaveBeenCalled();
  });

  test('other 403s become ApiError with the K8s message, without refreshing', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(403, { message: 'httpproxies is forbidden', reason: 'Forbidden' })
    );
    const source = tokens();
    const client = createApiClient({ baseUrl: BASE, tokens: source, fetchImpl });
    const error = await client.get('/apis/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: 'httpproxies is forbidden', reason: 'Forbidden' });
    expect(source.refreshes).toBe(0);
  });

  test('listResource follows continue tokens', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { items: [1, 2], metadata: { continue: 'c1' } }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [3], metadata: {} }));
    const client = createApiClient({ baseUrl: BASE, tokens: tokens(), fetchImpl });
    const items = await client.listResource<number>(
      { kind: 'project', project: 'p' },
      { group: 'compute.datumapis.com', version: 'v1alpha', resource: 'instances', namespace: 'default' }
    );
    expect(items).toEqual([1, 2, 3]);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://api.example/apis/resourcemanager.miloapis.com/v1alpha1/projects/p/control-plane/apis/compute.datumapis.com/v1alpha/namespaces/default/instances?limit=500&continue=c1'
    );
  });
});
