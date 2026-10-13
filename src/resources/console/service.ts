import { fetch as expoFetch } from 'expo/fetch';

import { api, projectScopedBase } from '@/api';
import { session } from '@/auth/instance';
import { env } from '@/config/env';

import {
  fetchShellAccess,
  httpSessionDeps,
  type ConsoleFetch,
  type ConsoleHttp,
  type ConsoleResponse,
  type ShellConnector,
  type ShellSessionDeps,
} from './control-plane';

/**
 * The console control plane wired to the app: requests go through the API
 * client (bearer token, one retry on 401) under the project's control plane.
 * Watches use `expo/fetch`, whose response bodies stream (React Native's
 * fetch buffers them), with the same token handling.
 */
export function consoleHttp(projectId: string): ConsoleHttp {
  const base = projectScopedBase(projectId);
  const fetch: ConsoleFetch = (path, init) =>
    api.fetch(`${base}${path}`, init) as Promise<ConsoleResponse>;
  const streamFetch: ConsoleFetch = async (path, init = {}) => {
    const send = (token: string) =>
      expoFetch(`${env.apiUrl}${base}${path}`, {
        method: init.method,
        body: init.body,
        signal: init.signal,
        headers: { Accept: 'application/json', ...init.headers, Authorization: `Bearer ${token}` },
      });
    let token = await session.getAccessToken();
    let res = await send(token);
    if (res.status === 401) {
      token = await session.handleUnauthorized(token);
      res = await send(token);
    }
    return res as unknown as ConsoleResponse;
  };
  return { fetch, streamFetch };
}

export const consoleService = {
  access: (projectId: string) => fetchShellAccess(consoleHttp(projectId)),
  sessionDeps: (projectId: string, createConnector: () => ShellConnector): ShellSessionDeps =>
    httpSessionDeps(consoleHttp(projectId), createConnector),
};
