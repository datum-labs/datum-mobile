// iOS (and the type base): Swift Charts via @expo/ui. Android resolves
// TimeSeriesChart.android.tsx instead, which draws the same marks with
// react-native-svg. Both take the props in TimeSeriesChart.types.ts.

import { Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { withAlpha } from '@datum-cloud/datum-ui-tokens';
import { Chart, Host, ZStack, type ChartDataPoint } from '@expo/ui/swift-ui';
import { StyleSheet, View } from 'react-native';

import type { MetricPoint } from '@/lib/metrics';

import { axisTimeLabel } from './scale';
import type { CategoryBarChartProps, TimeSeriesChartProps } from './TimeSeriesChart.types';

/**
 * Swift Charts' automatic x scale includes zero, so raw unix seconds squash a
 * series against the right edge, and clock-time category labels collide
 * (VictoriaMetrics doesn't always align samples to the step, so the first
 * and last hourly samples of a day can share "18:13"). Points are plotted as
 * seconds before the window end instead: zero pins the window end (now) to
 * the right edge, so a series that stopped reporting shows the gap. The time
 * labels are drawn underneath in React Native.
 */
function toChartData(points: readonly MetricPoint[], end: number): ChartDataPoint[] {
  return points.map((p) => ({ x: p.t - end, y: p.v }));
}

/**
 * One series over time in Swift Charts, as an area with a line on top (or a
 * line alone). `end` (unix seconds) is the window end, pinned to the right
 * edge; the left edge is the first sample. With `timeAxis`, the first,
 * middle and end times sit underneath.
 */
export function TimeSeriesChart({
  points,
  end,
  color,
  height,
  type = 'area',
  timeAxis = false,
}: TimeSeriesChartProps) {
  const t = useDatumTheme();
  const data = toChartData(points, end);
  const first = points[0]?.t ?? end;
  const span = end - first;
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
          {[first, first + span / 2, end].map((time, i) => (
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
export function CategoryBarChart({ bars, height }: CategoryBarChartProps) {
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

const styles = StyleSheet.create({
  timeAxis: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
});
