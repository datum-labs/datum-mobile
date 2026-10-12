import * as Crypto from 'expo-crypto';

import { api, ApiError } from '@/api';
import { session } from '@/auth/instance';
import { env } from '@/config/env';

import { DatumVpn } from '../../../modules/datum-vpn';
import * as cp from './control-plane';
import { isActive, toStartOptions } from './model';

/** The control plane's HTTP seam over the app's API client. */
export const connectHttp: cp.ConnectHttp = {
  async get<T>(path: string) {
    try {
      return await api.get<T>(path);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  post: (path, body) => api.post(path, body),
  put: (path, body) => api.put(path, body),
  delete: (path, body) => api.del(path, body),
};

async function edgeInfo(): Promise<string> {
  // The daemon gives edge.datum.net 5 s.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(cp.EDGE_INFO_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new cp.ConnectError(
        'location_unavailable',
        `Couldn't find your nearest Datum location (edge.datum.net returned HTTP ${res.status}).`
      );
    }
    return await res.text();
  } catch (error) {
    if (error instanceof cp.ConnectError) throw error;
    throw new cp.ConnectError(
      'location_unavailable',
      "Couldn't reach edge.datum.net to find your nearest Datum location. Check your connection and try again."
    );
  } finally {
    clearTimeout(timer);
  }
}

export function connectDeps(extra: Partial<cp.ConnectDeps> = {}): cp.ConnectDeps {
  return {
    http: connectHttp,
    sha256Hex: (input) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input),
    edgeInfo,
    ...extra,
  };
}

export interface ConnectRequest {
  project: string;
  network: string;
  displayName: string;
  onProgress?: cp.ConnectDeps['onProgress'];
  /** Submit a provider-gated activation request (after the user confirms). */
  requestGated?: boolean;
}

export const connectService = {
  availability: () => DatumVpn.availability(),

  state: () => DatumVpn.status(),

  activation: (project: string) => cp.observeActivation(connectDeps(), project),

  /**
   * `datumctl connect join NETWORK --project P`, for this iPhone: activate
   * Connect, enroll this device's Connector, select or create the nearest
   * gateway, wait for the binding, then start the packet tunnel with it.
   */
  async connect(request: ConnectRequest): Promise<cp.JoinResult> {
    const { project, network } = request;
    const deps = connectDeps({ onProgress: request.onProgress });

    // One tunnel per app: leaving another network first keeps its grant
    // from lingering on its gateway.
    const current = await DatumVpn.status();
    if (isActive(current.status) && current.project && current.network && (current.project !== project || current.network !== network)) {
      await connectService.disconnect({ project: current.project, network: current.network });
    }

    request.onProgress?.('activation');
    await cp.ensureActivated(deps, project, { requestGated: request.requestGated });
    const publicKey = await DatumVpn.ensureConnectorKey(project);
    const homeRelayUrls = cp.homeRelaysFor(env.apiUrl);
    const result = await cp.joinGatewayNetwork(deps, { project, network, publicKey, homeRelayUrls });

    await DatumVpn.setAccessToken(await session.getAccessToken());
    await DatumVpn.start(
      toStartOptions(result, { apiUrl: env.apiUrl, displayName: request.displayName, publicKey, homeRelayUrls })
    );
    return result;
  },

  /**
   * `datumctl connect leave NETWORK`: close the local tunnel first, then
   * delete this device's binding (its gateway grant). Safe to repeat.
   */
  async disconnect({ project, network }: { project: string; network: string }): Promise<boolean> {
    await DatumVpn.stop();
    const publicKey = await DatumVpn.getConnectorKey(project);
    if (!publicKey) return false;
    return cp.leaveGatewayNetwork(connectDeps(), {
      project,
      network,
      connectorName: cp.defaultConnectorName(publicKey),
    });
  },

  /** Keep the extension's Lease renewal supplied with a current token. */
  async shareAccessToken(): Promise<void> {
    await DatumVpn.setAccessToken(await session.getAccessToken());
  },
};
