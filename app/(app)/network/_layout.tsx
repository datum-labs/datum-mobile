import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/components/NavigationTheme';

export default function NetworkStack() {
  const screenOptions = useStackScreenOptions();
  return <Stack screenOptions={screenOptions} />;
}
