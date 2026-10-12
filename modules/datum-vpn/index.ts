import { requireOptionalNativeModule } from 'expo';

/** NEVPNStatus, as a string. */
export type VpnStatus = 'invalid' | 'disconnected' | 'connecting' | 'connected' | 'reasserting' | 'disconnecting';

export interface VpnAvailability {
  available: boolean;
  /** `simulator`: NE doesn't run there. `not-configured`: built without IOS_VPN=1. */
  reason: 'ok' | 'simulator' | 'not-configured' | 'no-module';
  providerBundleIdentifier?: string;
}

/** Non-secret tunnel configuration (stored as `providerConfiguration`). */
export interface VpnStartOptions {
  project: string;
  network: string;
  displayName: string;
  apiUrl: string;
  connectorName: string;
  publicKey: string;
  bindingName: string;
  gatewayName: string;
  gatewayLocation: string;
  gatewayEndpointId: string;
  relayUrls: string[];
  homeRelayUrls: string[];
  clientAddress: string;
  gatewayAddress: string;
  routes: string[];
  mtu: number;
}

/** What the running extension reports (the Rust core's SessionStatus). */
export interface TunnelReport {
  state?: 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'stopped';
  sessionId?: string | null;
  clientAddress?: string;
  gatewayAddress?: string;
  routes?: string[];
  mtu?: number;
  packetsSent?: number;
  packetsReceived?: number;
  packetsDropped?: number;
  datagramCapacity?: number;
  reconnects?: number;
  lastError?: string | null;
  errorCode?: string | null;
  lease?: { renewedAt?: number; error?: string };
}

export interface VpnState {
  status: VpnStatus;
  enabled?: boolean;
  project?: string;
  network?: string;
  clientAddress?: string;
  gatewayAddress?: string;
  routes?: string[];
  mtu?: number;
  gatewayLocation?: string;
  connectedAt?: number;
  tunnel?: TunnelReport;
}

interface Subscription {
  remove(): void;
}

interface DatumVpnNative {
  getAvailability(): VpnAvailability;
  ensureConnectorKey(project: string): Promise<string>;
  getConnectorKey(project: string): Promise<string | null>;
  setAccessToken(token: string): Promise<void>;
  start(options: VpnStartOptions): Promise<void>;
  stop(): Promise<void>;
  removeConfiguration(): Promise<void>;
  getStatus(): Promise<VpnState>;
  addListener(event: 'onStatusChange', listener: (state: VpnState) => void): Subscription;
}

const native = requireOptionalNativeModule<DatumVpnNative>('DatumVpn');

function requireNative(): DatumVpnNative {
  if (!native) throw new Error('This build doesn’t include the Datum VPN module.');
  return native;
}

/**
 * The Datum Connect packet tunnel (`DatumTunnel` Network Extension), via
 * NETunnelProviderManager. Unavailable in the Simulator and in builds made
 * without IOS_VPN=1; check `availability()` first.
 */
export const DatumVpn = {
  availability(): VpnAvailability {
    if (!native) return { available: false, reason: 'no-module' };
    try {
      return native.getAvailability();
    } catch {
      return { available: false, reason: 'no-module' };
    }
  },
  /** This device's Connector public key for a project (created on first use). */
  ensureConnectorKey: (project: string) => requireNative().ensureConnectorKey(project),
  getConnectorKey: (project: string) => (native ? native.getConnectorKey(project) : Promise.resolve(null)),
  /** Hand the extension a current access token for Lease renewal. */
  setAccessToken: (token: string) => requireNative().setAccessToken(token),
  start: (options: VpnStartOptions) => requireNative().start(options),
  stop: () => (native ? native.stop() : Promise.resolve()),
  removeConfiguration: () => (native ? native.removeConfiguration() : Promise.resolve()),
  status: (): Promise<VpnState> => (native ? native.getStatus() : Promise.resolve({ status: 'invalid' })),
  onStatusChange(listener: (state: VpnState) => void): Subscription {
    if (!native) return { remove() {} };
    return native.addListener('onStatusChange', listener);
  },
};
