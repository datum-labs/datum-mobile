import { Card, CardContent, CardField, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Share, StyleSheet, View } from 'react-native';

import { LogRowSkeletons } from '@/components/LogList';
import { HttpStatusBadge, MethodBadge } from '@/components/LogRows';
import { NoLogsAccessState } from '@/components/LogControls';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { EmptyState, ErrorState } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import {
  ACCESS_LOG_FIELD_LABELS,
  describeResponseFlags,
  formatDurationMs,
  formatLocalTimestamp,
  formatUtcTimestamp,
  httpStatusText,
  splitPathQuery,
  type AccessLogEntry,
} from '@/lib/logs';
import { isLogsForbidden, useAlbLogEntry } from '@/resources/logs/queries';
import { useToolbarIcon } from '@/lib/icons/toolbar';

/** Plain-text copy of the whole entry for the share sheet (which offers Copy). */
function entryAsText(entry: AccessLogEntry): string {
  const lines = [
    `${entry.method ?? ''} ${entry.path ?? ''} → ${entry.status ?? '?'} ${httpStatusText(entry.status) ?? ''}`.trim(),
    `Time: ${formatUtcTimestamp(entry.timeMs)} (${entry.timestampNs})`,
    ...Object.entries(entry.fields).map(
      ([key, value]) => `${ACCESS_LOG_FIELD_LABELS[key as keyof typeof ACCESS_LOG_FIELD_LABELS] ?? key}: ${value}`
    ),
  ];
  return lines.join('\n');
}

type Field = { label: string; value?: string; mono?: boolean } | false | null | undefined;

/**
 * Every field in full: short values sit inline, long ones (hosts, user
 * agents, ids) go under their label so nothing is truncated. All selectable.
 */
function FieldCard({ rows }: { rows: Field[] }) {
  const visible = rows.filter((row): row is Exclude<Field, false | null | undefined> => !!row && !!row.value);
  if (visible.length === 0) return null;
  return (
    <Card size="sm" sectioned>
      <CardContent padding="none">
        {visible.map((row) => {
          const stacked = (row.value as string).length > 22 || (row.value as string).includes('\n');
          return (
            <CardField
              key={row.label}
              label={row.label}
              layout={stacked ? 'stacked' : 'inline'}
              value={
                <Text size="sm" mono={row.mono} selectable style={stacked ? undefined : { textAlign: 'right' }}>
                  {row.value}
                </Text>
              }
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

function EntryHeader({ entry }: { entry: AccessLogEntry }) {
  const t = useDatumTheme();
  const duration = formatDurationMs(entry.durationMs);
  const statusText = httpStatusText(entry.status);
  return (
    <View style={[styles.card, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder }]}>
      <View style={styles.badges}>
        <MethodBadge method={entry.method} />
        <HttpStatusBadge entry={entry} />
        {statusText ? (
          <Text size="sm" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {statusText}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {duration ? (
          <Text size="sm" mono tone="muted">
            {duration}
          </Text>
        ) : null}
      </View>
      <Text size="base" mono selectable>
        {entry.path ?? '—'}
      </Text>
      <Text size="xs" tone="muted" selectable>
        {[entry.host, formatLocalTimestamp(entry.timeMs)].filter(Boolean).join('\n')}
      </Text>
    </View>
  );
}

export default function AccessLogEntryScreen() {
  const toolbarIcon = useToolbarIcon();
  const { id, entry: timestampNs, rid } = useLocalSearchParams<{ id: string; entry: string; rid?: string }>();
  const projectId = useProjectId();
  const query = useAlbLogEntry(projectId, id, timestampNs, rid);
  const entry = query.data;
  const f = entry?.fields;
  const { pathname, params } = splitPathQuery(entry?.path ?? '');
  const flags = describeResponseFlags(f?.response_flags);

  return (
    <>
      <Stack.Screen options={{ title: 'Request', headerLargeTitle: false }} />
      {entry ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={toolbarIcon('square.and.arrow.up')}
            accessibilityLabel="Share or copy this request"
            onPress={() => void Share.share({ message: entryAsText(entry) })}
          />
        </Stack.Toolbar>
      ) : null}
      <Screen onRefresh={() => query.refetch()}>
        {entry ? (
          <>
            <EntryHeader entry={entry} />
            <Section title="Request">
              <FieldCard
                rows={[
                  { label: 'Method', value: entry.method, mono: true },
                  { label: 'Path', value: pathname || undefined, mono: true },
                  { label: 'Host', value: entry.host, mono: true },
                  { label: ACCESS_LOG_FIELD_LABELS.protocol, value: f?.protocol },
                  { label: ACCESS_LOG_FIELD_LABELS.referer, value: f?.referer, mono: true },
                  { label: ACCESS_LOG_FIELD_LABELS.user_agent, value: f?.user_agent },
                ]}
              />
            </Section>
            {params.length > 0 ? (
              <Section title="Query parameters">
                <FieldCard
                  rows={params.map(([key, value], i) => ({ label: key || `#${i}`, value: value || '(empty)', mono: true }))}
                />
              </Section>
            ) : null}
            <Section title="Response">
              <FieldCard
                rows={[
                  {
                    label: 'Status',
                    value: entry.status !== undefined ? `${entry.status} ${httpStatusText(entry.status) ?? ''}`.trim() : undefined,
                  },
                  { label: 'Duration', value: formatDurationMs(entry.durationMs) },
                  { label: ACCESS_LOG_FIELD_LABELS.response_flags, value: flags.join('\n') },
                  { label: ACCESS_LOG_FIELD_LABELS.upstream_host, value: f?.upstream_host, mono: true },
                ]}
              />
            </Section>
            <Section title="Routing">
              <FieldCard
                rows={[
                  { label: ACCESS_LOG_FIELD_LABELS.requested_server_name, value: f?.requested_server_name, mono: true },
                  { label: ACCESS_LOG_FIELD_LABELS.x_forwarded_host, value: f?.x_forwarded_host, mono: true },
                  { label: ACCESS_LOG_FIELD_LABELS.authority, value: f?.authority, mono: true },
                ]}
              />
            </Section>
            <Section title="Identifiers">
              <FieldCard
                rows={[
                  { label: ACCESS_LOG_FIELD_LABELS.request_id, value: entry.requestId, mono: true },
                  { label: 'Local time', value: formatLocalTimestamp(entry.timeMs), mono: true },
                  { label: 'UTC', value: formatUtcTimestamp(entry.timeMs), mono: true },
                  { label: 'Timestamp (ns)', value: entry.timestampNs, mono: true },
                ]}
              />
            </Section>
          </>
        ) : isLogsForbidden(query.error) ? (
          <NoLogsAccessState />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : entry === null ? (
          <EmptyState
            title="Request not found"
            description="This log entry is no longer available. Logs are kept for a limited time."
          />
        ) : (
          <LogRowSkeletons count={4} />
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
