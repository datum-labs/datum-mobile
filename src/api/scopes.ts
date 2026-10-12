/**
 * Scoped control-plane base paths, mirroring cloud-portal
 * `app/resources/base/utils.ts`:
 *
 * - user:    /apis/iam.miloapis.com/v1alpha1/users/{sub}/control-plane
 * - org:     /apis/resourcemanager.miloapis.com/v1alpha1/organizations/{org}/control-plane
 * - project: /apis/resourcemanager.miloapis.com/v1alpha1/projects/{project}/control-plane
 *
 * Unlike the portal there's no `me` placeholder rewritten by a proxy: the app
 * talks to the API directly and passes the id_token `sub`.
 */
export type Scope =
  | { kind: 'user'; sub: string }
  | { kind: 'org'; org: string }
  | { kind: 'project'; project: string };

/** Namespaced resources in a project control plane live in `default`. */
export const DEFAULT_NAMESPACE = 'default';

function segment(value: string, what: string): string {
  if (!value) throw new Error(`Missing ${what} for scoped API path`);
  return encodeURIComponent(value);
}

export function userScopedBase(sub: string): string {
  return `/apis/iam.miloapis.com/v1alpha1/users/${segment(sub, 'user')}/control-plane`;
}

export function orgScopedBase(org: string): string {
  return `/apis/resourcemanager.miloapis.com/v1alpha1/organizations/${segment(org, 'organization')}/control-plane`;
}

export function projectScopedBase(project: string): string {
  return `/apis/resourcemanager.miloapis.com/v1alpha1/projects/${segment(project, 'project')}/control-plane`;
}

export function scopedBase(scope: Scope): string {
  switch (scope.kind) {
    case 'user':
      return userScopedBase(scope.sub);
    case 'org':
      return orgScopedBase(scope.org);
    case 'project':
      return projectScopedBase(scope.project);
  }
}

export interface ResourcePath {
  /** API group, e.g. `networking.datumapis.com`. */
  group: string;
  version: string;
  /** Plural resource, e.g. `httpproxies`. */
  resource: string;
  /** Namespace for namespaced resources; omit for cluster-scoped ones. */
  namespace?: string;
  name?: string;
}

/** `/apis/{group}/{version}[/namespaces/{ns}]/{resource}[/{name}]` under a scope. */
export function resourcePath(scope: Scope, path: ResourcePath): string {
  const ns = path.namespace ? `/namespaces/${segment(path.namespace, 'namespace')}` : '';
  const name = path.name ? `/${segment(path.name, 'name')}` : '';
  return `${scopedBase(scope)}/apis/${path.group}/${path.version}${ns}/${path.resource}${name}`;
}
