import type { Mention } from '@datum-cloud/datum-ui-assistant-core';

/**
 * The app's assistant ("Patch") copy. Suggestions are the portal's
 * (assistant repo, `ui/consumer/src/lib/assistant-config.ts`); every one is
 * read-only.
 */
export const SUGGESTIONS = [
  'Give me a detailed summary of my project.',
  'What can Patch help me with in this project?',
  'Summarize recent activity in this project.',
  'What resources do I have in this project?',
];

/**
 * Tool name → progress label. Patch's tools are `<service>__<tool>`; names
 * not listed fall back to {@link toolLabelFor}'s generic label.
 */
export const TOOL_LABELS: Record<string, string> = {
  alb__alb_list: 'Looking at your load balancers…',
  alb__alb_get: 'Looking at a load balancer…',
  compute__compute_workloads_list: 'Looking at your workloads…',
  compute__compute_workload_get: 'Looking at a workload…',
  compute__compute_instances_list: 'Looking at your instances…',
  dns__dns_zones_list: 'Checking your DNS zones…',
  dns__dns_records_list: 'Reading DNS records…',
};

/** The resources a detail screen can hand to Patch. */
export const MENTION_KINDS = {
  alb: { kind: 'HTTPProxy', apiGroup: 'networking.datumapis.com', noun: 'load balancer' },
  workload: { kind: 'Workload', apiGroup: 'compute.datumapis.com', noun: 'workload' },
  instance: { kind: 'Instance', apiGroup: 'compute.datumapis.com', noun: 'instance' },
  domain: { kind: 'Domain', apiGroup: 'networking.datumapis.com', noun: 'domain' },
  dnsZone: { kind: 'DNSZone', apiGroup: 'dns.networking.miloapis.com', noun: 'DNS zone' },
} as const;

export type MentionKind = keyof typeof MENTION_KINDS;

const NOUNS: Record<string, string> = Object.fromEntries(
  Object.values(MENTION_KINDS).map((m) => [m.kind, m.noun])
);

/** "load balancer" for an HTTPProxy mention, else the kind itself. */
export function mentionNoun(mention: Pick<Mention, 'kind'>): string {
  return NOUNS[mention.kind] ?? mention.kind;
}

/** Read-only starter prompts about one resource. */
export function mentionSuggestions(mention: Pick<Mention, 'kind'>): string[] {
  const noun = mentionNoun(mention);
  return [
    `Is this ${noun} healthy?`,
    `Summarize this ${noun}'s configuration.`,
    `Has anything changed on this ${noun} recently?`,
  ];
}

/** The literal `@Kind/name` the service expects in the text (the metadata list is advisory). */
export function mentionToken(mention: Pick<Mention, 'kind' | 'name'>): string {
  return `@${mention.kind}/${mention.name}`;
}

/** The text to send: the prompt with the mention's literal token in front, unless it already has it. */
export function withMentionText(text: string, mentions: Mention[]): string {
  const missing = mentions.map(mentionToken).filter((token) => !text.includes(token));
  return missing.length ? `${missing.join(' ')} ${text}` : text;
}

const LEADING_MENTIONS = /^((?:@[A-Za-z][\w.-]*\/[\w.-]+\s+)+)/;

/**
 * Splits the `@Kind/name` tokens a prompt starts with from the rest, so a
 * bubble or a title can show the resource as a chip and the question as text.
 */
export function splitLeadingMentions(text: string): { mentions: Pick<Mention, 'kind' | 'name'>[]; text: string } {
  const match = LEADING_MENTIONS.exec(text);
  if (!match) return { mentions: [], text };
  const mentions = match[1]!
    .trim()
    .split(/\s+/)
    .map((token) => {
      const [kind, ...name] = token.slice(1).split('/');
      return { kind: kind!, name: name.join('/') };
    });
  return { mentions, text: text.slice(match[0].length) };
}

/** A conversation title without the mention tokens it may start with. */
export function displayTitle(title: string): string {
  const { mentions, text } = splitLeadingMentions(title);
  if (mentions.length === 0) return title;
  return text || mentions.map((m) => m.name).join(', ');
}
