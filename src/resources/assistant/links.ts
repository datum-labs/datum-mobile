/**
 * Links in Patch's answers point at the portal (`/project/:p/alb/:id/...`,
 * sometimes as full URLs). Map the ones the app has a screen for to its own
 * routes; everything else opens in the browser.
 */
export type AnswerLink = { kind: 'route'; href: string } | { kind: 'external'; url: string };

export interface LinkContext {
  /** The project the chat is scoped to; links into other projects go to the browser. */
  projectId?: string;
  /** Portal origin, e.g. https://cloud.datum.net, for relative and same-origin links. */
  portalUrl: string;
}

const enc = encodeURIComponent;

/** Portal path (after `/project/:p`) → app route, or undefined when the app has no screen for it. */
function projectRoute(segments: string[]): string | undefined {
  // Plugin pages are mounted under /services/<slug>/…
  const rest = segments[0] === 'services' ? segments.slice(2) : segments;
  const [section, id, sub, subId] = rest;
  switch (section) {
    case undefined:
    case 'home':
      return '/home';
    case 'alb':
    case 'edge':
      return id ? `/alb/${enc(id)}` : '/edge';
    case 'domains':
      return id ? `/domains/${enc(id)}` : '/edge';
    case 'dns-zones':
    case 'dns':
      return id ? `/dns/${enc(id)}` : '/edge';
    case 'workloads':
      if (id && sub === 'instances' && subId) return `/instances/${enc(subId)}`;
      return id ? `/workloads/${enc(id)}` : '/compute';
    case 'instances':
      return id ? `/instances/${enc(id)}` : '/compute';
    case 'networks':
      return id ? `/networks/${enc(id)}` : '/network';
    case 'connectors':
      return id ? `/connectors/${enc(id)}` : '/network';
    default:
      return undefined;
  }
}

function originOf(url: string): string | undefined {
  const match = /^(https?:\/\/[^/?#]+)/i.exec(url);
  return match?.[1]?.toLowerCase();
}

/** Resolves a link from an answer to an in-app route or a browser URL. */
export function resolveAnswerLink(href: string, ctx: LinkContext): AnswerLink {
  const portal = ctx.portalUrl.replace(/\/+$/, '');
  let path: string | undefined;
  if (href.startsWith('/') && !href.startsWith('//')) {
    path = href;
  } else if (originOf(href) && originOf(href) === originOf(portal)) {
    path = href.slice(originOf(href)!.length) || '/';
  }
  if (path === undefined) return { kind: 'external', url: href };

  const pathname = path.split(/[?#]/)[0] ?? '';
  const segments = pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  if (segments[0] === 'project' && segments[1] && (!ctx.projectId || segments[1] === ctx.projectId)) {
    const route = projectRoute(segments.slice(2));
    if (route) return { kind: 'route', href: route };
  }
  return { kind: 'external', url: `${portal}${path}` };
}
