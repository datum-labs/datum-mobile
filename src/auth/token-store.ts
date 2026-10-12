import * as SecureStore from 'expo-secure-store';

import { env } from '@/config/env';

/**
 * What survives an app restart. Kept as a single Keychain item so a rotated
 * refresh token, the subject and the id_token hint are always written
 * together — one `setItemAsync` is one Keychain write.
 *
 * The access token is never stored; it lives in memory only.
 */
export interface StoredSession {
  refreshToken: string;
  /** OIDC `sub`: the user ID used in user-scoped control-plane paths. */
  sub: string;
  email?: string;
  name?: string;
  /** Kept for RP-initiated logout (`id_token_hint`). */
  idToken?: string;
}

/** PKCE state persisted before the browser opens, so a stray callback can still complete. */
export interface PendingAuthRequest {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

export interface TokenStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
  loadPending(): Promise<PendingAuthRequest | null>;
  savePending(pending: PendingAuthRequest): Promise<void>;
  clearPending(): Promise<void>;
}

const SESSION_KEY = 'datum.session.v1';
const PENDING_KEY = 'datum.pkce.v1';

/** A pending PKCE request older than this is ignored (Zitadel auth requests expire sooner). */
export const PENDING_TTL_MS = 30 * 60_000;

function secureOptions(): SecureStore.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    ...(env.keychainAccessGroup ? { accessGroup: env.keychainAccessGroup } : {}),
  };
}

function parse<T>(raw: string | null, isValid: (value: unknown) => value is T): T | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : null;
  } catch {
    return null;
  }
}

function isStoredSession(value: unknown): value is StoredSession {
  const v = value as Partial<StoredSession> | null;
  return !!v && typeof v.refreshToken === 'string' && typeof v.sub === 'string';
}

function isPending(value: unknown): value is PendingAuthRequest {
  const v = value as Partial<PendingAuthRequest> | null;
  return (
    !!v &&
    typeof v.state === 'string' &&
    typeof v.codeVerifier === 'string' &&
    typeof v.redirectUri === 'string' &&
    typeof v.createdAt === 'number'
  );
}

export const secureTokenStore: TokenStore = {
  async load() {
    return parse(await SecureStore.getItemAsync(SESSION_KEY, secureOptions()), isStoredSession);
  },
  async save(session) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), secureOptions());
  },
  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY, secureOptions());
  },
  async loadPending() {
    const pending = parse(await SecureStore.getItemAsync(PENDING_KEY, secureOptions()), isPending);
    if (pending && Date.now() - pending.createdAt > PENDING_TTL_MS) {
      await SecureStore.deleteItemAsync(PENDING_KEY, secureOptions());
      return null;
    }
    return pending;
  },
  async savePending(pending) {
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending), secureOptions());
  },
  async clearPending() {
    await SecureStore.deleteItemAsync(PENDING_KEY, secureOptions());
  },
};

/** In-memory store for tests. */
export function createMemoryTokenStore(initial?: StoredSession | null): TokenStore & {
  writes: StoredSession[];
} {
  let session = initial ?? null;
  let pending: PendingAuthRequest | null = null;
  const writes: StoredSession[] = [];
  return {
    writes,
    async load() {
      return session;
    },
    async save(next) {
      session = next;
      writes.push(next);
    },
    async clear() {
      session = null;
    },
    async loadPending() {
      return pending;
    },
    async savePending(next) {
      pending = next;
    },
    async clearPending() {
      pending = null;
    },
  };
}
