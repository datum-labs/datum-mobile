import { Button, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { LogSummary } from '@/components/LogControls';
import { LogList, LogNote, LogRowSkeletons } from '@/components/LogList';
import { EmptyState, ErrorState, NoProjectState } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { formatDate, pluralize, timeAgo } from '@/lib/format';
import { activityUnavailableReason, useResourceActivity } from '@/resources/activity/queries';
import type { ActivityItem } from '@/resources/activity/service';
import { useHttpProxy } from '@/resources/http-proxies/queries';

const CHANGE_SOURCE_LABEL = { human: 'Human', system: 'System' } as const;

/** Summary with link targets in semibold; then who did it, how, and when. */
const ActivityRow = memo(function ActivityRow({ item }: { item: ActivityItem }) {
  const t = useDatumTheme();
  const system = item.changeSource === 'system' || item.actorType === 'controller';
  const source = item.changeSource ? CHANGE_SOURCE_LABEL[item.changeSource] : undefined;
  // People's summaries already start with who did it ("alice@… enabled …").
  const named = !!item.actor && item.summary.includes(item.actor);
  const byline = [named ? undefined : `by ${item.actor}`, source].filter(Boolean).join(' · ');
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${item.summary}. ${byline}. ${formatDate(item.timestamp)}`}>
      <View style={[styles.iconWell, { backgroundColor: t.colors.accent }]}>
        <Icon name={system ? 'gearshape.fill' : 'person.fill'} size={13} color={t.colors.primary} />
      </View>
      <View style={styles.body}>
        <Text size="sm">
          {item.segments.map((segment, i) =>
            segment.emphasis ? (
              <Text key={i} size="sm" weight="semibold">
                {segment.text}
              </Text>
            ) : (
              segment.text
            )
          )}
        </Text>
        <View style={styles.meta}>
          <Text size="xs" tone="muted" numberOfLines={1} style={styles.grow}>
            {byline}
          </Text>
          <Text size="xs" tone="muted">
            {timeAgo(item.timestamp)}
          </Text>
        </View>
      </View>
    </View>
  );
});

export default function AlbActivity() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = useProjectId();
  const proxy = useHttpProxy(projectId, id);
  const activity = useResourceActivity(projectId, { kind: 'HTTPProxy', name: id });

  const items = activity.data;
  const unavailable = items ? undefined : activityUnavailableReason(activity.error);
  const renderRow = useCallback((item: ActivityItem) => <ActivityRow item={item} />, []);

  const placeholder = !projectId ? (
    <NoProjectState />
  ) : items ? (
    items.length === 0 ? (
      <EmptyState
        title="No activity in the last 7 days"
        description="Changes to this load balancer, by people or by Datum, will show up here."
      />
    ) : null
  ) : unavailable === 'forbidden' ? (
    <EmptyState
      title="You don't have access to activity in this project"
      description="Ask a project owner to grant you access, then pull to refresh."
    />
  ) : unavailable === 'unavailable' ? (
    <EmptyState title="Activity isn't available yet" description="This project's activity history hasn't been set up." />
  ) : activity.error ? (
    <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
  ) : (
    <LogRowSkeletons count={6} />
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Activity' }} />
      <LogList
        testID="alb-activity"
        data={items ?? []}
        renderRow={renderRow}
        placeholder={placeholder}
        onRefresh={projectId ? () => activity.refetch() : undefined}
        header={
          !projectId || unavailable ? null : (
            <LogSummary
              live={false}
              updatedAt={items ? activity.dataUpdatedAt : undefined}
              parts={[
                proxy.data?.displayName,
                'Last 7 days',
                items && items.length > 0 && pluralize(items.length, 'event'),
              ]}
            />
          )
        }
        footer={
          activity.hasNextPage ? (
            <View style={styles.footer}>
              {activity.isFetchNextPageError ? <LogNote>{"Couldn't load more activity."}</LogNote> : null}
              <Button
                type="secondary"
                theme="outline"
                size="small"
                loading={activity.isFetchingNextPage}
                onPress={() => void activity.fetchNextPage()}>
                {activity.isFetchNextPageError ? 'Try again' : 'Load more'}
              </Button>
            </View>
          ) : items && items.length > 0 ? (
            <LogNote>Showing activity from the last 7 days.</LogNote>
          ) : null
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  iconWell: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  footer: { alignItems: 'center', gap: 8 },
});
