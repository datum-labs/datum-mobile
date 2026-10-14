// Android: the iOS Swift Charts marks (TimeSeriesChart.tsx) redrawn with
// react-native-svg, with Material-style 1dp grid lines in the theme border
// colour and a value axis on the trailing edge for full charts.

import { Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { withAlpha } from '@datum-cloud/datum-ui-tokens';
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { axisTimeLabel, barGeometry, compactAxisNumber, seriesGeometry, timeAxisTicks } from './scale';
import type { CategoryBarChartProps, TimeSeriesChartProps } from './TimeSeriesChart.types';

const GRID_WIDTH = 1;
const BAR_RADIUS = 4;
const MAX_BAR_WIDTH = 56;
const LABEL_GAP = 4;

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e) => setWidth(Math.round(e.nativeEvent.layout.width))];
}

function GridLine({ y, width, color }: { y: number; width: number; color: string }) {
  return <Line x1={0} x2={width} y1={y} y2={y} stroke={color} strokeWidth={GRID_WIDTH} />;
}

/** Value labels down the trailing edge, spaced to sit on evenly spaced grid lines. */
function ValueAxis({ labels, height }: { labels: readonly string[]; height: number }) {
  return (
    <View style={[styles.valueAxis, { height }]}>
      {labels.map((label, i) => (
        <Text key={i} size="2xs" tone="muted" numberOfLines={1} style={styles.valueLabel}>
          {label}
        </Text>
      ))}
    </View>
  );
}

/**
 * One series over time, as an area with a line on top (or a line alone).
 * `end` (unix seconds) is the window end, pinned to the right edge; the left
 * edge is the first sample. With `timeAxis` it's a full chart: the first,
 * middle and end times underneath, grid lines at zero and the top of the
 * value domain, and their values on the trailing edge. Without it, a bare
 * sparkline.
 */
export function TimeSeriesChart({
  points,
  end,
  color,
  height,
  type = 'area',
  timeAxis = false,
  formatValue = compactAxisNumber,
}: TimeSeriesChartProps) {
  const t = useDatumTheme();
  const [width, onLayout] = useWidth();
  const strokeWidth = timeAxis ? 2 : 1.5;
  const first = points[0]?.t ?? end;
  const span = end - first;
  const hasData = points.length > 0;

  // Full charts inset the plot by half a label line so the grid lines run
  // through the middle of their labels; sparklines just keep the stroke in.
  const inset = timeAxis ? t.typography.sizes['2xs'].lineHeight / 2 : strokeWidth / 2;
  const plot = {
    left: strokeWidth / 2,
    top: inset,
    width: Math.max(0, width - strokeWidth),
    height: Math.max(0, height - inset * 2),
  };
  const geo = seriesGeometry(points, end, plot, 4);
  const axisValues = timeAxis && hasData ? [geo.domain.max, geo.domain.min] : [];
  // An empty full chart still keeps its baseline over the time labels.
  const gridYs = hasData ? axisValues.map(geo.tickY) : timeAxis ? [plot.top + plot.height] : [];

  return (
    <View style={styles.row}>
      <View style={styles.plotColumn}>
        <View style={{ height }} onLayout={onLayout} pointerEvents="none">
          {width > 0 ? (
            <Svg width={width} height={height}>
              {gridYs.map((y, i) => (
                <GridLine key={i} y={y} width={width} color={t.colors.border} />
              ))}
              {type === 'area' && geo.area ? <Path d={geo.area} fill={withAlpha(color, 0.2)} /> : null}
              {geo.line ? (
                <Path
                  d={geo.line}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeWidth}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
              {geo.dot ? <Circle cx={geo.dot.x} cy={geo.dot.y} r={strokeWidth * 1.5} fill={color} /> : null}
            </Svg>
          ) : null}
        </View>
        {timeAxis ? (
          <View style={styles.timeAxis}>
            {timeAxisTicks(first, end).map((time, i) => (
              <Text
                key={i}
                size="2xs"
                tone="muted"
                numberOfLines={1}
                style={{ flex: 1, textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right' }}>
                {axisTimeLabel(time, span)}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      {axisValues.length > 0 ? <ValueAxis labels={axisValues.map(formatValue)} height={height} /> : null}
    </View>
  );
}

/**
 * Category bars (status classes, WAF outcomes), each in its own colour, with
 * the category names underneath and grid lines at round values labelled on
 * the trailing edge, as Swift Charts lays them out.
 */
export function CategoryBarChart({ bars, height }: CategoryBarChartProps) {
  const t = useDatumTheme();
  const [width, onLayout] = useWidth();
  const labelLine = t.typography.sizes['2xs'].lineHeight;
  const plotHeight = Math.max(0, height - labelLine - LABEL_GAP);
  const inset = labelLine / 2;
  const plot = { left: 0, top: inset, width, height: Math.max(0, plotHeight - inset * 2) };
  const geo = barGeometry(bars.map((b) => b.value), plot, { tickCount: 3, maxWidth: MAX_BAR_WIDTH });
  const ticksTopDown = [...geo.domain.ticks].reverse();

  return (
    <View style={[styles.row, { height }]}>
      <View style={[styles.plotColumn, { gap: LABEL_GAP }]}>
        <View style={{ height: plotHeight }} onLayout={onLayout} pointerEvents="none">
          {width > 0 ? (
            <Svg width={width} height={plotHeight}>
              {ticksTopDown.map((v) => (
                <GridLine key={v} y={geo.tickY(v)} width={width} color={t.colors.border} />
              ))}
              {geo.bars.map((bar, i) =>
                bar.height > 0 ? (
                  <Rect
                    key={bars[i].label}
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={bar.height}
                    rx={BAR_RADIUS}
                    ry={BAR_RADIUS}
                    fill={bars[i].color}
                  />
                ) : null
              )}
            </Svg>
          ) : null}
        </View>
        <View style={styles.categoryAxis}>
          {bars.map((bar) => (
            <Text key={bar.label} size="2xs" tone="muted" numberOfLines={1} style={styles.categoryLabel}>
              {bar.label}
            </Text>
          ))}
        </View>
      </View>
      <ValueAxis labels={ticksTopDown.map(compactAxisNumber)} height={plotHeight} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  plotColumn: { flex: 1, gap: 6 },
  timeAxis: { flexDirection: 'row' },
  valueAxis: { justifyContent: 'space-between' },
  valueLabel: { textAlign: 'right' },
  categoryAxis: { flexDirection: 'row' },
  categoryLabel: { flex: 1, textAlign: 'center' },
});
