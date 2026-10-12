import { Skeleton, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { useCallback, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, View, type ListRenderItemInfo } from 'react-native';

/**
 * Virtualised log list under the large-title, transparent header. Rows sit
 * in one inset-grouped card (neutral surface, hairline separators) so 500
 * lines read as a table rather than 500 floating cards. `placeholder`
 * replaces the rows for loading, empty, error and no-access states while the
 * header (filters, summary) stays put.
 */
export function LogList<T extends { id: string }>({
  data,
  renderRow,
  header,
  footer,
  placeholder,
  onRefresh,
  testID,
}: {
  data: readonly T[];
  renderRow: (item: T) => ReactElement;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  placeholder?: ReactElement | null;
  /** Pull-to-refresh: resolves when the refetch settles. */
  onRefresh?: () => Promise<unknown>;
  testID?: string;
}) {
  const t = useDatumTheme();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const rows = placeholder ? [] : data;
  const last = rows.length - 1;
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<T>) => (
      <View
        style={[
          styles.cell,
          { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder },
          index === 0 && styles.first,
          index === last && styles.last,
        ]}>
        {index > 0 ? <View style={[styles.separator, { backgroundColor: t.colors.cardBorder }]} /> : null}
        {renderRow(item)}
      </View>
    ),
    [renderRow, last, t]
  );

  return (
    <FlatList
      testID={testID}
      data={rows}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustsScrollIndicatorInsets
      keyboardDismissMode="on-drag"
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={styles.content}
      ListHeaderComponent={header ? <View style={styles.header}>{header}</View> : null}
      ListEmptyComponent={placeholder ?? null}
      ListFooterComponent={footer && !placeholder ? <View style={styles.footer}>{footer}</View> : null}
      initialNumToRender={20}
      maxToRenderPerBatch={30}
      windowSize={11}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={t.colors.primary} />
        ) : undefined
      }
    />
  );
}

/** Placeholder rows in the same grouped card, shimmering while a page loads. */
export function LogRowSkeletons({ count = 8, lines = 2 }: { count?: number; lines?: 2 | 3 }) {
  const t = useDatumTheme();
  return (
    <View
      accessibilityLabel="Loading"
      style={[
        styles.cell,
        styles.first,
        styles.last,
        { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder },
      ]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.separator, { backgroundColor: t.colors.cardBorder }]} /> : null}
          <View style={styles.skeletonRow}>
            <View style={styles.skeletonLine}>
              <Skeleton width={lines === 2 ? 44 : 90} height={lines === 2 ? 18 : 10} radius={6} />
              <Skeleton width={`${45 + ((i * 17) % 35)}%`} height={12} />
              {lines === 2 ? <Skeleton width={38} height={18} radius={6} /> : null}
            </View>
            <Skeleton width={lines === 2 ? '40%' : '85%'} height={10} />
            {lines === 3 ? <Skeleton width={`${30 + ((i * 23) % 50)}%`} height={10} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** One quiet line under the list or in its header. */
export function LogNote({ children }: { children: string }) {
  return (
    <Text size="xs" tone="muted" style={{ textAlign: 'center' }}>
      {children}
    </Text>
  );
}

const RADIUS = 16;

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  header: { gap: 12, paddingBottom: 12 },
  footer: { paddingTop: 14, paddingHorizontal: 12 },
  cell: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  first: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: RADIUS,
    borderTopRightRadius: RADIUS,
  },
  last: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: RADIUS,
    borderBottomRightRadius: RADIUS,
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 14 },
  skeletonRow: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  skeletonLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
