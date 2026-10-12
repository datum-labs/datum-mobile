import type { JoinResult } from '../control-plane';
import { connectView, toStartOptions, unavailableCopy } from '../model';

const available = { available: true, reason: 'ok' as const };

const join: JoinResult = {
  grant: {
    network: 'default',
    project: 'p',
    bindingName: 'binding-1',
    connectorName: 'connect-abc',
    gatewayName: 'connect-default-us-east-1-f9aa9c30bd',
    gatewayLocation: 'us-east-1',
    gatewayEndpointId: 'e'.repeat(64),
    clientAddress: 'fd80::1/128',
    gatewayAddress: 'fd6f::1/128',
    routes: ['fd20:0:10::/48'],
    relayUrls: ['https://relay.example.com'],
    mtu: 1280,
  },
  connector: { name: 'connect-abc', uid: 'u', publicKey: 'k' },
  gatewayCreated: false,
  bindingCreated: true,
};

describe('toStartOptions', () => {
  test('falls back to the gateway relays for the device endpoint', () => {
    const options = toStartOptions(join, {
      apiUrl: 'https://api.datum.net',
      displayName: 'Default',
      publicKey: 'k',
      homeRelayUrls: [],
    });
    expect(options.homeRelayUrls).toEqual(['https://relay.example.com']);
    expect(options).toMatchObject({
      project: 'p',
      network: 'default',
      clientAddress: 'fd80::1/128',
      routes: ['fd20:0:10::/48'],
      mtu: 1280,
      publicKey: 'k',
    });
  });
});

describe('connectView', () => {
  const base = { availability: available, project: 'p', network: 'default' };

  test('unavailable builds disable the section', () => {
    const view = connectView({ ...base, availability: { available: false, reason: 'simulator' }, state: undefined });
    expect(view.phase).toBe('unavailable');
    expect(unavailableCopy({ available: false, reason: 'simulator' }).title).toMatch(/Simulator/);
    expect(unavailableCopy({ available: false, reason: 'not-configured' }).title).toMatch(/team build/);
  });

  test('disconnected by default', () => {
    expect(connectView({ ...base, state: { status: 'invalid' } })).toMatchObject({
      phase: 'disconnected',
      on: false,
      badge: { label: 'Disconnected' },
    });
  });

  test('connecting shows the join stage', () => {
    expect(connectView({ ...base, state: undefined, pending: 'connect', stage: 'gateway-starting' })).toMatchObject({
      phase: 'connecting',
      on: true,
      busy: true,
      detail: expect.stringMatching(/Starting the VPC gateway/),
    });
  });

  test('connected shows the address and routes for this network only', () => {
    const state = {
      status: 'connected' as const,
      project: 'p',
      network: 'default',
      clientAddress: 'fd80::1/128',
      routes: ['fd20:0:10::/48'],
      gatewayLocation: 'us-east-1',
      mtu: 1280,
    };
    expect(connectView({ ...base, state })).toMatchObject({
      phase: 'connected',
      detail: 'Connected · fd80::1',
      address: 'fd80::1',
      routes: ['fd20:0:10::/48'],
      badge: { status: 'success' },
    });
    expect(connectView({ ...base, network: 'other', state })).toMatchObject({
      phase: 'disconnected',
      otherNetwork: 'p/default',
    });
  });

  test('reconnecting and errors', () => {
    expect(
      connectView({
        ...base,
        state: { status: 'connected', project: 'p', network: 'default', tunnel: { state: 'reconnecting', lastError: 'timeout' } },
      })
    ).toMatchObject({ phase: 'connecting', badge: { label: 'Reconnecting' }, detail: 'Reconnecting: timeout' });
    expect(connectView({ ...base, state: { status: 'disconnected' }, error: 'nope' })).toMatchObject({
      phase: 'error',
      error: 'nope',
      badge: { status: 'error' },
    });
  });
});
