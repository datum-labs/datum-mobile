import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/components/NavigationTheme';

const NO_LARGE_TITLES: ReadonlySet<string> = new Set();

/** The instance shell, presented full screen over the tabs from an instance's "Open shell". */
export default function ConsoleLayout() {
  const screenOptions = useStackScreenOptions(NO_LARGE_TITLES);
  return <Stack screenOptions={screenOptions} />;
}
