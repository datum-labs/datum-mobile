// Pure chart geometry shared by the platform chart components. iOS hands the
// data to Swift Charts and only uses `axisTimeLabel`; Android draws with
// react-native-svg from the scales and paths here.

import { formatShortNumber, type MetricPoint } from '@/lib/metrics';

/** `formatShortNumber` without trailing zeros, for axis labels: "1.5K", "2K", "0.25". */
export function compactAxisNumber(value: number): string {
  return formatShortNumber(value, 2)
    .replace(/(\.\d*?)0+([A-Z]?)$/, '$1$2')
    .replace(/\.([A-Z]?)$/, '$1');
}

/** "18:05", or "Mon 18:05" past 12 hours, where the clock alone would repeat. */
export function axisTimeLabel(t: number, spanSeconds: number): string {
  const d = new Date(t * 1000);
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return spanSeconds > 12 * 3600 ? `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${clock}` : clock;
}

/** The first, middle and end times of a window, as the time axis labels them. */
export function timeAxisTicks(first: number, end: number): [number, number, number] {
  return [first, first + (end - first) / 2, end];
}

/** Round off float noise (0.1 + 0.2) so tick values format cleanly. */
function clean(n: number): number {
  return Number(n.toPrecision(12));
}

/** A 1, 2 or 5 × 10ⁿ step that splits `span` into about `count` intervals. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !(count > 0)) return 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / magnitude;
  const factor = ratio >= Math.sqrt(50) ? 10 : ratio >= Math.sqrt(10) ? 5 : ratio >= Math.sqrt(2) ? 2 : 1;
  return factor * magnitude;
}

export type NiceDomain = { min: number; max: number; ticks: number[] };

/**
 * A value domain like Swift Charts' automatic one: it always includes zero,
 * and its ends are rounded out to a 1/2/5 step, so a series' peak sits a
 * little under the top. No finite values (or all zero) gives 0–1.
 */
export function niceDomain(values: readonly number[], count = 3): NiceDomain {
  let lo = 0;
  let hi = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) hi = lo + 1;
  const step = niceStep(hi - lo, count);
  const min = clean(Math.floor(lo / step) * step);
  const max = clean(Math.ceil(hi / step) * step);
  const ticks: number[] = [];
  const n = Math.round((max - min) / step);
  for (let i = 0; i <= n; i++) ticks.push(clean(min + i * step));
  return { min, max, ticks };
}

/** Map [d0, d1] onto [r0, r1]; a zero-width domain maps everything to r1. */
export function scaleLinear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (span === 0) return () => r1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** The drawing area inside the SVG, in dp. */
export type PlotRect = { left: number; top: number; width: number; height: number };

export type SeriesGeometry = {
  /** SVG path for the line, or '' with fewer than two points. */
  line: string;
  /** SVG path for the area down to the zero line, or '' with fewer than two points. */
  area: string;
  /** The lone sample of a one-point series (Swift Charts draws nothing for it). */
  dot: { x: number; y: number } | null;
  /** The value domain and its tick values. */
  domain: NiceDomain;
  /** Value → y in the plot, for gridlines. */
  tickY: (v: number) => number;
};

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Geometry for one series, plotted the way the iOS chart plots it: x is
 * seconds before the window `end`, and the domain runs from the first sample
 * (or `end`, if a sample is later than it) to `end`, so the window end sits on
 * the right edge and a series that stopped reporting shows the gap. Samples
 * that aren't finite are skipped.
 */
export function seriesGeometry(
  points: readonly MetricPoint[],
  end: number,
  plot: PlotRect,
  tickCount = 3
): SeriesGeometry {
  const finite = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  const xs = finite.map((p) => p.t - end);
  const x0 = Math.min(0, ...xs);
  const x1 = Math.max(0, ...xs);
  const domain = niceDomain(finite.map((p) => p.v), tickCount);
  const sx = scaleLinear(x0, x1, plot.left, plot.left + plot.width);
  const sy = scaleLinear(domain.min, domain.max, plot.top + plot.height, plot.top);
  const coords = finite.map((p) => ({ x: sx(p.t - end), y: sy(p.v) }));

  if (coords.length < 2) {
    return { line: '', area: '', dot: coords[0] ?? null, domain, tickY: sy };
  }
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${fmt(c.x)},${fmt(c.y)}`).join('');
  const base = fmt(sy(0));
  const area = `${line}L${fmt(coords[coords.length - 1].x)},${base}L${fmt(coords[0].x)},${base}Z`;
  return { line, area, dot: null, domain, tickY: sy };
}

export type BarGeometry = { x: number; y: number; width: number; height: number; center: number };

/**
 * Evenly banded category bars from the zero line, with a nice value domain.
 * Each bar takes `fill` of its band, up to `maxWidth`; negative values hang
 * below zero, and values that aren't finite draw as zero.
 */
export function barGeometry(
  values: readonly number[],
  plot: PlotRect,
  { tickCount = 3, fill = 0.55, maxWidth = Infinity }: { tickCount?: number; fill?: number; maxWidth?: number } = {}
): { bars: BarGeometry[]; domain: NiceDomain; tickY: (v: number) => number } {
  const domain = niceDomain(values, tickCount);
  const sy = scaleLinear(domain.min, domain.max, plot.top + plot.height, plot.top);
  const band = values.length > 0 ? plot.width / values.length : 0;
  const width = Math.min(band * fill, maxWidth);
  const zero = sy(0);
  const bars = values.map((raw, i) => {
    const v = Number.isFinite(raw) ? raw : 0;
    const top = sy(v);
    const center = plot.left + band * (i + 0.5);
    return { x: center - width / 2, y: Math.min(top, zero), width, height: Math.abs(zero - top), center };
  });
  return { bars, domain, tickY: sy };
}
