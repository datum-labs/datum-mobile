/**
 * The health snapshot the app shares with its widgets (App Group file, read
 * by `native/datum-widgets`). Built here from the same view models and status
 * helpers Home uses, so a widget never disagrees with Home. Pure: no I/O.
 *
 * Keep the JSON shape in step with `native/datum-widgets/HealthModel.swift`
 * and bump SNAPSHOT_VERSION on breaking changes.
 */
import type { BadgeStatus, StatusView } from '@/lib/status/types';
import { instanceView, rollup, workloadView } from '@/lib/status/views';
import type { Instance, Workload } from '@/resources/compute/model';
import type { DnsZone } from '@/resources/dns/service';
import type { Domain } from '@/resources/domains/service';
import type { HttpProxy } from '@/resources/http-proxies/model';

import { attentionItems, type AttentionKind } from './attention';

export const SNAPSHOT_VERSION = 1;

/** Failing items kept per project: the medium widget shows up to four. */
export const MAX_ITEMS = 6;
/** Projects kept in the file (current first, then most recently refreshed). */
export const MAX_PROJECTS = 12;
/** Projects not refreshed for this long are dropped (unless current). */
export const PROJECT_TTL_MS = 7 * 24 * 60 * 60_000;
/** Rewrite an unchanged snapshot this often, so "Updated …" stays honest. */
export const REWRITE_AFTER_MS = 5 * 60_000;

export interface ProjectRef {
  projectId: string;
  projectName?: string;
  orgId: string;
  orgName?: string;
}

/** A Home tile, compacted: null when that list couldn't be loaded. */
export interface TileCount {
  total: number;
  error: number;
  pending: number;
}

export interface SnapshotItem {
  kind: AttentionKind;
  /** "Load balancer", "Workload", … */
  kindLabel: string;
  name: string;
  title: string;
  status: BadgeStatus;
  /** The badge label ("Failed", "Unverified", "Deploying", …). */
  label: string;
  /** Deep link into the resource's screen, selecting this project. */
  url: string;
}

export type OverallStatus = 'healthy' | 'error' | 'pending' | 'unknown';

export interface ProjectHealth extends ProjectRef {
  projectName: string;
  /** ISO time the data was read. */
  generatedAt: string;
  /** Every list loaded (otherwise counts may be null and the status partial). */
  complete: boolean;
  status: OverallStatus;
  counts: {
    loadBalancers: TileCount | null;
    workloads: TileCount | null;
    instances: TileCount | null;
    domains: TileCount | null;
  };
  attention: { total: number; error: number; pending: number; items: SnapshotItem[] };
  /** Deep link to Home with this project selected. */
  url: string;
}

export interface HealthSnapshot {
  version: number;
  generatedAt: string;
  /** The signed-in user (OIDC `sub`) the data belongs to. */
  owner?: string;
  /** The app's selected project: what an unconfigured widget shows. */
  currentProjectId?: string;
  projects: Record<string, ProjectHealth>;
  /** Projects the user can pick in the widget's configuration. */
  directory: ProjectRef[];
}

export interface HealthInput {
  project: ProjectRef;
  /** The app's URL scheme (app config `scheme`). */
  scheme: string;
  proxies?: HttpProxy[];
  workloads?: Workload[];
  instances?: Instance[];
  domains?: Domain[];
  zones?: DnsZone[];
  now?: number;
}

/** `<scheme>:/path?org=…&project=…`: opens the screen with that project selected. */
export function widgetUrl(scheme: string, path: string, project?: Pick<ProjectRef, 'orgId' | 'projectId'>): string {
  // Built by hand: React Native's URLSearchParams is partial.
  const query = project
    ? `?org=${encodeURIComponent(project.orgId)}&project=${encodeURIComponent(project.projectId)}`
    : '';
  return `${scheme}:${path.startsWith('/') ? path : `/${path}`}${query}`;
}

function tile(views: StatusView[] | undefined): TileCount | null {
  if (!views) return null;
  const counts = rollup(views);
  return { total: counts.total, error: counts.error, pending: counts.pending };
}

export function overallStatus(attention: { error: number; pending: number }, complete: boolean): OverallStatus {
  if (attention.error > 0) return 'error';
  if (attention.pending > 0) return 'pending';
  return complete ? 'healthy' : 'unknown';
}

/** One project's widget data: Home's tiles (LBs, workloads, instances, domains) and "Needs attention". */
export function projectHealth(input: HealthInput): ProjectHealth {
  const now = input.now ?? Date.now();
  const { project, scheme } = input;
  const items = attentionItems(input, now);
  const error = items.filter((i) => i.view.status === 'error').length;
  const pending = items.filter((i) => i.view.status === 'pending').length;
  const complete = [input.proxies, input.workloads, input.instances, input.domains, input.zones].every(
    (list) => list !== undefined
  );
  return {
    projectId: project.projectId,
    projectName: project.projectName || project.projectId,
    orgId: project.orgId,
    ...(project.orgName ? { orgName: project.orgName } : {}),
    generatedAt: new Date(now).toISOString(),
    complete,
    status: overallStatus({ error, pending }, complete),
    counts: {
      loadBalancers: tile(input.proxies?.map((p) => p.view)),
      workloads: tile(input.workloads?.map((w) => workloadView(w, now))),
      instances: tile(input.instances?.map(instanceView)),
      domains: tile(input.domains?.map((d) => d.view)),
    },
    attention: {
      total: items.length,
      error,
      pending,
      items: items.slice(0, MAX_ITEMS).map((item) => ({
        kind: item.kind,
        kindLabel: item.subtitle,
        name: item.name,
        title: item.title,
        status: item.view.status,
        label: item.view.label,
        url: widgetUrl(scheme, item.path, project),
      })),
    },
    url: widgetUrl(scheme, '/home', project),
  };
}

export interface SnapshotUpdate {
  /** The signed-in user; a different one starts a fresh snapshot. */
  owner?: string;
  /** A freshly read project. */
  project?: ProjectHealth;
  /** The app's selection; `null` clears it. */
  currentProjectId?: string | null;
  directory?: ProjectRef[];
  now?: number;
}

function emptySnapshot(now: number): HealthSnapshot {
  return { version: SNAPSHOT_VERSION, generatedAt: new Date(now).toISOString(), projects: {}, directory: [] };
}

/** Folds an update into the previous snapshot, pruning old projects. */
export function mergeSnapshot(previous: HealthSnapshot | null | undefined, update: SnapshotUpdate): HealthSnapshot {
  const now = update.now ?? Date.now();
  const sameOwner = !update.owner || !previous?.owner || previous.owner === update.owner;
  const base = previous && previous.version === SNAPSHOT_VERSION && sameOwner ? previous : emptySnapshot(now);
  const owner = update.owner ?? base.owner;
  const currentProjectId =
    update.currentProjectId === null ? undefined : (update.currentProjectId ?? base.currentProjectId);
  const projects: Record<string, ProjectHealth> = { ...base.projects };
  if (update.project) projects[update.project.projectId] = update.project;

  const age = (p: ProjectHealth) => now - Date.parse(p.generatedAt);
  const kept = Object.values(projects)
    .filter((p) => p.projectId === currentProjectId || age(p) < PROJECT_TTL_MS)
    .sort((a, b) => {
      if (a.projectId === currentProjectId) return -1;
      if (b.projectId === currentProjectId) return 1;
      return age(a) - age(b);
    })
    .slice(0, MAX_PROJECTS);

  // Names learned from fresh project data win over a stale directory entry.
  const directory = (update.directory ?? base.directory).map((ref) => {
    const fresh = projects[ref.projectId];
    return fresh ? { ...ref, projectName: fresh.projectName, orgName: ref.orgName ?? fresh.orgName } : ref;
  });
  for (const p of kept) {
    if (!directory.some((ref) => ref.projectId === p.projectId)) {
      directory.push({ projectId: p.projectId, projectName: p.projectName, orgId: p.orgId, orgName: p.orgName });
    }
  }

  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date(now).toISOString(),
    ...(owner ? { owner } : {}),
    ...(currentProjectId ? { currentProjectId } : {}),
    projects: Object.fromEntries(kept.map((p) => [p.projectId, p])),
    directory,
  };
}

/** What changes the widget's content (everything but the timestamps). */
export function snapshotFingerprint(snapshot: HealthSnapshot): string {
  return JSON.stringify({
    ...snapshot,
    generatedAt: undefined,
    projects: Object.fromEntries(
      Object.entries(snapshot.projects).map(([id, p]) => [id, { ...p, generatedAt: undefined }])
    ),
  });
}

/**
 * Whether to write (and reload widget timelines): when the content changed, or
 * when the last write is old enough that "Updated …" would mislead.
 */
export function shouldWrite(
  last: { fingerprint: string; at: number } | undefined,
  next: HealthSnapshot,
  now = Date.now()
): boolean {
  if (!last) return true;
  return last.fingerprint !== snapshotFingerprint(next) || now - last.at >= REWRITE_AFTER_MS;
}
