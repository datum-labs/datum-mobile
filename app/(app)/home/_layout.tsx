import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/components/NavigationTheme';

export default function HomeStack() {
  const screenOptions = useStackScreenOptions();
  return <Stack screenOptions={screenOptions} />;
}
