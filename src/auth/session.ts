import { jwtDecode } from 'jwt-decode';

import { OAuthError, type TokenResponse } from './oidc';
import type { StoredSession, TokenStore } from './token-store';

export interface SessionUser {
  sub: string;
  email?: string;
  name?: string;
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: 'expired' | 'signedOut' }
  | { status: 'signedIn'; user: SessionUser; devToken: boolean };

/** No usable credentials: the user has to sign in (again). */
export class AuthRequiredError extends Error {
  constructor(message = 'Sign in required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export interface SessionDeps {
  store: TokenStore;
  /** Refresh-token grant against the issuer's token endpoint. */
  refresh: (refreshToken: string) => Promise<TokenResponse>;
  /** Best-effort revocation of a refresh token. */
  revoke: (refreshToken: string) => Promise<void>;
  now?: () => number;
}

interface IdClaims {
  sub?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  exp?: number;
}

/** Refresh this long before the access token's stated expiry. */
const EXPIRY_SKEW_MS = 60_000;

export function decodeClaims(token: string | undefined): IdClaims {
  if (!token) return {};
  try {
    return jwtDecode<IdClaims>(token);
  } catch {
    return {};
  }
}

function displayName(claims: IdClaims): string | undefined {
  if (claims.name) return claims.name;
  const joined = [claims.given_name, claims.family_name].filter(Boolean).join(' ');
  return joined || claims.preferred_username || undefined;
}

/**
 * Owns the signed-in session: the refresh token (persisted) and the access
 * token (memory only).
 *
 * Zitadel rotates the refresh token on every refresh and revokes the access
 * token it replaces, so two concurrent refreshes would race each other into an
 * invalid grant. Every caller therefore goes through one in-flight refresh
 * promise, and the rotated refresh token is written to the Keychain before
 * the new access token is handed to anyone.
 */
export class SessionManager {
  private deps: Required<SessionDeps>;
  private state: SessionState = { status: 'loading' };
  private listeners = new Set<(state: SessionState) => void>();
  private accessToken: string | undefined;
  private accessTokenExpiresAt = 0;
  private inflightRefresh: Promise<string> | undefined;
  private devToken = false;

  constructor(deps: SessionDeps) {
    this.deps = { now: () => Date.now(), ...deps };
  }

  getState(): SessionState {
    return this.state;
  }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: SessionState) {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  /** Load the persisted session at launch. Does not hit the network. */
  async restore(): Promise<SessionState> {
    const stored = await this.deps.store.load().catch(() => null);
    if (stored) {
      this.setState({
        status: 'signedIn',
        user: { sub: stored.sub, email: stored.email, name: stored.name },
        devToken: false,
      });
    } else {
      this.setState({ status: 'signedOut' });
    }
    return this.state;
  }

  /** Persist the tokens from a completed authorization-code exchange. */
  async completeSignIn(tokens: TokenResponse): Promise<SessionUser> {
    const claims = decodeClaims(tokens.idToken);
    const sub = claims.sub ?? decodeClaims(tokens.accessToken).sub;
    if (!sub) throw new Error('The identity provider returned no subject (sub).');
    if (!tokens.refreshToken) {
      throw new Error('The identity provider returned no refresh token (offline_access).');
    }
    const user: SessionUser = { sub, email: claims.email, name: displayName(claims) };
    await this.deps.store.save({
      refreshToken: tokens.refreshToken,
      sub,
      email: user.email,
      name: user.name,
      idToken: tokens.idToken,
    });
    this.setAccessToken(tokens.accessToken, tokens.expiresIn);
    this.devToken = false;
    this.setState({ status: 'signedIn', user, devToken: false });
    return user;
  }

  /**
   * Development-only: run on a pasted access token with no refresh token.
   * The caller (AuthProvider) only reaches this in __DEV__ staging builds.
   */
  useStaticAccessToken(accessToken: string): SessionUser {
    const claims = decodeClaims(accessToken);
    if (!claims.sub) throw new Error('That token has no sub claim.');
    const user: SessionUser = { sub: claims.sub, email: claims.email, name: displayName(claims) };
    this.devToken = true;
    this.accessToken = accessToken;
    this.accessTokenExpiresAt = claims.exp ? claims.exp * 1000 : Number.POSITIVE_INFINITY;
    this.setState({ status: 'signedIn', user, devToken: true });
    return user;
  }

  private setAccessToken(token: string, expiresIn?: number) {
    this.accessToken = token;
    const exp = decodeClaims(token).exp;
    this.accessTokenExpiresAt = exp
      ? exp * 1000
      : expiresIn
        ? this.deps.now() + expiresIn * 1000
        : this.deps.now() + 5 * 60_000;
  }

  private hasFreshAccessToken(): boolean {
    return !!this.accessToken && this.deps.now() < this.accessTokenExpiresAt - EXPIRY_SKEW_MS;
  }

  /** A valid access token, refreshing first if the cached one is missing or near expiry. */
  async getAccessToken(): Promise<string> {
    if (this.hasFreshAccessToken()) return this.accessToken as string;
    if (this.devToken) {
      if (this.accessToken && this.deps.now() < this.accessTokenExpiresAt) return this.accessToken;
      await this.expire();
      throw new AuthRequiredError('The development token has expired.');
    }
    return this.refresh();
  }

  /**
   * The API rejected `rejected` with a 401. If it's still our current token,
   * refresh; if another request already rotated it, use the new one. Either
   * way the caller retries exactly once with what this returns.
   */
  async handleUnauthorized(rejected: string): Promise<string> {
    if (this.devToken) {
      await this.expire();
      throw new AuthRequiredError('The development token was rejected.');
    }
    if (this.inflightRefresh) return this.inflightRefresh;
    if (this.accessToken && this.accessToken !== rejected && this.hasFreshAccessToken()) {
      return this.accessToken;
    }
    return this.refresh();
  }

  /** Single-flight refresh: concurrent callers share one token-endpoint call. */
  refresh(): Promise<string> {
    if (this.devToken) return Promise.reject(new AuthRequiredError('Development tokens cannot refresh.'));
    if (!this.inflightRefresh) {
      this.inflightRefresh = this.doRefresh().finally(() => {
        this.inflightRefresh = undefined;
      });
    }
    return this.inflightRefresh;
  }

  private async doRefresh(): Promise<string> {
    const stored = await this.deps.store.load();
    if (!stored) {
      await this.expire();
      throw new AuthRequiredError();
    }
    let tokens: TokenResponse;
    try {
      tokens = await this.deps.refresh(stored.refreshToken);
    } catch (error) {
      if (error instanceof OAuthError && error.isGrantInvalid) {
        await this.expire();
        throw new AuthRequiredError('Your session has ended. Sign in again.');
      }
      throw error;
    }
    const claims = decodeClaims(tokens.idToken);
    const next: StoredSession = {
      ...stored,
      refreshToken: tokens.refreshToken ?? stored.refreshToken,
      idToken: tokens.idToken ?? stored.idToken,
      email: claims.email ?? stored.email,
      name: displayName(claims) ?? stored.name,
    };
    // Persist the rotated refresh token before anyone can use the new access
    // token: if the app dies after this point the next launch still holds a
    // live grant.
    await this.deps.store.save(next);
    this.setAccessToken(tokens.accessToken, tokens.expiresIn);
    if (this.state.status !== 'signedIn') {
      this.setState({
        status: 'signedIn',
        user: { sub: next.sub, email: next.email, name: next.name },
        devToken: false,
      });
    }
    return tokens.accessToken;
  }

  /** The grant is gone: drop local state and report signed-out (expired). */
  private async expire() {
    this.clearMemory();
    await this.deps.store.clear().catch(() => undefined);
    this.setState({ status: 'signedOut', reason: 'expired' });
  }

  private clearMemory() {
    this.accessToken = undefined;
    this.accessTokenExpiresAt = 0;
    this.devToken = false;
  }

  /** Revoke the refresh token (best effort) and clear everything local. */
  async signOut(): Promise<{ idToken?: string }> {
    const stored = await this.deps.store.load().catch(() => null);
    if (stored && !this.devToken) {
      await this.deps.revoke(stored.refreshToken).catch(() => undefined);
    }
    this.clearMemory();
    await this.deps.store.clear().catch(() => undefined);
    await this.deps.store.clearPending().catch(() => undefined);
    this.setState({ status: 'signedOut', reason: 'signedOut' });
    return { idToken: stored?.idToken };
  }
}
