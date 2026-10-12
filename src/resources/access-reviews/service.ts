import { api, scopedBase, type Scope } from '@/api';

/**
 * SelfSubjectAccessReviews, issued the way cloud-portal's RbacService does
 * (`app/modules/rbac/server/rbac.service.ts` + `resources/access-review`):
 * posted to the scope's own control plane, with an explicit namespace (`''`
 * for cluster-scoped checks such as the logs API).
 */
export interface ResourceAttributes {
  namespace: string;
  verb: string;
  group: string;
  resource: string;
  subresource?: string;
  name?: string;
}

export interface AccessReviewResult {
  allowed: boolean;
  denied: boolean;
  reason?: string;
}

interface RawSelfSubjectAccessReview {
  status?: { allowed?: boolean; denied?: boolean; reason?: string };
}

export function toSelfSubjectAccessReview(attributes: ResourceAttributes) {
  return {
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SelfSubjectAccessReview',
    spec: { resourceAttributes: attributes },
  } as const;
}

export function toAccessReviewResult(raw: RawSelfSubjectAccessReview): AccessReviewResult {
  return {
    allowed: raw.status?.allowed ?? false,
    denied: raw.status?.denied ?? false,
    reason: raw.status?.reason,
  };
}

export const accessReviewService = {
  async review(scope: Scope, attributes: ResourceAttributes, signal?: AbortSignal): Promise<AccessReviewResult> {
    const raw = await api.post<RawSelfSubjectAccessReview>(
      `${scopedBase(scope)}/apis/authorization.k8s.io/v1/selfsubjectaccessreviews`,
      toSelfSubjectAccessReview(attributes),
      { signal }
    );
    return toAccessReviewResult(raw);
  },
};
