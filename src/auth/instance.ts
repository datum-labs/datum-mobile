import { env } from '@/config/env';

import { getDiscovery, refreshTokens, revokeToken } from './oidc';
import { SessionManager } from './session';
import { secureTokenStore } from './token-store';

/** The app-wide session. Everything that needs a token goes through this. */
export const session = new SessionManager({
  store: secureTokenStore,
  refresh: async (refreshToken) => {
    const discovery = await getDiscovery(env.auth.issuer);
    return refreshTokens(discovery, { clientId: env.auth.clientId, refreshToken });
  },
  revoke: async (refreshToken) => {
    const discovery = await getDiscovery(env.auth.issuer);
    await revokeToken(discovery, {
      clientId: env.auth.clientId,
      token: refreshToken,
      tokenTypeHint: 'refresh_token',
    });
  },
});
