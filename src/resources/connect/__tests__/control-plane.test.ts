import { createHash } from 'node:crypto';

import * as cp from '../control-plane';

const PROJECT = 'demo-project';
const BASE = `/apis/resourcemanager.miloapis.com/v1alpha1/projects/${PROJECT}/control-plane`;
const CONNECT = `${BASE}/apis/connect.datumapis.com/v1alpha1`;
const KEY = 'af18f4d600a7ed6a171e3f595e5a2a3d308c7351ff8c7ef4c85202abe2ebd69c';
const CONNECTOR = `connect-${KEY.slice(0, 40)}`;

const sha256Hex = async (input: string) => createHash('sha256').update(input, 'utf8').digest('hex');

class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

type Obj = cp.KObject & Record<string, unknown>;

/** A tiny in-memory API server: objects by path, lists by collection. */
class FakeApi {
  objects = new Map<string, Obj>();
  calls: { method: string; path: string; body?: unknown }[] = [];
  private uid = 0;
  /** Runs on every sleep: plays the controllers. */
  onTick: () => void = () => undefined;

  put(path: string, object: Obj) {
    this.objects.set(path, object);
  }

  http: cp.ConnectHttp = {
    get: async <T>(path: string) => {
      this.calls.push({ method: 'GET', path });
      const object = this.objects.get(path);
      if (object) return structuredClone(object) as T;
      const prefix = `${path}/`;
      const items = [...this.objects.entries()]
        .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map(([, o]) => structuredClone(o));
      if (items.length > 0 || this.collections.has(path)) return { items } as T;
      return null;
    },
    post: async <T>(path: string, body: unknown) => {
      this.calls.push({ method: 'POST', path, body });
      const object = structuredClone(body) as Obj;
      const name = object.metadata?.name as string;
      const full = `${path}/${name}`;
      if (this.objects.has(full)) throw new HttpError(409);
      this.uid += 1;
      object.metadata = { ...object.metadata, uid: `uid-${this.uid}`, generation: 1, resourceVersion: '1' };
      this.objects.set(full, object);
      return structuredClone(object) as T;
    },
    put: async <T>(path: string, body: unknown) => {
      this.calls.push({ method: 'PUT', path, body });
      if (!this.objects.has(path)) throw new HttpError(404);
      this.objects.set(path, structuredClone(body) as Obj);
      return structuredClone(body) as T;
    },
    delete: async (path: string, body?: unknown) => {
      this.calls.push({ method: 'DELETE', path, body });
      if (!this.objects.delete(path)) throw new HttpError(404);
    },
  };

  /** Collections that exist even when empty (installed APIs). */
  collections = new Set<string>();

  deps(extra: Partial<cp.ConnectDeps> = {}): cp.ConnectDeps {
    return {
      http: this.http,
      sha256Hex,
      edgeInfo: async () => '{"region":"us-east-1","zone":"us-east-1"}',
      sleep: async () => this.onTick(),
      now: () => new Date('2026-10-12T22:58:01.123Z'),
      ...extra,
    };
  }
}

const ready = (type = 'Ready', generation = 1) => ({
  type,
  status: 'True',
  observedGeneration: generation,
});

function installConnect(api: FakeApi) {
  api.collections.add(`${CONNECT}/namespaces/default/connectgateways`);
  api.collections.add(`${CONNECT}/namespaces/default/connectnetworkbindings`);
  api.collections.add(`${CONNECT}/namespaces/default/connectors`);
  api.put(`${CONNECT}/connectorclasses/connect-staging-masque-v1`, {
    metadata: { name: 'connect-staging-masque-v1', generation: 1 },
    spec: { transports: ['masque-v1'] },
    status: { conditions: [ready()] },
  });
  api.put(`${CONNECT}/connectgatewayclasses/standard`, {
    metadata: { name: 'standard', generation: 1 },
    spec: {
      controllerName: 'connect.datum.net/gateway-controller',
      default: true,
      relayURLs: ['https://iroh-relay.us-central-1.datum-staging.net', 'https://iroh-relay.us-east-1.datum-staging.net'],
    },
    status: { conditions: [ready()] },
  });
  api.put(`${BASE}/apis/networking.datumapis.com/v1alpha/namespaces/default/networks/default`, {
    metadata: { name: 'default', generation: 1 },
    status: { ipam: { ipv6Prefix: 'fd20:0:10::/48' } },
  });
}

/** The Connect controller: Lease + Ready for Connectors, Accepted bindings. */
function playController(api: FakeApi, options: { bindingAfterTicks?: number; rejectWith?: string } = {}) {
  let ticks = 0;
  api.onTick = () => {
    ticks += 1;
    for (const [path, object] of api.objects) {
      if (path.includes('/connectors/') && !object.status) {
        object.status = { leaseRef: 'connect-lease-1', conditions: [ready()] };
        api.put(`${BASE}/apis/coordination.k8s.io/v1/namespaces/default/leases/connect-lease-1`, {
          metadata: { name: 'connect-lease-1', resourceVersion: '7' },
          spec: { holderIdentity: 'controller' },
        });
      }
      if (path.includes('/connectnetworkbindings/') && ticks >= (options.bindingAfterTicks ?? 1)) {
        object.status = options.rejectWith
          ? { conditions: [{ type: 'Accepted', status: 'False', reason: options.rejectWith, observedGeneration: 1 }] }
          : {
              endpointID: '155279db1c3e31ce28938caf78842596b1b182eee7fbbc3bc86c0e7c0f8b6a4e',
              assignedAddress: 'fd80:ba85:dcb2:bb05:219b:b959:899d:7db9/128',
              peerAddress: 'fd6f:2bd1:8c12:348a:af5d:d4bb:b988:1d92/128',
              routes: ['fd20:0:10::/48'],
              relayURLs: ['https://iroh-relay.us-central-1.datum-staging.net'],
              conditions: [ready('Accepted')],
            };
      }
    }
  };
}

describe('deterministic names (byte-for-byte with successor/mod.rs)', () => {
  test('match resources the daemon created on staging', async () => {
    await expect(cp.networkGatewayName(sha256Hex, 'connect-auto-vpc-20261007', 'IAD')).resolves.toBe(
      'connect-connect-auto-vpc-20261007-iad-64f6db945c'
    );
    await expect(cp.networkBindingName(sha256Hex, 'connect-auto-vpc-20261007', 'mac-studio')).resolves.toBe(
      'binding-340c6158f6feb170'
    );
  });

  test('gateway stem is sanitised and truncated', async () => {
    const name = await cp.networkGatewayName(sha256Hex, '--' + 'x'.repeat(50), 'us-east-1');
    expect(name).toMatch(/^connect-x{35}-us-east-1-[0-9a-f]{10}$/);
  });

  test('default Connector name is the key prefix', () => {
    expect(cp.defaultConnectorName(KEY)).toBe(CONNECTOR);
    expect(() => cp.defaultConnectorName('nope')).toThrow(cp.ConnectError);
  });
});

describe('helpers', () => {
  test('currentCondition requires the current generation', () => {
    const r = (observedGeneration: number, generation = 2) => ({
      metadata: { generation },
      status: { conditions: [{ type: 'Ready', status: 'True', observedGeneration }] },
    });
    expect(cp.currentCondition(r(2), 'Ready')).toBe(true);
    expect(cp.currentCondition(r(1), 'Ready')).toBe(false);
    expect(cp.currentCondition(r(0, 0), 'Ready')).toBe(false);
    expect(cp.currentCondition({}, 'Ready')).toBe(false);
  });

  test('edge location from the text and JSON forms', () => {
    expect(cp.parseEdgeLocation('ip=1.2.3.4\ncolo=IAD\nregion=us-east-1\nzone=us-east-1\n')).toBe('us-east-1');
    expect(cp.parseEdgeLocation('{"region":"us-central-1"}')).toBe('us-central-1');
    expect(() => cp.parseEdgeLocation('<!DOCTYPE html>')).toThrow(cp.ConnectError);
    expect(() => cp.parseEdgeLocation('region=US_EAST')).toThrow(cp.ConnectError);
  });

  test('microTime matches chrono SecondsFormat::Micros', () => {
    expect(cp.microTime(new Date('2026-10-12T22:58:01.123Z'))).toBe('2026-10-12T22:58:01.123000Z');
  });

  test('endpoint JSON is an iroh EndpointAddr with a relay', () => {
    expect(JSON.parse(cp.endpointJson(KEY, 'https://iroh-relay.us-east-1.datum-staging.net'))).toEqual({
      id: KEY,
      addrs: [{ Relay: 'https://iroh-relay.us-east-1.datum-staging.net/' }],
    });
  });

  test('staging selects the Datum staging relays only for the exact host', () => {
    expect(cp.homeRelaysFor('https://api.staging.env.datum.net')).toEqual(cp.STAGING_RELAYS);
    expect(cp.homeRelaysFor('https://api.datum.net')).toEqual([]);
    expect(cp.homeRelaysFor('https://api.staging.env.datum.net.example.com')).toEqual([]);
  });
});

describe('activation (service-catalog gate)', () => {
  const services = (mode?: string) => ({
    metadata: { name: 'connect-datumapis-com' },
    spec: {
      serviceName: 'connect.datumapis.com',
      displayName: 'Connect',
      phase: 'Published',
      enablementPolicy: mode ? { mode } : null,
    },
  });
  const entitlements = `${BASE}/apis/services.miloapis.com/v1alpha1/serviceentitlements`;

  function setup(mode?: string) {
    const api = new FakeApi();
    api.put('/apis/services.miloapis.com/v1alpha1/services/connect-datumapis-com', services(mode));
    api.collections.add(entitlements);
    return api;
  }

  test('classifies entitlements like activation.Classify', () => {
    const e = (phase?: string, reason?: string, entitledAt?: string) => ({
      status: { phase, entitledAt, conditions: phase ? [{ type: 'Ready', reason }] : [] },
    });
    expect(cp.classifyEntitlement(undefined)).toBe('NotRequested');
    expect(cp.classifyEntitlement(e())).toBe('Processing');
    expect(cp.classifyEntitlement(e('Active'))).toBe('Active');
    expect(cp.classifyEntitlement(e('PendingApproval'))).toBe('PendingApproval');
    expect(cp.classifyEntitlement(e('Rejected', 'ServiceNotPublished'))).toBe('Unavailable');
    expect(cp.classifyEntitlement(e('Rejected', 'x', '2026-01-01T00:00:00Z'))).toBe('Revoked');
    expect(cp.classifyEntitlement(e('Rejected', 'x'))).toBe('Denied');
  });

  test('self-service is enabled outright, then waits for Active', async () => {
    const api = setup('SelfService');
    api.onTick = () => {
      const e = api.objects.get(`${entitlements}/connect-datumapis-com`);
      if (e) e.status = { phase: 'Active', conditions: [{ type: 'Ready', status: 'True' }] };
    };
    const result = await cp.ensureActivated(api.deps(), PROJECT);
    expect(result.state).toBe('Active');
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      apiVersion: 'services.miloapis.com/v1alpha1',
      kind: 'ServiceEntitlement',
      metadata: { name: 'connect-datumapis-com' },
      spec: { serviceRef: { name: 'connect-datumapis-com' } },
    });
  });

  test('already Active does nothing', async () => {
    const api = setup();
    api.put(`${entitlements}/connect-datumapis-com`, {
      metadata: { name: 'connect-datumapis-com' },
      spec: { serviceRef: { name: 'connect-datumapis-com' } },
      status: { phase: 'Active', serviceName: 'connect.datumapis.com', conditions: [{ type: 'Ready', status: 'True' }] },
    });
    await expect(cp.ensureActivated(api.deps(), PROJECT)).resolves.toMatchObject({ state: 'Active' });
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  test('provider-gated needs an explicit request', async () => {
    const api = setup('GatedByProvider');
    await expect(cp.ensureActivated(api.deps(), PROJECT)).rejects.toMatchObject({
      code: 'activation_approval_required',
    });
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);

    api.onTick = () => {
      const e = api.objects.get(`${entitlements}/connect-datumapis-com`);
      if (e) e.status = { phase: 'PendingApproval', conditions: [{ type: 'Ready', status: 'False' }] };
    };
    await expect(cp.ensureActivated(api.deps(), PROJECT, { requestGated: true })).rejects.toMatchObject({
      code: 'activation_PendingApproval',
    });
  });

  test('denied access reports and never re-requests', async () => {
    const api = setup();
    api.put(`${entitlements}/connect-datumapis-com`, {
      metadata: { name: 'connect-datumapis-com' },
      spec: { serviceRef: { name: 'connect-datumapis-com' } },
      status: { phase: 'Rejected', conditions: [{ type: 'Ready', status: 'False', reason: 'EntitlementRejected' }] },
    });
    await expect(cp.ensureActivated(api.deps(), PROJECT)).rejects.toMatchObject({ code: 'activation_Denied' });
  });
});

describe('join (successor::join_gateway_network)', () => {
  test('creates the gateway, Connector and binding, renews the Lease and returns the grant', async () => {
    const api = new FakeApi();
    installConnect(api);
    playController(api, { bindingAfterTicks: 3 });
    const stages: string[] = [];
    const result = await cp.joinGatewayNetwork(api.deps({ onProgress: (s) => stages.push(s) }), {
      project: PROJECT,
      network: 'default',
      publicKey: KEY,
      homeRelayUrls: cp.STAGING_RELAYS,
    });

    const gatewayName = await cp.networkGatewayName(sha256Hex, 'default', 'us-east-1');
    const gateway = api.objects.get(`${CONNECT}/namespaces/default/connectgateways/${gatewayName}`);
    expect(gateway?.spec).toEqual({
      gatewayClassRef: 'standard',
      networkRef: 'default',
      locationRef: 'us-east-1',
      routes: ['fd20:0:10::/48'],
      relayURLs: ['https://iroh-relay.us-central-1.datum-staging.net', 'https://iroh-relay.us-east-1.datum-staging.net'],
    });

    const connector = api.objects.get(`${CONNECT}/namespaces/default/connectors/${CONNECTOR}`);
    expect(connector?.spec).toEqual({
      classRef: 'connect-staging-masque-v1',
      publicKey: KEY,
      relayURLs: ['https://iroh-relay.us-central-1.datum-staging.net/'],
      endpoint: cp.endpointJson(KEY, cp.STAGING_RELAYS[0]),
    });

    const lease = api.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/leases/connect-lease-1'));
    expect((lease?.body as { spec: { renewTime: string } }).spec.renewTime).toBe('2026-10-12T22:58:01.123000Z');
    expect((lease?.body as { spec: { holderIdentity: string } }).spec.holderIdentity).toBe('controller');

    const bindingName = await cp.networkBindingName(sha256Hex, 'default', CONNECTOR);
    expect(result).toMatchObject({ gatewayCreated: true, bindingCreated: true });
    expect(result.grant).toEqual({
      network: 'default',
      project: PROJECT,
      bindingName,
      connectorName: CONNECTOR,
      gatewayName,
      gatewayLocation: 'us-east-1',
      gatewayEndpointId: '155279db1c3e31ce28938caf78842596b1b182eee7fbbc3bc86c0e7c0f8b6a4e',
      clientAddress: 'fd80:ba85:dcb2:bb05:219b:b959:899d:7db9/128',
      gatewayAddress: 'fd6f:2bd1:8c12:348a:af5d:d4bb:b988:1d92/128',
      routes: ['fd20:0:10::/48'],
      relayUrls: ['https://iroh-relay.us-central-1.datum-staging.net'],
      mtu: 1280,
    });
    expect(stages).toEqual(expect.arrayContaining(['gateway', 'location', 'connector', 'binding', 'ready']));
  });

  test('reuses the existing gateway in the nearest location', async () => {
    const api = new FakeApi();
    installConnect(api);
    playController(api);
    api.put(`${CONNECT}/namespaces/default/connectgateways/existing`, {
      metadata: { name: 'existing', generation: 1 },
      spec: { networkRef: 'default', locationRef: 'us-east-1', relayURLs: ['https://relay.example.com'] },
      status: { endpointID: 'a'.repeat(64) },
    });
    api.put(`${CONNECT}/namespaces/default/connectgateways/elsewhere`, {
      metadata: { name: 'elsewhere', generation: 1 },
      spec: { networkRef: 'default', locationRef: 'us-central-1' },
    });
    const result = await cp.joinGatewayNetwork(api.deps(), {
      project: PROJECT,
      network: 'default',
      publicKey: KEY,
      homeRelayUrls: [],
    });
    expect(result.gatewayCreated).toBe(false);
    expect(result.grant.gatewayName).toBe('existing');
    // Without environment relays the gateway's relay is published.
    const connector = api.objects.get(`${CONNECT}/namespaces/default/connectors/${CONNECTOR}`);
    expect((connector?.spec as { relayURLs: string[] }).relayURLs).toEqual(['https://relay.example.com/']);
  });

  test('refuses duplicate gateways for one location', async () => {
    const api = new FakeApi();
    installConnect(api);
    for (const name of ['a', 'b']) {
      api.put(`${CONNECT}/namespaces/default/connectgateways/${name}`, {
        metadata: { name },
        spec: { networkRef: 'default', locationRef: 'us-east-1' },
      });
    }
    await expect(cp.selectGateway(api.deps(), PROJECT, 'default')).rejects.toMatchObject({ code: 'gateway_duplicate' });
  });

  test('missing gateway API, network and classes are explicit errors', async () => {
    const api = new FakeApi();
    await expect(cp.selectGateway(api.deps(), PROJECT, 'default')).rejects.toMatchObject({
      code: 'gateway_api_unavailable',
    });
    installConnect(api);
    await expect(cp.selectGateway(api.deps(), PROJECT, 'nope')).rejects.toMatchObject({ code: 'network_not_found' });
    api.objects.delete(`${CONNECT}/connectgatewayclasses/standard`);
    api.collections.add(`${CONNECT}/connectgatewayclasses`);
    await expect(cp.selectGateway(api.deps(), PROJECT, 'default')).rejects.toMatchObject({
      code: 'gateway_class_unavailable',
    });
  });

  test('a non-default class is used only when it is the only Ready one', async () => {
    const api = new FakeApi();
    installConnect(api);
    const standard = api.objects.get(`${CONNECT}/connectgatewayclasses/standard`)!;
    (standard.spec as Record<string, unknown>).default = false;
    api.put(`${CONNECT}/connectgatewayclasses/other`, {
      metadata: { name: 'other', generation: 1 },
      spec: { controllerName: 'connect.datum.net/gateway-controller' },
      status: { conditions: [ready()] },
    });
    await expect(cp.selectGateway(api.deps(), PROJECT, 'default')).rejects.toMatchObject({
      code: 'gateway_class_ambiguous',
    });
  });

  test('a Connector name owned by another key is never adopted', async () => {
    const api = new FakeApi();
    installConnect(api);
    api.put(`${CONNECT}/namespaces/default/connectors/${CONNECTOR}`, {
      metadata: { name: CONNECTOR, uid: 'x', generation: 1 },
      spec: { publicKey: 'b'.repeat(64) },
    });
    await expect(
      cp.joinGatewayNetwork(api.deps(), { project: PROJECT, network: 'default', publicKey: KEY, homeRelayUrls: [] })
    ).rejects.toMatchObject({ code: 'ownership' });
  });

  test('a rejected binding fails; ConnectorNotReady keeps waiting', async () => {
    const api = new FakeApi();
    installConnect(api);
    playController(api, { rejectWith: 'RouteCapacityExceeded' });
    await expect(
      cp.joinGatewayNetwork(api.deps(), { project: PROJECT, network: 'default', publicKey: KEY, homeRelayUrls: [] })
    ).rejects.toMatchObject({ code: 'binding_rejected' });

    const api2 = new FakeApi();
    installConnect(api2);
    let ticks = 0;
    playController(api2, { bindingAfterTicks: 6 });
    const controller = api2.onTick;
    api2.onTick = () => {
      ticks += 1;
      controller();
      if (ticks < 6) {
        for (const [path, object] of api2.objects) {
          if (path.includes('/connectnetworkbindings/')) {
            object.status = {
              conditions: [{ type: 'Accepted', status: 'False', reason: 'ConnectorNotReady', observedGeneration: 1 }],
            };
          }
        }
      }
    };
    await expect(
      cp.joinGatewayNetwork(api2.deps(), { project: PROJECT, network: 'default', publicKey: KEY, homeRelayUrls: [] })
    ).resolves.toMatchObject({ bindingCreated: true });
  });

  test('times out after the daemon’s 240 s budget', async () => {
    const api = new FakeApi();
    installConnect(api);
    playController(api, { bindingAfterTicks: Number.POSITIVE_INFINITY });
    let now = 0;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const tick = api.onTick;
    api.onTick = () => {
      tick();
      now += 2_000;
    };
    try {
      await expect(
        cp.joinGatewayNetwork(api.deps(), { project: PROJECT, network: 'default', publicKey: KEY, homeRelayUrls: [] })
      ).rejects.toMatchObject({ code: 'binding_timeout' });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('grantFromBinding (daemon join_network checks)', () => {
  const gateway = { metadata: { name: 'gw' }, spec: { locationRef: 'us-east-1' }, status: { endpointID: 'c'.repeat(64) } };
  const binding = (status: Record<string, unknown>) => ({ metadata: { name: 'b' }, status });
  const ctx = { project: PROJECT, network: 'default', connectorName: CONNECTOR };
  const good = {
    assignedAddress: 'fd80::1/128',
    peerAddress: 'fd6f::1/128',
    routes: ['fd20:0:10::/48'],
  };

  test('falls back to the gateway endpoint ID', () => {
    expect(cp.grantFromBinding(binding(good), gateway, ctx).gatewayEndpointId).toBe('c'.repeat(64));
  });

  test.each([
    { ...good, assignedAddress: 'fd80::1/64' },
    { ...good, assignedAddress: '10.0.0.1/32' },
    { ...good, peerAddress: undefined },
    { ...good, routes: [] },
    { ...good, routes: [7] },
  ])('rejects %j', (status) => {
    expect(() => cp.grantFromBinding(binding(status), gateway, ctx)).toThrow(cp.ConnectError);
  });
});

describe('leave (successor::leave_gateway_network)', () => {
  test('deletes this Connector’s binding with preconditions', async () => {
    const api = new FakeApi();
    const name = await cp.networkBindingName(sha256Hex, 'default', CONNECTOR);
    const path = `${CONNECT}/namespaces/default/connectnetworkbindings/${name}`;
    api.put(path, {
      metadata: { name, uid: 'uid-9', resourceVersion: '42' },
      spec: { connectorRef: CONNECTOR, gatewayRef: 'gw' },
    });
    await expect(
      cp.leaveGatewayNetwork(api.deps(), { project: PROJECT, network: 'default', connectorName: CONNECTOR })
    ).resolves.toBe(true);
    expect(api.calls.at(-1)).toEqual({
      method: 'DELETE',
      path,
      body: {
        apiVersion: 'v1',
        kind: 'DeleteOptions',
        preconditions: { uid: 'uid-9', resourceVersion: '42' },
      },
    });
    // Repeating is safe.
    await expect(
      cp.leaveGatewayNetwork(api.deps(), { project: PROJECT, network: 'default', connectorName: CONNECTOR })
    ).resolves.toBe(false);
  });

  test('refuses another Connector’s binding', async () => {
    const api = new FakeApi();
    const name = await cp.networkBindingName(sha256Hex, 'default', CONNECTOR);
    api.put(`${CONNECT}/namespaces/default/connectnetworkbindings/${name}`, {
      metadata: { name, uid: 'u', resourceVersion: '1' },
      spec: { connectorRef: 'someone-else' },
    });
    await expect(
      cp.leaveGatewayNetwork(api.deps(), { project: PROJECT, network: 'default', connectorName: CONNECTOR })
    ).rejects.toMatchObject({ code: 'ownership' });
  });
});

describe('Lease renewal', () => {
  test('retries resourceVersion conflicts', async () => {
    const api = new FakeApi();
    const path = `${BASE}/apis/coordination.k8s.io/v1/namespaces/default/leases/l1`;
    api.put(path, { metadata: { name: 'l1' }, spec: {} });
    let conflicts = 2;
    const put = api.http.put;
    api.http.put = async (p, b) => {
      if (conflicts-- > 0) throw new HttpError(409);
      return put(p, b);
    };
    await cp.renewLease(api.deps(), PROJECT, 'l1');
    expect((api.objects.get(path)?.spec as { renewTime: string }).renewTime).toBe('2026-10-12T22:58:01.123000Z');
  });

  test('liveness fails closed when the Connector is gone', async () => {
    const api = new FakeApi();
    await expect(cp.renewConnectorLiveness(api.deps(), PROJECT, CONNECTOR, KEY)).rejects.toMatchObject({
      code: 'connector_deleted',
    });
  });
});
