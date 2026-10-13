import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/components/NavigationTheme';

const NO_LARGE_TITLES: ReadonlySet<string> = new Set();

/**
 * Patch's own stack (chat → history), presented full screen over the tabs.
 * Inline titles throughout: none of these is a tab root.
 */
export default function AssistantLayout() {
  const screenOptions = useStackScreenOptions(NO_LARGE_TITLES);
  return <Stack initialRouteName="index" screenOptions={screenOptions} />;
}
