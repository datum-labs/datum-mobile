import { Skeleton, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { withAlpha } from '@datum-cloud/datum-ui-tokens';
import { Chart, Host, ZStack, type ChartDataPoint } from '@expo/ui/swift-ui';
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { MetricRangeControl } from '@/hooks/useMetricRange';
import { metricRangePreset, splitUnit, type MetricPoint } from '@/lib/metrics';

import { Notice } from './Notice';

/**
 * Header time-range menu for a metrics screen (the same native toolbar menu
 * the log screens use).
 */
export function MetricRangeMenu({ control, hidden }: { control: MetricRangeControl; hidden?: boolean }) {
  const { range, setRange, allowed } = control;
  if (hidden) return null;
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="clock" accessibilityLabel="Time range" title="Time range">
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
  start,
}: {
  label: string;
  /** Window start (unix seconds), so sparklines line up with each other. */
  start?: number;
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
            <TimeSeriesChart points={points} start={start ?? points[0].t} color={color} height={SPARK_HEIGHT} />
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

/**
 * Swift Charts' automatic x scale includes zero, so raw unix seconds squash a
 * series against the right edge, and clock-time category labels collide
 * (VictoriaMetrics doesn't always align samples to the step, so the first
 * and last hourly samples of a day can share "18:13"). Points are plotted as
 * seconds since the window start instead, which puts the window start on the
 * left edge, and the time labels are drawn underneath in React Native.
 */
function toChartData(points: readonly MetricPoint[], start: number): ChartDataPoint[] {
  return points.map((p) => ({ x: p.t - start, y: p.v }));
}

/** "18:05", or "Mon 18:05" when the window spans days. */
export function axisTimeLabel(t: number, spanSeconds: number): string {
  const d = new Date(t * 1000);
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return spanSeconds > 36 * 3600 ? `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${clock}` : clock;
}

/**
 * One series over time in Swift Charts, as an area with a line on top (or a
 * line alone). `start` (unix seconds) is the window start, pinned to the left
 * edge. With `timeAxis`, start, middle and last-sample times sit underneath.
 */
export function TimeSeriesChart({
  points,
  start,
  color,
  height,
  type = 'area',
  timeAxis = false,
}: {
  points: readonly MetricPoint[];
  start: number;
  color: string;
  height: number;
  type?: 'area' | 'line';
  timeAxis?: boolean;
}) {
  const t = useDatumTheme();
  const data = toChartData(points, start);
  const end = points[points.length - 1]?.t ?? start;
  const span = end - start;
  return (
    <View style={{ gap: 6, alignSelf: 'stretch' }}>
      <Host style={{ height, alignSelf: 'stretch' }} pointerEvents="none">
        <ZStack>
          {type === 'area' ? (
            <Chart type="area" data={data} showGrid={false} animate={false} areaStyle={{ color: withAlpha(color, 0.2) }} />
          ) : null}
          <Chart
            type="line"
            data={data}
            showGrid={false}
            animate={false}
            lineStyle={{ color, width: timeAxis ? 2 : 1.5, pointSize: 0 }}
          />
        </ZStack>
      </Host>
      {timeAxis ? (
        <View style={[styles.timeAxis, { borderTopColor: t.colors.border }]}>
          {[start, start + span / 2, end].map((time, i) => (
            <Text
              key={i}
              size="2xs"
              tone="muted"
              style={{ flex: 1, textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right' }}>
              {axisTimeLabel(time, span)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Category bars (status classes, WAF outcomes), each in its own colour. */
export function CategoryBarChart({
  bars,
  height,
}: {
  bars: readonly { label: string; value: number; color: string }[];
  height: number;
}) {
  return (
    <Host style={{ height, alignSelf: 'stretch' }} pointerEvents="none">
      <Chart
        type="bar"
        data={bars.map((bar) => ({ x: bar.label, y: bar.value, color: bar.color }))}
        showGrid
        animate={false}
        barStyle={{ cornerRadius: 4 }}
      />
    </Host>
  );
}

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
  timeAxis: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
});
