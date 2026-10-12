import type { RawHttpProxy, RawTrafficProtectionPolicy } from '@/api/types';
import type { HostnameStatusLike, HttpProxyStatusLike } from '@/lib/status/http-proxy-conditions';
import { isHttpProxyProvisioning } from '@/lib/status/http-proxy-provisioning';
import type { StatusView } from '@/lib/status/types';
import { httpProxyView } from '@/lib/status/views';
import { selectPolicyForProxy } from '@/lib/status/waf-attach';
import {
  getTrafficProtectionProgrammedMessage,
  getTrafficProtectionProgrammedReason,
  getWafProtectionState,
  isTrafficProtectionProgrammed,
  type TrafficProtectionMode,
  type WafProtectionState,
} from '@/lib/status/waf-status';

import { displayNameOf, toConditions, toMeta, type Condition, type ResourceMeta } from '../shared';

/** Label the compute controller stamps on an ALB it created for a workload. */
export const COMPUTE_WORKLOAD_NAME_LABEL = 'compute.datumapis.com/workload-name';

export interface HttpProxyBackend {
  kind: 'instance' | 'networkService' | 'connector' | 'endpoint';
  endpoint?: string;
  connector?: string;
  networkService?: { name?: string; port?: number };
  instance?: { name?: string; port?: number };
  tlsHostname?: string;
  weight?: number;
}

export interface HttpProxy extends ResourceMeta {
  displayName: string;
  hostnames: string[];
  canonicalHostname?: string;
  hostnameStatuses: HostnameStatusLike[];
  status: HttpProxyStatusLike;
  conditions: Condition[];
  view: ReturnType<typeof httpProxyView>;
  backends: HttpProxyBackend[];
  enableHttpRedirect: boolean;
  workloadName?: string;
  provisioning: boolean;
}

type RawBackend = NonNullable<
  NonNullable<NonNullable<RawHttpProxy['spec']>['rules']>[number]['backends']
>[number];

/** cloud-portal http-proxy.adapter.ts `toHttpProxyBackend` (without the raw passthrough). */
function toBackend(raw: RawBackend): HttpProxyBackend {
  const r = raw as RawBackend & {
    instance?: { name?: string; port?: number };
    networkService?: { name?: string; port?: number };
    connector?: { name?: string };
  };
  const kind: HttpProxyBackend['kind'] = r.instance
    ? 'instance'
    : r.networkService
      ? 'networkService'
      : r.connector
        ? 'connector'
        : 'endpoint';
  return {
    kind,
    endpoint: r.endpoint,
    connector: r.connector?.name,
    networkService: r.networkService,
    instance: r.instance,
    tlsHostname: (r as { tls?: { hostname?: string } }).tls?.hostname,
    weight: (r as { weight?: number }).weight,
  };
}

export function toHttpProxy(raw: RawHttpProxy): HttpProxy {
  const meta = toMeta(raw);
  const status = (raw.status ?? {}) as HttpProxyStatusLike & {
    canonicalHostname?: string;
    hostnameStatuses?: HostnameStatusLike[];
  };
  const backendRule = raw.spec?.rules?.find((rule) => rule.backends && rule.backends.length > 0);
  const hasRedirectRule = !!raw.spec?.rules?.some((rule) => {
    const noBackends = !rule.backends || rule.backends.length === 0;
    if (!noBackends || !rule.filters?.length) return false;
    return rule.filters.some((filter) => {
      const redirect = (filter as { requestRedirect?: { scheme?: string; statusCode?: number } })
        .requestRedirect;
      if (!redirect || redirect.scheme !== 'https') return false;
      const code = Number(redirect.statusCode);
      return code === 301 || code === 302;
    });
  });
  const hostnames = raw.spec?.hostnames ?? [];
  const hostnameStatuses = status.hostnameStatuses ?? [];
  return {
    ...meta,
    displayName: displayNameOf(meta),
    hostnames,
    canonicalHostname: status.canonicalHostname,
    hostnameStatuses,
    status,
    conditions: toConditions(status.conditions),
    view: httpProxyView(status),
    backends: (backendRule?.backends ?? []).map(toBackend),
    enableHttpRedirect: hasRedirectRule,
    workloadName: meta.labels[COMPUTE_WORKLOAD_NAME_LABEL],
    provisioning: isHttpProxyProvisioning({ status, hostnames, hostnameStatuses }),
  };
}

export function toHttpProxyList(items: RawHttpProxy[]): HttpProxy[] {
  return items
    .map(toHttpProxy)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** WAF view for one proxy, from the project's TrafficProtectionPolicies. */
export interface WafView {
  /** The TPP list was denied: show "no access" instead of "Disabled". */
  forbidden: boolean;
  mode?: TrafficProtectionMode;
  policyName?: string;
  state: WafProtectionState;
  message?: string;
  paranoia?: { blocking?: number; detection?: number };
}

function getMode(policy: RawTrafficProtectionPolicy | undefined): TrafficProtectionMode | undefined {
  const mode = policy?.spec?.mode;
  return mode === 'Observe' || mode === 'Enforce' || mode === 'Disabled' ? mode : undefined;
}

function getParanoia(policy: RawTrafficProtectionPolicy | undefined) {
  const owasp = policy?.spec?.ruleSets?.find((rs) => rs.type === 'OWASPCoreRuleSet')?.owaspCoreRuleSet;
  return owasp?.paranoiaLevels;
}

export function toWafView(
  policies: { items: RawTrafficProtectionPolicy[]; forbidden: boolean },
  proxyName: string
): WafView {
  if (policies.forbidden) return { forbidden: true, state: 'disabled' };
  const policy = selectPolicyForProxy(policies.items, proxyName);
  const mode = getMode(policy);
  const programmed = isTrafficProtectionProgrammed(policy?.status);
  const reason = getTrafficProtectionProgrammedReason(policy?.status);
  return {
    forbidden: false,
    mode,
    policyName: policy?.metadata?.name,
    state: getWafProtectionState(mode, programmed, reason),
    message: getTrafficProtectionProgrammedMessage(policy?.status),
    paranoia: getParanoia(policy),
  };
}

export function wafStatusView(waf: WafView | undefined): StatusView | undefined {
  if (!waf) return undefined;
  if (waf.forbidden) return { status: 'unknown', label: 'No access' };
  switch (waf.state) {
    case 'protected':
      return { status: 'success', label: 'Protected' };
    case 'monitoring':
      return { status: 'success', label: 'Monitoring' };
    case 'pending':
      return { status: 'pending', label: 'Pending', detail: waf.message };
    case 'error':
      return { status: 'error', label: 'Error', detail: waf.message };
    default:
      return { status: 'unknown', label: 'Disabled' };
  }
}
