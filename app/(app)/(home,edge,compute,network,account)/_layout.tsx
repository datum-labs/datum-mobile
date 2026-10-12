import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/components/NavigationTheme';

/** The root screen of each tab's stack, keyed by the tab's group segment. */
const TAB_ROOTS: Record<string, string> = {
  '(home)': 'home',
  '(edge)': 'edge',
  '(compute)': 'compute',
  '(network)': 'network',
  '(account)': 'account',
};

/**
 * One native stack per tab, shared across all five tabs (expo-router shared
 * routes). Every detail screen exists in every tab, so drilling into an ALB
 * from Home or a connector from an ALB pushes within the current tab, with
 * the zoom transition and a working Back, instead of jumping tabs.
 */
export default function TabStack({ segment }: { segment: string }) {
  const screenOptions = useStackScreenOptions();
  return <Stack initialRouteName={TAB_ROOTS[segment]} screenOptions={screenOptions} />;
}
