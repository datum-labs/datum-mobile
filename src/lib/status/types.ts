/** Ported from cloud-portal `app/resources/base/status.types.ts`. */
export const ControlPlaneStatus = {
  Success: 'success',
  Error: 'error',
  Pending: 'pending',
} as const;

export type ControlPlaneStatus = (typeof ControlPlaneStatus)[keyof typeof ControlPlaneStatus];

export interface ConditionSummary {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

export interface ExtendedControlPlaneStatus {
  status: ControlPlaneStatus;
  message: string;
  isProgrammed?: boolean;
  programmedReason?: string;
  isAccepted?: boolean;
  acceptedReason?: string;
  conditions?: ConditionSummary[];
  [key: string]: unknown;
}

/** A K8s condition as served; every field optional so partial objects type-check. */
export interface RawCondition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string | Date;
  observedGeneration?: number;
}

/** The four states datum-ui-native's StatusBadge renders. */
export type BadgeStatus = 'success' | 'error' | 'pending' | 'unknown';

/** A status ready to render: badge state, short label and an optional explanation. */
export interface StatusView {
  status: BadgeStatus;
  label: string;
  detail?: string;
}
