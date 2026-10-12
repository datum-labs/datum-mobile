import { Badge, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  formatDurationMs,
  formatLogTime,
  httpStatusText,
  type AccessLogEntry,
  type ConsoleLogEntry,
} from '@/lib/logs';

/** HTTP method in a neutral badge; mono so GET/POST/PUT line up. */
export function MethodBadge({ method }: { method?: string }) {
  const t = useDatumTheme();
  return (
    <Badge type="muted" theme="light" style={styles.method} textStyle={{ fontFamily: t.fonts.mono }}>
      {method ?? '—'}
    </Badge>
  );
}

/** Status code coloured by class: 2xx success, 3xx info, 4xx warning, 5xx danger, 0 muted. */
export function HttpStatusBadge({ entry }: { entry: Pick<AccessLogEntry, 'status' | 'badge'> }) {
  const t = useDatumTheme();
  return (
    <Badge
      type={entry.badge}
      theme="light"
      textStyle={{ fontFamily: t.fonts.mono }}
      accessibilityLabel={`Status ${entry.status ?? 'unknown'} ${httpStatusText(entry.status) ?? ''}`.trim()}>
      {entry.status !== undefined ? String(entry.status) : '—'}
    </Badge>
  );
}

/** One request: method, path, status; then time, host and duration. */
export const AccessLogRow = memo(function AccessLogRow({
  entry,
  onPress,
}: {
  entry: AccessLogEntry;
  onPress?: (entry: AccessLogEntry) => void;
}) {
  const t = useDatumTheme();
  const duration = formatDurationMs(entry.durationMs);
  return (
    <Pressable
      onPress={onPress ? () => onPress(entry) : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${entry.method ?? ''} ${entry.path ?? ''}, status ${entry.status ?? 'unknown'}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.colors.muted }]}>
      <View style={styles.line}>
        <MethodBadge method={entry.method} />
        <Text size="sm" mono numberOfLines={1} style={styles.grow}>
          {entry.path ?? entry.line ?? '—'}
        </Text>
        <HttpStatusBadge entry={entry} />
      </View>
      <View style={styles.line}>
        <Text size="xs" tone="muted" mono>
          {formatLogTime(entry.timeMs)}
        </Text>
        <Text size="xs" tone="muted" numberOfLines={1} style={styles.grow}>
          {entry.host ?? ''}
        </Text>
        {duration ? (
          <Text size="xs" tone="muted" mono>
            {duration}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

/** One console line: time, severity and instance; then the message, wrapping and selectable. */
export const ConsoleLogRow = memo(function ConsoleLogRow({
  entry,
  instanceLabel,
}: {
  entry: ConsoleLogEntry;
  /** Shown when the screen merges several instances. */
  instanceLabel?: string;
}) {
  return (
    <View style={[styles.row, { gap: 4 }]}>
      <View style={styles.line}>
        <Text size="xs" tone="muted" mono>
          {formatLogTime(entry.timeMs)}
        </Text>
        <Text size="xs" tone="muted" numberOfLines={1} ellipsizeMode="middle" style={styles.grow}>
          {[instanceLabel, entry.container].filter(Boolean).join(' · ')}
        </Text>
        {entry.severity ? (
          <Badge type={entry.badge} theme="light" style={styles.severity} textStyle={styles.severityText}>
            {entry.severity}
          </Badge>
        ) : null}
      </View>
      <Text size="xs" mono selectable style={styles.message}>
        {entry.message || ' '}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  method: { minWidth: 58, justifyContent: 'center', paddingHorizontal: 6 },
  severity: { paddingHorizontal: 6, paddingVertical: 0 },
  severityText: { fontSize: 10, lineHeight: 16, letterSpacing: 0.3 },
  message: { lineHeight: 18 },
});
