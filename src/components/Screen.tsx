import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import { useCallback, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';

type Props = Omit<ScrollViewProps, 'refreshControl'> & {
  children: ReactNode;
  /** Pull-to-refresh: resolves when every refetch settles. */
  onRefresh?: () => Promise<unknown>;
};

/**
 * Scrollable screen body under a large-title, transparent (Liquid Glass)
 * header. `contentInsetAdjustmentBehavior="automatic"` lets UIKit inset the
 * content below the header and above the tab bar so titles collapse natively.
 */
export function Screen({ children, onRefresh, contentContainerStyle, style, ...rest }: Props) {
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

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustsScrollIndicatorInsets
      keyboardDismissMode="on-drag"
      style={[{ flex: 1, backgroundColor: t.colors.background }, style]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={t.colors.primary}
          />
        ) : undefined
      }
      {...rest}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 20 },
});
