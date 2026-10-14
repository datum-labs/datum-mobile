import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import { useCallback, useState, type ReactNode } from 'react';
import { RefreshControl, StyleSheet, type ScrollViewProps } from 'react-native';
import Animated, { type AnimatedRef, type ScrollHandlerProcessed } from 'react-native-reanimated';

type Props = Omit<ScrollViewProps, 'refreshControl' | 'onScroll'> & {
  children: ReactNode;
  /** Pull-to-refresh: resolves when every refetch settles. */
  onRefresh?: () => Promise<unknown>;
  /** Pull-to-refresh spinner colour (e.g. light over Home's artwork). */
  refreshTint?: string;
  /** For scroll-driven animations (`useScrollViewOffset`, `useAnimatedScrollHandler`). */
  scrollRef?: AnimatedRef<Animated.ScrollView>;
  onScroll?: ScrollHandlerProcessed<Record<string, unknown>>;
};

/**
 * Scrollable screen body under a large-title, transparent (Liquid Glass)
 * header. `contentInsetAdjustmentBehavior="automatic"` lets UIKit inset the
 * content below the header and above the tab bar so titles collapse natively.
 */
export function Screen({
  children,
  onRefresh,
  refreshTint,
  scrollRef,
  onScroll,
  contentContainerStyle,
  style,
  ...rest
}: Props) {
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
    <Animated.ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={16}
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
            tintColor={refreshTint ?? t.colors.primary}
          />
        ) : undefined
      }
      {...rest}>
      {children}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 20 },
});
