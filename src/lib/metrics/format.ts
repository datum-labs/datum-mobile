// Value formatters. The ALB ones port cloud-portal app/modules/prometheus/formatter.ts
// `formatValue` (a7010d0e); cores and bytes port compute ui/consumer/src/lib/resource-usage.ts
// (285fb19d). Tests pin them against output from the originals.

/** Portal `requestsPerSecond`: "12.50 req/s". */
export function formatRps(value: number, precision = 2): string {
  return `${value.toFixed(precision)} req/s`;
}

/** Portal `percent`: a 0–1 ratio as "1.23%". */
export function formatPercent(ratio: number, precision = 2): string {
  return `${(ratio * 100).toFixed(precision)}%`;
}

/** Portal `milliseconds-auto`: "13ms", or "2.35s" from a second up. */
export function formatMs(value: number, precision = 2): string {
  if (value >= 1000) return `${(value / 1000).toFixed(precision)}s`;
  return `${value.toFixed(0)}ms`;
}

/** Portal `short-number`: "999", "1.2K", "3M". */
export function formatShortNumber(num: number, precision = 2): string {
  if (num === null || Number.isNaN(num)) return 'N/A';
  if (num === 0) return '0';
  const tier = Math.floor(Math.log10(Math.abs(num)) / 3);
  if (tier <= 0) {
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: precision });
  }
  const suffix = ['', 'K', 'M', 'G', 'T', 'P', 'E'][Math.min(tier, 6)];
  return `${(num / Math.pow(10, Math.min(tier, 6) * 3)).toFixed(precision)}${suffix}`;
}

/** Whole requests or events: "4,104". */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

/** Compute `formatBytes` (binary steps, decimal-looking units): "19 MB", "3.0 GB". */
export function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function trimmedFixed(n: number, decimals: number): string {
  const fixed = n.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/**
 * Compute `formatCores(value, false)`: a plain decimal to hundredths ("0.12",
 * "1.5"), "<0.01" for a non-zero sliver, never SI-prefixed.
 */
export function formatCores(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const n = Math.abs(value);
  if (n < 1e-9) return '0';
  const sign = value < 0 ? '-' : '';
  if (n >= 100) return `${sign}${n.toFixed(0)}`;
  const rounded = trimmedFixed(n, 2);
  return rounded === '0' ? '<0.01' : `${sign}${rounded}`;
}

/**
 * Split "12.50 req/s" into "12.50" and "req/s" (or "13ms" into "13" and
 * "ms") so a tile can set the unit smaller than the number.
 */
export function splitUnit(formatted: string): { value: string; unit: string } {
  const match = formatted.match(/^([<\-]?[\d.,]+)\s?(.*)$/);
  return match ? { value: match[1], unit: match[2] } : { value: formatted, unit: '' };
}
