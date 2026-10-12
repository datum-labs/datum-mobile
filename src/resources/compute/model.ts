/**
 * Workload / Instance view models. Type-only port of compute
 * `ui/consumer/src/schema.ts` (the zod schemas there are dropped; the adapter
 * builds these directly from the API objects).
 */
export type WorkloadHealth = 'Available' | 'Degraded' | 'Deploying' | 'Unavailable' | 'Unknown';

export interface WorkloadCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

export interface WorkloadPlacementRegion {
  name: string;
  locations: string[];
  locationSelector?: string;
  readyReplicas: number;
  desiredReplicas: number;
  health: WorkloadHealth;
}

export interface Workload {
  uid: string;
  name: string;
  namespace?: string;
  resourceVersion?: string;
  createdAt: Date;
  updatedAt?: Date;
  image?: string;
  health: WorkloadHealth;
  currentReplicas: number;
  readyReplicas: number;
  desiredReplicas: number;
  placements: string[];
  placementRegions: WorkloadPlacementRegion[];
  conditions: WorkloadCondition[];
  runtimeType?: string;
  tags: string[];
  ports: string[];
  locations: string[];
  resources?: string;
  replicasPerRegion?: number;
  networks: string[];
  deleting: boolean;
}

export type InstanceStatusValue = 'Available' | 'Pending' | 'Failed' | 'Unknown';

export interface InstanceCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface Instance {
  uid: string;
  name: string;
  namespace?: string;
  createdAt: Date;
  workloadName?: string;
  workloadUid?: string;
  location?: string;
  placement?: string;
  instanceType?: string;
  cpu?: string;
  memory?: string;
  image?: string;
  ports: string[];
  containers: string[];
  runtimeClass?: string;
  status: InstanceStatusValue;
  externalIP?: string;
  internalIP?: string;
  internalIPs: string[];
  conditions: InstanceCondition[];
}

/** Badge tone for a workload health (compute `workloadHealthToBadgeType`). */
export function workloadHealthToBadgeType(
  health: WorkloadHealth
): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  switch (health) {
    case 'Available':
      return 'success';
    case 'Deploying':
      return 'info';
    case 'Degraded':
      return 'warning';
    case 'Unavailable':
      return 'danger';
    default:
      return 'muted';
  }
}

/** Badge tone for an instance status (compute `instanceStatusToBadgeType`). */
export function instanceStatusToBadgeType(
  status: InstanceStatusValue
): 'success' | 'warning' | 'danger' | 'muted' {
  switch (status) {
    case 'Available':
      return 'success';
    case 'Pending':
      return 'warning';
    case 'Failed':
      return 'danger';
    default:
      return 'muted';
  }
}
