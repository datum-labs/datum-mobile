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
    portalUrl: 'https://cloud.staging.env.datum.net',
    // Staging-only VictoriaMetrics gateway for metrics (see
    // src/resources/metrics/source.ts). Production has none yet.
    telemetryUrl: 'https://telemetry.staging.env.datum.net',
    // Patch, the assistant (A2A). The project's AssistantEndpoint wins when
    // published; this is the fallback.
    assistantUrl: 'https://patch.staging.env.datum.net',
    // "Datum Cloud iOS" Zitadel app (infra datum-iam-system, ConfigMap
    // datum-mobile-oidc-id). Public PKCE client, so not a secret.
    oidcClientId: '394841158565511203',
  },
  production: {
    name: 'Datum',
    bundleIdentifier: 'net.datum.cloud',
    scheme: 'net.datum.cloud',
    authIssuer: 'https://auth.datum.net',
    apiUrl: 'https://api.datum.net',
    portalUrl: 'https://cloud.datum.net',
    telemetryUrl: '',
    assistantUrl: 'https://patch.datum.net',
    // Not created yet: production opts in via infra's pulumi-configmap.yaml.
    oidcClientId: '',
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

  // Reserved for a future Network Extension (README "Future"):
  // - The App Group builds for the simulator without a signing team (Xcode
  //   embeds it as simulated entitlements), so it is always on. EAS capability
  //   sync registers it on the Apple team at the first signed build.
  // - The shared keychain access group needs the team ID prefix, so it (and
  //   SecureStore's `accessGroup`) is only enabled when APPLE_TEAM_ID is set.
  //   Turning it on later moves Keychain items: existing sessions sign in again.
  const teamId = process.env.APPLE_TEAM_ID;
  // Personal-team device builds (cable installs before org access): use a
  // personal bundle ID so the real one isn't claimed by a personal team, and
  // drop the App Group, which free teams can't provision. The URL scheme stays
  // the variant's, so the registered OIDC redirect still matches.
  const bundleIdentifier = process.env.IOS_BUNDLE_ID || v.bundleIdentifier;
  // The App Group follows the effective bundle ID, so a personal bundle ID on
  // a paid team gets its own group (group.<bundle>); for the variants this is
  // the reserved group.net.datum.cloud[.staging].
  const appGroup = process.env.IOS_NO_APP_GROUP === '1' ? undefined : `group.${bundleIdentifier}`;
  const keychainAccessGroup = teamId ? `${teamId}.${bundleIdentifier}.shared` : undefined;
  const entitlements: Record<string, unknown> = {
    ...(appGroup ? { 'com.apple.security.application-groups': [appGroup] } : {}),
    ...(keychainAccessGroup ? { 'keychain-access-groups': [keychainAccessGroup] } : {}),
  };

  return {
    ...config,
    name: v.name,
    slug: 'datum-mobile',
    version: '0.1.0',
    runtimeVersion: { policy: 'appVersion' },
    // Info.plist allows portrait and landscape so the instance shell can turn
    // sideways; every other screen pins itself to portrait (app/_layout.tsx).
    orientation: 'default',
    scheme: v.scheme,
    userInterfaceStyle: 'automatic',
    backgroundColor: NAVY,
    platforms: ['ios', 'android'],
    icon: './assets/icon/icon-1024.png',
    ios: {
      bundleIdentifier,
      // Local App Store Connect uploads set this per build; EAS manages it
      // remotely (eas.json appVersionSource: remote).
      ...(process.env.IOS_BUILD_NUMBER ? { buildNumber: process.env.IOS_BUILD_NUMBER } : {}),
      supportsTablet: false,
      // Icon Composer bundle: iOS 26 layered Liquid Glass icon, with the
      // system deriving dark, tinted and clear appearances.
      icon: './assets/icon/datum.icon',
      appleTeamId: teamId,
      entitlements,
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        CFBundleAllowMixedLocalizations: true,
        // Only standard HTTPS/TLS: exempt from export compliance, so App Store
        // Connect doesn't ask on every TestFlight build.
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      // Same id and URL scheme as iOS, so the staging OIDC redirect
      // (net.datum.cloud.staging:/oauth/callback) works unchanged.
      package: process.env.ANDROID_PACKAGE || v.bundleIdentifier,
      ...(process.env.ANDROID_VERSION_CODE ? { versionCode: Number(process.env.ANDROID_VERSION_CODE) } : {}),
      adaptiveIcon: {
        foregroundImage: './assets/icon/android/foreground.png',
        monochromeImage: './assets/icon/android/foreground.png',
        backgroundColor: NAVY,
      },
      predictiveBackGestureEnabled: true,
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
      [
        'expo-build-properties',
        {
          // Expo's prebuilt module frameworks are tied to the Swift compiler
          // they were built with (6.3.1 for SDK 57.0.x); Xcode 27.1's 6.4 can't
          // import them, so build the modules from source.
          ios: { deploymentTarget: '26.0', usePrecompiledModules: false },
        },
      ],
      // BGTaskScheduler identifier + processing mode for the widgets' background refresh.
      'expo-background-task',
      './plugins/with-scene-lifecycle',
      // Instance shell: the terminal page and console WASM as bundle files (README "Instance shell").
      './plugins/with-console-assets',
      // Datum Connect packet tunnel; a no-op unless IOS_VPN=1 (README "Connect").
      './plugins/with-datum-vpn',
      // Home Screen / Lock Screen widgets and Control Centre controls; a no-op
      // unless IOS_WIDGETS=1 (README "Widgets and controls").
      './plugins/with-datum-widgets',
    ],
    experiments: {
      reactCompiler: true,
    },
    extra: {
      variant,
      apiUrl: v.apiUrl,
      auth: {
        issuer: v.authIssuer,
        clientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID || v.oidcClientId,
        redirectUri: `${v.scheme}:/oauth/callback`,
        postLogoutRedirectUri: `${v.scheme}:/oauth/logout`,
        endSessionOnLogout: process.env.EXPO_PUBLIC_END_SESSION_ON_LOGOUT === 'true',
      },
      appGroup,
      keychainAccessGroup,
      portalUrl: v.portalUrl,
      telemetryUrl: v.telemetryUrl,
      assistantUrl: v.assistantUrl,
    },
  };
};
