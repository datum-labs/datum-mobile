// iOS 27 traps at launch (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption)
// unless the app adopts the UIScene life cycle. Expo 57 ships ExpoAppSceneDelegate for this,
// but the SDK 57 prebuild template still starts React Native from the app delegate. Wire it up:
// declare the scene manifest, and let the scene delegate own the window instead.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE_CLASS = 'EXExpoAppSceneDelegate';

const withSceneManifest = (config) =>
  withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    };
    return cfg;
  });

const START_IN_APP_DELEGATE =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

const withSceneAppDelegate = (config) =>
  withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('with-scene-lifecycle: expected a Swift AppDelegate');
    }
    let src = cfg.modResults.contents;

    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      const declaration = 'class AppDelegate: ExpoAppDelegate {';
      if (!src.includes(declaration)) {
        throw new Error('with-scene-lifecycle: AppDelegate declaration not found');
      }
      src = src.replace(declaration, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    }

    if (START_IN_APP_DELEGATE.test(src)) {
      src = src.replace(START_IN_APP_DELEGATE, '');
    } else if (src.includes('window = UIWindow(frame: UIScreen.main.bounds)')) {
      throw new Error('with-scene-lifecycle: could not remove the app-delegate React Native start');
    }

    cfg.modResults.contents = src;
    return cfg;
  });

module.exports = (config) => withSceneAppDelegate(withSceneManifest(config));
