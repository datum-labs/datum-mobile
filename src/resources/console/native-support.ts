import { TurboModuleRegistry } from 'react-native';

/**
 * Whether this binary has react-native-webview. The shell needs it, and a
 * dev client built before the shell was added (or any older build) doesn't:
 * importing the package there throws, because it looks its native module up
 * eagerly. Check first, then `require` it lazily (see ConsoleWebView).
 */
export function hasWebView(): boolean {
  try {
    return TurboModuleRegistry.get('RNCWebViewModule') != null;
  } catch {
    return false;
  }
}
