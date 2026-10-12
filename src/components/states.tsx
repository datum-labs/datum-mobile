import {
  Alert,
  Button,
  EmptyContent,
  Skeleton,
  useDatumTheme,
} from '@datum-cloud/datum-ui-native';
import type { UseQueryResult } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { describeError } from '@/api/errors';

import { Icon } from './Icon';

export const SCENES = {
  hills: require('@/assets/images/scenes/scene-3.png') as ImageSourcePropType,
  flags: require('@/assets/images/scenes/scene-9.png') as ImageSourcePropType,
  camp: require('@/assets/images/scenes/scene-10.png') as ImageSourcePropType,
  trail: require('@/assets/images/scenes/scene-8.png') as ImageSourcePropType,
  ridge: require('@/assets/images/scenes/scene-4.png') as ImageSourcePropType,
  wide: require('@/assets/images/scenes/scene-2.png') as ImageSourcePropType,
};

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

export function EmptyState({
  title,
  description,
  image = SCENES.hills,
  action,
}: {
  title: string;
  description?: string;
  image?: ImageSourcePropType;
  action?: ReactNode;
}) {
  return (
    <Animated.View entering={FadeIn.duration(250)}>
      <EmptyContent title={title} description={description} image={image} action={action} />
    </Animated.View>
  );
}

/** Shown on project-scoped screens until a project is chosen. */
export function NoProjectState() {
  return (
    <EmptyState
      title="Choose a project"
      description="Pick an organization and project to see its resources."
      image={SCENES.flags}
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
  empty?: { title: string; description?: string; image?: ImageSourcePropType };
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
