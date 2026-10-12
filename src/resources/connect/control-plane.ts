/**
 * Datum Connect control plane for "connect this phone to a project VPC".
 *
 * A port of what `datumctl connect join NETWORK --project P` does, from
 * datum-cloud/connect v1.0.0-preview.28:
 *
 * - activation: `connect-plugin/commands/activation.go`, which runs the
 *   service-catalog gate (`go.miloapis.com/service-catalog/pkg/activation`
 *   v0.13.1) for `connect.datumapis.com` before `up`/`join`;
 * - enrollment, liveness, gateway selection and bindings:
 *   `connect-lib/lib/src/successor/mod.rs` (`CloudConnector`).
 *
 * The CONNECT-IP session itself runs in the Network Extension (Rust core).
 *
 * This file has no runtime imports (only `import type`) and uses only
 * erasable TypeScript, so `scripts/connect-e2e.mjs` can load it with Node's
 * type stripping and drive the same code against staging.
 */

export const CONNECT_GROUP = 'connect.datumapis.com/v1alpha1';
export const CONNECT_SERVICE = 'connect.datumapis.com';
const SERVICES_GROUP = 'services.miloapis.com/v1alpha1';
const GATEWAY_CONTROLLER = 'connect.datum.net/gateway-controller';
/**
 * The daemon reads `region=` from `https://edge.datum.net/`, which serves
 * that text only to clients without a User-Agent; fetch() always sends one
 * and gets the HTML page. `/api/edge-info` is the same service's JSON view.
 */
export const EDGE_INFO_URL = 'https://edge.datum.net/api/edge-info';

/** The daemon's managed-gateway MTU (`runtime.rs`: `mtu: 1280`). */
export const MANAGED_MTU = 1280;

/** `daemon/src/relays.rs` STAGING_RELAYS. */
export const STAGING_RELAYS = [
  'https://iroh-relay.us-central-1.datum-staging.net',
  'https://iroh-relay.us-east-1.datum-staging.net',
];

/** Binding approval budget (`join_gateway_network`: 240 s, polled every 2 s). */
const BINDING_TIMEOUT_MS = 240_000;
const POLL_MS = 2_000;
/** Connector readiness budget (`connect_connector`: 60 s). */
const CONNECTOR_TIMEOUT_MS = 60_000;
/** service-catalog `firstStatusTimeout` and `reentryWaitWindow`. */
const FIRST_STATUS_TIMEOUT_MS = 30_000;
const REENTRY_WAIT_WINDOW_MS = 120_000;
/** After activation the Connect service installs the project's classes. */
const CLASS_INSTALL_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Transport seams

/** The HTTP surface the control plane needs. Paths are API-host relative. */
export interface ConnectHttp {
  /** GET; resolves `null` on 404 (as the daemon's `request` does). */
  get<T = unknown>(path: string): Promise<T | null>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
  put<T = unknown>(path: string, body: unknown): Promise<T>;
  /** DELETE with an optional DeleteOptions body. */
  delete(path: string, body?: unknown): Promise<void>;
}

export type JoinStage =
  | 'activation'
  | 'location'
  | 'gateway'
  | 'connector'
  | 'binding'
  | 'gateway-starting'
  | 'ready';

export interface ConnectDeps {
  http: ConnectHttp;
  /** Lowercase hex SHA-256 of the UTF-8 encoding of `input`. */
  sha256Hex(input: string): Promise<string>;
  /** Body of `GET https://edge.datum.net/` (5 s budget in the daemon). */
  edgeInfo(): Promise<string>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (stage: JoinStage, detail?: string) => void;
  signal?: AbortSignal;
}

/** A control-plane failure with a stable code for the UI. */
export class ConnectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConnectError';
    this.code = code;
  }
}

/** HTTP status of an error thrown by a `ConnectHttp`, if it has one. */
export function httpStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

// ---------------------------------------------------------------------------
// Kubernetes object helpers

export interface Condition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  observedGeneration?: number;
}

export interface KObject {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    uid?: string;
    generation?: number;
    resourceVersion?: string;
    creationTimestamp?: string;
    deletionTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown> & { conditions?: Condition[] };
}

export interface KList<T> {
  items?: T[];
  metadata?: { continue?: string };
}

/** `successor::current_condition`: True and observed at the current generation. */
export function currentCondition(resource: KObject | null | undefined, type: string): boolean {
  const generation = resource?.metadata?.generation;
  if (typeof generation !== 'number' || generation <= 0) return false;
  return (resource?.status?.conditions ?? []).some(
    (c) => c.type === type && c.status === 'True' && c.observedGeneration === generation
  );
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function required(value: unknown, what: string): string {
  const s = str(value);
  if (!s) throw new ConnectError('invalid_response', `control-plane response lacks ${what}`);
  return s;
}

/** `successor::validate_name` (TunnelId): a DNS label. */
export function validName(name: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name);
}

function assertName(name: string) {
  if (!validName(name)) throw new ConnectError('invalid_name', 'invalid resource name');
}

// ---------------------------------------------------------------------------
// Paths

export function projectBase(project: string): string {
  assertName(project);
  return `/apis/resourcemanager.miloapis.com/v1alpha1/projects/${project}/control-plane`;
}

export function connectPath(project: string, plural: string, name = ''): string {
  return `${projectBase(project)}/apis/${CONNECT_GROUP}/namespaces/default/${plural}${name ? `/${name}` : ''}`;
}

function connectClusterPath(project: string, plural: string): string {
  return `${projectBase(project)}/apis/${CONNECT_GROUP}/${plural}`;
}

function networkPath(project: string, name: string): string {
  return `${projectBase(project)}/apis/networking.datumapis.com/v1alpha/namespaces/default/networks/${name}`;
}

export function leasePath(project: string, name: string): string {
  return `${projectBase(project)}/apis/coordination.k8s.io/v1/namespaces/default/leases/${name}`;
}

// ---------------------------------------------------------------------------
// Deterministic names (byte-for-byte with successor/mod.rs)

/** `connect-{stem}-{location}-{sha256(network/location)[..5] hex}`. */
export async function networkGatewayName(
  sha256Hex: ConnectDeps['sha256Hex'],
  network: string,
  location: string
): Promise<string> {
  const suffix = (await sha256Hex(`${network}/${location}`)).slice(0, 10);
  let stem = Array.from(network)
    .map((ch) => (/[a-z0-9-]/.test(ch) ? ch : '-'))
    .join('')
    .replace(/^-+|-+$/g, '');
  if (!stem) stem = 'network';
  stem = stem.slice(0, 35);
  return `connect-${stem}-${location.toLowerCase()}-${suffix}`;
}

/** `binding-{sha256(network \0 connector)[..8] hex}`. */
export async function networkBindingName(
  sha256Hex: ConnectDeps['sha256Hex'],
  network: string,
  connector: string
): Promise<string> {
  return `binding-${(await sha256Hex(`${network}\u0000${connector}`)).slice(0, 16)}`;
}

/** The daemon's default Connector name: `connect-{publicKey[..40]}`. */
export function defaultConnectorName(publicKey: string): string {
  if (!/^[0-9a-f]{64}$/.test(publicKey)) {
    throw new ConnectError('invalid_key', 'invalid Connector public key');
  }
  return `connect-${publicKey.slice(0, 40)}`;
}

// ---------------------------------------------------------------------------
// Activation (service-catalog gate)

export type ActivationState =
  | 'CatalogUnavailable'
  | 'NotRequested'
  | 'Processing'
  | 'PendingApproval'
  | 'Active'
  | 'Denied'
  | 'Revoked'
  | 'Unavailable';

export interface ServiceInfo {
  objectName: string;
  canonicalName: string;
  displayName: string;
  enablementMode: 'SelfService' | 'GatedByProvider' | string;
}

interface RawService extends KObject {
  spec?: {
    serviceName?: string;
    displayName?: string;
    phase?: string;
    enablementPolicy?: { mode?: string } | null;
  };
}

interface RawEntitlement extends KObject {
  spec?: { serviceRef?: { name?: string }; requestMessage?: string };
  status?: KObject['status'] & { phase?: string; serviceName?: string; entitledAt?: string };
}

/** `activation.FindService`: Published services, canonical name first, then object name. */
export function findService(services: RawService[], name: string): ServiceInfo | undefined {
  let fallback: ServiceInfo | undefined;
  for (const svc of services) {
    if (svc.spec?.phase !== 'Published') continue;
    const info: ServiceInfo = {
      objectName: svc.metadata?.name ?? '',
      canonicalName: svc.spec?.serviceName ?? '',
      displayName: svc.spec?.displayName ?? '',
      enablementMode: svc.spec?.enablementPolicy?.mode || 'SelfService',
    };
    if (info.canonicalName === name) return info;
    if (!fallback && info.objectName === name) fallback = info;
  }
  return fallback;
}

/** `activation.Classify`. */
export function classifyEntitlement(e: RawEntitlement | null | undefined): ActivationState {
  if (!e) return 'NotRequested';
  const ready = (e.status?.conditions ?? []).find((c) => c.type === 'Ready');
  if (!e.status?.phase || !ready) return 'Processing';
  switch (e.status.phase) {
    case 'Active':
      return 'Active';
    case 'PendingApproval':
      return 'PendingApproval';
    case 'Rejected':
      if (ready.reason === 'ServiceNotPublished') return 'Unavailable';
      return e.status.entitledAt ? 'Revoked' : 'Denied';
    default:
      return 'Processing';
  }
}

/** `activation.SelectEntitlement`: canonical service name, then serviceRef. */
export function selectEntitlement(
  items: RawEntitlement[],
  service: ServiceInfo
): RawEntitlement | undefined {
  let fallback: RawEntitlement | undefined;
  for (const item of items) {
    const canonical = item.status?.serviceName || item.spec?.serviceRef?.name;
    if (canonical === service.canonicalName) return item;
    if (!fallback && item.spec?.serviceRef?.name === service.objectName) fallback = item;
  }
  return fallback;
}

export interface Activation {
  state: ActivationState;
  service: ServiceInfo;
}

function entitlementsPath(project: string, name = ''): string {
  return `${projectBase(project)}/apis/${SERVICES_GROUP}/serviceentitlements${name ? `/${name}` : ''}`;
}

/** Read-only: the project's Connect activation state. */
export async function observeActivation(deps: ConnectDeps, project: string): Promise<Activation> {
  const services = await deps.http.get<KList<RawService>>(`/apis/${SERVICES_GROUP}/services`);
  const service = findService(services?.items ?? [], CONNECT_SERVICE);
  if (!service) {
    throw new ConnectError('service_not_found', 'The Connect service is not available on this platform.');
  }
  const list = await deps.http.get<KList<RawEntitlement>>(entitlementsPath(project));
  if (list === null) return { state: 'CatalogUnavailable', service };
  return { state: classifyEntitlement(selectEntitlement(list.items ?? [], service)), service };
}

/** User-facing copy for a state that blocks Connect (the gate's report* messages). */
export function activationMessage(state: ActivationState, project: string): string {
  switch (state) {
    case 'Active':
      return 'Connect is enabled.';
    case 'NotRequested':
      return `Connect is not enabled for project "${project}".`;
    case 'Processing':
      return 'Connect is still being set up for this project. This normally takes a few seconds.';
    case 'PendingApproval':
      return 'Access to Connect is waiting for approval from the team that provides it.';
    case 'Denied':
      return 'Access to Connect was denied for this project.';
    case 'Revoked':
      return 'Access to Connect was revoked for this project.';
    case 'Unavailable':
    case 'CatalogUnavailable':
      return 'The Connect service is not available here.';
  }
}

/**
 * The CLI gate (`activation.Gate.Run`) without a TTY prompt: Active proceeds;
 * self-service is enabled outright (the CLI does this without asking);
 * provider-gated is only requested when `requestGated` is set, which the UI
 * does after the user confirms. Other states throw with the gate's copy.
 */
export async function ensureActivated(
  deps: ConnectDeps,
  project: string,
  options: { requestGated?: boolean } = {}
): Promise<Activation> {
  const now = deps.now ?? (() => new Date());
  const { state, service } = await observeActivation(deps, project);
  const fail = (s: ActivationState): never => {
    throw new ConnectError(`activation_${s}`, activationMessage(s, project));
  };
  if (state === 'Active') return { state, service };
  if (state === 'NotRequested') {
    if (service.enablementMode === 'GatedByProvider' && !options.requestGated) {
      throw new ConnectError('activation_approval_required', activationMessage(state, project));
    }
    deps.onProgress?.('activation', service.enablementMode === 'GatedByProvider' ? 'requesting' : 'enabling');
    try {
      await deps.http.post<RawEntitlement>(entitlementsPath(project), {
        apiVersion: SERVICES_GROUP,
        kind: 'ServiceEntitlement',
        metadata: { name: service.objectName },
        spec: { serviceRef: { name: service.objectName } },
      });
    } catch (error) {
      const status = httpStatus(error);
      // createEntitlement: AlreadyExists is a race; Invalid means unavailable.
      if (status === 422) fail('Unavailable');
      if (status !== 409) throw error;
    }
    const settled = await waitFirstStatus(deps, project, service.objectName);
    if (settled === 'Active') return { state: settled, service };
    if (settled === 'Processing') {
      throw new ConnectError(
        'activation_Processing',
        'Connect was requested for this project and is still being set up. Try again in a moment.'
      );
    }
    return fail(settled);
  }
  if (state === 'Processing') {
    const list = await deps.http.get<KList<RawEntitlement>>(entitlementsPath(project));
    const e = selectEntitlement(list?.items ?? [], service);
    const created = e?.metadata?.creationTimestamp ? Date.parse(e.metadata.creationTimestamp) : NaN;
    if (Number.isFinite(created) && now().getTime() - created > REENTRY_WAIT_WINDOW_MS) fail(state);
    const settled = await waitFirstStatus(deps, project, e?.metadata?.name ?? service.objectName);
    if (settled === 'Active') return { state: settled, service };
    return fail(settled);
  }
  return fail(state);
}

/** `waitForFirstStatus`, polling instead of watching (30 s budget). */
async function waitFirstStatus(deps: ConnectDeps, project: string, name: string): Promise<ActivationState> {
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = Date.now() + FIRST_STATUS_TIMEOUT_MS;
  for (;;) {
    checkAbort(deps);
    const e = await deps.http.get<RawEntitlement>(entitlementsPath(project, name));
    const state = e ? classifyEntitlement(e) : 'NotRequested';
    if (state !== 'Processing' && state !== 'NotRequested') return state;
    if (Date.now() >= deadline) return 'Processing';
    await sleep(1_000);
  }
}

// ---------------------------------------------------------------------------
// Connector enrollment and liveness

export interface ConnectorIdentity {
  name: string;
  uid: string;
  publicKey: string;
  leaseName?: string;
}

/** iroh `EndpointAddr` JSON with only a relay address (what `spec.endpoint` holds). */
export function endpointJson(publicKey: string, relayUrl: string): string {
  return JSON.stringify({ id: publicKey, addrs: [{ Relay: relayUrlString(relayUrl) }] });
}

/** iroh `RelayUrl` display form: origin plus a trailing slash. */
export function relayUrlString(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function leaseName(connector: KObject): string | undefined {
  const ref = connector.status?.leaseRef as unknown;
  if (typeof ref === 'string') return str(ref);
  return str((ref as { name?: unknown } | undefined)?.name);
}

function assertOwned(connector: KObject, name: string, publicKey: string) {
  if (connector.spec?.publicKey !== publicKey) {
    throw new ConnectError(
      'ownership',
      `Connector ${name} belongs to another device. Nothing was adopted.`
    );
  }
}

/** POST with the daemon's create-conflict-then-GET idempotency. */
async function createOrGet<T extends KObject>(deps: ConnectDeps, collection: string, object: T): Promise<T> {
  const name = required(object.metadata?.name, 'metadata.name');
  try {
    return await deps.http.post<T>(collection, object);
  } catch (error) {
    if (httpStatus(error) !== 409) throw error;
    const existing = await deps.http.get<T>(`${collection}/${name}`);
    if (!existing) throw error;
    return existing;
  }
}

/**
 * `renew_connect_connector_lease`: GET the Lease, set `spec.renewTime`, PUT,
 * retrying resourceVersion conflicts. A Lease the controller hasn't created
 * yet is not an error.
 */
export async function renewLease(deps: ConnectDeps, project: string, name: string | undefined) {
  if (!name) return;
  assertName(name);
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const path = leasePath(project, name);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const lease = await deps.http.get<KObject>(path);
    if (!lease) return;
    const body = { ...lease, spec: { ...(lease.spec ?? {}), renewTime: microTime(now()) } };
    try {
      await deps.http.put(path, body);
      return;
    } catch (error) {
      if (httpStatus(error) === 409 && attempt < 3) {
        await sleep(50 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}

/** RFC 3339 with microseconds, as `chrono::SecondsFormat::Micros` writes it. */
export function microTime(date: Date): string {
  return date.toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
}

/** `renew_connect_connector_liveness`: re-read the Connector, then renew. */
export async function renewConnectorLiveness(
  deps: ConnectDeps,
  project: string,
  connectorName: string,
  publicKey: string
) {
  const connector = await deps.http.get<KObject>(connectPath(project, 'connectors', connectorName));
  if (!connector) throw new ConnectError('connector_deleted', 'This device’s Connector was deleted.');
  assertOwned(connector, connectorName, publicKey);
  await renewLease(deps, project, leaseName(connector));
}

/**
 * `ensure_connect_connector`: create the Connector if missing (exactly one
 * Ready ConnectorClass advertising `masque-v1`), then renew its Lease until
 * the controller reports it Ready (60 s).
 */
export async function ensureConnector(
  deps: ConnectDeps,
  project: string,
  input: { name: string; publicKey: string; relayUrl: string }
): Promise<ConnectorIdentity> {
  const sleep = deps.sleep ?? defaultSleep;
  assertName(input.name);
  let connector = await deps.http.get<KObject>(connectPath(project, 'connectors', input.name));
  if (connector) {
    assertOwned(connector, input.name, input.publicKey);
  } else {
    const className = await connectorClass(deps, project);
    connector = await createOrGet(deps, connectPath(project, 'connectors'), {
      apiVersion: CONNECT_GROUP,
      kind: 'Connector',
      metadata: { name: input.name },
      spec: {
        classRef: className,
        publicKey: input.publicKey,
        relayURLs: input.relayUrl ? [relayUrlString(input.relayUrl)] : [],
        endpoint: endpointJson(input.publicKey, input.relayUrl),
      },
    });
    assertOwned(connector, input.name, input.publicKey);
  }
  const deadline = Date.now() + CONNECTOR_TIMEOUT_MS;
  for (;;) {
    checkAbort(deps);
    await renewLease(deps, project, leaseName(connector));
    if (currentCondition(connector, 'Ready')) {
      return {
        name: required(connector.metadata?.name, 'metadata.name'),
        uid: required(connector.metadata?.uid, 'metadata.uid'),
        publicKey: input.publicKey,
        leaseName: leaseName(connector),
      };
    }
    if (Date.now() >= deadline) {
      const reason =
        connector.status?.conditions?.find((c) => c.type === 'Ready')?.reason ?? 'waiting for controller';
      throw new ConnectError('connector_not_ready', `Connector ${input.name} is not Ready (${reason}).`);
    }
    await sleep(POLL_MS);
    connector = await deps.http.get<KObject>(connectPath(project, 'connectors', input.name));
    if (!connector) throw new ConnectError('connector_deleted', `Connector ${input.name} was deleted.`);
    assertOwned(connector, input.name, input.publicKey);
  }
}

/**
 * Exactly one Ready ConnectorClass advertising `masque-v1`. Right after a
 * fresh activation the Connect service is still installing classes, so wait
 * briefly for them to appear before giving the daemon's error.
 */
async function connectorClass(deps: ConnectDeps, project: string): Promise<string> {
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = Date.now() + CLASS_INSTALL_TIMEOUT_MS;
  for (;;) {
    const classes = await deps.http.get<KList<KObject>>(connectClusterPath(project, 'connectorclasses'));
    const ready = (classes?.items ?? []).filter(
      (c) => strings(c.spec?.transports).includes('masque-v1') && currentCondition(c, 'Ready')
    );
    if (ready.length === 1) return required(ready[0].metadata?.name, 'connector class name');
    if (ready.length > 1 || Date.now() >= deadline) {
      throw new ConnectError(
        'connector_class',
        `Expected one Ready Connect ConnectorClass advertising masque-v1; found ${ready.length}.`
      );
    }
    await sleep(POLL_MS);
  }
}

// ---------------------------------------------------------------------------
// Gateway selection

/**
 * `edge_location`: the nearest Datum location from edge.datum.net, either the
 * text form's `region=` line or the JSON form's `region` field.
 */
export function parseEdgeLocation(body: string): string {
  let location: string | undefined;
  if (body.trim().startsWith('{')) {
    try {
      const region = (JSON.parse(body) as { region?: unknown }).region;
      location = typeof region === 'string' ? region.trim() : undefined;
    } catch {
      location = undefined;
    }
  } else {
    const line = body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('region='));
    location = line?.slice('region='.length).trim();
  }
  if (!location || location.length > 63 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(location)) {
    throw new ConnectError(
      'location_unavailable',
      'edge.datum.net did not return a valid location name; try again later.'
    );
  }
  return location;
}

function validIpv6Prefix(value: string): boolean {
  const [address, prefix, extra] = value.split('/');
  if (extra !== undefined || !address?.includes(':') || !/^[0-9a-fA-F:.]+$/.test(address)) return false;
  const length = Number(prefix);
  return Number.isInteger(length) && length >= 2 && length <= 128;
}

/** `create_network_gateway`: default (or only) Ready class, network's IPv6 prefix as the route. */
async function createNetworkGateway(
  deps: ConnectDeps,
  project: string,
  network: string,
  location: string,
  networkObject: KObject
): Promise<KObject> {
  const prefix = str((networkObject.status?.ipam as { ipv6Prefix?: unknown } | undefined)?.ipv6Prefix);
  if (!prefix) {
    throw new ConnectError(
      'network_not_ready',
      `Network "${network}" has no IPv6 prefix yet. Wait for it to become Ready and try again.`
    );
  }
  if (!validIpv6Prefix(prefix)) {
    throw new ConnectError('network_invalid', `Network "${network}" has an invalid IPv6 prefix.`);
  }
  const classes = await deps.http.get<KList<KObject>>(connectClusterPath(project, 'connectgatewayclasses'));
  if (!classes) {
    throw new ConnectError('gateway_class_unavailable', 'The ConnectGatewayClass API is not available in this project.');
  }
  const ready = (classes.items ?? []).filter(
    (c) => c.spec?.controllerName === GATEWAY_CONTROLLER && currentCondition(c, 'Ready')
  );
  const defaults = ready.filter((c) => c.spec?.default === true);
  let gatewayClass: KObject;
  if (defaults.length === 1) gatewayClass = defaults[0];
  else if (defaults.length === 0 && ready.length === 1) gatewayClass = ready[0];
  else if (defaults.length === 0 && ready.length === 0)
    throw new ConnectError('gateway_class_unavailable', 'No Ready ConnectGatewayClass is available in this project.');
  else if (defaults.length === 0)
    throw new ConnectError('gateway_class_ambiguous', 'Multiple Ready ConnectGatewayClasses exist and none is the default.');
  else throw new ConnectError('gateway_class_ambiguous', 'Multiple Ready ConnectGatewayClasses are marked as the default.');
  const className = required(gatewayClass.metadata?.name, 'gateway class name');
  const name = await networkGatewayName(deps.sha256Hex, network, location);
  return createOrGet(deps, connectPath(project, 'connectgateways'), {
    apiVersion: CONNECT_GROUP,
    kind: 'ConnectGateway',
    metadata: { name },
    spec: {
      gatewayClassRef: className,
      networkRef: network,
      locationRef: location,
      routes: [prefix],
      relayURLs: strings(gatewayClass.spec?.relayURLs),
    },
  });
}

export interface GatewaySelection {
  gateway: KObject;
  location: string;
  created: boolean;
}

/** List gateways, read the Network, resolve the nearest location, select or create. */
export async function selectGateway(deps: ConnectDeps, project: string, network: string): Promise<GatewaySelection> {
  assertName(network);
  deps.onProgress?.('gateway');
  const gateways = await deps.http.get<KList<KObject>>(connectPath(project, 'connectgateways'));
  if (!gateways) {
    throw new ConnectError('gateway_api_unavailable', 'Connect VPC gateways are not available in this project yet.');
  }
  const networkObject = await deps.http.get<KObject>(networkPath(project, network));
  if (!networkObject) throw new ConnectError('network_not_found', `Network "${network}" was not found in this project.`);
  deps.onProgress?.('location');
  const location = parseEdgeLocation(await deps.edgeInfo());
  const matches = (gateways.items ?? []).filter(
    (g) => g.spec?.networkRef === network && g.spec?.locationRef === location
  );
  if (matches.length > 1) {
    const names = matches.map((g) => g.metadata?.name).join(', ');
    throw new ConnectError(
      'gateway_duplicate',
      `Multiple ConnectGateways exist for network "${network}" in ${location}: ${names}.`
    );
  }
  if (matches.length === 1) return { gateway: matches[0], location, created: false };
  deps.onProgress?.('gateway', 'creating');
  return { gateway: await createNetworkGateway(deps, project, network, location, networkObject), location, created: true };
}

// ---------------------------------------------------------------------------
// Binding

/** What the CONNECT-IP session needs, from binding (and gateway) status. */
export interface BindingGrant {
  network: string;
  project: string;
  bindingName: string;
  connectorName: string;
  gatewayName: string;
  gatewayLocation: string;
  gatewayEndpointId: string;
  clientAddress: string;
  gatewayAddress: string;
  routes: string[];
  relayUrls: string[];
  mtu: number;
}

function isIpv6Host(value: string): boolean {
  const [address, prefix, extra] = value.split('/');
  return extra === undefined && prefix === '128' && !!address && address.includes(':') && /^[0-9a-fA-F:]+$/.test(address);
}

/**
 * The daemon's checks on binding status (`join_network`): a gateway endpoint
 * ID, IPv6 `/128` client and gateway addresses, and 1..=32 routes.
 */
export function grantFromBinding(
  binding: KObject,
  gateway: KObject,
  context: { project: string; network: string; connectorName: string }
): BindingGrant {
  const status = binding.status ?? {};
  const endpoint = str(status.endpointID) ?? str(gateway.status?.endpointID);
  if (!endpoint || !/^[0-9a-f]{64}$/.test(endpoint)) {
    throw new ConnectError('invalid_response', 'ConnectNetworkBinding has no valid gateway endpoint ID.');
  }
  const clientAddress = required(status.assignedAddress, 'status.assignedAddress');
  const gatewayAddress = required(status.peerAddress, 'status.peerAddress');
  if (!isIpv6Host(clientAddress) || !isIpv6Host(gatewayAddress)) {
    throw new ConnectError('invalid_response', 'ConnectNetworkBinding must assign IPv6 /128 host addresses.');
  }
  if (!Array.isArray(status.routes) || status.routes.some((r) => typeof r !== 'string')) {
    throw new ConnectError('invalid_response', 'ConnectNetworkBinding returned an invalid route.');
  }
  const routes = strings(status.routes);
  if (routes.length === 0 || routes.length > 32) {
    throw new ConnectError('invalid_response', 'ConnectNetworkBinding must approve 1 to 32 routes.');
  }
  return {
    network: context.network,
    project: context.project,
    bindingName: required(binding.metadata?.name, 'metadata.name'),
    connectorName: context.connectorName,
    gatewayName: required(gateway.metadata?.name, 'gateway name'),
    gatewayLocation: str(gateway.spec?.locationRef) ?? '',
    gatewayEndpointId: endpoint,
    clientAddress,
    gatewayAddress,
    routes,
    relayUrls: strings(status.relayURLs),
    mtu: MANAGED_MTU,
  };
}

export interface JoinInput {
  project: string;
  network: string;
  /** This device's iroh public key (hex). */
  publicKey: string;
  /** Connector name; defaults to the daemon's `connect-{key[..40]}`. */
  connectorName?: string;
  /** Home relays for the device endpoint; the first is published on the Connector. */
  homeRelayUrls: string[];
}

export interface JoinResult {
  grant: BindingGrant;
  connector: ConnectorIdentity;
  gatewayCreated: boolean;
  bindingCreated: boolean;
}

/**
 * `join_gateway_network`: select or create the gateway, enroll the Connector,
 * create or reuse the binding and wait (240 s) for the controller to accept
 * it, renewing the Connector Lease throughout as the daemon's liveness task
 * does.
 */
export async function joinGatewayNetwork(deps: ConnectDeps, input: JoinInput): Promise<JoinResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const { project, network, publicKey } = input;
  const connectorName = input.connectorName ?? defaultConnectorName(publicKey);
  const { gateway, created: gatewayCreated } = await selectGateway(deps, project, network);
  const gatewayName = required(gateway.metadata?.name, 'gateway name');
  const relayUrl = input.homeRelayUrls[0] ?? strings(gateway.spec?.relayURLs)[0] ?? '';
  if (!relayUrl) {
    throw new ConnectError('relay_unavailable', 'No Connect relay is configured for this gateway.');
  }

  deps.onProgress?.('connector');
  const connector = await ensureConnector(deps, project, { name: connectorName, publicKey, relayUrl });

  deps.onProgress?.('binding');
  const bindingName = await networkBindingName(deps.sha256Hex, network, connectorName);
  let binding = await deps.http.get<KObject>(connectPath(project, 'connectnetworkbindings', bindingName));
  let bindingCreated = false;
  if (binding) {
    if (binding.spec?.connectorRef !== connectorName || binding.spec?.gatewayRef !== gatewayName) {
      throw new ConnectError(
        'ownership',
        `Network binding ${bindingName} already targets another Connector or gateway. Disconnect it first.`
      );
    }
  } else {
    binding = await createOrGet(deps, connectPath(project, 'connectnetworkbindings'), {
      apiVersion: CONNECT_GROUP,
      kind: 'ConnectNetworkBinding',
      metadata: { name: bindingName },
      spec: { gatewayRef: gatewayName, connectorRef: connectorName },
    });
    bindingCreated = true;
  }

  const deadline = Date.now() + BINDING_TIMEOUT_MS;
  let lastLiveness = 0;
  let connectorNotReady = false;
  for (;;) {
    checkAbort(deps);
    if (currentCondition(binding, 'Accepted')) {
      deps.onProgress?.('ready');
      return {
        grant: grantFromBinding(binding, gateway, { project, network, connectorName }),
        connector,
        gatewayCreated,
        bindingCreated,
      };
    }
    const accepted = (binding.status?.conditions ?? []).find((c) => c.type === 'Accepted');
    if (accepted?.status === 'False') {
      const reason = accepted.reason ?? 'unknown reason';
      if (reason === 'GatewayProvisioning' || reason === 'GatewayApplyingGrant') {
        deps.onProgress?.('gateway-starting', reason);
      } else if (reason === 'ConnectorNotReady') {
        connectorNotReady = true;
      } else {
        throw new ConnectError('binding_rejected', `ConnectNetworkBinding was rejected (${reason}).`);
      }
    }
    if (Date.now() >= deadline) {
      throw new ConnectError(
        'binding_timeout',
        connectorNotReady
          ? `ConnectNetworkBinding ${bindingName} is still waiting for this device’s Connector to be Ready.`
          : `Timed out waiting for ConnectNetworkBinding ${bindingName}; the VPC gateway may still be starting. Try again shortly.`
      );
    }
    // The daemon's independent liveness task renews every 10 s.
    if (Date.now() - lastLiveness >= 10_000) {
      lastLiveness = Date.now();
      await renewConnectorLiveness(deps, project, connectorName, publicKey).catch(() => undefined);
    }
    await sleep(POLL_MS);
    binding = await deps.http.get<KObject>(connectPath(project, 'connectnetworkbindings', bindingName));
    if (!binding) throw new ConnectError('binding_deleted', `ConnectNetworkBinding ${bindingName} was deleted.`);
  }
}

/**
 * `leave_gateway_network`: delete this Connector's binding with uid and
 * resourceVersion preconditions. Returns false when there was none.
 */
export async function leaveGatewayNetwork(
  deps: ConnectDeps,
  input: { project: string; network: string; connectorName: string }
): Promise<boolean> {
  assertName(input.network);
  const name = await networkBindingName(deps.sha256Hex, input.network, input.connectorName);
  const path = connectPath(input.project, 'connectnetworkbindings', name);
  const binding = await deps.http.get<KObject>(path);
  if (!binding) return false;
  if (binding.spec?.connectorRef !== input.connectorName) {
    throw new ConnectError('ownership', `Network binding ${name} belongs to another Connector.`);
  }
  try {
    await deps.http.delete(path, {
      apiVersion: 'v1',
      kind: 'DeleteOptions',
      preconditions: {
        uid: required(binding.metadata?.uid, 'metadata.uid'),
        resourceVersion: required(binding.metadata?.resourceVersion, 'metadata.resourceVersion'),
      },
    });
  } catch (error) {
    if (httpStatus(error) !== 404) throw error;
  }
  return true;
}

/** This device's binding for a network, if any (read-only, for status). */
export async function readBinding(
  deps: ConnectDeps,
  input: { project: string; network: string; connectorName: string }
): Promise<KObject | null> {
  const name = await networkBindingName(deps.sha256Hex, input.network, input.connectorName);
  return deps.http.get<KObject>(connectPath(input.project, 'connectnetworkbindings', name));
}

/** Relays for the device endpoint: Datum staging's for staging (`relays::select`). */
export function homeRelaysFor(apiUrl: string): string[] {
  try {
    const url = new URL(apiUrl);
    if (url.protocol === 'https:' && url.hostname === 'api.staging.env.datum.net') return [...STAGING_RELAYS];
  } catch {
    // fall through
  }
  return [];
}

// ---------------------------------------------------------------------------

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkAbort(deps: ConnectDeps) {
  if (deps.signal?.aborted) throw new ConnectError('cancelled', 'Cancelled.');
}
