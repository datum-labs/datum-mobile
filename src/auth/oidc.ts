/**
 * Minimal OIDC client for Zitadel: discovery, code exchange, refresh and
 * revocation, all over plain `fetch` so they can be unit-tested with a mocked
 * fetch. The interactive authorize step lives in `sign-in.ts` (it needs
 * ASWebAuthenticationSession via expo-auth-session).
 */

export interface OidcDiscovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  endSessionEndpoint?: string;
  userinfoEndpoint?: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Seconds until the access token expires, as reported by the token endpoint. */
  expiresIn?: number;
  tokenType?: string;
}

/** An error the token endpoint returned in the RFC 6749 §5.2 shape. */
export class OAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, description: string | undefined, status: number) {
    super(description ? `${code}: ${description}` : code);
    this.name = 'OAuthError';
    this.code = code;
    this.status = status;
  }

  /** The grant itself is dead (revoked, rotated away, expired) — the user must sign in again. */
  get isGrantInvalid(): boolean {
    return this.code === 'invalid_grant' || this.code === 'invalid_token';
  }
}

const discoveryCache = new Map<string, Promise<OidcDiscovery>>();

/** Fetch (once per issuer, per process) the issuer's OpenID configuration. */
export function getDiscovery(issuer: string, fetchImpl: typeof fetch = fetch): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;
  const pending = (async () => {
    const res = await fetchImpl(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`OIDC discovery failed (${res.status})`);
    }
    const doc = (await res.json()) as Record<string, string | undefined>;
    if (!doc.authorization_endpoint || !doc.token_endpoint) {
      throw new Error('OIDC discovery document is missing endpoints');
    }
    return {
      issuer: doc.issuer ?? issuer,
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      revocationEndpoint: doc.revocation_endpoint,
      endSessionEndpoint: doc.end_session_endpoint,
      userinfoEndpoint: doc.userinfo_endpoint,
    } satisfies OidcDiscovery;
  })();
  discoveryCache.set(issuer, pending);
  // Don't cache failures: the next caller retries.
  pending.catch(() => discoveryCache.delete(issuer));
  return pending;
}

/** Test hook. */
export function clearDiscoveryCache(): void {
  discoveryCache.clear();
}

function formBody(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

async function postToken(
  endpoint: string,
  params: Record<string, string | undefined>,
  fetchImpl: typeof fetch
): Promise<TokenResponse> {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: formBody(params),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Non-JSON error page; handled below.
  }
  if (!res.ok || typeof json.access_token !== 'string') {
    const code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    const description =
      typeof json.error_description === 'string' ? json.error_description : undefined;
    throw new OAuthError(code, description, res.status);
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    idToken: typeof json.id_token === 'string' ? json.id_token : undefined,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
    tokenType: typeof json.token_type === 'string' ? json.token_type : undefined,
  };
}

/** Authorization-code + PKCE exchange for a public (no secret) client. */
export function exchangeCode(
  discovery: Pick<OidcDiscovery, 'tokenEndpoint'>,
  args: { clientId: string; code: string; codeVerifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch
): Promise<TokenResponse> {
  return postToken(
    discovery.tokenEndpoint,
    {
      grant_type: 'authorization_code',
      client_id: args.clientId,
      code: args.code,
      code_verifier: args.codeVerifier,
      redirect_uri: args.redirectUri,
    },
    fetchImpl
  );
}

/** Refresh-token grant. Zitadel rotates the refresh token on every call. */
export function refreshTokens(
  discovery: Pick<OidcDiscovery, 'tokenEndpoint'>,
  args: { clientId: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch
): Promise<TokenResponse> {
  return postToken(
    discovery.tokenEndpoint,
    {
      grant_type: 'refresh_token',
      client_id: args.clientId,
      refresh_token: args.refreshToken,
    },
    fetchImpl
  );
}

/** RFC 7009 revocation. Resolves even when the server says the token was already gone. */
export async function revokeToken(
  discovery: Pick<OidcDiscovery, 'revocationEndpoint'>,
  args: { clientId: string; token: string; tokenTypeHint: 'refresh_token' | 'access_token' },
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (!discovery.revocationEndpoint) return;
  const res = await fetchImpl(discovery.revocationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      client_id: args.clientId,
      token: args.token,
      token_type_hint: args.tokenTypeHint,
    }),
  });
  if (!res.ok && res.status !== 400) {
    throw new Error(`Token revocation failed (${res.status})`);
  }
}

/** URL for RP-initiated logout (end_session), or undefined when the issuer has none. */
export function buildEndSessionUrl(
  discovery: Pick<OidcDiscovery, 'endSessionEndpoint'>,
  args: { clientId: string; idTokenHint?: string; postLogoutRedirectUri: string }
): string | undefined {
  if (!discovery.endSessionEndpoint) return undefined;
  const query = formBody({
    client_id: args.clientId,
    id_token_hint: args.idTokenHint,
    post_logout_redirect_uri: args.postLogoutRedirectUri,
  });
  return `${discovery.endSessionEndpoint}?${query}`;
}
