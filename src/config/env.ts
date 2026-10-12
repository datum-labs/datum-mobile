import Constants from 'expo-constants';

export type AppVariant = 'staging' | 'production';

export interface AppEnv {
  variant: AppVariant;
  apiUrl: string;
  auth: {
    issuer: string;
    clientId: string;
    redirectUri: string;
    postLogoutRedirectUri: string;
    endSessionOnLogout: boolean;
  };
  appGroup: string;
  /** Shared keychain group, set only when the build is entitled to it (see app.config.ts). */
  keychainAccessGroup?: string;
  portalUrl: string;
  /** Metrics gateway origin; empty where metrics aren't offered (production). */
  telemetryUrl: string;
  version: string;
}

type Extra = Partial<Omit<AppEnv, 'version'>>;

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/**
 * Resolved once from app.config.ts `extra`. The OIDC client ID also honours
 * the inlined EXPO_PUBLIC_ variable so `expo start` picks up .env changes
 * without regenerating the native config.
 */
export const env: AppEnv = {
  variant: extra.variant ?? 'staging',
  apiUrl: extra.apiUrl ?? 'https://api.staging.env.datum.net',
  auth: {
    issuer: extra.auth?.issuer ?? 'https://auth.staging.env.datum.net',
    clientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID || extra.auth?.clientId || '',
    redirectUri: extra.auth?.redirectUri ?? 'net.datum.cloud.staging:/oauth/callback',
    postLogoutRedirectUri:
      extra.auth?.postLogoutRedirectUri ?? 'net.datum.cloud.staging:/oauth/logout',
    endSessionOnLogout: extra.auth?.endSessionOnLogout ?? false,
  },
  appGroup: extra.appGroup ?? 'group.net.datum.cloud.staging',
  keychainAccessGroup: extra.keychainAccessGroup,
  portalUrl: extra.portalUrl ?? 'https://cloud.staging.env.datum.net',
  // `??` keeps production's explicit ''. The fallback only covers a staging
  // dev client still running on an older native config.
  telemetryUrl:
    extra.telemetryUrl ?? ((extra.variant ?? 'staging') === 'staging' ? 'https://telemetry.staging.env.datum.net' : ''),
  version: Constants.expoConfig?.version ?? '0.0.0',
};

/** Human-readable reason the app can't start a sign-in, or undefined when it can. */
export function authConfigError(config: AppEnv['auth'] = env.auth): string | undefined {
  if (!config.clientId) {
    return 'This build has no OIDC client ID. Set EXPO_PUBLIC_OIDC_CLIENT_ID for this variant and rebuild.';
  }
  return undefined;
}
