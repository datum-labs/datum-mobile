import {
  buildEndSessionUrl,
  clearDiscoveryCache,
  exchangeCode,
  getDiscovery,
  OAuthError,
  revokeToken,
} from '../oidc';

import { jsonResponse } from '@/test/helpers';

describe('oidc', () => {
  beforeEach(() => clearDiscoveryCache());

  test('discovery is fetched once per issuer and mapped', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, {
        issuer: 'https://auth.example',
        authorization_endpoint: 'https://auth.example/oauth/v2/authorize',
        token_endpoint: 'https://auth.example/oauth/v2/token',
        revocation_endpoint: 'https://auth.example/oauth/v2/revoke',
        end_session_endpoint: 'https://auth.example/oidc/v1/end_session',
      })
    );
    const [a, b] = await Promise.all([
      getDiscovery('https://auth.example', fetchImpl),
      getDiscovery('https://auth.example', fetchImpl),
    ]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://auth.example/.well-known/openid-configuration',
      expect.anything()
    );
    expect(a.revocationEndpoint).toBe('https://auth.example/oauth/v2/revoke');
  });

  test('failed discovery is not cached', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(500, 'boom'));
    await expect(getDiscovery('https://auth.example', fetchImpl)).rejects.toThrow();
    await expect(getDiscovery('https://auth.example', fetchImpl)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('exchangeCode posts the PKCE verifier as a public client', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, { access_token: 'at', refresh_token: 'rt', id_token: 'id', expires_in: 43199 })
    );
    const tokens = await exchangeCode(
      { tokenEndpoint: 'https://auth.example/oauth/v2/token' },
      {
        clientId: 'ios-client',
        code: 'the-code',
        codeVerifier: 'verifier~123',
        redirectUri: 'net.datum.cloud.staging:/oauth/callback',
      },
      fetchImpl
    );
    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      expiresIn: 43199,
      tokenType: undefined,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'ios-client',
      code: 'the-code',
      code_verifier: 'verifier~123',
      redirect_uri: 'net.datum.cloud.staging:/oauth/callback',
    });
    expect(body.has('client_secret')).toBe(false);
  });

  test('token errors become OAuthError', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(400, { error: 'invalid_grant', error_description: 'code expired' })
    );
    const error = await exchangeCode(
      { tokenEndpoint: 'https://t' },
      { clientId: 'c', code: 'x', codeVerifier: 'v', redirectUri: 'r' },
      fetchImpl
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).isGrantInvalid).toBe(true);
  });

  test('revokeToken posts the refresh token hint', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, ''));
    await revokeToken(
      { revocationEndpoint: 'https://auth.example/oauth/v2/revoke' },
      { clientId: 'c', token: 'rt', tokenTypeHint: 'refresh_token' },
      fetchImpl
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('client_id=c&token=rt&token_type_hint=refresh_token');
  });

  test('end-session URL carries the post-logout redirect', () => {
    expect(
      buildEndSessionUrl(
        { endSessionEndpoint: 'https://auth.example/oidc/v1/end_session' },
        { clientId: 'c', idTokenHint: 'id', postLogoutRedirectUri: 'net.datum.cloud:/oauth/logout' }
      )
    ).toBe(
      'https://auth.example/oidc/v1/end_session?client_id=c&id_token_hint=id&post_logout_redirect_uri=net.datum.cloud%3A%2Foauth%2Flogout'
    );
  });
});
