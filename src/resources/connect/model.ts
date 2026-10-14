import { Platform } from 'react-native';

/** What the UI calls this device. */
export const THIS_DEVICE = Platform.OS === 'android' ? 'this phone' : 'this iPhone';
import type { BadgeStatus } from '@/lib/status/types';

import type { JoinResult, JoinStage } from './control-plane';
import type { VpnAvailability, VpnStartOptions, VpnState } from '../../../modules/datum-vpn';

/** Tunnel configuration for the extension, from an accepted binding. */
export function toStartOptions(
  result: JoinResult,
  extra: { apiUrl: string; displayName: string; publicKey: string; homeRelayUrls: string[] }
): VpnStartOptions {
  const g = result.grant;
  return {
    project: g.project,
    network: g.network,
    displayName: extra.displayName,
    apiUrl: extra.apiUrl,
    connectorName: g.connectorName,
    publicKey: extra.publicKey,
    bindingName: g.bindingName,
    gatewayName: g.gatewayName,
    gatewayLocation: g.gatewayLocation,
    gatewayEndpointId: g.gatewayEndpointId,
    relayUrls: g.relayUrls,
    // The device endpoint's relays: the environment's (staging), else the
    // gateway's, so the Connector's published home relay is one it uses.
    homeRelayUrls: extra.homeRelayUrls.length > 0 ? extra.homeRelayUrls : g.relayUrls,
    clientAddress: g.clientAddress,
    gatewayAddress: g.gatewayAddress,
    routes: g.routes,
    mtu: g.mtu,
  };
}

export type ConnectPhase = 'unavailable' | 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';

export interface ConnectView {
  phase: ConnectPhase;
  /** Whether the toggle reads as on. */
  on: boolean;
  /** Toggle disabled while a transition is in flight. */
  busy: boolean;
  badge: { status: BadgeStatus; label: string };
  /** One line under the toggle: "Connected · fd…", "Starting the VPC gateway…". */
  detail?: string;
  address?: string;
  routes: string[];
  location?: string;
  mtu?: number;
  error?: string;
  /** This screen's network isn't the one the tunnel is attached to. */
  otherNetwork?: string;
}

const STAGE_COPY: Record<JoinStage, string> = {
  activation: 'Enabling Connect for this project…',
  location: 'Finding the nearest Datum location…',
  gateway: 'Preparing the VPC gateway…',
  connector: `Registering ${THIS_DEVICE}…`,
  binding: 'Requesting access to the network…',
  'gateway-starting': 'Starting the VPC gateway. This can take a few minutes…',
  ready: 'Opening the tunnel…',
};

export function stageCopy(stage: JoinStage | undefined): string {
  return stage ? STAGE_COPY[stage] : 'Connecting…';
}

const hostOf = (cidr?: string) => cidr?.split('/')[0];

/**
 * What the "Connect this iPhone" section shows, from the extension's state,
 * the in-flight mutation (if any) and its last error.
 */
export function connectView(input: {
  availability: VpnAvailability;
  project: string;
  network: string;
  state: VpnState | undefined;
  pending?: 'connect' | 'disconnect';
  stage?: JoinStage;
  error?: string;
}): ConnectView {
  const { availability, state, pending, stage, error } = input;
  const empty: Pick<ConnectView, 'address' | 'routes' | 'location' | 'mtu'> = { routes: [] };
  if (!availability.available) {
    return { ...empty, phase: 'unavailable', on: false, busy: true, badge: { status: 'unknown', label: 'Unavailable' } };
  }
  const ours = state?.project === input.project && state?.network === input.network;
  const other =
    state && !ours && state.network && isActive(state.status) ? `${state.project}/${state.network}` : undefined;
  const status = ours ? state?.status : 'disconnected';
  const tunnel = ours ? state?.tunnel : undefined;
  const address = tunnel?.clientAddress ?? state?.clientAddress;
  const facts: Pick<ConnectView, 'address' | 'routes' | 'location' | 'mtu'> = ours
    ? {
        address: hostOf(address),
        routes: tunnel?.routes ?? state?.routes ?? [],
        location: state?.gatewayLocation,
        mtu: tunnel?.mtu ?? state?.mtu,
      }
    : empty;

  if (pending === 'disconnect' || status === 'disconnecting') {
    return { ...facts, phase: 'disconnecting', on: false, busy: true, badge: { status: 'pending', label: 'Disconnecting' }, detail: 'Disconnecting…', otherNetwork: other };
  }
  if (pending === 'connect') {
    return { ...facts, phase: 'connecting', on: true, busy: true, badge: { status: 'pending', label: 'Connecting' }, detail: stageCopy(stage), otherNetwork: other };
  }
  if (status === 'connecting') {
    return { ...facts, phase: 'connecting', on: true, busy: true, badge: { status: 'pending', label: 'Connecting' }, detail: 'Opening the tunnel…', otherNetwork: other };
  }
  if (status === 'reasserting' || tunnel?.state === 'reconnecting') {
    return {
      ...facts,
      phase: 'connecting',
      on: true,
      busy: false,
      badge: { status: 'pending', label: 'Reconnecting' },
      detail: tunnel?.lastError ? `Reconnecting: ${tunnel.lastError}` : 'Reconnecting…',
      otherNetwork: other,
    };
  }
  if (status === 'connected') {
    const leaseError = tunnel?.lease?.error;
    return {
      ...facts,
      phase: 'connected',
      on: true,
      busy: false,
      badge: { status: 'success', label: 'Connected' },
      detail: facts.address ? `Connected · ${facts.address}` : 'Connected',
      error: leaseError,
      otherNetwork: other,
    };
  }
  if (error) {
    return { ...empty, phase: 'error', on: false, busy: false, badge: { status: 'error', label: 'Error' }, detail: 'Not connected', error, otherNetwork: other };
  }
  return { ...empty, phase: 'disconnected', on: false, busy: false, badge: { status: 'unknown', label: 'Disconnected' }, detail: 'Not connected', otherNetwork: other };
}

export function isActive(status: VpnState['status'] | undefined): boolean {
  return status === 'connected' || status === 'connecting' || status === 'reasserting';
}

/** Copy for a build or device that can't run the tunnel. */
export function unavailableCopy(availability: VpnAvailability): { title: string; description: string } {
  if (Platform.OS === 'android') {
    return {
      title: 'Needs a newer build',
      description: 'This build of the app doesn’t include Datum Connect. Install the latest build to connect this phone.',
    };
  }
  if (availability.reason === 'simulator') {
    return {
      title: 'Not available in the Simulator',
      description:
        'iOS runs VPN tunnels only on a real device. Install the Datum team build on an iPhone to connect it to this network.',
    };
  }
  return {
    title: 'Needs the Datum team build',
    description:
      'Connecting this iPhone to a VPC uses a VPN extension that only the Datum team build includes. Install that build to use it.',
  };
}
