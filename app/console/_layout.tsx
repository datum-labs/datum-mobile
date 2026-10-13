import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useStackScreenOptions } from '@/components/NavigationTheme';

const NO_LARGE_TITLES: ReadonlySet<string> = new Set();

/**
 * The instance shell, presented full screen over the tabs from an instance's
 * "Open shell". It can turn landscape while the app under it stays portrait, so
 * it measures its own safe area instead of the root's portrait insets.
 */
export default function ConsoleLayout() {
  const screenOptions = useStackScreenOptions(NO_LARGE_TITLES);
  return (
    <SafeAreaProvider>
      <Stack screenOptions={screenOptions} />
    </SafeAreaProvider>
  );
}
