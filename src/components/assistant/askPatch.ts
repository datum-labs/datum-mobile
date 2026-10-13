import type { ImageSourcePropType } from 'react-native';
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

/**
 * Patch's toolbar icon: Lucide's `brain`, the icon the portal's assistant
 * plugin uses, rendered at toolbar size and drawn as a template image so it
 * takes the header tint like the SF Symbols beside it.
 */
export const PATCH_ICON = require('@/assets/icons/brain.png') as ImageSourcePropType;

/** Toolbar props shared by every detail screen. */
export const ASK_PATCH = {
  icon: PATCH_ICON,
  iconRenderingMode: 'template',
  accessibilityLabel: 'Ask Patch about this',
} as const;
