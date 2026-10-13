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

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

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
 * Thin fetch client for the Milo control-plane API.
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
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  function get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return request<T>('GET', path, options);
  }

  /**
   * POST: review-style objects (SelfSubjectAccessReview), creating a private
   * Network, and, for Connect, this device's own Connector, gateway and binding.
   */
  function post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return request<T>('POST', path, { ...options, body });
  }

  /** PUT a full object (Connect: the Connector's Lease renewal). */
  function put<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return request<T>('PUT', path, { ...options, body });
  }

  /** DELETE, optionally with DeleteOptions (preconditions). */
  async function del(path: string, body?: unknown, options: RequestOptions = {}): Promise<void> {
    await request<unknown>('DELETE', path, { ...options, body });
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

  /**
   * An authenticated `fetch` against the API for callers that read the
   * response themselves (the assistant's shared history helpers): bearer
   * token, one retry on 401 with a refreshed token, the raw `Response` back.
   */
  async function rawFetch(
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}
  ): Promise<Response> {
    const send = (token: string) =>
      doFetch(`${baseUrl}${path}`, {
        ...init,
        headers: { Accept: 'application/json', ...init.headers, Authorization: `Bearer ${token}` },
      });
    let token = await tokens.getAccessToken();
    let res = await send(token);
    if (res.status === 401) {
      token = await tokens.handleUnauthorized(token);
      res = await send(token);
    }
    return res;
  }

  return { get, post, put, del, getResource, listResource, fetch: rawFetch };
}

export type ApiClient = ReturnType<typeof createApiClient>;
