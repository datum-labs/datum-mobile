/**
 * Resource → badge mappings, matching the labels the portal shows for the
 * same resource (cloud-portal `components/badge/badge-status.tsx`, the ALB and
 * connector list columns, and `DOMAIN_VERIFICATION_STATUS`).
 */
import { albStatus, albStatusDisplay, type ConnectedAlb } from './alb-status';
import { transformControlPlaneStatus } from './control-plane';
import {
  getCertificatesReadyCondition,
  getCertificatesReadyDisplay,
  getHttpProxyStatus,
  type HttpProxyStatusLike,
} from './http-proxy-conditions';
import { ControlPlaneStatus, type BadgeStatus, type RawCondition, type StatusView } from './types';
import { deployStatus, instanceStatusLabel, statusLabel } from './workload';
import type { Instance, Workload } from '@/resources/compute/model';

type StatusLike = { conditions?: RawCondition[] | null } | null | undefined;

function toBadge(status: ControlPlaneStatus): BadgeStatus {
  switch (status) {
    case ControlPlaneStatus.Success:
      return 'success';
    case ControlPlaneStatus.Error:
      return 'error';
    default:
      return 'pending';
  }
}

/** Generic control-plane resource: Ready / Pending / Failed. */
export function controlPlaneView(
  status: StatusLike,
  labels: Partial<Record<ControlPlaneStatus, string>> = {}
): StatusView {
  const result = transformControlPlaneStatus(status ?? undefined);
  const fallback = { success: 'Ready', pending: 'Pending', error: 'Failed' } as const;
  return {
    status: toBadge(result.status),
    label: labels[result.status] ?? fallback[result.status],
    detail: result.status === ControlPlaneStatus.Success ? undefined : result.message,
  };
}

/** ALB (HTTPProxy) row status: Active / Pending / Failed, as in the portal's edge list. */
export function httpProxyView(status: HttpProxyStatusLike | null | undefined): StatusView & {
  certificates?: 'ready' | 'pending' | 'failed';
  retryRef?: string;
} {
  const result = getHttpProxyStatus(status);
  const certificates = getCertificatesReadyDisplay(getCertificatesReadyCondition(status));
  return {
    status: toBadge(result.status),
    label:
      result.status === ControlPlaneStatus.Success
        ? 'Active'
        : result.status === ControlPlaneStatus.Error
          ? 'Failed'
          : 'Pending',
    detail: result.status === ControlPlaneStatus.Success ? undefined : result.message,
    certificates,
    retryRef: result.retryRef,
  };
}

/** Domain: Verified, otherwise Unverified (the portal shows pending as unverified too). */
export function domainView(status: StatusLike): StatusView {
  const result = transformControlPlaneStatus(status ?? undefined);
  if (result.status === ControlPlaneStatus.Success) return { status: 'success', label: 'Verified' };
  const pendingChecks = (status?.conditions ?? [])
    .filter(
      (c) => ['Verified', 'VerifiedDNS', 'VerifiedHTTP'].includes(c.type ?? '') && c.status !== 'True'
    )
    .map((c) => c.message)
    .filter(Boolean);
  return {
    status: 'error',
    label: 'Unverified',
    detail: pendingChecks.join('\n') || result.message,
  };
}

/** Connector: Online / Offline (portal connectors list). */
export function connectorView(status: StatusLike): StatusView {
  const result = transformControlPlaneStatus(status ?? undefined);
  const online = result.status === ControlPlaneStatus.Success;
  return {
    status: online ? 'success' : 'unknown',
    label: online ? 'Online' : 'Offline',
    detail: online ? undefined : result.message,
  };
}

/** Workload health, with the compute plugin's deploying/deleting treatment. */
export function workloadView(workload: Workload, now = Date.now()): StatusView {
  if (workload.deleting) return { status: 'unknown', label: 'Deleting' };
  const deploy = deployStatus(workload, now);
  if (deploy) {
    return {
      status: 'pending',
      label: deploy.label,
      detail: [deploy.step, deploy.message].filter(Boolean).join(' — '),
    };
  }
  const label = statusLabel(workload);
  switch (workload.health) {
    case 'Available':
      return { status: 'success', label };
    case 'Degraded':
      return { status: 'pending', label };
    case 'Unavailable':
      return { status: 'error', label };
    default:
      return { status: 'unknown', label };
  }
}

export function instanceView(instance: Instance): StatusView {
  const label = instanceStatusLabel(instance);
  switch (instance.status) {
    case 'Available':
      return { status: 'success', label };
    case 'Pending':
      return { status: 'pending', label };
    case 'Failed':
      return { status: 'error', label };
    default:
      return { status: 'unknown', label };
  }
}

/** A workload's ALB, as the compute plugin labels it. */
export function workloadAlbView(alb: ConnectedAlb, workloadServing: boolean): StatusView {
  const display = albStatusDisplay(albStatus(alb, { workloadServing }));
  if (!display) return { status: 'success', label: 'Serving' };
  return {
    status: display.tone === 'danger' ? 'error' : 'pending',
    label: display.short,
    detail: display.detail,
  };
}

export interface StatusRollup {
  total: number;
  success: number;
  pending: number;
  error: number;
  unknown: number;
}

export function rollup(views: StatusView[]): StatusRollup {
  const counts: StatusRollup = { total: views.length, success: 0, pending: 0, error: 0, unknown: 0 };
  for (const view of views) counts[view.status] += 1;
  return counts;
}

/** The single badge that best summarises a rollup: any error, else any pending, else success. */
export function rollupView(counts: StatusRollup): StatusView {
  if (counts.total === 0) return { status: 'unknown', label: 'None' };
  if (counts.error > 0) return { status: 'error', label: `${counts.error} failing` };
  if (counts.pending > 0) return { status: 'pending', label: `${counts.pending} pending` };
  if (counts.unknown > 0 && counts.success === 0) return { status: 'unknown', label: 'Unknown' };
  return { status: 'success', label: 'All healthy' };
}
