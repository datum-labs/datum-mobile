import { api } from '@/api';

/** The Milo user object, trimmed to what the app reads. */
export interface RawUser {
  metadata?: { name?: string };
  spec?: { email?: string; givenName?: string; familyName?: string };
  status?: { avatarUrl?: string; lastLoginProvider?: 'google' | 'github' };
}

export interface UserProfile {
  sub: string;
  email?: string;
  fullName?: string;
  avatarUrl?: string;
}

/**
 * Google serves avatars at a size baked into the URL (`=s96-c`). Ask for one
 * big enough to stay sharp at @3x.
 */
export function sizedAvatarUrl(url: string | undefined, px = 192): string | undefined {
  if (!url) return undefined;
  return url.replace(/=s\d+(-c)?$/, `=s${px}-c`);
}

/** cloud-portal user.adapter.ts `toUser`, trimmed. */
export function toUserProfile(raw: RawUser): UserProfile {
  const given = raw.spec?.givenName?.trim();
  const family = raw.spec?.familyName?.trim();
  const fullName = [given, family].filter(Boolean).join(' ') || undefined;
  return {
    sub: raw.metadata?.name ?? '',
    email: raw.spec?.email,
    fullName,
    avatarUrl: sizedAvatarUrl(raw.status?.avatarUrl),
  };
}

export const userService = {
  get(sub: string, signal?: AbortSignal) {
    return api.get<RawUser>(`/apis/iam.miloapis.com/v1alpha1/users/${encodeURIComponent(sub)}`, {
      signal,
    });
  },
};
