import { Skeleton, Text, Title, useDatumTheme } from '@datum-cloud/datum-ui-native';
import type { SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { rollupView, type StatusRollup } from '@/lib/status/views';

import { groupedSurface, StatusLabel } from './Grouped';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

/** Home tile: resource count plus a status rollup; taps through to the list. */
export function SummaryTile({
  label,
  icon,
  counts,
  loading,
  failed,
  onPress,
  index = 0,
}: {
  label: string;
  icon: SymbolViewProps['name'];
  counts?: StatusRollup;
  loading?: boolean;
  failed?: boolean;
  onPress?: () => void;
  index?: number;
}) {
  const t = useDatumTheme();
  const view = counts ? rollupView(counts) : undefined;
  return (
    <Animated.View entering={FadeIn.delay(index * 40).duration(300)} style={styles.cell}>
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${counts?.total ?? 'loading'}`}
        style={[styles.tile, { backgroundColor: t.colors.card }]}>
        <View style={styles.head}>
          <Icon name={icon} size={16} color={t.colors.primary} />
          <Text size="sm" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
            {label}
          </Text>
        </View>
        {counts ? (
          <Title level={2}>{counts.total}</Title>
        ) : loading ? (
          <Skeleton width={44} height={30} radius={6} />
        ) : (
          <Title level={2} tone="muted">
            —
          </Title>
        )}
        <View style={{ minHeight: 22, justifyContent: 'center' }}>
          {view && counts && counts.total > 0 ? (
            <StatusLabel status={view.status} label={view.label} />
          ) : failed ? (
            <Text size="xs" tone="muted">
              Unavailable
            </Text>
          ) : counts ? (
            <Text size="xs" tone="muted">
              None yet
            </Text>
          ) : null}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cell: { width: '50%', padding: 6 },
  tile: {
    ...groupedSurface,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
