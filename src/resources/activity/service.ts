import { api, projectScopedBase } from '@/api';

/**
 * Activity API (activity.miloapis.com), reached through the project's control
 * plane like the portal's `ResourceActivityFeed`. History is read by POSTing
 * an ActivityQuery: a virtual, read-only object whose `status` carries the
 * matching activities, newest first.
 */
export const ACTIVITY_QUERIES_PATH = '/apis/activity.miloapis.com/v1alpha1/activityqueries';

/** The portal feed's defaults (activity-ui `useActivityFeed`). */
export const ACTIVITY_WINDOW_START = 'now-7d';
export const ACTIVITY_PAGE_SIZE = 30;

// ── Raw API types (activity-ui `types/activity.ts`) ──────────────────────

export type ChangeSource = 'human' | 'system';
export type ActorType = 'user' | 'machine account' | 'controller';

export interface RawResourceRef {
  apiGroup?: string;
  apiVersion?: string;
  kind: string;
  name: string;
  namespace?: string;
  uid?: string;
}

export interface RawActivityLink {
  /** Substring of the summary this link covers. */
  marker: string;
  resource: RawResourceRef;
  /** Set server-side for User links, to show a name instead of a UID. */
  displayName?: string;
  email?: string;
}

export interface RawActivity {
  apiVersion?: string;
  kind?: 'Activity';
  metadata?: { name?: string; uid?: string; namespace?: string; creationTimestamp?: string };
  spec?: {
    summary?: string;
    changeSource?: ChangeSource;
    actor?: { type?: ActorType; name?: string; uid?: string; email?: string; displayName?: string };
    resource?: RawResourceRef;
    links?: RawActivityLink[];
    tenant?: { type?: string; name?: string };
    origin?: { type?: 'audit' | 'event'; id?: string };
  };
}

export interface ActivityQuerySpec {
  /** RFC 3339 or relative ("now-7d"). */
  startTime: string;
  endTime: string;
  limit?: number;
  /** CEL over the Activity object. */
  filter?: string;
  search?: string;
  /** `status.continue` from the previous page. */
  continue?: string;
}

export interface ActivityQuery {
  apiVersion: 'activity.miloapis.com/v1alpha1';
  kind: 'ActivityQuery';
  spec: ActivityQuerySpec;
  status?: {
    results?: RawActivity[];
    continue?: string;
    effectiveStartTime?: string;
    effectiveEndTime?: string;
  };
}

// ── Request ──────────────────────────────────────────────────────────────

export interface ResourceActivityTarget {
  kind: string;
  name: string;
}

/** Escape a value for a double-quoted CEL string literal. */
export function celEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * The portal's locked kind + name filter. Name is a substring match, as in
 * activity-ui (`spec.resource.name.contains`).
 */
export function buildResourceActivityFilter({ kind, name }: ResourceActivityTarget): string {
  return `spec.resource.kind == "${celEscape(kind)}" && spec.resource.name.contains("${celEscape(name)}")`;
}

export function buildResourceActivityQuery(
  target: ResourceActivityTarget,
  options: { cursor?: string; limit?: number } = {}
): ActivityQuery {
  const spec: ActivityQuerySpec = {
    startTime: ACTIVITY_WINDOW_START,
    endTime: 'now',
    limit: options.limit ?? ACTIVITY_PAGE_SIZE,
    filter: buildResourceActivityFilter(target),
  };
  if (options.cursor) spec.continue = options.cursor;
  return { apiVersion: 'activity.miloapis.com/v1alpha1', kind: 'ActivityQuery', spec };
}

export const activityService = {
  /** One page of a resource's activity, newest first. */
  queryResource(
    projectId: string,
    target: ResourceActivityTarget,
    options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}
  ) {
    return api.post<ActivityQuery>(
      `${projectScopedBase(projectId)}${ACTIVITY_QUERIES_PATH}`,
      buildResourceActivityQuery(target, options),
      { signal: options.signal }
    );
  },
};

// ── View model ───────────────────────────────────────────────────────────

/** A run of summary text; `emphasis` marks a link target. */
export interface SummarySegment {
  text: string;
  emphasis: boolean;
}

export interface ActivityItem {
  id: string;
  summary: string;
  segments: SummarySegment[];
  /** Display name, email or name; controllers lose their API-group prefix. */
  actor: string;
  actorType?: ActorType;
  changeSource?: ChangeSource;
  resource?: { kind: string; name: string };
  /** RFC 3339. */
  timestamp?: string;
}

export interface ActivityPage {
  items: ActivityItem[];
  /** Cursor for the next page, when there is one. */
  continue?: string;
}

/**
 * Split a summary at its link markers (activity-ui `parseSummaryWithLinks`):
 * longest marker wins, overlaps are dropped, and a User link shows its
 * displayName in place of the raw marker.
 */
export function toSummarySegments(summary: string, links: RawActivityLink[] | undefined): SummarySegment[] {
  const ranges: { start: number; end: number; text: string }[] = [];
  const sorted = (links ?? []).filter((l) => !!l.marker).sort((a, b) => b.marker.length - a.marker.length);
  for (const link of sorted) {
    for (let pos = summary.indexOf(link.marker); pos !== -1; pos = summary.indexOf(link.marker, pos + 1)) {
      const end = pos + link.marker.length;
      if (ranges.some((r) => pos < r.end && end > r.start)) continue;
      ranges.push({ start: pos, end, text: link.displayName || link.marker });
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  const segments: SummarySegment[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start > at) segments.push({ text: summary.slice(at, range.start), emphasis: false });
    segments.push({ text: range.text, emphasis: true });
    at = range.end;
  }
  if (at < summary.length) segments.push({ text: summary.slice(at), emphasis: false });
  return segments;
}

function actorLabel(actor: NonNullable<RawActivity['spec']>['actor']): string {
  if (!actor) return 'Unknown';
  if (actor.displayName) return actor.displayName;
  const name = actor.name || actor.email || '';
  if (actor.type === 'controller') return name.split('/').pop() || name || 'System';
  return name || 'Unknown';
}

export function toActivityItem(raw: RawActivity, index = 0): ActivityItem {
  const spec = raw.spec ?? {};
  const summary = spec.summary ?? '';
  return {
    id: raw.metadata?.uid || raw.metadata?.name || spec.origin?.id || `${raw.metadata?.creationTimestamp ?? ''}#${index}`,
    summary,
    segments: toSummarySegments(summary, spec.links),
    actor: actorLabel(spec.actor),
    actorType: spec.actor?.type,
    changeSource: spec.changeSource,
    resource: spec.resource ? { kind: spec.resource.kind, name: spec.resource.name } : undefined,
    timestamp: raw.metadata?.creationTimestamp,
  };
}

export function toActivityPage(query: ActivityQuery | undefined): ActivityPage {
  const results = query?.status?.results ?? [];
  return { items: results.map(toActivityItem), continue: query?.status?.continue || undefined };
}
