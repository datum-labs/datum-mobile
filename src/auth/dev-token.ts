import { env } from '@/config/env';

/**
 * DEV-ONLY escape hatch: sign in with a pasted staging access token (e.g. from
 * `datumctl auth get-token`) before the iOS OIDC client exists.
 *
 * Every entry point is behind `__DEV__`, which Metro constant-folds to
 * `false` in release bundles, so these branches — and the inlined
 * EXPO_PUBLIC_DEV_ACCESS_TOKEN value — are stripped from production JS.
 * app.config.ts also refuses to configure a production build with the
 * variable set.
 */
export function isDevTokenAllowed(): boolean {
  if (!__DEV__) return false;
  return env.variant === 'staging';
}

export function devTokenFromEnv(): string | undefined {
  if (!__DEV__) return undefined;
  if (env.variant !== 'staging') return undefined;
  const token = process.env.EXPO_PUBLIC_DEV_ACCESS_TOKEN;
  return token ? token.trim() : undefined;
}
