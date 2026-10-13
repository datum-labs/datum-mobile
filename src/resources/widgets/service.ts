import type { QueryKey } from '@tanstack/react-query';

import { env } from '@/config/env';
import {
  mergeSnapshot,
  projectHealth,
  shouldWrite,
  snapshotFingerprint,
  SNAPSHOT_VERSION,
  type HealthSnapshot,
  type ProjectHealth,
  type ProjectRef,
  type SnapshotUpdate,
} from '@/lib/health/snapshot';
import { queryClient } from '@/lib/query';
import { computeService, toInstanceList, toWorkloadList } from '@/resources/compute/service';
import { instanceKeys, workloadKeys } from '@/resources/compute/queries';
import { dnsZoneKeys } from '@/resources/dns/queries';
import { dnsService, toDnsZoneList } from '@/resources/dns/service';
import { domainKeys } from '@/resources/domains/queries';
import { domainService, toDomainList } from '@/resources/domains/service';
import { toHttpProxyList } from '@/resources/http-proxies/model';
import { httpProxyKeys } from '@/resources/http-proxies/queries';
import { httpProxyService } from '@/resources/http-proxies/service';
import { organizationKeys } from '@/resources/organizations/queries';
import { organizationService, toOrganizationList } from '@/resources/organizations/service';
import { projectKeys } from '@/resources/projects/queries';
import { projectService, toProjectList } from '@/resources/projects/service';

import { DatumWidgets } from '../../../modules/datum-widgets';

/** Reads shared with Home's queries: a fresh-enough cached list isn't fetched again. */
const STALE_MS = 30_000;

async function cached<T>(queryKey: QueryKey, fetch: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  try {
    return await queryClient.fetchQuery({ queryKey, queryFn: ({ signal }) => fetch(signal), staleTime: STALE_MS });
  } catch {
    return undefined;
  }
}

/** Whether this binary has the widgets (extension embedded and App Group reachable). */
export function widgetsEnabled(): boolean {
  const info = DatumWidgets.info();
  return info.available && !!info.widgetsEmbedded;
}

/**
 * One project's health from the same queries (and cache entries) as Home.
 * Undefined when nothing could be read, so a signed-out or offline refresh
 * never replaces good data with an empty project.
 */
export async function readProjectHealth(project: ProjectRef): Promise<ProjectHealth | undefined> {
  const id = project.projectId;
  const [proxies, workloads, instances, domains, zones] = await Promise.all([
    cached(httpProxyKeys.list(id), (signal) => httpProxyService.list(id, signal)),
    cached(workloadKeys.list(id), (signal) => computeService.listWorkloads(id, signal)),
    cached(instanceKeys.list(id), (signal) => computeService.listInstances(id, { signal })),
    cached(domainKeys.list(id), (signal) => domainService.list(id, signal)),
    cached(dnsZoneKeys.list(id), (signal) => dnsService.listZones(id, signal)),
  ]);
  if ([proxies, workloads, instances, domains, zones].every((list) => list === undefined)) return undefined;
  return projectHealth({
    project,
    scheme: env.scheme,
    proxies: proxies && toHttpProxyList(proxies),
    workloads: workloads && toWorkloadList(workloads),
    instances: instances && toInstanceList(instances),
    domains: domains && toDomainList(domains),
    zones: zones && toDnsZoneList(zones),
  });
}

/** Every project the user can pick in the widget (all orgs; the portal's project filter). */
export async function readProjectDirectory(sub: string): Promise<ProjectRef[] | undefined> {
  const memberships = await cached(organizationKeys.list(sub), (signal) =>
    organizationService.listMemberships(sub, signal)
  );
  if (!memberships) return undefined;
  const orgs = toOrganizationList(memberships).slice(0, 25);
  const lists = await Promise.all(
    orgs.map(async (org) => {
      const items = await cached(projectKeys.list(org.name), (signal) => projectService.list(org.name, signal));
      return (items ? toProjectList(items) : []).map<ProjectRef>((p) => ({
        projectId: p.name,
        projectName: p.displayName,
        orgId: org.name,
        orgName: org.displayName,
      }));
    })
  );
  return lists.flat();
}

// ---------------------------------------------------------------------------
// Publishing (one writer, serialized)

let current: HealthSnapshot | null | undefined;
let lastWrite: { fingerprint: string; at: number } | undefined;
let queue: Promise<void> = Promise.resolve();

function parse(json: string | null): HealthSnapshot | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as HealthSnapshot;
    return value?.version === SNAPSHOT_VERSION ? value : null;
  } catch {
    return null;
  }
}

/** The snapshot as last written (or read back from the App Group). */
export async function currentSnapshot(): Promise<HealthSnapshot | null> {
  if (current === undefined) current = parse(await DatumWidgets.readSnapshot().catch(() => null));
  return current;
}

/**
 * Merge an update into the shared snapshot and write it (reloading the
 * widget timelines) when its content changed or the last write is old.
 */
export function publishHealth(update: SnapshotUpdate): Promise<void> {
  if (!widgetsEnabled()) return Promise.resolve();
  queue = queue
    .then(async () => {
      const next = mergeSnapshot(await currentSnapshot(), update);
      current = next;
      const now = Date.now();
      if (!shouldWrite(lastWrite, next, now)) return;
      await DatumWidgets.writeSnapshot(JSON.stringify(next));
      lastWrite = { fingerprint: snapshotFingerprint(next), at: now };
    })
    .catch(() => undefined);
  return queue;
}

/** Signed out, or another user signed in: the widgets show nothing until the next read. */
export function clearHealth(): Promise<void> {
  queue = queue
    .then(async () => {
      current = null;
      lastWrite = undefined;
      await DatumWidgets.clearSnapshot();
    })
    .catch(() => undefined);
  return queue;
}

/** Projects the widgets show besides the selected one (at most `limit`). */
export async function widgetProjects(selected: ProjectRef | undefined, limit = 4): Promise<ProjectRef[]> {
  const snapshot = await currentSnapshot();
  const refs: ProjectRef[] = selected ? [selected] : [];
  const known = (id: string): ProjectRef | undefined =>
    snapshot?.projects[id] ?? snapshot?.directory.find((ref) => ref.projectId === id);
  const candidates = [snapshot?.currentProjectId, ...DatumWidgets.requestedProjects()];
  for (const id of candidates) {
    if (!id || refs.some((r) => r.projectId === id)) continue;
    const ref = known(id);
    if (ref) refs.push(ref);
  }
  return refs.slice(0, limit);
}

/**
 * Re-read the selected project and any project a widget is showing, and
 * (when `sub` is given) the project directory; then publish.
 */
export async function refreshWidgets(options: {
  /** The signed-in user (snapshot owner). */
  sub: string;
  selected?: ProjectRef;
  directory?: boolean;
}): Promise<void> {
  if (!widgetsEnabled()) return;
  const projects = await widgetProjects(options.selected);
  const [directory, ...healths] = await Promise.all([
    options.directory ? readProjectDirectory(options.sub) : Promise.resolve(undefined),
    ...projects.map(readProjectHealth),
  ]);
  const owner = options.sub;
  if (directory) await publishHealth({ owner, directory });
  for (const health of healths) if (health) await publishHealth({ owner, project: health });
}
