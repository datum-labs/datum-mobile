/**
 * The console control plane wired to the app (service.ts): plain requests
 * through the API client under the project's control plane, and watches
 * through expo/fetch with the API client's token handling (bearer, one retry
 * on 401). The fetches are fakes; nothing leaves the test.
 */
import { consoleHttp, consoleService } from '../service';

const mockApiFetch = jest.fn();
const mockExpoFetch = jest.fn();

jest.mock('@/api', () => ({
  api: { fetch: (...args: unknown[]) => mockApiFetch(...args) },
  projectScopedBase: (project: string) =>
    `/apis/resourcemanager.miloapis.com/v1alpha1/projects/${project}/control-plane`,
}));
jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockExpoFetch(...args) }));
jest.mock('@/config/env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('@/auth/instance', () => ({
  session: {
    getAccessToken: jest.fn(async () => 'token-1'),
    handleUnauthorized: jest.fn(async () => 'token-2'),
  },
}));

const mockSession = jest.requireMock('@/auth/instance').session as {
  getAccessToken: jest.Mock;
  handleUnauthorized: jest.Mock;
};

const BASE = '/apis/resourcemanager.miloapis.com/v1alpha1/projects/p1/control-plane';
const SESSIONS = '/apis/compute.datumapis.com/v1alpha/namespaces/default/instanceconsolesessions';

function response(status: number, body: unknown = {}, stream?: string[]) {
  const encoder = new TextEncoder();
  const queue = (stream ?? []).map((c) => encoder.encode(c));
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: stream
      ? {
          getReader: () => ({
            read: async () => (queue.length ? { value: queue.shift(), done: false } : { done: true }),
            releaseLock: () => undefined,
          }),
        }
      : null,
  };
}

function authOf(call: unknown[]): string {
  return ((call[1] as { headers: Record<string, string> }).headers ?? {}).Authorization;
}

beforeEach(() => {
  mockApiFetch.mockReset();
  mockExpoFetch.mockReset();
  mockSession.getAccessToken.mockClear();
  mockSession.handleUnauthorized.mockClear();
});

describe('consoleHttp', () => {
  test('sends requests through the API client under the project', async () => {
    mockApiFetch.mockResolvedValue(response(200, { ok: true }));
    const http = consoleHttp('p1');
    const signal = new AbortController().signal;
    await http.fetch('/apis/x', { method: 'DELETE', signal });
    expect(mockApiFetch).toHaveBeenCalledWith(`${BASE}/apis/x`, { method: 'DELETE', signal });
    expect(mockExpoFetch).not.toHaveBeenCalled();
  });

  test('streams watches with expo/fetch and the access token', async () => {
    mockExpoFetch.mockResolvedValue(response(200));
    const signal = new AbortController().signal;
    await consoleHttp('p1').streamFetch!('/apis/watch?watch=true', {
      headers: { 'X-Test': '1' },
      signal,
    });
    expect(mockExpoFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockExpoFetch.mock.calls[0];
    expect(url).toBe(`https://api.example.test${BASE}/apis/watch?watch=true`);
    expect(init).toMatchObject({
      signal,
      headers: { Accept: 'application/json', 'X-Test': '1', Authorization: 'Bearer token-1' },
    });
    expect(mockSession.handleUnauthorized).not.toHaveBeenCalled();
  });

  test('retries a watch once with a fresh token after a 401', async () => {
    mockExpoFetch.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200));
    const res = await consoleHttp('p1').streamFetch!('/apis/watch');
    expect(res.status).toBe(200);
    expect(mockSession.handleUnauthorized).toHaveBeenCalledWith('token-1');
    expect(mockExpoFetch.mock.calls.map(authOf)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  test("returns the second 401 rather than retrying forever", async () => {
    mockExpoFetch.mockResolvedValue(response(401));
    const res = await consoleHttp('p1').streamFetch!('/apis/watch');
    expect(res.status).toBe(401);
    expect(mockExpoFetch).toHaveBeenCalledTimes(2);
  });
});

describe('consoleService.sessionDeps', () => {
  const connector = () => {
    throw new Error('not used');
  };

  test('creates and deletes sessions through the API client', async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        response(201, { metadata: { name: 's-1', namespace: 'default', uid: 'u-1', resourceVersion: '7' } })
      )
      .mockResolvedValueOnce(response(200));
    const deps = consoleService.sessionDeps('p1', connector);
    const created = await deps.create({
      instanceName: 'web-0',
      instanceUid: 'iu-1',
      containerName: 'app',
      command: ['/bin/sh'],
      clientPublicKey: 'pk',
    });
    expect(created).toMatchObject({ name: 's-1', uid: 'u-1', resourceVersion: '7' });
    const [createPath, createInit] = mockApiFetch.mock.calls[0];
    expect(createPath).toBe(`${BASE}${SESSIONS}`);
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(createInit.body)).toMatchObject({
      kind: 'InstanceConsoleSession',
      spec: { clientPublicKey: 'pk', command: ['/bin/sh'] },
    });

    await deps.remove('s-1');
    expect(mockApiFetch.mock.calls[1][0]).toBe(`${BASE}${SESSIONS}/s-1`);
    expect(mockApiFetch.mock.calls[1][1].method).toBe('DELETE');
  });

  test('a 403 on create is a permission error', async () => {
    mockApiFetch.mockResolvedValue(response(403, { message: 'forbidden' }));
    const deps = consoleService.sessionDeps('p1', connector);
    await expect(
      deps.create({
        instanceName: 'web-0',
        instanceUid: 'iu-1',
        containerName: 'app',
        command: ['/bin/sh'],
        clientPublicKey: 'pk',
      })
    ).rejects.toMatchObject({ status: 403, message: 'You need permission to open a shell in this project.' });
  });

  test('watches the session over the streaming fetch', async () => {
    mockExpoFetch.mockResolvedValue(
      response(200, undefined, [
        '{"type":"MODIFIED","object":{"metadata":{"resourceVersion":"8"}}}\n',
        '{"type":"DELETED","object":{"metadata":{"resourceVersion":"9"}}}\n',
      ])
    );
    const deps = consoleService.sessionDeps('p1', connector);
    const types: string[] = [];
    for await (const event of deps.watch('s-1', '7', new AbortController().signal)) types.push(event.type);
    expect(types).toEqual(['MODIFIED', 'DELETED']);
    const url = decodeURIComponent(mockExpoFetch.mock.calls[0][0]);
    expect(url).toBe(
      `https://api.example.test${BASE}${SESSIONS}?watch=true&fieldSelector=metadata.name=s-1&resourceVersion=7`
    );
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
