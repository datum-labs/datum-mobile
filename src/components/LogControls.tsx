import { Button, StatusBadge, Text, impactHaptic } from '@datum-cloud/datum-ui-native';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { LogControls } from '@/hooks/useLogControls';
import { LOG_RANGE_PRESETS, logRangePreset, type LogRangeKey } from '@/lib/logs';

import { EmptyState } from './states';

/**
 * Native header controls for a log screen: a time-range menu, a Live toggle
 * (5 s polling while focused) and the system search field.
 */
export function LogHeaderControls({
  controls,
  searchPlaceholder,
  hidden,
}: {
  controls: LogControls;
  searchPlaceholder: string;
  /** No controls when there's nothing to control (no access). */
  hidden?: boolean;
}) {
  const { range, setRange, live, setLive, setSearch } = controls;
  if (hidden) return null;
  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="clock" accessibilityLabel="Time range" title="Time range">
          {LOG_RANGE_PRESETS.map((preset) => (
            <Stack.Toolbar.MenuAction
              key={preset.key}
              isOn={preset.key === range}
              onPress={() => setRange(preset.key)}>
              {preset.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          icon={live ? 'pause.fill' : 'play.fill'}
          accessibilityLabel={live ? 'Stop live updates' : 'Start live updates'}
          onPress={() => {
            impactHaptic('light');
            setLive(!live);
          }}
        />
      </Stack.Toolbar>
      <Stack.SearchBar
        placeholder={searchPlaceholder}
        autoCapitalize="none"
        hideWhenScrolling={false}
        onChangeText={(e) => setSearch(e.nativeEvent.text)}
        onCancelButtonPress={() => setSearch('')}
      />
    </>
  );
}

/** "Wildcard · Last 30 minutes · 231 requests", with a Live badge while polling. */
export function LogSummary({
  parts,
  live,
  updatedAt,
}: {
  parts: (string | false | undefined | null)[];
  live: boolean;
  updatedAt?: number;
}) {
  const text = parts.filter(Boolean).join(' · ');
  return (
    <View style={styles.summary}>
      <Text size="xs" tone="muted" numberOfLines={2} style={{ flex: 1 }}>
        {text}
        {!live && updatedAt ? ` · Updated ${clock(updatedAt)}` : ''}
      </Text>
      {live ? <StatusBadge status="success" label="Live" /> : null}
    </View>
  );
}

function clock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Shown in place of the list when either logs access review (or the query) is denied. */
export function NoLogsAccessState() {
  return (
    <EmptyState
      title="You don't have access to logs in this project"
      description="Ask a project owner to grant you access to logs, then pull to refresh."
    />
  );
}

/** Nothing in the window: suggests a wider range, or says the search found nothing. */
export function NoLogsState({
  noun,
  range,
  search,
  onWiden,
}: {
  noun: string;
  range: LogRangeKey;
  search?: string;
  onWiden?: (range: LogRangeKey) => void;
}) {
  const label = logRangePreset(range).label.toLowerCase();
  if (search?.trim()) {
    return (
      <EmptyState
        title={`No ${noun} match “${search.trim()}”`}
        description={`Only the ${label} are searched. Try a longer time range.`}
      />
    );
  }
  const wider = range === '24h' ? undefined : '24h';
  return (
    <EmptyState
      title={`No ${noun} in the ${label}`}
      description={wider ? 'Try a longer time range.' : 'Nothing was logged in the last day.'}
      action={
        wider && onWiden ? (
          <Button type="secondary" theme="outline" size="small" onPress={() => onWiden(wider)}>
            Show the last 24 hours
          </Button>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, minHeight: 24 },
});
