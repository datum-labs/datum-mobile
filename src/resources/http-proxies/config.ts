/**
 * Read-only views of an HTTPProxy's configuration, ported from the cloud
 * portal's ALB pages (app/features/edge/proxy/{overview,backends}/ and
 * app/resources/http-proxies/owasp-crs-catalog.ts) so the app shows the same
 * values with the same words.
 */
import type { RawHttpProxy, RawTrafficProtectionPolicy } from '@/api/types';
import {
  getBlockedHostnames,
  getHttpProxyStatus,
  isHeldBackByCustomHostnames,
  type HostnameStatusLike,
} from '@/lib/status/http-proxy-conditions';
import { ControlPlaneStatus } from '@/lib/status/types';

import type { HttpProxy, HttpProxyBackend } from './model';

type Spec = NonNullable<RawHttpProxy['spec']>;
type Rule = NonNullable<Spec['rules']>[number];
type Filter = NonNullable<Rule['filters']>[number];
type HeaderSet = { name?: string; value?: string }[];

function backendRule(raw: RawHttpProxy): Rule | undefined {
  return raw.spec?.rules?.find((rule) => rule.backends && rule.backends.length > 0);
}

function headerSet(filters: Filter[] | undefined, kind: 'requestHeaderModifier' | 'responseHeaderModifier'): HeaderSet {
  return (filters ?? []).flatMap(
    (filter) => ((filter as unknown as Record<string, { set?: HeaderSet } | undefined>)[kind]?.set ?? []) as HeaderSet
  );
}

// --- Access & TLS -----------------------------------------------------------

/** Backend rule `requestHeaderModifier.set[host]` (portal config-card "Host header override"). */
export function hostHeaderOverride(raw: RawHttpProxy): string | undefined {
  const entry = headerSet(backendRule(raw)?.filters, 'requestHeaderModifier').find(
    (header) => header.name?.toLowerCase() === 'host'
  );
  return entry?.value || undefined;
}

/** Backend rule sets a Strict-Transport-Security response header (portal tls-card: on/off only). */
export function hstsEnabled(raw: RawHttpProxy): boolean {
  return headerSet(backendRule(raw)?.filters, 'responseHeaderModifier').some(
    (header) => header.name?.toLowerCase() === 'strict-transport-security'
  );
}

export type OriginTls =
  | { kind: 'override'; hostname: string }
  | { kind: 'fromOrigin'; hostname?: string }
  | { kind: 'perBackend' }
  | { kind: 'connector' };

/** "Origin TLS hostname" (SNI), as the portal's tls-card words it. */
export function originTls(backends: HttpProxyBackend[]): OriginTls | undefined {
  if (backends.length === 0) return undefined;
  if (backends.length > 1) return { kind: 'perBackend' };
  const [only] = backends;
  if (only.tlsHostname) return { kind: 'override', hostname: only.tlsHostname };
  if (only.kind === 'connector') return { kind: 'connector' };
  let hostname: string | undefined;
  try {
    hostname = only.endpoint ? new URL(only.endpoint).hostname : undefined;
  } catch {
    hostname = undefined;
  }
  return { kind: 'fromOrigin', hostname };
}

// --- Backend pool -----------------------------------------------------------

export interface PoolRow {
  backend: HttpProxyBackend;
  weight: number;
  /** Share of traffic, e.g. "50%", "<1%", or "Drained" at weight 0. */
  share: string;
  transport: string;
}

/** Largest-remainder rounding to 100%, "<1%" for small non-zero shares (portal backend-pool `shareLabels`). */
export function shareLabels(weights: number[]): string[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return weights.map(() => 'Drained');
  const exact = weights.map((w) => (w / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, v) => sum + v, 0);
  const order = exact
    .map((value, i) => ({ i, rem: value - Math.floor(value) }))
    .sort((a, b) => b.rem - a.rem);
  const rounded = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    if (weights[i] > 0) {
      rounded[i] += 1;
      left -= 1;
    }
  }
  return weights.map((w, i) => (w === 0 ? 'Drained' : rounded[i] < 1 ? '<1%' : `${rounded[i]}%`));
}

function transportOf(backend: HttpProxyBackend): string {
  if (backend.kind === 'connector') return 'Galactic VPC';
  if (backend.tlsHostname) return `SNI · ${backend.tlsHostname}`;
  if (backend.endpoint?.startsWith('https://')) return 'HTTPS';
  if (backend.endpoint?.startsWith('http://')) return 'HTTP';
  if (backend.kind === 'instance' || backend.kind === 'networkService') return 'Datum compute';
  return 'IP origin';
}

export function poolRows(backends: HttpProxyBackend[]): PoolRow[] {
  const weights = backends.map((b) => b.weight ?? 1);
  const shares = shareLabels(weights);
  return backends.map((backend, i) => ({
    backend,
    weight: weights[i],
    share: shares[i],
    transport: transportOf(backend),
  }));
}

const ALGORITHMS: Record<string, string> = {
  RoundRobin: 'Round robin',
  LeastRequest: 'Least request',
  Random: 'Random',
  ConsistentHash: 'Consistent hash',
};

/** `spec.loadBalancer.type`, default LeastRequest; consistent hash names its key. */
export function loadBalancingLabel(raw: RawHttpProxy): string {
  const lb = raw.spec?.loadBalancer as
    | { type?: string; consistentHash?: { type?: string; header?: { name?: string } | string } }
    | undefined;
  const type = lb?.type ?? 'LeastRequest';
  if (type !== 'ConsistentHash') return ALGORITHMS[type] ?? type;
  const hash = lb?.consistentHash;
  if (hash?.type === 'Header') {
    const header = typeof hash.header === 'string' ? hash.header : hash.header?.name;
    return `Consistent hash · ${header ?? 'header'}`;
  }
  return 'Consistent hash · IP';
}

export interface HealthCheckView {
  enabled: boolean;
  consecutive5xxErrors: number;
  baseEjectionTime: string;
  maxEjectionPercent: number;
}

/** Passive health checks (outlier detection), with the portal's defaults. */
export function healthCheckView(raw: RawHttpProxy): HealthCheckView {
  const passive = (raw.spec?.healthCheck as
    | { passive?: { consecutive5xxErrors?: number; baseEjectionTime?: string; maxEjectionPercent?: number } }
    | undefined)?.passive;
  return {
    enabled: !!raw.spec?.healthCheck,
    consecutive5xxErrors: passive?.consecutive5xxErrors ?? 5,
    baseEjectionTime: passive?.baseEjectionTime ?? '30s',
    maxEjectionPercent: passive?.maxEjectionPercent ?? 50,
  };
}

/** "30s" → "30 seconds", "2m" → "2 minutes" (Go durations as the API returns them). */
export function durationLabel(value: string): string {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value.trim());
  if (!match) return value;
  const n = Number(match[1]);
  const unit = { ms: 'millisecond', s: 'second', m: 'minute', h: 'hour' }[match[2] as 'ms' | 's' | 'm' | 'h'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

// --- General ----------------------------------------------------------------

/**
 * Most recent write to spec or metadata: the newest managedFields time,
 * ignoring status (portal general-card `extractUpdatedAt`).
 */
export function lastUpdatedAt(raw: RawHttpProxy): string | undefined {
  const times = (raw.metadata?.managedFields ?? [])
    .filter((entry) => entry.subresource !== 'status' && entry.time)
    .map((entry) => String(entry.time));
  return times.sort().at(-1);
}

/** Rich-text note content as plain text for the phone. */
export function noteText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- WAF rule categories ----------------------------------------------------

export interface WafCategory {
  id: string;
  label: string;
  description: string;
  tags: readonly string[];
}

/** User-facing OWASP CRS attack categories (portal owasp-crs-catalog.ts). */
export const OWASP_CRS_CATEGORIES: readonly WafCategory[] = [
  { id: 'sqli', label: 'SQL injection', description: 'Detects SQL injection in query parameters, headers, and bodies.', tags: ['attack-sqli'] },
  { id: 'xss', label: 'Cross-site scripting', description: 'Detects XSS payloads, including script tags and JavaScript URIs.', tags: ['attack-xss'] },
  { id: 'rce', label: 'Command injection', description: 'Detects Unix and Windows command injection attempts.', tags: ['attack-rce'] },
  { id: 'lfi', label: 'Path traversal', description: 'Detects local file inclusion and path-traversal attacks.', tags: ['attack-lfi'] },
  { id: 'rfi', label: 'Remote file inclusion', description: 'Detects attempts to include remote files into the application.', tags: ['attack-rfi'] },
  { id: 'php', label: 'PHP injection', description: 'Detects PHP code injection and PHP-specific attack patterns.', tags: ['attack-injection-php'] },
  { id: 'java', label: 'Java attacks', description: 'Detects Java-specific injection and deserialization attacks.', tags: ['attack-java'] },
  { id: 'session', label: 'Session fixation', description: 'Detects session-fixation and session-hijacking patterns.', tags: ['attack-session-fixation'] },
  { id: 'protocol', label: 'HTTP protocol attacks', description: 'Detects HTTP smuggling, encoding abuse, and invalid protocol use.', tags: ['attack-protocol'] },
  { id: 'scanner', label: 'Scanner detection', description: 'Detects known security scanners and probing tools.', tags: ['attack-reputation-scanner'] },
];

/** The policy's excluded CRS tags (`ruleSets[OWASPCoreRuleSet].owaspCoreRuleSet.ruleExclusions.tags`). */
export function excludedTags(policy: RawTrafficProtectionPolicy | undefined): string[] {
  const ruleSets = (policy?.spec as { ruleSets?: { type?: string; owaspCoreRuleSet?: { ruleExclusions?: { tags?: string[] } } }[] } | undefined)
    ?.ruleSets;
  const owasp = ruleSets?.find((set) => set.type === 'OWASPCoreRuleSet')?.owaspCoreRuleSet;
  return owasp?.ruleExclusions?.tags ?? [];
}

export interface WafCategoriesView {
  enabled: WafCategory[];
  excluded: WafCategory[];
  /** "10 of 10 categories", "8 of 10 categories · 2 excluded" */
  summary: string;
}

export function wafCategoriesView(tags: readonly string[]): WafCategoriesView {
  const excluded = OWASP_CRS_CATEGORIES.filter((category) => category.tags.some((tag) => tags.includes(tag)));
  const enabled = OWASP_CRS_CATEGORIES.filter((category) => !excluded.includes(category));
  const total = OWASP_CRS_CATEGORIES.length;
  return {
    enabled,
    excluded,
    summary: `${enabled.length} of ${total} categories${excluded.length > 0 ? ` · ${excluded.length} excluded` : ''}`,
  };
}

// --- Health summary ---------------------------------------------------------

export interface AlbHealth {
  tone: 'success' | 'warning' | 'error' | 'info';
  title: string;
  detail: string;
  /** Support reference while the operator retries an internal error. */
  retryRef?: string;
  busy?: boolean;
}

/**
 * The portal's ALB health strip headline (overview/health-strip.tsx), minus
 * the traffic-presence case, which needs metrics.
 */
export function albHealth(proxy: HttpProxy, options: { workloadMissing?: boolean } = {}): AlbHealth {
  const status = getHttpProxyStatus(proxy.status);
  const hostnameCount = proxy.hostnames.length;
  if (status.status === ControlPlaneStatus.Success) {
    if (options.workloadMissing && proxy.workloadName) {
      return {
        tone: 'warning',
        title: 'No backend available',
        detail: `Workload ${proxy.workloadName} was deleted. Redeploy it to reconnect.`,
      };
    }
    const count = proxy.backends.length;
    return {
      tone: 'success',
      title: 'Serving traffic normally',
      detail: [
        `${count} ${count === 1 ? 'backend' : 'backends'}`,
        `${hostnameCount} custom ${hostnameCount === 1 ? 'hostname' : 'hostnames'}`,
      ].join(' · '),
    };
  }
  if (status.status === ControlPlaneStatus.Error) {
    return {
      tone: 'error',
      title: 'Configuration failed to program',
      detail: status.message || 'The load balancer reported an error while programming.',
    };
  }
  const retryRef = (status as { retryRef?: string }).retryRef;
  if (retryRef) {
    return {
      tone: 'warning',
      title: 'Retrying after an internal error',
      detail: "Datum retries automatically. If it doesn't clear, send support this reference.",
      retryRef,
      busy: true,
    };
  }
  const blockedInput = {
    hostnames: proxy.hostnames,
    hostnameStatuses: proxy.hostnameStatuses as HostnameStatusLike[],
    status: proxy.status,
  };
  const { wildcardsNotEnabled, ownershipBlocked, awaitingDns } = getBlockedHostnames(blockedInput);
  if (awaitingDns.length > 0 && wildcardsNotEnabled.length + ownershipBlocked.length === 0) {
    return {
      tone: 'warning',
      title:
        awaitingDns.length === 1
          ? 'Add a DNS record to finish setting up a hostname'
          : 'Add DNS records to finish setting up your hostnames',
      detail: `The certificate for ${awaitingDns.join(', ')} is issued once its record is in place.${
        isHeldBackByCustomHostnames(blockedInput) ? ' The default hostname is already serving.' : ''
      }`,
    };
  }
  if (wildcardsNotEnabled.length > 0 && ownershipBlocked.length === 0) {
    return {
      tone: 'warning',
      title: "Wildcard hostnames aren't enabled for this project",
      detail: `No certificate is issued for ${wildcardsNotEnabled.join(', ')} until Datum enables wildcards. You can also use an exact hostname.`,
    };
  }
  const blocked = [...ownershipBlocked, ...wildcardsNotEnabled, ...awaitingDns];
  if (blocked.length > 0) {
    return {
      tone: 'warning',
      title: blocked.length === 1 ? 'A custom hostname needs your attention' : `${blocked.length} custom hostnames need your attention`,
      detail: `${blocked.join(', ')} can't be served yet.`,
    };
  }
  return {
    tone: 'info',
    title: 'Programming edge configuration',
    detail: status.message || 'Hostnames, DNS, and certificates are being provisioned.',
    busy: true,
  };
}
