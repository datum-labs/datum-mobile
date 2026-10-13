// Datum widgets and controls: the `DatumWidgets` WidgetKit extension.
//
// Off unless IOS_WIDGETS=1 (and the App Group isn't dropped with
// IOS_NO_APP_GROUP=1, since the widgets read the app's snapshot from it).
// With it on, this:
//
// - gives the app the Info.plist keys the datum-widgets module reads (App
//   Group, URL scheme);
// - copies native/datum-widgets (Swift) and Canela (from datum-ui-native) to
//   ios/DatumWidgets;
// - adds an app-extension target that embeds in the app;
// - compiles the intents the controls run (native/datum-widgets/Shared) into
//   the app too: an intent that opens the app must exist in it.
//
// With IOS_VPN=1 as well, the "Connect to VPC" control is included
// (DATUM_VPN), and the extension gets the packet-tunnel entitlement and the
// shared Keychain group to drive and check the DatumTunnel configuration.
//
// IDs derive from the effective bundle ID (IOS_BUNDLE_ID or the variant's):
//   extension     <bundle>.widgets
//   App Group     group.<bundle>
//   Keychain      <TEAM>.<bundle>.shared (VPN only)
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const { addSourcesToTarget, appTarget, consolidateEmbedPhases, entitlementsPlist } = require('./lib/xcode-extension');

const TARGET = 'DatumWidgets';
const NE_KEY = 'com.apple.developer.networking.networkextension';
const ROOT = path.resolve(__dirname, '..');
const SOURCES = path.join(ROOT, 'native/datum-widgets');
const FONT = 'CanelaText-Regular.ttf';
const INFO_PLIST = `${TARGET}-Info.plist`;

/** Extension-only sources. */
const EXTENSION_SWIFT = ['DatumWidgets.swift', 'HealthStore.swift', 'HealthViews.swift'];
/** Compiled into the app as well (Shared/). */
const SHARED_SWIFT = ['WidgetShared.swift', 'HealthModel.swift', 'OpenRouteIntents.swift'];
const VPN_SWIFT = ['ConnectJoin.swift', 'ConnectVPCIntent.swift'];

const vpn = () => process.env.IOS_VPN === '1';

function ids(config) {
  const bundleId = config.ios?.bundleIdentifier;
  if (!bundleId) throw new Error('with-datum-widgets: ios.bundleIdentifier is required');
  const teamId = config.ios?.appleTeamId;
  const scheme = Array.isArray(config.scheme) ? config.scheme[0] : config.scheme;
  return {
    bundleId,
    extensionId: `${bundleId}.widgets`,
    teamId,
    scheme: scheme || bundleId,
    appGroup: `group.${bundleId}`,
    keychainGroup: teamId ? `${teamId}.${bundleId}.shared` : `$(AppIdentifierPrefix)${bundleId}.shared`,
    vpnProvider: `${bundleId}.tunnel`,
  };
}

function sharedSwift() {
  return vpn() ? [...SHARED_SWIFT, ...VPN_SWIFT] : SHARED_SWIFT;
}

function fontSource() {
  const file = path.join(ROOT, 'node_modules/@datum-cloud/datum-ui-native/fonts', FONT);
  return fs.existsSync(file) ? file : undefined;
}

const withAppEntitlements = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    const { appGroup } = ids(cfg);
    const groups = new Set(cfg.modResults['com.apple.security.application-groups'] ?? []);
    groups.add(appGroup);
    cfg.modResults['com.apple.security.application-groups'] = [...groups];
    return cfg;
  });

const withAppInfoPlist = (config) =>
  withInfoPlist(config, (cfg) => {
    const { appGroup, scheme } = ids(cfg);
    cfg.modResults.DatumAppGroupIdentifier = appGroup;
    cfg.modResults.DatumURLScheme = scheme;
    return cfg;
  });

const withExtensionFiles = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const { appGroup, keychainGroup } = ids(cfg);
      const dir = path.join(cfg.modRequest.platformProjectRoot, TARGET);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      for (const file of EXTENSION_SWIFT) fs.copyFileSync(path.join(SOURCES, file), path.join(dir, file));
      for (const file of sharedSwift()) fs.copyFileSync(path.join(SOURCES, 'Shared', file), path.join(dir, file));
      fs.copyFileSync(path.join(SOURCES, 'Info.plist'), path.join(dir, INFO_PLIST));
      const font = fontSource();
      if (font) fs.copyFileSync(font, path.join(dir, FONT));
      else console.warn(`[with-datum-widgets] ${FONT} not found in datum-ui-native; widgets fall back to the system font.`);
      const entitlements = {
        'com.apple.security.application-groups': [appGroup],
        ...(vpn() ? { [NE_KEY]: ['packet-tunnel-provider'], 'keychain-access-groups': [keychainGroup] } : {}),
      };
      fs.writeFileSync(path.join(dir, `${TARGET}.entitlements`), entitlementsPlist(entitlements));
      return cfg;
    },
  ]);

const withExtensionTarget = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    if (project.pbxTargetByName(TARGET)) return cfg;
    const { extensionId, teamId, appGroup, keychainGroup, scheme, vpnProvider } = ids(cfg);
    const app = appTarget(project);

    const objects = project.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency ?? {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy ?? {};

    const target = project.addTarget(TARGET, 'app_extension', TARGET, extensionId);
    const shared = sharedSwift();
    const swift = [...EXTENSION_SWIFT, ...shared];
    const resources = fontSource() ? [FONT] : [];
    const group = project.addPbxGroup([...swift, ...resources, INFO_PLIST, `${TARGET}.entitlements`], TARGET, TARGET);
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);

    project.addBuildPhase(swift, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase(resources, 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
    consolidateEmbedPhases(project, app.uuid);

    // The controls' intents run in the app when they open it.
    addSourcesToTarget(project, app.uuid, shared);

    const configurations = project.pbxXCBuildConfigurationSection();
    const listId = project.pbxNativeTargetSection()[target.uuid].buildConfigurationList;
    const list = project.pbxXCConfigurationList()[listId];
    const version = cfg.version ?? '1.0.0';
    const build = cfg.ios?.buildNumber ?? '1';
    for (const { value } of list.buildConfigurations) {
      const settings = configurations[value].buildSettings;
      Object.assign(settings, {
        PRODUCT_NAME: `"${TARGET}"`,
        PRODUCT_BUNDLE_IDENTIFIER: `"${extensionId}"`,
        INFOPLIST_FILE: `"${TARGET}/${INFO_PLIST}"`,
        CODE_SIGN_ENTITLEMENTS: `"${TARGET}/${TARGET}.entitlements"`,
        CODE_SIGN_STYLE: 'Automatic',
        GENERATE_INFOPLIST_FILE: 'NO',
        SWIFT_VERSION: '5.0',
        SDKROOT: 'iphoneos',
        IPHONEOS_DEPLOYMENT_TARGET: '26.0',
        TARGETED_DEVICE_FAMILY: '1',
        MARKETING_VERSION: version,
        CURRENT_PROJECT_VERSION: build,
        CLANG_ENABLE_MODULES: 'YES',
        DEAD_CODE_STRIPPING: 'YES',
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        SWIFT_EMIT_LOC_STRINGS: 'YES',
        DATUM_APP_GROUP: `"${appGroup}"`,
        DATUM_URL_SCHEME: `"${scheme}"`,
        DATUM_KEYCHAIN_ACCESS_GROUP: vpn() ? `"${keychainGroup}"` : '""',
        DATUM_VPN_PROVIDER: vpn() ? `"${vpnProvider}"` : '""',
        ...(vpn() ? { SWIFT_ACTIVE_COMPILATION_CONDITIONS: '"$(inherited) DATUM_VPN"' } : {}),
        ...(teamId ? { DEVELOPMENT_TEAM: teamId } : {}),
      });
      delete settings.GCC_PREPROCESSOR_DEFINITIONS;
    }
    if (teamId) project.addTargetAttribute('DevelopmentTeam', teamId, target);
    return cfg;
  });

module.exports = function withDatumWidgets(config) {
  if (process.env.IOS_WIDGETS !== '1') return config;
  if (process.env.IOS_NO_APP_GROUP === '1') {
    console.warn('[with-datum-widgets] IOS_WIDGETS=1 needs the App Group; skipped because IOS_NO_APP_GROUP=1.');
    return config;
  }
  config = withAppEntitlements(config);
  config = withAppInfoPlist(config);
  config = withExtensionFiles(config);
  config = withExtensionTarget(config);
  return config;
};
