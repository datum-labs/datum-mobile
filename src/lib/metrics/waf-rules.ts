// Ported from cloud-portal app/features/edge/proxy/metrics/waf-top-rules.tsx: the rule names,
// the category parsed from the CRS file, and the merge of per-label slices into one row per rule.
import { toMetricSeries, type MetricSeries, type PromResponse } from './prometheus';

/** Names for the OWASP CRS rules the portal knows; anything else reads "Rule <id>". */
export const OWASP_RULE_NAMES: Record<string, string> = {
  '200002': 'Failed to parse request body',
  '920180': 'POST without Content-Length or Transfer-Encoding',
  '930100': 'Path Traversal Attack',
  '930110': 'Path Traversal: Double-Encoded',
  '920350': 'Host Header is Numeric IP',
  '920440': 'URL File Extension Restricted',
  '921110': 'HTTP Request Smuggling',
  '932100': 'Remote Command Execution: Unix',
  '932110': 'Remote Command Execution: Windows',
  '932235': 'Remote Command Execution: Unix Shell',
  '933100': 'PHP Injection',
  '934100': 'Node.js Injection',
  '941100': 'XSS Attack via libinjection',
  '941110': 'XSS: Script Tag',
  '941160': 'XSS: JavaScript URI',
  '942100': 'SQL Injection via libinjection',
  '942151': 'SQL Injection',
  '942200': 'SQL Injection: MySQL Comment',
  '942260': 'SQL Injection: Basic Authentication Bypass',
  '942370': 'SQL Injection: Benchmark/Sleep',
  '942550': 'SQL Injection: MySQL',
  '949110': 'Inbound Anomaly Score Exceeded',
  '949111': 'Inbound Anomaly Score Exceeded (Early Blocking)',
  '959100': 'Outbound Anomaly Score Exceeded',
};

export interface WafRuleRow {
  ruleId: string;
  name: string;
  /** From the CRS file name ("Sqli", "Protocol Enforcement"); null when the series has no file. */
  category: string | null;
  phases: string[];
  severities: string[];
  actions: string[];
  /** CRS version label, e.g. "OWASP_CRS/4.x". */
  version: string | null;
  events: number;
  /** Share of all rule events in the window (0–1). */
  share: number;
}

interface RuleSlice {
  ruleId: string;
  file: string | null;
  phase: string | null;
  severity: string | null;
  action: string | null;
  version: string | null;
  events: number;
}

function lastPositiveValue(series: MetricSeries): number {
  for (let i = series.points.length - 1; i >= 0; i--) {
    const value = series.points[i]?.v;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function cleanLabel(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function titleCaseWords(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** "REQUEST-942-APPLICATION-ATTACK-SQLI.conf" → "Sqli"; "@recommended…" → "Recommended". */
export function categoryFromFile(file: string | null): string | null {
  if (!file) return null;
  if (file.includes('recommended')) return 'Recommended';
  const match = file.match(/(?:REQUEST|RESPONSE)-\d+-([A-Z0-9-]+)/i);
  if (!match?.[1]) {
    return titleCaseWords(
      file
        .replace(/^@/, '')
        .replace(/\.conf$/i, '')
        .replace(/[_/]+/g, ' ')
    );
  }
  return titleCaseWords(match[1].replace(/^APPLICATION-ATTACK-/, ''));
}

function uniqueSorted(values: (string | null)[], eventsByValue: Map<string, number>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort(
    (a, b) => (eventsByValue.get(b) ?? 0) - (eventsByValue.get(a) ?? 0)
  );
}

function mergeRuleRows(slices: RuleSlice[], limit: number): WafRuleRow[] {
  const byRule = new Map<string, RuleSlice[]>();
  for (const slice of slices) {
    const group = byRule.get(slice.ruleId) ?? [];
    group.push(slice);
    byRule.set(slice.ruleId, group);
  }

  const rows = [...byRule.entries()].map(([ruleId, group]): WafRuleRow => {
    const count = (key: 'phase' | 'severity' | 'action') => {
      const totals = new Map<string, number>();
      for (const slice of group) {
        const value = slice[key];
        if (value) totals.set(value, (totals.get(value) ?? 0) + slice.events);
      }
      return totals;
    };
    return {
      ruleId,
      name: OWASP_RULE_NAMES[ruleId] ?? `Rule ${ruleId}`,
      category: categoryFromFile(group.find((slice) => slice.file)?.file ?? null),
      phases: uniqueSorted(
        group.map((slice) => slice.phase),
        count('phase')
      ).map(titleCaseWords),
      severities: uniqueSorted(
        group.map((slice) => slice.severity),
        count('severity')
      ),
      actions: uniqueSorted(
        group.map((slice) => slice.action),
        count('action')
      ),
      version: group.find((slice) => slice.version)?.version ?? null,
      events: group.reduce((sum, slice) => sum + slice.events, 0),
      share: 0,
    };
  });

  const total = rows.reduce((sum, row) => sum + row.events, 0);
  return rows
    .map((row) => ({ ...row, share: total > 0 ? row.events / total : 0 }))
    .sort((a, b) => b.events - a.events || a.ruleId.localeCompare(b.ruleId))
    .slice(0, limit);
}

/**
 * Rows for `albWafTopRulesQuery`: one per rule id, busiest first, at most
 * `limit` (the portal shows 10). The rule-less series (allowed traffic) and
 * rules with no events in the window are dropped.
 */
export function wafTopRulesView(response: PromResponse | undefined | null, limit = 10): WafRuleRow[] {
  const slices = toMetricSeries(response)
    .map(
      (series): RuleSlice => ({
        ruleId: series.labels.coraza_rule_id ?? '',
        file: cleanLabel(series.labels.coraza_rule_file),
        phase: cleanLabel(series.labels.coraza_interruption_phase),
        severity: cleanLabel(series.labels.coraza_rule_severity),
        action: cleanLabel(series.labels.coraza_rule_action),
        version: cleanLabel(series.labels.coraza_rule_version),
        events: Math.round(lastPositiveValue(series)),
      })
    )
    .filter((slice) => slice.ruleId !== '' && slice.events > 0);
  return mergeRuleRows(slices, limit);
}
