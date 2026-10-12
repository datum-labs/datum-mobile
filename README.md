# Datum for iOS (`datum-mobile`)

A read-only iOS app for Datum Cloud: organizations, projects, ALBs (HTTPProxies),
domains, DNS, compute workloads and instances, networks, subnets and connectors.
Built with Expo SDK 57 / React Native 0.86 (new architecture), Expo Router and
the system iOS 26 chrome (Liquid Glass tab bar, headers and sheets). Content
components come from [`@datum-cloud/datum-ui-native`](../datum-ui/packages/native).

> iOS 26+ only. Android is not a target (`platforms: ['ios']`).

## Setup

Requirements: Node 24, pnpm 11 (via corepack), Xcode 26+ (iOS 26 SDK),
CocoaPods. If `xcode-select` points at the Command Line Tools, export
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

```sh
pnpm install          # .npmrc sets node-linker=hoisted, which Expo needs with pnpm
cp .env.example .env.local
```

`@datum-cloud/datum-ui-native` and `@datum-cloud/datum-ui-tokens` are `link:`
dependencies on a datum-ui checkout at `../.worktrees/datum-ui-native`. Build
that workspace first (`pnpm build` there produces `fonts/`, `assets/` and
`dist/`). `metro.config.js` watches the linked folders and resolves every bare
import made inside them from this app's `node_modules`, so only one React /
React Native / Reanimated is bundled. Switch to the published packages once
they're released.

| Script | What it does |
|---|---|
| `pnpm start` | Metro dev server (`APP_VARIANT` defaults to `staging`) |
| `pnpm ios` | `expo run:ios`: prebuild, build and launch on a simulator |
| `pnpm prebuild` | `expo prebuild --platform ios --clean` |
| `pnpm export:ios` | `expo export --platform ios` (release JS bundle) |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | `tsc --noEmit`, `expo lint`, jest-expo |
| `pnpm check` | all three |
| `pnpm sync:api-types` | re-copy the generated API types from cloud-portal |
| `pnpm build:assets` | regenerate icon, splash and artwork from the brand sources |

## Variants

`app.config.ts` reads `APP_VARIANT` (`staging` | `production`). `eas.json`
maps the `development` and `preview` profiles to staging, and `production` to production.

| Variant | Bundle ID | URL scheme | Auth issuer | API |
|---|---|---|---|---|
| staging | `net.datum.cloud.staging` | `net.datum.cloud.staging` | `https://auth.staging.env.datum.net` | `https://api.staging.env.datum.net` |
| production | `net.datum.cloud` | `net.datum.cloud` | `https://auth.datum.net` | `https://api.datum.net` |

Both variants install side by side ("Datum Staging" and "Datum").

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `APP_VARIANT` | build time | `staging` (default) or `production` |
| `EXPO_PUBLIC_OIDC_CLIENT_ID` | build time, per variant (EAS env) | Client ID of the "Datum Cloud iOS" Zitadel app. Without it the Welcome screen shows a configuration error and sign-in is disabled. |
| `EXPO_PUBLIC_END_SESSION_ON_LOGOUT` | build time | `true` to also call Zitadel `end_session` on sign-out (default off) |
| `APPLE_TEAM_ID` | build time | Enables the shared Keychain access group (see Future) |
| `EXPO_PUBLIC_DEV_ACCESS_TOKEN` | **dev only** | See the dev token section. `app.config.ts` refuses to configure a production build with it set. |

`EXPO_PUBLIC_*` values are inlined into the JS bundle. Never put secrets in them.

## How auth works

OIDC authorization code flow with PKCE (S256) against Zitadel, as a public
client (no secret). See `src/auth/`.

1. **Discovery:** `<issuer>/.well-known/openid-configuration`, cached per process.
2. **Authorize:** `expo-auth-session` opens `ASWebAuthenticationSession`, never a
   WebView, so Google SSO and passkeys work. `preferEphemeralSession: false`
   reuses an existing Safari session. Scopes: `openid profile email
   offline_access`. `email` is required, because the Milo authn webhook uses it as the
   username. **Switch account** sends `prompt=select_account`.
3. **Stray callbacks:** the PKCE `state` and verifier are written to the
   Keychain before the browser opens. If the callback arrives as a plain deep
   link instead (for example after verifying an email in Safari),
   `app/oauth/callback.tsx` completes the exchange from the stored state.
4. **Tokens:** the refresh token, `sub` (from the id_token) and the id_token hint
   are stored as one Keychain item (`expo-secure-store`,
   `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), so they are always written
   together. The access token (a JWT) is kept in memory only.
5. **Refresh:** Zitadel rotates the refresh token on every refresh and revokes the
   old access token. `SessionManager` (`src/auth/session.ts`) runs a single
   refresh at a time that every caller shares, and persists the rotated
   refresh token *before* handing out the new access token. The API client
   retries a 401 once: if another request has already rotated the token it uses that one,
   otherwise it refreshes. An `invalid_grant` signs the user out.
6. **User scope:** user-scoped calls use `sub` directly:
   `/apis/iam.miloapis.com/v1alpha1/users/{sub}/control-plane/...`.
7. **Email not verified:** milo's 403 with `details.causes[].type =
   EmailNotVerified` (ported `isEmailNotVerifiedDenial`) gets one retry with a
   fresh token, because the API server caches TokenReviews per token. If the denial
   persists, the app shows `(auth)/verify-email`.
8. **Sign out:** the refresh token is revoked at `revocation_endpoint`, and the Keychain,
   the in-memory token, and the persisted query cache are cleared. With
   `EXPO_PUBLIC_END_SESSION_ON_LOGOUT=true` the app also opens `end_session`
   with `post_logout_redirect_uri=<scheme>:/oauth/logout`.

### Redirect URIs infra must register

On the "Datum Cloud iOS" Zitadel application (`appType: NATIVE`,
`authMethodType: NONE`, grants `AUTHORIZATION_CODE` + `REFRESH_TOKEN`,
`accessTokenType: JWT`, `idTokenUserinfoAssertion: true`):

| Variant | Redirect URI | Post-logout redirect URI |
|---|---|---|
| staging | `net.datum.cloud.staging:/oauth/callback` | `net.datum.cloud.staging:/oauth/logout` |
| production | `net.datum.cloud:/oauth/callback` | `net.datum.cloud:/oauth/logout` |

These are custom schemes with a single slash, and they must match exactly.

## Running on the simulator

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
pnpm prebuild
pnpm ios                          # debug build + Metro

# or a Release build with the JS bundle embedded (no Metro):
npx expo run:ios --configuration Release --no-bundler --device <simulator-udid>
```

If `expo run:ios` ends with an `osascript`/System Events error, macOS
Automation permission isn't granted. The app is still installed, so launch it
with `xcrun simctl launch <udid> net.datum.cloud.staging`. No signing team is
needed for the simulator.

### Dev token escape hatch (staging, `__DEV__` only)

Until the iOS OIDC client exists, you can sign a debug build in with a staging
access token:

```sh
EXPO_PUBLIC_DEV_ACCESS_TOKEN="$(datumctl auth get-token)" pnpm start --clear
```

You can also tap **DEV · Use an access token** on the Welcome screen and paste
one. Check that `datumctl` is logged in to **staging** first. The token is used as-is,
is never refreshed and is never stored. Every entry point sits behind `__DEV__`
plus the staging variant. Metro constant-folds those branches out of
release bundles, and `app.config.ts` throws if the variable is set for
production. Keep tokens in your shell, never in a committed file.

`src/dev/useDevRouteScript.ts` is a second dev-only hook. It replays
`datum.dev.routeScript` (`/edge|/edge/alb/<name>`) from AsyncStorage once at
launch, so headless simulator runs can reach screens without taps.
`simctl openurl` shows an "Open in…?" prompt that can't be dismissed
headlessly.

Deep link: `<scheme>:/home?org=<org>&project=<project>` selects a project.

## Layout

```
app/
  _layout.tsx                 theme, auth, persisted React Query, project context, splash gate
  index.tsx                   redirect by session state
  (auth)/welcome.tsx          illustration, glass "Sign in with Datum"
  (auth)/verify-email.tsx, (auth)/dev-token.tsx
  (app)/_layout.tsx           NativeTabs: Home · Edge · Compute · Network · Account
  (app)/home/                 project overview: counts, status rollups, needs-attention
  (app)/edge/                 ALBs · Domains · DNS Zones; alb/[id], domains/[id], dns/[id]
  (app)/compute/              workloads · instances; [workload], instances/[instance]
  (app)/network/              networks · subnets · connectors; [id], connectors/[id]
  (app)/account/              profile, project, switch account, sign out, environment
  context-switcher.tsx        form sheet: organization → project
  oauth/callback.tsx, oauth/logout.tsx
src/
  auth/        OIDC client, PKCE sign-in, Keychain store, SessionManager (refresh mutex)
  api/         fetch client (bearer, 401 retry, email-verification), scope builders, generated types
  resources/   per resource: service.ts (raw fetchers) + queries.ts (key factories, hooks)
  lib/status/  ports of the portal/compute status helpers (+ their upstream tests)
  components/  app composites on datum-ui-native (rows, glass controls, splash, states)
```

### Data and freshness

The query cache stores raw API objects, which are JSON-safe. View models are derived
with `select`, and the cache is persisted to AsyncStorage (24 h, per variant,
cleared when a different user signs in or on sign-out), so cold starts paint the
last-seen data immediately. Focused screens re-poll every 30 s while the app
is active, and ALB and workload detail screens poll faster while they are
provisioning, as the portal does. Every list supports pull-to-refresh.

### Status parity

`src/lib/status/` ports these helpers so the app shows the same badge the portal shows:

- `transformControlPlaneStatus`
- the HTTPProxy condition, WAF and provisioning helpers
- the DNS error formatting
- the compute plugin's workload presenters and ALB status

The upstream bun tests come along with them and run under jest-expo. Generated types are copied from cloud-portal by
`scripts/sync-api-types.mjs`, which records the source commit in
`src/api/generated/SOURCE.json`.

## Assets

`scripts/build-assets.sh` documents and regenerates every bitmap:

- **App icon:** an Icon Composer bundle (`assets/icon/datum.icon`: lime Datum mark, navy fill) passed through Expo's `ios.icon`, so iOS 26 derives the dark, tinted and clear looks. There is also a flat 1024 px fallback.
- **Native splash:** the mark on `#0c1d31`, for both light and dark.
- **Hero illustration:** a portrait crop of the datum.net hero at @2x and @3x, used by the animated splash and the Welcome screen.
- **Empty states:** cloud-portal scene artwork.

## Future: connectors from the phone

A Network Extension (`NEPacketTunnelProvider`) target is planned. Its Keychain
and App Group are reserved now:

- **App Group** `group.net.datum.cloud[.staging]`: always on. The simulator
  builds it without a team, and EAS registers the capability on the first signed build.
- **Shared Keychain group** `<TEAM>.<bundle>.shared`: enabled only when
  `APPLE_TEAM_ID` is set, because it needs the team prefix. `expo-secure-store` then
  writes with that `accessGroup`. Enabling it later moves the Keychain items,
  so existing installs sign in again once.

## Not done yet

- **Sign-in against staging:** not exercised end-to-end, because the Zitadel client
  doesn't exist yet. The flow is covered by unit tests with a mocked `fetch`.
- **Maestro smoke flow:** not written yet.
- **Universal links:** the AASA file isn't set up yet.
- **Watch/SSE updates:** these are deferred, and the app polls instead.
