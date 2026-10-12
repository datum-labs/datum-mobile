import fs from 'node:fs';
import path from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App variants. `APP_VARIANT` picks one at build time (EAS sets it per
 * profile, see eas.json); local development defaults to staging.
 */
const VARIANTS = {
  staging: {
    name: 'Datum Staging',
    bundleIdentifier: 'net.datum.cloud.staging',
    scheme: 'net.datum.cloud.staging',
    authIssuer: 'https://auth.staging.env.datum.net',
    apiUrl: 'https://api.staging.env.datum.net',
    appGroup: 'group.net.datum.cloud.staging',
    portalUrl: 'https://cloud.staging.env.datum.net',
  },
  production: {
    name: 'Datum',
    bundleIdentifier: 'net.datum.cloud',
    scheme: 'net.datum.cloud',
    authIssuer: 'https://auth.datum.net',
    apiUrl: 'https://api.datum.net',
    appGroup: 'group.net.datum.cloud',
    portalUrl: 'https://cloud.datum.net',
  },
} as const;

export type AppVariant = keyof typeof VARIANTS;

const NAVY = '#0c1d31';

function resolveVariant(): AppVariant {
  const raw = process.env.APP_VARIANT ?? 'staging';
  if (raw !== 'staging' && raw !== 'production') {
    throw new Error(`APP_VARIANT must be "staging" or "production", got "${raw}"`);
  }
  return raw;
}

/**
 * Font files ship with @datum-cloud/datum-ui-native and are embedded at build
 * time by the expo-font config plugin, so the first frame never waits on them.
 */
function datumFontFiles(): string[] {
  const dir = path.join(__dirname, 'node_modules/@datum-cloud/datum-ui-native/fonts');
  const files = [
    'AllianceNo1-Regular.ttf',
    'AllianceNo1-Medium.ttf',
    'AllianceNo1-SemiBold.ttf',
    'CanelaText-Regular.ttf',
  ].map((file) => path.join(dir, file));
  const missing = files.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    console.warn(
      `[app.config] datum-ui-native fonts not found (${missing
        .map((f) => path.basename(f))
        .join(', ')}); building without embedded fonts.`
    );
    return files.filter((file) => fs.existsSync(file));
  }
  return files;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant();
  const v = VARIANTS[variant];

  // The dev-token escape hatch is staging-only. Refuse to even configure a
  // production build while the variable is set, so it can't leak into one.
  if (variant === 'production' && process.env.EXPO_PUBLIC_DEV_ACCESS_TOKEN) {
    throw new Error('EXPO_PUBLIC_DEV_ACCESS_TOKEN must not be set for the production variant.');
  }

  const fonts = datumFontFiles();

  // App Group + shared keychain group, reserved for a future Network
  // Extension (see README "Future"). They need a signing team, so they are
  // only added when one is configured; simulator builds run without them.
  const teamId = process.env.APPLE_TEAM_ID;
  const keychainAccessGroup = teamId ? `${teamId}.${v.bundleIdentifier}.shared` : undefined;
  const entitlements: Record<string, unknown> | undefined = teamId
    ? {
        'com.apple.security.application-groups': [v.appGroup],
        'keychain-access-groups': [keychainAccessGroup],
      }
    : undefined;

  return {
    ...config,
    name: v.name,
    slug: 'datum-mobile',
    version: '0.1.0',
    runtimeVersion: { policy: 'appVersion' },
    orientation: 'portrait',
    scheme: v.scheme,
    userInterfaceStyle: 'automatic',
    backgroundColor: NAVY,
    platforms: ['ios'],
    icon: './assets/icon/icon-1024.png',
    ios: {
      bundleIdentifier: v.bundleIdentifier,
      supportsTablet: false,
      // Icon Composer bundle: iOS 26 layered Liquid Glass icon, with the
      // system deriving dark, tinted and clear appearances.
      icon: './assets/icon/datum.icon',
      appleTeamId: teamId,
      entitlements,
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        CFBundleAllowMixedLocalizations: true,
      },
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: NAVY,
          image: './assets/splash/splash-mark.png',
          imageWidth: 88,
          resizeMode: 'contain',
          dark: { backgroundColor: NAVY, image: './assets/splash/splash-mark.png' },
        },
      ],
      ['expo-font', { fonts }],
      'expo-secure-store',
      'expo-web-browser',
      ['expo-build-properties', { ios: { deploymentTarget: '26.0' } }],
    ],
    experiments: {
      reactCompiler: true,
    },
    extra: {
      variant,
      apiUrl: v.apiUrl,
      auth: {
        issuer: v.authIssuer,
        clientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? '',
        redirectUri: `${v.scheme}:/oauth/callback`,
        postLogoutRedirectUri: `${v.scheme}:/oauth/logout`,
        endSessionOnLogout: process.env.EXPO_PUBLIC_END_SESSION_ON_LOGOUT === 'true',
      },
      appGroup: v.appGroup,
      keychainAccessGroup,
      portalUrl: v.portalUrl,
    },
  };
};
