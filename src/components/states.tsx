import { Alert, Button, Skeleton, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import type { UseQueryResult } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { describeError } from '@/api/errors';

import { Icon } from './Icon';

/**
 * The one empty-state illustration: the three explorers, cut from the
 * datum.net vector artwork (illustration.svg) and exported at @1x/@2x/@3x so
 * it stays crisp. The old cloud-portal scene PNGs were too small for iOS.
 */
export const EMPTY_STATE_ART = require('@/assets/images/scenes/explorers.png') as ImageSourcePropType;

/** Placeholder rows shaped like ResourceRow, shimmering while data loads. */
export function RowSkeletons({ count = 5 }: { count?: number }) {
  const t = useDatumTheme();
  return (
    <View style={{ gap: 8 }} accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            styles.skeletonRow,
            { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder },
          ]}>
          <Skeleton width={36} height={36} radius={10} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="35%" height={10} />
          </View>
          <Skeleton width={64} height={20} radius={10} />
        </View>
      ))}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(200)}>
      <Alert
        type="destructive"
        title="Couldn't load this"
        description={describeError(error)}
        icon={<Icon name="exclamationmark.triangle.fill" size={16} />}
      />
      {onRetry ? (
        <View style={{ marginTop: 12, alignItems: 'flex-start' }}>
          <Button type="secondary" theme="outline" size="small" onPress={onRetry}>
            Try again
          </Button>
        </View>
      ) : null}
    </Animated.View>
  );
}

/**
 * Empty state in the spirit of iOS's ContentUnavailableView: a centred scene,
 * a title and muted copy straight on the background, with no frames. (The
 * web-style EmptyContent from datum-ui-native nests cards and corner art,
 * which reads as a web page on iOS.)
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.empty}>
      <Image
        source={EMPTY_STATE_ART}
        resizeMode="contain"
        style={styles.emptyImage}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={styles.emptyText}>
        <Text size="lg" weight="semibold" style={styles.center} accessibilityRole="header">
          {title}
        </Text>
        {description ? (
          <Text size="sm" tone="muted" style={styles.center}>
            {description}
          </Text>
        ) : null}
      </View>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </Animated.View>
  );
}

/** Shown on project-scoped screens until a project is chosen. */
export function NoProjectState() {
  return (
    <EmptyState
      title="Choose a project"
      description="Pick an organization and project to see its resources."
      action={
        <Button
          type="primary"
          theme="solid"
          size="small"
          onPress={() => router.push('/context-switcher')}>
          Choose project
        </Button>
      }
    />
  );
}

/**
 * Renders a query's loading / error / empty / data states. Cached data keeps
 * rendering through background refetches and transient errors.
 */
export function QueryView<T>({
  query,
  isEmpty,
  empty,
  skeleton,
  children,
}: {
  query: Pick<UseQueryResult<T>, 'data' | 'error' | 'isPending' | 'refetch'>;
  isEmpty?: (data: T) => boolean;
  empty?: { title: string; description?: string };
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) {
    if (empty && isEmpty?.(query.data)) return <EmptyState {...empty} />;
    return <>{children(query.data)}</>;
  }
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{skeleton ?? <RowSkeletons />}</>;
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', paddingTop: 48, paddingBottom: 32, paddingHorizontal: 32, gap: 18 },
  emptyImage: { width: 168, height: 171 },
  emptyText: { alignSelf: 'stretch', gap: 6 },
  emptyAction: { alignItems: 'center', marginTop: 4 },
  center: { textAlign: 'center' },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
