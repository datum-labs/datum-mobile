import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/components/NavigationTheme';

export default function AccountStack() {
  const screenOptions = useStackScreenOptions();
  return <Stack screenOptions={screenOptions} />;
}
