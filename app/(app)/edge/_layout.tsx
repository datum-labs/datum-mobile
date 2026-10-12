import { Stack } from 'expo-router';

import { useStackScreenOptions } from '@/components/NavigationTheme';

export default function EdgeStack() {
  const screenOptions = useStackScreenOptions();
  return <Stack screenOptions={screenOptions} />;
}
