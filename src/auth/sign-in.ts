import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import { env } from '@/config/env';

import { buildEndSessionUrl, exchangeCode, getDiscovery } from './oidc';
import { session } from './instance';
import { secureTokenStore } from './token-store';

export const OIDC_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export type SignInResult = { type: 'success' } | { type: 'cancel' } | { type: 'error'; message: string };

let interactiveSignInActive = false;

/** True while ASWebAuthenticationSession is on screen; a stray deep link then belongs to it. */
export function isInteractiveSignInActive(): boolean {
  return interactiveSignInActive;
}

/**
 * Authorization code + PKCE (S256) in ASWebAuthenticationSession. The shared
 * (non-ephemeral) session lets an existing Safari login give SSO; pass
 * `selectAccount` to force Zitadel's account picker ("Switch account").
 */
export async function signInInteractive({
  selectAccount = false,
}: { selectAccount?: boolean } = {}): Promise<SignInResult> {
  const { clientId, issuer, redirectUri } = env.auth;
  const discovery = await getDiscovery(issuer);

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    scopes: OIDC_SCOPES,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
    prompt: selectAccount ? AuthSession.Prompt.SelectAccount : undefined,
  });
  // Builds the URL, generating state + verifier, so both can be persisted
  // before the browser opens.
  const url = await request.makeAuthUrlAsync({
    authorizationEndpoint: discovery.authorizationEndpoint,
  });
  if (!request.codeVerifier) throw new Error('PKCE verifier was not generated.');
  await secureTokenStore.savePending({
    state: request.state,
    codeVerifier: request.codeVerifier,
    redirectUri,
    createdAt: Date.now(),
  });

  interactiveSignInActive = true;
  let result: AuthSession.AuthSessionResult;
  try {
    result = await request.promptAsync(
      { authorizationEndpoint: discovery.authorizationEndpoint },
      { url, preferEphemeralSession: false }
    );
  } finally {
    interactiveSignInActive = false;
  }

  if (result.type === 'success') {
    const code = result.params.code;
    if (!code) return { type: 'error', message: 'The sign-in response had no code.' };
    // Take the pending request so a duplicate deep link can't redeem it twice.
    await secureTokenStore.clearPending();
    const tokens = await exchangeCode(discovery, {
      clientId,
      code,
      codeVerifier: request.codeVerifier,
      redirectUri,
    });
    await session.completeSignIn(tokens);
    return { type: 'success' };
  }
  if (result.type === 'error') {
    const message =
      result.params.error_description ?? result.error?.message ?? result.params.error ?? 'Sign-in failed.';
    return { type: 'error', message };
  }
  // cancel / dismiss / locked: keep the pending request — the callback can
  // still arrive as a plain deep link (e.g. after verifying email in Safari).
  return { type: 'cancel' };
}

/**
 * Complete a sign-in whose callback arrived as a plain deep link, outside the
 * auth session, from the PKCE state stored before the browser opened.
 */
export async function completeFromCallback(params: {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}): Promise<SignInResult> {
  if (params.error) {
    return { type: 'error', message: params.error_description ?? params.error };
  }
  if (!params.code || !params.state) {
    return { type: 'error', message: 'The sign-in link was incomplete.' };
  }
  const pending = await secureTokenStore.loadPending();
  if (!pending || pending.state !== params.state) {
    return { type: 'error', message: 'This sign-in link has expired. Sign in again.' };
  }
  await secureTokenStore.clearPending();
  const discovery = await getDiscovery(env.auth.issuer);
  const tokens = await exchangeCode(discovery, {
    clientId: env.auth.clientId,
    code: params.code,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUri,
  });
  await session.completeSignIn(tokens);
  return { type: 'success' };
}

/**
 * Sign out: revoke the refresh token and clear the Keychain. With
 * `endSessionOnLogout`, also end the Zitadel browser session so the next
 * sign-in doesn't silently reuse the Safari cookie.
 */
export async function signOutEverywhere(): Promise<void> {
  const { idToken } = await session.signOut();
  if (!env.auth.endSessionOnLogout || !env.auth.clientId) return;
  try {
    const discovery = await getDiscovery(env.auth.issuer);
    const url = buildEndSessionUrl(discovery, {
      clientId: env.auth.clientId,
      idTokenHint: idToken,
      postLogoutRedirectUri: env.auth.postLogoutRedirectUri,
    });
    if (url) {
      await WebBrowser.openAuthSessionAsync(url, env.auth.postLogoutRedirectUri, {
        preferEphemeralSession: false,
      });
    }
  } catch {
    // Local sign-out already happened; the browser session is a nicety.
  }
}
