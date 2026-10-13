import { router, type Href } from 'expo-router';

import { MENTION_KINDS, type MentionKind } from '@/resources/assistant/config';

/**
 * Presents Patch with a resource prefilled as the prompt's mention ("Ask
 * Patch about this" on a detail screen). Closing it returns to the resource.
 */
export function askPatchAbout(kind: MentionKind, name: string, label?: string): void {
  const m = MENTION_KINDS[kind];
  router.push({
    pathname: '/assistant',
    params: {
      mentionKind: m.kind,
      mentionName: name,
      mentionGroup: m.apiGroup,
      ...(label && label !== name ? { mentionLabel: label } : {}),
    },
  } as Href);
}

/** Toolbar copy shared by every detail screen. */
export const ASK_PATCH = { icon: 'sparkles', accessibilityLabel: 'Ask Patch about this' } as const;
