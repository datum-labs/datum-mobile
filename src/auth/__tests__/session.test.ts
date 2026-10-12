import { OAuthError, refreshTokens } from '../oidc';
import { AuthRequiredError, SessionManager } from '../session';
import { createMemoryTokenStore } from '../token-store';

import { deferred, fakeJwt, jsonResponse } from '@/test/helpers';

const NOW = 1_800_000_000_000;
const TOKEN_ENDPOINT = 'https://auth.example/oauth/v2/token';

function accessToken(n: number, expSecondsFromNow = 3600) {
  return fakeJwt({ sub: 'user-1', n, exp: Math.floor(NOW / 1000) + expSecondsFromNow });
}

function setup(opts: { fetchImpl: jest.Mock; refreshToken?: string | null }) {
  const store = createMemoryTokenStore(
    opts.refreshToken === null
      ? null
      : { refreshToken: opts.refreshToken ?? 'rt-0', sub: 'user-1', email: 'a@b.c' }
  );
  const revoke = jest.fn(async () => undefined);
  const manager = new SessionManager({
    store,
    refresh: (rt) =>
      refreshTokens({ tokenEndpoint: TOKEN_ENDPOINT }, { clientId: 'ios', refreshToken: rt }, opts.fetchImpl),
    revoke,
    now: () => NOW,
  });
  return { store, manager, revoke };
}

describe('SessionManager refresh', () => {
  test('restores a persisted session without touching the network', async () => {
    const fetchImpl = jest.fn();
    const { manager } = setup({ fetchImpl });
    const state = await manager.restore();
    expect(state).toEqual({
      status: 'signedIn',
      user: { sub: 'user-1', email: 'a@b.c', name: undefined },
      devToken: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('concurrent callers share exactly one refresh and the rotated token is persisted', async () => {
    const pending = deferred<Response>();
    const fetchImpl = jest.fn(() => pending.promise);
    const { manager, store } = setup({ fetchImpl });
    await manager.restore();

    const calls = [manager.getAccessToken(), manager.getAccessToken(), manager.refresh()];
    pending.resolve(
      jsonResponse(200, { access_token: accessToken(1), refresh_token: 'rt-1', expires_in: 3600 })
    );
    const tokens = await Promise.all(calls);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new Set(tokens).size).toBe(1);
    const body = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=rt-0');
    expect(store.writes.map((w) => w.refreshToken)).toEqual(['rt-1']);
    expect((await store.load())?.refreshToken).toBe('rt-1');
  });

  test('persists the rotated refresh token before resolving the access token', async () => {
    const order: string[] = [];
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, { access_token: accessToken(2), refresh_token: 'rt-2' })
    );
    const { manager, store } = setup({ fetchImpl });
    const save = store.save.bind(store);
    store.save = async (s) => {
      order.push(`save:${s.refreshToken}`);
      await save(s);
    };
    await manager.restore();
    await manager.getAccessToken().then(() => order.push('resolved'));
    expect(order).toEqual(['save:rt-2', 'resolved']);
  });

  test('reuses a fresh access token without refreshing again', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, { access_token: accessToken(3), refresh_token: 'rt-3' })
    );
    const { manager } = setup({ fetchImpl });
    await manager.restore();
    const first = await manager.getAccessToken();
    const second = await manager.getAccessToken();
    expect(first).toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('refreshes when the cached token is inside the expiry skew', async () => {
    let n = 0;
    const fetchImpl = jest.fn(async () => {
      n += 1;
      return jsonResponse(200, { access_token: accessToken(n, 30), refresh_token: `rt-${n}` });
    });
    const { manager } = setup({ fetchImpl });
    await manager.restore();
    await manager.getAccessToken();
    await manager.getAccessToken();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('handleUnauthorized reuses a token another request already rotated in', async () => {
    let n = 0;
    const fetchImpl = jest.fn(async () => {
      n += 1;
      return jsonResponse(200, { access_token: accessToken(n), refresh_token: `rt-${n}` });
    });
    const { manager } = setup({ fetchImpl });
    await manager.restore();
    const stale = await manager.getAccessToken(); // refresh #1
    const fresh = await manager.handleUnauthorized(stale); // refresh #2
    expect(fresh).not.toBe(stale);
    // A second request that was also holding `stale` gets the new token, no third refresh.
    await expect(manager.handleUnauthorized(stale)).resolves.toBe(fresh);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('an invalid grant signs the user out and clears the keychain', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(400, { error: 'invalid_grant', error_description: 'refresh token invalid' })
    );
    const { manager, store } = setup({ fetchImpl });
    await manager.restore();
    const states: string[] = [];
    manager.subscribe((s) => states.push(s.status));
    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(await store.load()).toBeNull();
    expect(manager.getState()).toEqual({ status: 'signedOut', reason: 'expired' });
    expect(states).toEqual(['signedOut']);
  });

  test('a network failure keeps the session', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const { manager, store } = setup({ fetchImpl });
    await manager.restore();
    await expect(manager.getAccessToken()).rejects.toThrow('Network request failed');
    expect(await store.load()).not.toBeNull();
    expect(manager.getState().status).toBe('signedIn');
  });

  test('a 5xx from the token endpoint surfaces as OAuthError but keeps the session', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(503, 'unavailable'));
    const { manager, store } = setup({ fetchImpl });
    await manager.restore();
    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(OAuthError);
    expect(await store.load()).not.toBeNull();
  });

  test('keeps the old refresh token when the server does not rotate it', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { access_token: accessToken(9) }));
    const { manager, store } = setup({ fetchImpl });
    await manager.restore();
    await manager.getAccessToken();
    expect((await store.load())?.refreshToken).toBe('rt-0');
  });
});

describe('SessionManager sign-in and sign-out', () => {
  test('completeSignIn stores refresh token + sub from the id_token', async () => {
    const fetchImpl = jest.fn();
    const { manager, store } = setup({ fetchImpl, refreshToken: null });
    await manager.restore();
    const user = await manager.completeSignIn({
      accessToken: accessToken(1),
      refreshToken: 'rt-new',
      idToken: fakeJwt({ sub: 'user-42', email: 'x@y.z', given_name: 'Ada', family_name: 'L' }),
    });
    expect(user).toEqual({ sub: 'user-42', email: 'x@y.z', name: 'Ada L' });
    expect(await store.load()).toMatchObject({ refreshToken: 'rt-new', sub: 'user-42' });
    await expect(manager.getAccessToken()).resolves.toBe(accessToken(1));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('completeSignIn refuses a response without a refresh token', async () => {
    const { manager } = setup({ fetchImpl: jest.fn(), refreshToken: null });
    await expect(
      manager.completeSignIn({ accessToken: accessToken(1), idToken: fakeJwt({ sub: 's' }) })
    ).rejects.toThrow(/refresh token/);
  });

  test('signOut revokes the refresh token and clears storage', async () => {
    const { manager, store, revoke } = setup({ fetchImpl: jest.fn() });
    await manager.restore();
    await manager.signOut();
    expect(revoke).toHaveBeenCalledWith('rt-0');
    expect(await store.load()).toBeNull();
    expect(manager.getState()).toEqual({ status: 'signedOut', reason: 'signedOut' });
  });

  test('signOut still clears local state when revocation fails', async () => {
    const { manager, store, revoke } = setup({ fetchImpl: jest.fn() });
    revoke.mockRejectedValueOnce(new Error('offline'));
    await manager.restore();
    await manager.signOut();
    expect(await store.load()).toBeNull();
  });

  test('a static dev token is used as-is and never refreshed', async () => {
    const fetchImpl = jest.fn();
    const { manager } = setup({ fetchImpl, refreshToken: null });
    await manager.restore();
    const token = accessToken(5);
    expect(manager.useStaticAccessToken(token)).toMatchObject({ sub: 'user-1' });
    await expect(manager.getAccessToken()).resolves.toBe(token);
    await expect(manager.handleUnauthorized(token)).rejects.toBeInstanceOf(AuthRequiredError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(manager.getState().status).toBe('signedOut');
  });
});
