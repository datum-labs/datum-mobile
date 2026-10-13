/**
 * Instance shell ("exec") control plane: `InstanceConsoleSession`s.
 *
 * A port of the compute portal plugin's browser shell, datum-cloud/compute
 * `ui/consumer/src/lib/{console-sessions,shell-session,shell-command,instance-shell}.ts`
 * at af9d7d3b (AGPL-3.0, Datum Technology), adapted for the app:
 *
 * - HTTP goes through a project-scoped `fetch` seam instead of the portal
 *   proxy, so the app's API client (bearer token, 401 retry) and a Node script
 *   can both drive it;
 * - the copy says "the app" where the portal says "the browser", and a 403
 *   on create explains the missing permission.
 *
 * The session flow is the portal's: create a session with the client's public
 * key, watch it (falling back to reads) until `Ready=True/SessionReady`, hand
 * `status.connection` and `metadata.uid` to the client right away (the cell
 * ends unconnected sessions at `status.connectBefore`, 60 s after it publishes
 * them), and delete the session when the shell closes. Sessions are single use.
 *
 * This file has no runtime imports and uses only erasable TypeScript, so
 * `scripts/console-e2e.mjs` loads it with Node's type stripping and drives the
 * same code against staging.
 */

export const CONSOLE_API_GROUP = 'compute.datumapis.com';
export const CONSOLE_API_VERSION = 'v1alpha';
const SESSIONS_PATH = `/apis/${CONSOLE_API_GROUP}/${CONSOLE_API_VERSION}/namespaces/default/instanceconsolesessions`;
const RUNTIME_CLASSES_PATH = `/apis/${CONSOLE_API_GROUP}/${CONSOLE_API_VERSION}/runtimeclasses`;
const EVENTS_PATH = '/apis/events.k8s.io/v1/namespaces/default/events';
const SSAR_PATH = '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews';
const ALLOWANCE_BUCKETS_PATH =
  '/apis/quota.miloapis.com/v1alpha1/namespaces/milo-system/allowancebuckets?labelSelector=quota.miloapis.com%2Fconsumer-kind%3DProject';

export const SESSION_RESOURCE_TYPE = 'compute.datumapis.com/instanceconsolesessions';
export const EXEC_FEATURE = 'exec';

// ---------------------------------------------------------------------------
// Commands (shell-command.ts)

export const DEFAULT_SHELL_COMMAND = '/bin/sh';
export const QUICK_COMMANDS = ['/bin/sh', '/bin/bash'] as const;
export const SHELL_COMMAND = [DEFAULT_SHELL_COMMAND];
export const MAX_COMMAND_ARGS = 64;
export const MAX_COMMAND_BYTES = 16 * 1024;

export type ParsedCommand = { ok: true; argv: string[] } | { ok: false; error: string };

const DOUBLE_QUOTE_ESCAPES = new Set(['"', '\\', '$', '`']);

function utf8Length(text: string): number {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    n += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Splits a command line into arguments the way a POSIX shell splits words,
 * without expanding anything (compute `parseCommand`).
 */
export function parseCommand(text: string): ParsedCommand {
  const argv: string[] = [];
  let word = '';
  let inWord = false;
  let quote: "'" | '"' | undefined;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = undefined;
      else word += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') {
        quote = undefined;
      } else if (c === '\\' && i + 1 < text.length && DOUBLE_QUOTE_ESCAPES.has(text[i + 1])) {
        word += text[++i];
      } else {
        word += c;
      }
      continue;
    }
    if (/\s/.test(c)) {
      if (inWord) argv.push(word);
      word = '';
      inWord = false;
      continue;
    }
    inWord = true;
    if (c === "'" || c === '"') {
      quote = c;
    } else if (c === '\\') {
      if (i + 1 >= text.length) return { ok: false, error: 'The command ends with a backslash.' };
      word += text[++i];
    } else {
      word += c;
    }
  }

  if (quote) return { ok: false, error: `Close the ${quote === "'" ? 'single' : 'double'} quote.` };
  if (inWord) argv.push(word);
  if (argv.length === 0) return { ok: false, error: 'Enter a command, such as /bin/sh.' };
  if (argv.length > MAX_COMMAND_ARGS) {
    return { ok: false, error: `A command can have at most ${MAX_COMMAND_ARGS} arguments.` };
  }
  const bytes = argv.reduce((n, arg) => n + utf8Length(arg), 0);
  if (bytes > MAX_COMMAND_BYTES) return { ok: false, error: 'The command is longer than 16 KiB.' };
  return { ok: true, argv };
}

// ---------------------------------------------------------------------------
// Transport seam

/** The part of a fetch Response the control plane reads. */
export interface ConsoleResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  body?: ReadableStream<Uint8Array> | null;
}

export interface ConsoleRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/**
 * Authenticated fetch against one project's control plane: `path` is relative
 * to `/apis/resourcemanager.miloapis.com/v1alpha1/projects/{p}/control-plane`.
 * It resolves non-2xx responses rather than throwing.
 */
export type ConsoleFetch = (path: string, init?: ConsoleRequestInit) => Promise<ConsoleResponse>;

export interface ConsoleHttp {
  fetch: ConsoleFetch;
  /** A fetch whose response body streams (watches). Defaults to `fetch`. */
  streamFetch?: ConsoleFetch;
}

/** A non-2xx response, with copy that's ready to show. */
export class ConsoleApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ConsoleApiError';
    this.status = status;
  }
}

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

// ---------------------------------------------------------------------------
// Sessions (console-sessions.ts)

export interface SessionConnection {
  endpointID: string;
  relayURLs: string[];
  target: string;
}

export interface RawConsoleSession {
  metadata?: { name?: string; namespace?: string; uid?: string; resourceVersion?: string };
  status?: {
    connection?: Partial<SessionConnection>;
    connectBefore?: string;
    exitCode?: number;
    conditions?: { type?: string; status?: string; reason?: string; message?: string }[];
  };
}

export interface SessionRef {
  name: string;
  namespace: string;
  uid: string;
}

export interface CreatedSession extends SessionRef {
  resourceVersion: string;
  initial: RawConsoleSession;
}

export interface SessionWatchEvent {
  type: 'ADDED' | 'MODIFIED' | 'DELETED' | 'BOOKMARK' | 'ERROR';
  object: RawConsoleSession;
}

export interface SessionEnding {
  reason: string;
  message?: string;
  exitCode?: number;
}

export interface NewSession {
  instanceName: string;
  instanceUid: string;
  containerName: string;
  command: string[];
  clientPublicKey: string;
}

export type SessionProgress =
  | { kind: 'pending' }
  | { kind: 'ready'; connection: SessionConnection }
  | { kind: 'ended'; reason: string; message: string; exitCode?: number };

const REASON_MESSAGES: Record<string, string> = {
  Expired: 'The session reached its time limit.',
  Revoked: 'The session was closed.',
  NotConnected: "The app didn't reach the shell in time. Try again.",
  AgentShutdown: 'Datum closed the session for maintenance. Connect again to continue.',
  AgentLost: 'Datum lost contact with the session. Connect again to continue.',
  TooManySessions:
    'This instance already has as many shells open as it allows. Close one and try again.',
  NoShell:
    "This container has no shell (sh), so a shell session can't start. Datum runs every command through sh, so no command can run in this container.",
  InstanceNotRunning: "The instance isn't running.",
  InstanceNotFound: 'The instance no longer exists.',
  Invalid: "Datum couldn't open this shell.",
  Unavailable: 'No part of Datum took the session in time. Try again shortly.',
  Disconnected: 'The connection to the session was lost, so Datum stopped the command.',
  ClosedByUser: 'The shell was closed.',
};

export const SESSION_GONE_MESSAGE = "The session ended, but Datum couldn't say why. Try again.";
export const TOO_MANY_SESSIONS_MESSAGE =
  'Too many open sessions in this project. Close another shell and try again.';
export const SESSIONS_NOT_ENABLED_MESSAGE = "Shell sessions aren't enabled for this project.";
export const SESSION_QUOTA_MESSAGE =
  "Shell sessions aren't enabled for this project, or too many are open in it.";
export const PERMISSION_DENIED_MESSAGE = 'You need permission to open a shell in this project.';
export const RUNTIME_UNSUPPORTED_MESSAGE = "This instance's runtime doesn't support shell sessions.";

export function describeEnding(ending: SessionEnding, command: string[] = SHELL_COMMAND): string {
  const { reason, message, exitCode } = ending;
  if (reason === 'Completed' || reason === '') {
    return exitCode ? `The shell exited with code ${exitCode}.` : 'The shell exited.';
  }
  if (reason === 'CommandUnavailable') {
    return command[0]
      ? `${command[0]} isn't installed in this container.`
      : "The command isn't installed in this container.";
  }
  if (reason === 'Invalid') return message?.trim() || REASON_MESSAGES.Invalid;
  return REASON_MESSAGES[reason] ?? (message?.trim() || 'The session ended.');
}

export function sessionEnding(raw: RawConsoleSession): SessionEnding | undefined {
  const ready = raw.status?.conditions?.find((c) => c.type === 'Ready');
  if (ready?.status !== 'False') return undefined;
  return {
    reason: ready.reason ?? '',
    message: ready.message ?? '',
    exitCode: raw.status?.exitCode,
  };
}

export function sessionProgress(raw: RawConsoleSession): SessionProgress {
  const ended = sessionEnding(raw);
  if (ended) return { kind: 'ended', ...ended, message: ended.message ?? '' };
  const ready = raw.status?.conditions?.find((c) => c.type === 'Ready');
  if (!ready || ready.status !== 'True') return { kind: 'pending' };
  const reason = ready.reason ?? '';
  const c = raw.status?.connection;
  if (reason === 'SessionReady' && c?.endpointID && c.target && c.relayURLs?.length) {
    return {
      kind: 'ready',
      connection: { endpointID: c.endpointID, relayURLs: c.relayURLs, target: c.target },
    };
  }
  if (reason === 'Connected') {
    return {
      kind: 'ended',
      reason,
      message: 'Another client is already connected to this session.',
    };
  }
  return { kind: 'pending' };
}

export function isQuotaDenial(message: string): boolean {
  return /reached your quota|insufficient quota/i.test(message);
}

const ADMISSION_PREFIX = /^admission webhook "[^"]*" denied the request: /;

export function createErrorMessage(status: number, raw: string, allowance?: number): string {
  const message = raw.replace(ADMISSION_PREFIX, '');
  if (isQuotaDenial(message)) {
    if (allowance === undefined) return SESSION_QUOTA_MESSAGE;
    return allowance === 0 ? SESSIONS_NOT_ENABLED_MESSAGE : TOO_MANY_SESSIONS_MESSAGE;
  }
  if (/quota/i.test(message)) return message;
  if (status === 403) return PERMISSION_DENIED_MESSAGE;
  if (status === 404) return 'Shell sessions are not available in this project yet.';
  if (/does not support shell sessions/i.test(message)) return RUNTIME_UNSUPPORTED_MESSAGE;
  return message || `The shell could not be opened (${status}).`;
}

async function statusMessage(res: ConsoleResponse): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? '';
  } catch {
    return '';
  }
}

async function readJson<T>(http: ConsoleHttp, path: string): Promise<T | undefined> {
  try {
    const res = await http.fetch(path, { headers: { Accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

export interface RawAllowanceBucketList {
  items?: {
    spec?: { resourceType?: string };
    status?: { limit?: number };
  }[];
}

export function sessionAllowance(body: RawAllowanceBucketList): number {
  const limit = body.items?.find((b) => b.spec?.resourceType === SESSION_RESOURCE_TYPE)?.status?.limit;
  return typeof limit === 'number' ? limit : 0;
}

/** The project's session allowance, or undefined when it can't be read. */
export async function fetchSessionAllowance(http: ConsoleHttp): Promise<number | undefined> {
  const body = await readJson<RawAllowanceBucketList>(http, ALLOWANCE_BUCKETS_PATH);
  return body ? sessionAllowance(body) : undefined;
}

export function sessionRequest(input: NewSession) {
  return {
    apiVersion: `${CONSOLE_API_GROUP}/${CONSOLE_API_VERSION}`,
    kind: 'InstanceConsoleSession',
    metadata: { generateName: `${input.instanceName}-` },
    spec: {
      instanceRef: { name: input.instanceName, uid: input.instanceUid },
      containerName: input.containerName,
      command: input.command,
      stdin: true,
      terminal: true,
      clientPublicKey: input.clientPublicKey,
    },
  };
}

export async function createSession(http: ConsoleHttp, input: NewSession): Promise<CreatedSession> {
  const res = await http.fetch(SESSIONS_PATH, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(sessionRequest(input)),
  });
  if (!res.ok) {
    const message = await statusMessage(res);
    const allowance = isQuotaDenial(message) ? await fetchSessionAllowance(http) : undefined;
    throw new ConsoleApiError(res.status, createErrorMessage(res.status, message, allowance));
  }
  const body = (await res.json()) as RawConsoleSession;
  return {
    name: body.metadata?.name ?? '',
    namespace: body.metadata?.namespace ?? 'default',
    uid: body.metadata?.uid ?? '',
    resourceVersion: body.metadata?.resourceVersion ?? '',
    initial: body,
  };
}

/** Newline-delimited watch events from a streaming response body. */
export async function* readWatchStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SessionWatchEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as SessionWatchEvent;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* watchSession(
  http: ConsoleHttp,
  name: string,
  resourceVersion: string,
  signal: AbortSignal
): AsyncGenerator<SessionWatchEvent> {
  const query = [`watch=true`, `fieldSelector=${encodeURIComponent(`metadata.name=${name}`)}`];
  if (resourceVersion) query.push(`resourceVersion=${encodeURIComponent(resourceVersion)}`);
  const res = await (http.streamFetch ?? http.fetch)(`${SESSIONS_PATH}?${query.join('&')}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new ConsoleApiError(res.status, `The session could not be watched (${res.status}).`);
  }
  yield* readWatchStream(res.body);
}

export async function getSession(http: ConsoleHttp, name: string): Promise<RawConsoleSession> {
  const res = await http.fetch(`${SESSIONS_PATH}/${encodeURIComponent(name)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new ConsoleApiError(res.status, `The session could not be read (${res.status}).`);
  return (await res.json()) as RawConsoleSession;
}

export interface RawSessionEvent {
  reason?: string;
  note?: string;
  metadata?: { annotations?: Record<string, string> };
}

const REASON_ANNOTATION = 'compute.datumapis.com/reason';
const EXIT_CODE_ANNOTATION = 'compute.datumapis.com/exit-code';

export function sessionEndingFromEvent(event: RawSessionEvent): SessionEnding | undefined {
  const annotations = event.metadata?.annotations ?? {};
  const reason = annotations[REASON_ANNOTATION];
  if (event.reason !== 'SessionEnded' || !reason) return undefined;
  const code = Number.parseInt(annotations[EXIT_CODE_ANNOTATION] ?? '', 10);
  return Number.isNaN(code) ? { reason } : { reason, exitCode: code };
}

/** How a session that is already gone ended, from its `SessionEnded` event. */
export async function fetchSessionEnding(http: ConsoleHttp, uid: string): Promise<SessionEnding | undefined> {
  const named = await readJson<RawSessionEvent>(http, `${EVENTS_PATH}/${uid}.sessionended`);
  const ending = named && sessionEndingFromEvent(named);
  if (ending) return ending;
  const selector = encodeURIComponent(`regarding.uid=${uid},reason=SessionEnded`);
  const list = await readJson<{ items?: RawSessionEvent[] }>(http, `${EVENTS_PATH}?fieldSelector=${selector}`);
  for (const event of list?.items ?? []) {
    const found = sessionEndingFromEvent(event);
    if (found) return found;
  }
  return undefined;
}

/** Deletes (revokes) a session. Never throws: a session that's gone is fine. */
export async function deleteSession(http: ConsoleHttp, name: string): Promise<void> {
  await http
    .fetch(`${SESSIONS_PATH}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Who may open a shell, and where (use-shell-available.ts, instance-shell.ts)

export interface RuntimeClassSummary {
  name: string;
  isDefault: boolean;
  features: string[];
}

export interface RawRuntimeClassList {
  items?: {
    metadata?: { name?: string };
    spec?: { default?: boolean; capabilities?: { features?: string[] } };
  }[];
}

export function toRuntimeClasses(body: RawRuntimeClassList): RuntimeClassSummary[] {
  return (body.items ?? []).map((item) => ({
    name: item.metadata?.name ?? '',
    isDefault: !!item.spec?.default,
    features: item.spec?.capabilities?.features ?? [],
  }));
}

export function resolveRuntimeClass(
  instanceClass: string | undefined,
  classes: RuntimeClassSummary[]
): RuntimeClassSummary | undefined {
  if (instanceClass) return classes.find((c) => c.name === instanceClass);
  return classes.find((c) => c.isDefault);
}

export interface ShellAccess {
  canCreateSessions: boolean;
  sessionAllowance: number | undefined;
  runtimeClasses: RuntimeClassSummary[];
}

async function canCreateSessions(http: ConsoleHttp): Promise<boolean> {
  try {
    const res = await http.fetch(SSAR_PATH, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectAccessReview',
        spec: {
          resourceAttributes: {
            group: CONSOLE_API_GROUP,
            resource: 'instanceconsolesessions',
            verb: 'create',
            namespace: 'default',
          },
        },
      }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: { allowed?: boolean; denied?: boolean } };
    return !!body.status?.allowed && !body.status?.denied;
  } catch {
    return false;
  }
}

/** The permission, allowance and runtime-class facts that decide whether to offer a shell. */
export async function fetchShellAccess(http: ConsoleHttp): Promise<ShellAccess> {
  const [allowed, allowance, classes] = await Promise.all([
    canCreateSessions(http),
    fetchSessionAllowance(http),
    readJson<RawRuntimeClassList>(http, RUNTIME_CLASSES_PATH),
  ]);
  return {
    canCreateSessions: allowed,
    sessionAllowance: allowance,
    runtimeClasses: classes ? toRuntimeClasses(classes) : [],
  };
}

export function canShowShell({
  canCreateSessions: allowed,
  sessionAllowance: allowance,
  runtimeClass,
  containers,
}: {
  canCreateSessions: boolean;
  sessionAllowance: number | undefined;
  runtimeClass: RuntimeClassSummary | undefined;
  containers: string[];
}): boolean {
  return (
    allowed &&
    allowance !== 0 &&
    !!runtimeClass?.features.includes(EXEC_FEATURE) &&
    containers.length > 0
  );
}

// ---------------------------------------------------------------------------
// The shell session (shell-session.ts)

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** Where a ready session lives, as `datumExec.connect` takes it. */
export interface ConsoleTarget extends SessionConnection {
  uid: string;
}

/** `datumExec.connect`'s `onEnd` argument, normalised. */
export interface ConsoleEnding {
  exitCode: number;
  reason: string;
  message: string;
  error: string;
}

/** The shell client: the WebView's WASM client in the app, the WASM in Node in the e2e script. */
export interface ShellConnector {
  /** Starts the client and returns the public key for the next session. */
  load(): Promise<string>;
  connect(
    target: ConsoleTarget,
    size: TerminalSize,
    onOutput: (bytes: Uint8Array) => void,
    onEnd: (ending: ConsoleEnding) => void,
    onConnected: () => void
  ): void;
  write(data: string): void;
  resize(size: TerminalSize): void;
  dispose(): void;
}

export type ShellState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting' }
  | { phase: 'connecting' }
  | { phase: 'connected' }
  | { phase: 'ended'; message: string; reason?: string };

export interface ShellSessionDeps {
  createConnector(): ShellConnector;
  create(input: NewSession): Promise<CreatedSession>;
  watch(name: string, resourceVersion: string, signal: AbortSignal): AsyncIterable<SessionWatchEvent>;
  get(name: string): Promise<RawConsoleSession>;
  ending(uid: string): Promise<SessionEnding | undefined>;
  remove(name: string): Promise<void>;
  wait(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
}

export interface ShellSessionOptions {
  instanceName: string;
  instanceUid: string;
  onState(state: ShellState): void;
  onOutput(bytes: Uint8Array): void;
}

export const POLL_INTERVAL_MS = 500;
export const READY_TIMEOUT_MS = 60_000;

export function endingMessage(ending: ConsoleEnding, command: string[] = SHELL_COMMAND): string {
  if (ending.reason) return describeEnding(ending, command);
  if (ending.error === 'closed') return 'The shell was closed.';
  if (ending.error) {
    return `The connection to the instance was lost (${ending.error}). Open a new shell to try again.`;
  }
  return describeEnding({ reason: 'Completed', exitCode: ending.exitCode }, command);
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'The shell could not be opened.';
}

function isGone(err: unknown): boolean {
  return err instanceof ConsoleApiError && err.status === 404;
}

/** The deps a ShellSession needs, from an HTTP seam (watch, reads, events, delete). */
export function httpSessionDeps(
  http: ConsoleHttp,
  createConnector: () => ShellConnector
): ShellSessionDeps {
  return {
    createConnector,
    create: (input) => createSession(http, input),
    watch: (name, resourceVersion, signal) => watchSession(http, name, resourceVersion, signal),
    get: (name) => getSession(http, name),
    ending: (uid) => fetchSessionEnding(http, uid),
    remove: (name) => deleteSession(http, name),
    wait: (ms, signal) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      }),
    now: () => Date.now(),
  };
}

type ReadyOutcome = SessionProgress | { kind: 'gone' } | { kind: 'timeout' };

/**
 * One shell: create → wait for Ready → connect → end, then delete. `open`
 * again (Reconnect) always creates a new session, because sessions are
 * single use. A port of compute's `ShellSession`; `ended` also carries the
 * platform's terminal reason so the app can pick a Notice tone.
 */
export class ShellSession {
  private deps: ShellSessionDeps;
  private options: ShellSessionOptions;
  private connector: ShellConnector | undefined;
  private session: SessionRef | undefined;
  private watching: AbortController | undefined;
  private attempt = 0;
  private state: ShellState = { phase: 'idle' };
  private command: string[] = SHELL_COMMAND;

  constructor(deps: ShellSessionDeps, options: ShellSessionOptions) {
    this.deps = deps;
    this.options = options;
  }

  get current(): ShellState {
    return this.state;
  }

  /** The session being opened or connected, if any (for logs and tests). */
  get sessionName(): string | undefined {
    return this.session?.name;
  }

  async open(containerName: string, command: string[], size: () => TerminalSize): Promise<void> {
    this.release();
    this.command = command;
    const attempt = ++this.attempt;
    const live = () => attempt === this.attempt;
    this.setState({ phase: 'starting' });

    try {
      const connector = this.deps.createConnector();
      this.connector = connector;
      const clientPublicKey = await connector.load();
      if (!live()) return;

      const session = await this.deps.create({
        instanceName: this.options.instanceName,
        instanceUid: this.options.instanceUid,
        containerName,
        command,
        clientPublicKey,
      });
      if (!live()) {
        void this.deps.remove(session.name);
        return;
      }
      this.session = session;
      this.setState({ phase: 'waiting' });

      const outcome = await this.awaitReady(session, live);
      if (!live()) return;
      switch (outcome.kind) {
        case 'ended':
          return this.end(describeEnding(outcome, this.command), outcome.reason);
        case 'gone':
          return this.endFrom(await this.recoverEnding(session.uid));
        case 'timeout':
          return this.end('The shell took too long to start. Try again.');
        case 'pending':
          return;
      }

      this.setState({ phase: 'connecting' });
      connector.connect(
        { uid: session.uid, ...outcome.connection },
        size(),
        (bytes) => {
          if (live()) this.options.onOutput(bytes);
        },
        (ending) => {
          if (live()) void this.finish(ending, session, live);
        },
        () => {
          if (live() && this.state.phase === 'connecting') {
            this.setState({ phase: 'connected' });
          }
        }
      );
    } catch (err) {
      if (live()) this.end(errorMessage(err), err instanceof ConsoleApiError ? `HTTP${err.status}` : undefined);
    }
  }

  write(data: string): void {
    if (this.state.phase === 'connecting' || this.state.phase === 'connected') {
      this.connector?.write(data);
    }
  }

  resize(size: TerminalSize): void {
    if (this.state.phase === 'connecting' || this.state.phase === 'connected') {
      this.connector?.resize(size);
    }
  }

  close(): void {
    this.attempt++;
    this.release();
    this.setState({ phase: 'idle' });
  }

  dispose(): void {
    this.attempt++;
    this.release();
  }

  // Sessions are deleted as soon as they end, so a watch is the one reliable
  // way to see how an unready session ended. A broken watch is read again and
  // resumed; a session that is gone by then is explained from its events.
  private async awaitReady(session: CreatedSession, live: () => boolean): Promise<ReadyOutcome> {
    const deadline = this.deps.now() + READY_TIMEOUT_MS;
    let resourceVersion = session.resourceVersion;
    let progress = sessionProgress(session.initial);

    while (live() && progress.kind === 'pending') {
      const remaining = deadline - this.deps.now();
      if (remaining <= 0) return { kind: 'timeout' };

      const watching = new AbortController();
      this.watching = watching;
      let timedOut = false;
      void this.deps.wait(remaining, watching.signal).then(() => {
        if (watching.signal.aborted) return;
        timedOut = true;
        watching.abort();
      });
      try {
        for await (const event of this.deps.watch(session.name, resourceVersion, watching.signal)) {
          if (event.type === 'ERROR') break;
          resourceVersion = event.object.metadata?.resourceVersion ?? resourceVersion;
          if (event.type === 'BOOKMARK') continue;
          progress = sessionProgress(event.object);
          if (event.type === 'DELETED' && progress.kind !== 'ended') return { kind: 'gone' };
          if (progress.kind !== 'pending') break;
        }
      } catch {
        // A broken watch falls through to reading the session again.
      } finally {
        watching.abort();
        if (this.watching === watching) this.watching = undefined;
      }
      if (!live() || progress.kind !== 'pending') break;
      if (timedOut) return { kind: 'timeout' };

      try {
        const raw = await this.deps.get(session.name);
        resourceVersion = raw.metadata?.resourceVersion ?? '';
        progress = sessionProgress(raw);
      } catch (err) {
        if (isGone(err)) return { kind: 'gone' };
        throw err;
      }
      if (progress.kind === 'pending') await this.deps.wait(POLL_INTERVAL_MS);
    }
    return progress;
  }

  private async recoverEnding(uid: string): Promise<SessionEnding | undefined> {
    return this.deps.ending(uid).catch(() => undefined);
  }

  private endFrom(ending: SessionEnding | undefined): void {
    if (ending) this.end(describeEnding(ending, this.command), ending.reason);
    else this.end(SESSION_GONE_MESSAGE);
  }

  // A stream that broke without an ending is explained from the session's
  // status, or from its events once it is gone, as datumctl does.
  private async finish(ending: ConsoleEnding, session: SessionRef, live: () => boolean) {
    if (ending.reason || !ending.error || ending.error === 'closed') {
      return this.end(endingMessage(ending, this.command), ending.reason || (ending.error ? 'Closed' : 'Completed'));
    }
    let message = endingMessage(ending, this.command);
    let reason: string | undefined = 'Disconnected';
    try {
      const ended = sessionEnding(await this.deps.get(session.name));
      if (ended) {
        message = describeEnding(ended, this.command);
        reason = ended.reason;
      }
    } catch (err) {
      if (isGone(err)) {
        const recovered = await this.recoverEnding(session.uid);
        message = recovered ? describeEnding(recovered, this.command) : SESSION_GONE_MESSAGE;
        reason = recovered?.reason;
      }
    }
    if (live()) this.end(message, reason);
  }

  private end(message: string, reason?: string): void {
    this.attempt++;
    this.release();
    this.setState(reason ? { phase: 'ended', message, reason } : { phase: 'ended', message });
  }

  private release(): void {
    this.watching?.abort();
    this.watching = undefined;
    this.connector?.dispose();
    this.connector = undefined;
    if (this.session) void this.deps.remove(this.session.name);
    this.session = undefined;
  }

  private setState(state: ShellState): void {
    this.state = state;
    this.options.onState(state);
  }
}

export interface ShellStatusPill {
  label: 'Connecting' | 'Connected' | 'Ended';
  status: 'pending' | 'success' | 'unknown';
}

/** The header pill for a shell state (compute `shellStatusBadge`, in StatusBadge terms). */
export function shellStatusPill(state: ShellState): ShellStatusPill {
  if (state.phase === 'connected') return { label: 'Connected', status: 'success' };
  if (state.phase === 'ended' || state.phase === 'idle') return { label: 'Ended', status: 'unknown' };
  return { label: 'Connecting', status: 'pending' };
}

/** What the screen says while a shell is opening. */
export const OPENING_STATUS: Record<'starting' | 'waiting' | 'connecting', string> = {
  starting: 'Starting the shell client…',
  waiting: 'Preparing the session…',
  connecting: 'Connecting…',
};
