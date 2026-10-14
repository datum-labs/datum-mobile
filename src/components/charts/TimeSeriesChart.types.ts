import type { MetricPoint } from '@/lib/metrics';

export type TimeSeriesChartProps = {
  points: readonly MetricPoint[];
  /** Window end (unix seconds), pinned to the right edge. */
  end: number;
  color: string;
  height: number;
  type?: 'area' | 'line';
  /** Full chart: time labels underneath (and, on Android, a value axis and grid). */
  timeAxis?: boolean;
  /**
   * Formats the value-axis labels. Android only (Swift Charts' axes are hidden
   * on iOS); defaults to a short number ("1.2K").
   */
  formatValue?: (value: number) => string;
};

export type CategoryBarChartProps = {
  bars: readonly { label: string; value: number; color: string }[];
  height: number;
};
