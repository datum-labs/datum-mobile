// Learn more https://docs.expo.dev/guides/customizing-metro
const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

/**
 * @datum-cloud/datum-ui-native and -tokens are `link:` dependencies pointing
 * at a datum-ui checkout. Metro has to watch their real paths, and every
 * import made from inside them must resolve against *this* app's
 * node_modules — otherwise the linked package's own dev copies of react /
 * react-native / reanimated get bundled and React sees two renderers.
 */
const linkedPackages = ['@datum-cloud/datum-ui-native', '@datum-cloud/datum-ui-tokens']
  .map((name) => path.join(projectRoot, 'node_modules', name))
  .filter((dir) => fs.existsSync(dir))
  .map((dir) => fs.realpathSync(dir));

config.watchFolders = [...(config.watchFolders ?? []), ...linkedPackages];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')];

const isInsideLinkedPackage = (file) =>
  linkedPackages.some((dir) => file.startsWith(dir + path.sep));

// Resolve bare imports from linked packages as if they came from the app root.
const appOrigin = path.join(projectRoot, 'package.json');
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  const isBare = !moduleName.startsWith('.') && !path.isAbsolute(moduleName);
  if (isBare && isInsideLinkedPackage(context.originModulePath)) {
    return resolve({ ...context, originModulePath: appOrigin }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
