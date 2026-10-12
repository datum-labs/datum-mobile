import { isEmailNotVerifiedDenial } from '@/auth/email-verification';

import { ApiError, EmailNotVerifiedError, parseK8sStatus } from './errors';
import { resourcePath, type ResourcePath, type Scope } from './scopes';

/** The parts of SessionManager the client needs (kept narrow for tests). */
export interface TokenSource {
  getAccessToken(): Promise<string>;
  handleUnauthorized(rejected: string): Promise<string>;
  refresh(): Promise<string>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenSource;
  fetchImpl?: typeof fetch;
  /** Called when milo denies the user for an unverified email (after one fresh-token retry). */
  onEmailNotVerified?: () => void;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

type Method = 'GET' | 'POST';

export interface K8sList<T> {
  items?: T[];
  metadata?: { continue?: string; resourceVersion?: string };
}

function withQuery(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const parts = Object.entries(query)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  if (parts.length === 0) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${parts.join('&')}`;
}

/**
 * Thin, read-only fetch client for the Milo control-plane API.
 *
 * - Injects `Authorization: Bearer <access token>` from the session.
 * - On 401, asks the session for a refreshed token (single-flight) and
 *   retries exactly once. Zitadel revokes the old access token on refresh,
 *   so a request can legitimately lose a race with a concurrent refresh.
 * - On a 403 carrying milo's EmailNotVerified cause, mints a fresh token and
 *   retries once (the API server caches TokenReviews per token for ~2 min, so
 *   a user who just verified can still be held as unverified); if it
 *   persists, throws EmailNotVerifiedError.
 */
export function createApiClient({ baseUrl, tokens, fetchImpl, onEmailNotVerified }: ApiClientOptions) {
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const call = (method: Method, path: string, token: string, signal?: AbortSignal, body?: string) =>
    doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      signal,
    });

  async function request<T>(
    method: Method,
    path: string,
    options: RequestOptions & { body?: unknown } = {}
  ): Promise<T> {
    const fullPath = withQuery(path, options.query);
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const send = (token: string) => call(method, fullPath, token, options.signal, payload);
    let token = await tokens.getAccessToken();
    let res = await send(token);

    if (res.status === 401) {
      token = await tokens.handleUnauthorized(token);
      res = await send(token);
    }

    if (res.status === 403) {
      let body = await res.text();
      if (isEmailNotVerifiedDenial(body)) {
        try {
          token = await tokens.refresh();
          res = await send(token);
          body = res.ok ? '' : await res.text();
        } catch {
          // Refresh failed: fall through with the original denial.
        }
        if (!res.ok && isEmailNotVerifiedDenial(body)) {
          onEmailNotVerified?.();
          throw new EmailNotVerifiedError();
        }
      }
      if (!res.ok) {
        const { message, reason } = parseK8sStatus(body, res.status);
        throw new ApiError(res.status, message, path, reason);
      }
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const { message, reason } = parseK8sStatus(body, res.status);
      throw new ApiError(res.status, message, path, reason);
    }
    return (await res.json()) as T;
  }

  function get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return request<T>('GET', path, options);
  }

  /**
   * POST a review-style object (SelfSubjectAccessReview). The app never
   * mutates resources; reviews are create-only and side-effect free.
   */
  function post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return request<T>('POST', path, { ...options, body });
  }

  /** GET a single object. */
  function getResource<T>(scope: Scope, path: ResourcePath, options?: RequestOptions): Promise<T> {
    return get<T>(resourcePath(scope, path), options);
  }

  /** LIST every page of a collection (follows `metadata.continue`). */
  async function listResource<T>(
    scope: Scope,
    path: Omit<ResourcePath, 'name'>,
    options: RequestOptions & { pageSize?: number } = {}
  ): Promise<T[]> {
    const items: T[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
      const page = await get<K8sList<T>>(resourcePath(scope, path), {
        signal: options.signal,
        query: { ...options.query, limit: options.pageSize ?? 500, continue: token },
      });
      items.push(...(page.items ?? []));
      token = page.metadata?.continue || undefined;
      pages += 1;
    } while (token && pages < 20);
    return items;
  }

  return { get, post, getResource, listResource };
}

export type ApiClient = ReturnType<typeof createApiClient>;
