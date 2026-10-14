import { Skeleton, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { MetricRangeControl } from '@/hooks/useMetricRange';
import { metricRangePreset, splitUnit, type MetricPoint } from '@/lib/metrics';

import { TimeSeriesChart } from './charts/TimeSeriesChart';
import { Notice } from './Notice';
import { useToolbarIcon } from '@/lib/icons/toolbar';

// The charts are platform-split: Swift Charts on iOS, react-native-svg on Android.
export { axisTimeLabel } from './charts/scale';
export { CategoryBarChart, TimeSeriesChart } from './charts/TimeSeriesChart';
export type { CategoryBarChartProps, TimeSeriesChartProps } from './charts/TimeSeriesChart.types';

/**
 * Header time-range menu for a metrics screen (the same native toolbar menu
 * the log screens use).
 */
export function MetricRangeMenu({ control, hidden }: { control: MetricRangeControl; hidden?: boolean }) {
  const toolbarIcon = useToolbarIcon();
  const { range, setRange, allowed } = control;
  if (hidden) return null;
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon={toolbarIcon('clock')} accessibilityLabel="Time range" title="Time range">
        {allowed.map((key) => (
          <Stack.Toolbar.MenuAction key={key} isOn={key === range} onPress={() => setRange(key)}>
            {metricRangePreset(key).label}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

/** Shown instead of charts when there's no metrics backend for this user or build. */
export function MetricsUnavailableNotice() {
  return (
    <Notice
      kind="info"
      title="Metrics aren't available for your account yet"
      description="Charts for this resource will show up here once they are."
    />
  );
}

/** Neutral grouped surface for one chart, like an inset table cell. */
export function MetricCard({
  title,
  caption,
  children,
  testID,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
  testID?: string;
}) {
  const t = useDatumTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      testID={testID}
      style={[styles.card, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder }]}>
      <View style={styles.cardHead}>
        <Text size="sm" weight="semibold" style={{ flex: 1 }}>
          {title}
        </Text>
        {caption ? (
          <Text size="xs" tone="muted">
            {caption}
          </Text>
        ) : null}
      </View>
      {children}
    </Animated.View>
  );
}

/** A number with its unit set smaller: "12.50 req/s", "13 ms". */
export function MetricValue({ text, size = 'lg' }: { text: string; size?: 'lg' | 'md' }) {
  const { value, unit } = splitUnit(text);
  return (
    <Text
      size={size === 'lg' ? '2xl' : 'lg'}
      weight="semibold"
      numberOfLines={1}
      adjustsFontSizeToFit>
      {value}
      {unit ? (
        <Text size={size === 'lg' ? 'sm' : 'xs'} weight="medium" tone="muted">
          {` ${unit}`}
        </Text>
      ) : null}
    </Text>
  );
}

/** A headline KPI with an optional sparkline, half the width of the screen. */
export function KpiTile({
  label,
  value,
  points,
  color,
  loading,
  footnote,
  end,
}: {
  label: string;
  /** Window end (unix seconds), so sparklines line up with each other. */
  end?: number;
  /** Muted line in place of a sparkline. */
  footnote?: string;
  /** Formatted; undefined reads as "—". */
  value?: string;
  points?: readonly MetricPoint[];
  color: string;
  loading?: boolean;
}) {
  const t = useDatumTheme();
  return (
    <View style={styles.tileCell}>
      <View
        style={[styles.tile, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder }]}
        accessible
        accessibilityLabel={`${label}: ${value ?? 'no data'}`}>
        <Text size="xs" weight="medium" tone="muted" numberOfLines={1}>
          {label}
        </Text>
        {loading ? <Skeleton width={72} height={28} radius={6} /> : <MetricValue text={value ?? '—'} />}
        <View style={styles.sparkSlot}>
          {loading ? null : footnote ? (
            <Text size="xs" tone="muted" numberOfLines={2}>
              {footnote}
            </Text>
          ) : points && points.length > 1 ? (
            <TimeSeriesChart points={points} end={end ?? points[points.length - 1].t} color={color} height={SPARK_HEIGHT} />
          ) : points ? (
            <View style={[styles.baseline, { backgroundColor: t.colors.border }]} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const SPARK_HEIGHT = 34;

/** A row of labelled values under a chart: "p50 12 ms · p95 640 ms · p99 1.2 s". */
export function MetricLegend({
  items,
}: {
  items: readonly { label: string; value: string; color?: string }[];
}) {
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={styles.legendLabel}>
            {item.color ? <View style={[styles.dot, { backgroundColor: item.color }]} /> : null}
            <Text size="xs" tone="muted" numberOfLines={1}>
              {item.label}
            </Text>
          </View>
          <MetricValue text={item.value} size="md" />
        </View>
      ))}
    </View>
  );
}

/** Placeholder shaped like a chart card while the first fetch runs. */
export function MetricCardSkeleton({ height = 160 }: { height?: number }) {
  const t = useDatumTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder }]}
      accessibilityLabel="Loading">
      <Skeleton width="35%" height={14} />
      <Skeleton width="100%" height={height} radius={8} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -5 },
  tileCell: { width: '50%', padding: 5 },
  tile: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 6,
  },
  sparkSlot: { height: SPARK_HEIGHT, justifyContent: 'center' },
  baseline: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  legend: { flexDirection: 'row', gap: 12 },
  legendItem: { flex: 1, gap: 2 },
  legendLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
