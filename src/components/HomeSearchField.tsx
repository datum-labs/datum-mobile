import { impactHaptic, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from './Icon';

/**
 * Home's search field: looks like the system search field and opens the
 * search screen, whose native search bar takes the focus.
 */
export function HomeSearchField({ projectName }: { projectName?: string }) {
  const t = useDatumTheme();
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel={projectName ? `Search ${projectName}` : 'Search this project'}
      onPress={() => {
        impactHaptic('light');
        router.push('/search');
      }}
      style={({ pressed }) => [styles.field, { backgroundColor: pressed ? t.colors.muted : t.colors.card }]}>
      <Icon name="magnifyingglass" size={16} weight="semibold" color={t.colors.mutedForeground} />
      <Text size="base" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
        {projectName ? `Search ${projectName}` : 'Search this project'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderCurve: 'continuous',
  },
});
