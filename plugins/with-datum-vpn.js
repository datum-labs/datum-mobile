// Datum Connect VPN: the `DatumTunnel` packet-tunnel Network Extension.
//
// Off unless IOS_VPN=1, so default and personal-team builds stay unchanged
// (free teams can't sign Network Extensions). With it on, this:
//
// - gives the app the packet-tunnel entitlement, the shared Keychain group and
//   the Info.plist keys the DatumVpn module reads;
// - copies native/datum-tunnel (Swift), the UniFFI bindings and the
//   DatumConnectCore xcframework (scripts/build-connect-core.sh) to
//   ios/DatumTunnel;
// - adds an app-extension target that embeds in the app.
//
// IDs derive from the effective bundle ID (IOS_BUNDLE_ID or the variant's):
//   extension     <bundle>.tunnel
//   App Group     group.<bundle> (unless IOS_NO_APP_GROUP=1)
//   Keychain      <TEAM>.<bundle>.shared ($(AppIdentifierPrefix) without APPLE_TEAM_ID)
//
// A local plugin rather than @bacons/apple-targets: apple-targets 5.0.0 pins
// @expo/prebuild-config ~55 (SDK 55), not this app's SDK 57.
const fs = require('node:fs');
const path = require('node:path');
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

const TARGET = 'DatumTunnel';
const NE_KEY = 'com.apple.developer.networking.networkextension';
const ROOT = path.resolve(__dirname, '..');
const SOURCES = path.join(ROOT, 'native/datum-tunnel');
const CORE_BUILD = path.join(ROOT, 'native/connect-core/build');
const XCFRAMEWORK = 'DatumConnectCore.xcframework';
const BINDINGS = 'datum_connect_core.swift';

function ids(config) {
  const bundleId = config.ios?.bundleIdentifier;
  if (!bundleId) throw new Error('with-datum-vpn: ios.bundleIdentifier is required');
  const teamId = config.ios?.appleTeamId;
  return {
    bundleId,
    extensionId: `${bundleId}.tunnel`,
    teamId,
    appGroup: process.env.IOS_NO_APP_GROUP === '1' ? undefined : `group.${bundleId}`,
    keychainGroup: teamId ? `${teamId}.${bundleId}.shared` : `$(AppIdentifierPrefix)${bundleId}.shared`,
  };
}

function requireCore() {
  const missing = [path.join(CORE_BUILD, XCFRAMEWORK), path.join(CORE_BUILD, 'swift', BINDINGS)].filter(
    (p) => !fs.existsSync(p)
  );
  if (missing.length > 0) {
    throw new Error(
      `with-datum-vpn: IOS_VPN=1 needs the Rust core. Run scripts/build-connect-core.sh first (missing ${missing
        .map((p) => path.relative(ROOT, p))
        .join(', ')}).`
    );
  }
}

const withAppEntitlements = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    const { appGroup, keychainGroup } = ids(cfg);
    const e = cfg.modResults;
    e[NE_KEY] = ['packet-tunnel-provider'];
    const groups = new Set(e['keychain-access-groups'] ?? []);
    groups.add(keychainGroup);
    e['keychain-access-groups'] = [...groups];
    if (appGroup) {
      const appGroups = new Set(e['com.apple.security.application-groups'] ?? []);
      appGroups.add(appGroup);
      e['com.apple.security.application-groups'] = [...appGroups];
    }
    return cfg;
  });

const withAppInfoPlist = (config) =>
  withInfoPlist(config, (cfg) => {
    const { extensionId, keychainGroup } = ids(cfg);
    cfg.modResults.DatumVpnProviderBundleIdentifier = extensionId;
    cfg.modResults.DatumKeychainAccessGroup = keychainGroup;
    return cfg;
  });

const xml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Entitlements plist: string-array values only. */
function entitlementsPlist(entries) {
  const body = Object.entries(entries)
    .map(
      ([key, values]) =>
        `\t<key>${xml(key)}</key>\n\t<array>\n${values.map((v) => `\t\t<string>${xml(v)}</string>\n`).join('')}\t</array>\n`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}</dict>\n</plist>\n`;
}

function copyRecursive(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

const withExtensionFiles = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      requireCore();
      const { appGroup, keychainGroup } = ids(cfg);
      const dir = path.join(cfg.modRequest.platformProjectRoot, TARGET);
      fs.mkdirSync(dir, { recursive: true });
      for (const file of fs.readdirSync(SOURCES)) {
        fs.copyFileSync(path.join(SOURCES, file), path.join(dir, file));
      }
      fs.copyFileSync(path.join(CORE_BUILD, 'swift', BINDINGS), path.join(dir, BINDINGS));
      copyRecursive(path.join(CORE_BUILD, XCFRAMEWORK), path.join(dir, XCFRAMEWORK));
      const entitlements = {
        [NE_KEY]: ['packet-tunnel-provider'],
        'keychain-access-groups': [keychainGroup],
        ...(appGroup ? { 'com.apple.security.application-groups': [appGroup] } : {}),
      };
      fs.writeFileSync(path.join(dir, `${TARGET}.entitlements`), entitlementsPlist(entitlements));
      return cfg;
    },
  ]);

const withExtensionTarget = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    if (project.pbxTargetByName(TARGET)) return cfg;
    const { extensionId, teamId, keychainGroup } = ids(cfg);

    // addTarget wires the dependency and the embed phase; those sections
    // don't exist in a fresh Expo project.
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency ?? {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy ?? {};

    const target = project.addTarget(TARGET, 'app_extension', TARGET, extensionId);
    const swift = ['PacketTunnelProvider.swift', 'TunnelConfig.swift', 'LeaseRenewer.swift', BINDINGS];
    const files = [...swift, 'Info.plist', `${TARGET}.entitlements`, XCFRAMEWORK];
    const group = project.addPbxGroup(files, TARGET, TARGET);
    const mainGroup = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(group.uuid, mainGroup);

    // node-xcode doesn't know xcframeworks.
    const refs = project.pbxFileReferenceSection();
    for (const key of Object.keys(refs)) {
      const ref = refs[key];
      if (typeof ref === 'object' && String(ref.path).replace(/"/g, '') === XCFRAMEWORK) {
        ref.lastKnownFileType = 'wrapper.xcframework';
        delete ref.explicitFileType;
      }
    }

    project.addBuildPhase(swift, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase([XCFRAMEWORK], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    // The embed phase addTarget created: name it as Xcode does.
    const copyPhases = objects.PBXCopyFilesBuildPhase ?? {};
    for (const key of Object.keys(copyPhases)) {
      const phase = copyPhases[key];
      if (typeof phase === 'object' && phase.dstSubfolderSpec === 13) {
        phase.name = '"Embed Foundation Extensions"';
        copyPhases[`${key}_comment`] = 'Embed Foundation Extensions';
      }
    }

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
        INFOPLIST_FILE: `"${TARGET}/Info.plist"`,
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
        DATUM_KEYCHAIN_ACCESS_GROUP: `"${keychainGroup}"`,
        // The Rust core uses the resolver and system networking APIs.
        OTHER_LDFLAGS: '("$(inherited)", "-lresolv", "-framework", "SystemConfiguration", "-framework", "Security")',
        ...(teamId ? { DEVELOPMENT_TEAM: teamId } : {}),
      });
      delete settings.GCC_PREPROCESSOR_DEFINITIONS;
    }
    if (teamId) project.addTargetAttribute('DevelopmentTeam', teamId, target);
    return cfg;
  });

module.exports = function withDatumVpn(config) {
  if (process.env.IOS_VPN !== '1') return config;
  config = withAppEntitlements(config);
  config = withAppInfoPlist(config);
  config = withExtensionFiles(config);
  config = withExtensionTarget(config);
  return config;
};
