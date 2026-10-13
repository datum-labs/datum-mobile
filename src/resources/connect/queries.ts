import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { describeError } from '@/api';

import { DatumVpn, type VpnState } from '../../../modules/datum-vpn';
import { DatumWidgets } from '../../../modules/datum-widgets';
import { ConnectError, type JoinStage } from './control-plane';
import { connectView, isActive } from './model';
import { connectService } from './service';

export const connectKeys = {
  all: ['connect'] as const,
  vpn: () => [...connectKeys.all, 'vpn'] as const,
};

/** Token hand-off cadence while the tunnel is up and the app is active. */
const TOKEN_SHARE_MS = 5 * 60_000;

/** The tunnel's state: NEVPNStatus events plus the extension's own report. */
export function useVpnState(enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: connectKeys.vpn(),
    queryFn: () => connectService.state(),
    enabled,
    // Counters and reconnect state come from the extension; poll while up.
    refetchInterval: (q) => (isActive((q.state.data as VpnState | undefined)?.status) ? 5_000 : false),
    meta: { persist: false },
  });
  useEffect(() => {
    if (!enabled) return;
    const subscription = DatumVpn.onStatusChange(() => {
      void client.invalidateQueries({ queryKey: connectKeys.vpn() });
      DatumWidgets.reloadControls();
    });
    return () => subscription.remove();
  }, [client, enabled]);
  return query;
}

/** While the tunnel is up, keep the extension supplied with a fresh token. */
function useTokenHandOff(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const share = () => void connectService.shareAccessToken().catch(() => undefined);
    share();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') share();
    }, TOKEN_SHARE_MS);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') share();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [active]);
}

/**
 * App-wide, while signed in: keep the "Connect to VPC" control usable. When a
 * tunnel configuration exists (connected or paused from the control), hand
 * the extension a fresh access token whenever the app becomes active, so the
 * control can check the join and resume it later without refreshing tokens
 * itself; and refresh the control when the tunnel's state changes.
 */
export function useConnectControlSync(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn || !connectService.availability().available) return;
    const share = async () => {
      const state = await connectService.state().catch(() => undefined);
      if (state && state.status !== 'invalid') await connectService.shareAccessToken().catch(() => undefined);
    };
    void share();
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void share();
    });
    const vpn = DatumVpn.onStatusChange(() => DatumWidgets.reloadControls());
    return () => {
      appState.remove();
      vpn.remove();
    };
  }, [signedIn]);
}

/**
 * Everything the "Connect this iPhone" section needs for one network:
 * availability, live state, connect/disconnect and progress.
 */
export function useConnectThisDevice(project: string | undefined, network: string | undefined, displayName?: string) {
  const client = useQueryClient();
  const availability = useMemo(() => connectService.availability(), []);
  const vpn = useVpnState(availability.available);
  const [stage, setStage] = useState<JoinStage>();
  const [error, setError] = useState<string>();

  const connect = useMutation({
    mutationFn: async (options: { requestGated?: boolean } = {}) => {
      setError(undefined);
      setStage(undefined);
      return connectService.connect({
        project: project as string,
        network: network as string,
        displayName: displayName ?? (network as string),
        requestGated: options.requestGated,
        onProgress: (next) => setStage(next),
      });
    },
    onError: (e) => setError(connectErrorMessage(e)),
    onSettled: () => client.invalidateQueries({ queryKey: connectKeys.vpn() }),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      setError(undefined);
      return connectService.disconnect({ project: project as string, network: network as string });
    },
    onError: (e) => setError(connectErrorMessage(e)),
    onSettled: () => client.invalidateQueries({ queryKey: connectKeys.vpn() }),
  });

  const view = connectView({
    availability,
    project: project ?? '',
    network: network ?? '',
    state: vpn.data,
    pending: connect.isPending ? 'connect' : disconnect.isPending ? 'disconnect' : undefined,
    stage,
    error: error ?? (vpn.data?.tunnel?.state === 'failed' ? (vpn.data.tunnel.lastError ?? undefined) : undefined),
  });
  useTokenHandOff(view.phase === 'connected');

  return {
    availability,
    view,
    errorCode: connect.error instanceof ConnectError ? connect.error.code : undefined,
    connect: (options?: { requestGated?: boolean }) => connect.mutate(options ?? {}),
    disconnect: () => disconnect.mutate(),
    refresh: () => vpn.refetch(),
  };
}

export function connectErrorMessage(error: unknown): string {
  if (error instanceof ConnectError) return error.message;
  if (error instanceof Error && /permission|denied|declined/i.test(error.message)) {
    return 'iOS needs your permission to add the Datum VPN configuration.';
  }
  return describeError(error);
}
