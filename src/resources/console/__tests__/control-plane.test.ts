/**
 * The session API and its explanations. The sessionProgress, describeEnding,
 * readWatchStream, sessionEndingFromEvent and createErrorMessage cases are
 * ported from datum-cloud/compute `ui/consumer/src/lib/console-sessions.test.ts`
 * at af9d7d3b (AGPL-3.0, Datum Technology); the HTTP cases drive the app's
 * project-scoped fetch seam instead of the portal's global fetch.
 */
import {
  canShowShell,
  createErrorMessage,
  createSession,
  deleteSession,
  describeEnding,
  fetchSessionEnding,
  fetchShellAccess,
  parseCommand,
  PERMISSION_DENIED_MESSAGE,
  readWatchStream,
  resolveRuntimeClass,
  RUNTIME_UNSUPPORTED_MESSAGE,
  SESSION_QUOTA_MESSAGE,
  SESSION_RESOURCE_TYPE,
  sessionAllowance,
  sessionEndingFromEvent,
  sessionProgress,
  SESSIONS_NOT_ENABLED_MESSAGE,
  shellStatusPill,
  toRuntimeClasses,
  TOO_MANY_SESSIONS_MESSAGE,
  watchSession,
  type ConsoleHttp,
  type ConsoleRequestInit,
  type RawConsoleSession,
} from '../control-plane';

function withReady(
  status: string,
  reason: string,
  extra: Partial<NonNullable<RawConsoleSession['status']>> = {},
  message?: string
): RawConsoleSession {
  return { status: { ...extra, conditions: [{ type: 'Ready', status, reason, message }] } };
}

const connection = {
  endpointID: 'ab'.repeat(32),
  relayURLs: ['https://relay.example'],
  target: 'agent.cell:8443',
};

/** A stand-in body: just enough of ReadableStream for readWatchStream. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const queue = chunks.map((c) => encoder.encode(c));
  return {
    getReader: () => ({
      read: async () => (queue.length ? { value: queue.shift(), done: false } : { value: undefined, done: true }),
      releaseLock: () => undefined,
    }),
  } as unknown as ReadableStream<Uint8Array>;
}

interface Call {
  path: string;
  init: ConsoleRequestInit;
}

/** A fake project-scoped fetch: routes match the end of the decoded path. */
function serve(routes: Record<string, { status?: number; body?: unknown; stream?: string[] }>) {
  const calls: Call[] = [];
  const http: ConsoleHttp = {
    fetch: async (path, init = {}) => {
      calls.push({ path: decodeURIComponent(path), init });
      const key = Object.keys(routes).find((k) => decodeURIComponent(path).endsWith(k));
      const route = key ? routes[key] : { status: 404, body: { message: 'not found' } };
      const status = route.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => route.body ?? {},
        body: route.stream ? streamOf(...route.stream) : null,
      };
    },
  };
  return { http, calls };
}

describe('sessionProgress', () => {
  test('is pending without a Ready condition', () => {
    expect(sessionProgress({})).toEqual({ kind: 'pending' });
  });

  test('is pending while Ready is Unknown', () => {
    expect(sessionProgress(withReady('Unknown', 'Pending'))).toEqual({ kind: 'pending' });
  });

  test('is ready once SessionReady publishes a connection', () => {
    expect(sessionProgress(withReady('True', 'SessionReady', { connection }))).toEqual({ kind: 'ready', connection });
  });

  test('waits for a complete connection', () => {
    expect(sessionProgress(withReady('True', 'SessionReady', { connection: { endpointID: 'x' } }))).toEqual({
      kind: 'pending',
    });
  });

  test('carries the terminal reason and the platform message', () => {
    expect(sessionProgress(withReady('False', 'NoShell', {}, 'The image has no /bin/sh.'))).toEqual({
      kind: 'ended',
      reason: 'NoShell',
      message: 'The image has no /bin/sh.',
      exitCode: undefined,
    });
  });

  test('carries the exit code of a completed session', () => {
    expect(sessionProgress(withReady('False', 'Completed', { exitCode: 3 }))).toMatchObject({ kind: 'ended', exitCode: 3 });
  });

  test('ends a session another client already consumed', () => {
    expect(sessionProgress(withReady('True', 'Connected', { connection }))).toMatchObject({
      kind: 'ended',
      reason: 'Connected',
    });
  });
});

describe('describeEnding', () => {
  test('says plainly that a container without sh can run nothing', () => {
    const message = describeEnding({ reason: 'NoShell', message: 'The container has no shell (sh).' });
    expect(message.startsWith("This container has no shell (sh), so a shell session can't start.")).toBe(true);
    expect(message).toMatch(/no command can run/);
  });

  test('names the command that is not installed', () => {
    expect(describeEnding({ reason: 'CommandUnavailable' }, ['/bin/bash', '-l'])).toBe(
      "/bin/bash isn't installed in this container."
    );
  });

  test('reports the exit code of a command that exited', () => {
    expect(describeEnding({ reason: 'Completed', exitCode: 0 })).toBe('The shell exited.');
    expect(describeEnding({ reason: 'Completed', exitCode: 3 })).toBe('The shell exited with code 3.');
  });

  test('says the app, not the browser, missed the connection window', () => {
    expect(describeEnding({ reason: 'NotConnected' })).toBe("The app didn't reach the shell in time. Try again.");
  });

  test('explains every terminal reason', () => {
    for (const reason of [
      'Expired',
      'Revoked',
      'NotConnected',
      'AgentShutdown',
      'AgentLost',
      'TooManySessions',
      'NoShell',
      'CommandUnavailable',
      'InstanceNotRunning',
      'InstanceNotFound',
      'Invalid',
      'Unavailable',
      'Disconnected',
      'ClosedByUser',
    ]) {
      expect(describeEnding({ reason })).not.toBe('The session ended.');
    }
  });

  test('prefers the platform message for a request it could not serve', () => {
    expect(describeEnding({ reason: 'Invalid', message: 'The command is too long.' })).toBe('The command is too long.');
  });

  test('falls back to the platform message for a reason it does not know', () => {
    expect(describeEnding({ reason: 'SomethingNew', message: 'Details.' })).toBe('Details.');
  });
});

describe('readWatchStream', () => {
  test('parses watch events split across chunks', async () => {
    const events = [];
    for await (const event of readWatchStream(
      streamOf(
        '{"type":"MODIFIED","object":{"metadata":{"resourceVersion":"2"}}}\n{"type":"DEL',
        'ETED","object":{"metadata":{"resourceVersion":"3"}}}\n'
      )
    )) {
      events.push(event);
    }
    expect(events.map((e) => [e.type, e.object.metadata?.resourceVersion])).toEqual([
      ['MODIFIED', '2'],
      ['DELETED', '3'],
    ]);
  });

  test('reads a final event without a trailing newline', async () => {
    const events = [];
    for await (const event of readWatchStream(streamOf('{"type":"ADDED","object":{}}'))) events.push(event.type);
    expect(events).toEqual(['ADDED']);
  });
});

function endedEvent(annotations: Record<string, string>) {
  return { reason: 'SessionEnded', metadata: { annotations } };
}

describe('sessionEndingFromEvent', () => {
  test('reads the reason and exit code the controller records', () => {
    expect(
      sessionEndingFromEvent(
        endedEvent({ 'compute.datumapis.com/reason': 'Completed', 'compute.datumapis.com/exit-code': '2' })
      )
    ).toEqual({ reason: 'Completed', exitCode: 2 });
  });

  test('ignores events other than the session ending', () => {
    expect(sessionEndingFromEvent({ reason: 'SessionStarted', metadata: { annotations: {} } })).toBeUndefined();
  });
});

describe('fetchSessionEnding', () => {
  test("reads the session's SessionEnded event by name", async () => {
    const { http, calls } = serve({
      '/events/session-uid.sessionended': { body: endedEvent({ 'compute.datumapis.com/reason': 'NoShell' }) },
    });
    expect(await fetchSessionEnding(http, 'session-uid')).toEqual({ reason: 'NoShell' });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/apis/events.k8s.io/v1/namespaces/default/events/session-uid.sessionended');
  });

  test('finds the event by the session it regards when the name differs', async () => {
    const { http, calls } = serve({
      'fieldSelector=regarding.uid=session-uid,reason=SessionEnded': {
        body: { items: [endedEvent({ 'compute.datumapis.com/reason': 'Expired' })] },
      },
    });
    expect(await fetchSessionEnding(http, 'session-uid')).toEqual({ reason: 'Expired' });
    expect(calls).toHaveLength(2);
  });

  test('returns nothing when no ending was recorded', async () => {
    const { http } = serve({});
    expect(await fetchSessionEnding(http, 'session-uid')).toBeUndefined();
  });
});

describe('createErrorMessage', () => {
  const denial =
    "You've reached your quota for this resource type (Insufficient quota resources.). Delete unused resources to free up capacity, or contact support to request a higher limit.";

  test('maps a denial with no allowance to sessions not enabled', () => {
    expect(createErrorMessage(403, denial, 0)).toBe(SESSIONS_NOT_ENABLED_MESSAGE);
  });

  test('maps a denial with an allowance to too many open sessions', () => {
    expect(createErrorMessage(403, denial, 10)).toBe(TOO_MANY_SESSIONS_MESSAGE);
  });

  test('covers both causes when the allowance cannot be read', () => {
    expect(createErrorMessage(403, 'instanceconsolesessions "x" is forbidden: Insufficient quota')).toBe(
      SESSION_QUOTA_MESSAGE
    );
  });

  test('passes a quota check that is not a denial through', () => {
    const timeout = 'Your request took too long to be checked against your quota. Please try again in a moment.';
    expect(createErrorMessage(403, timeout)).toBe(timeout);
  });

  test('says which permission is missing on any other 403', () => {
    expect(createErrorMessage(403, 'cannot create resource')).toBe(PERMISSION_DENIED_MESSAGE);
    expect(PERMISSION_DENIED_MESSAGE).toBe('You need permission to open a shell in this project.');
  });

  test("explains a runtime that doesn't support shells", () => {
    expect(
      createErrorMessage(
        422,
        'admission webhook "minstanceconsolesession.kb.io" denied the request: Can\'t open a shell session in instance "web-0": the "unikernel" runtime class does not support shell sessions'
      )
    ).toBe(RUNTIME_UNSUPPORTED_MESSAGE);
  });

  test('shows other admission refusals without the webhook preamble', () => {
    expect(
      createErrorMessage(
        422,
        'admission webhook "minstanceconsolesession.kb.io" denied the request: Can\'t open a shell session in instance "web-0": spec.containerName: Unsupported value: "x"'
      )
    ).toBe('Can\'t open a shell session in instance "web-0": spec.containerName: Unsupported value: "x"');
  });

  test('passes other API messages through', () => {
    expect(createErrorMessage(400, 'shell sessions are not enabled')).toBe('shell sessions are not enabled');
  });
});

describe('session requests', () => {
  test('creates a terminal session for the chosen command and key', async () => {
    const { http, calls } = serve({
      '/instanceconsolesessions': {
        status: 201,
        body: { metadata: { name: 'web-0-x', uid: 'u', resourceVersion: '4' } },
      },
    });
    const created = await createSession(http, {
      instanceName: 'web-0',
      instanceUid: 'iu',
      containerName: 'app',
      command: ['/bin/bash', '-l'],
      clientPublicKey: 'cd'.repeat(32),
    });

    expect(calls[0].path).toBe('/apis/compute.datumapis.com/v1alpha/namespaces/default/instanceconsolesessions');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body ?? '')).toEqual({
      apiVersion: 'compute.datumapis.com/v1alpha',
      kind: 'InstanceConsoleSession',
      metadata: { generateName: 'web-0-' },
      spec: {
        instanceRef: { name: 'web-0', uid: 'iu' },
        containerName: 'app',
        command: ['/bin/bash', '-l'],
        stdin: true,
        terminal: true,
        clientPublicKey: 'cd'.repeat(32),
      },
    });
    expect(created).toMatchObject({ name: 'web-0-x', uid: 'u', resourceVersion: '4' });
  });

  test('turns a forbidden create into the permission message', async () => {
    const { http } = serve({
      '/instanceconsolesessions': { status: 403, body: { message: 'instanceconsolesessions is forbidden' } },
    });
    await expect(
      createSession(http, {
        instanceName: 'web-0',
        instanceUid: 'iu',
        containerName: 'app',
        command: ['/bin/sh'],
        clientPublicKey: 'cd'.repeat(32),
      })
    ).rejects.toMatchObject({ status: 403, message: PERMISSION_DENIED_MESSAGE });
  });

  test('reads the allowance to explain a quota denial', async () => {
    const { http } = serve({
      '/instanceconsolesessions': { status: 403, body: { message: 'Insufficient quota resources.' } },
      'consumer-kind=Project': {
        body: { items: [{ spec: { resourceType: SESSION_RESOURCE_TYPE }, status: { limit: 0 } }] },
      },
    });
    await expect(
      createSession(http, {
        instanceName: 'web-0',
        instanceUid: 'iu',
        containerName: 'app',
        command: ['/bin/sh'],
        clientPublicKey: 'cd'.repeat(32),
      })
    ).rejects.toMatchObject({ message: SESSIONS_NOT_ENABLED_MESSAGE });
  });

  test('watches one session from a resource version, over the streaming fetch', async () => {
    const streamed: string[] = [];
    const { http } = serve({});
    http.streamFetch = async (path) => {
      streamed.push(decodeURIComponent(path));
      return { ok: true, status: 200, json: async () => ({}), body: streamOf('{"type":"MODIFIED","object":{}}\n') };
    };
    const events = [];
    for await (const e of watchSession(http, 'web-0-x', '7', new AbortController().signal)) events.push(e.type);

    expect(events).toEqual(['MODIFIED']);
    expect(streamed).toEqual([
      '/apis/compute.datumapis.com/v1alpha/namespaces/default/instanceconsolesessions?watch=true&fieldSelector=metadata.name=web-0-x&resourceVersion=7',
    ]);
  });

  test('deletes a session and tolerates one that is already gone', async () => {
    const { http, calls } = serve({});
    await expect(deleteSession(http, 'web-0-x')).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({
      path: '/apis/compute.datumapis.com/v1alpha/namespaces/default/instanceconsolesessions/web-0-x',
      init: { method: 'DELETE' },
    });
  });
});

describe('shell access', () => {
  const classes = {
    items: [
      { metadata: { name: 'general-purpose' }, spec: { capabilities: { features: ['sandboxRuntime', 'exec'] } } },
      { metadata: { name: 'unikernel' }, spec: { default: true, capabilities: { features: ['sandboxRuntime'] } } },
    ],
  };

  test('reads permission, allowance and runtime classes', async () => {
    const { http, calls } = serve({
      '/selfsubjectaccessreviews': { status: 201, body: { status: { allowed: true } } },
      'consumer-kind=Project': {
        body: { items: [{ spec: { resourceType: SESSION_RESOURCE_TYPE }, status: { limit: 10 } }] },
      },
      '/runtimeclasses': { body: classes },
    });
    const access = await fetchShellAccess(http);

    expect(access).toEqual({
      canCreateSessions: true,
      sessionAllowance: 10,
      runtimeClasses: toRuntimeClasses(classes),
    });
    const review = calls.find((c) => c.path.endsWith('/selfsubjectaccessreviews'));
    expect(JSON.parse(review?.init.body ?? '').spec.resourceAttributes).toEqual({
      group: 'compute.datumapis.com',
      resource: 'instanceconsolesessions',
      verb: 'create',
      namespace: 'default',
    });
  });

  test('treats an unreadable review as no permission', async () => {
    const { http } = serve({ '/runtimeclasses': { body: classes } });
    expect((await fetchShellAccess(http)).canCreateSessions).toBe(false);
  });

  test('offers a shell only where the runtime class advertises exec', () => {
    const runtimeClasses = toRuntimeClasses(classes);
    const base = { canCreateSessions: true, sessionAllowance: 10, containers: ['app'] };
    expect(canShowShell({ ...base, runtimeClass: resolveRuntimeClass('general-purpose', runtimeClasses) })).toBe(true);
    expect(canShowShell({ ...base, runtimeClass: resolveRuntimeClass('unikernel', runtimeClasses) })).toBe(false);
    // No class on the instance means the default one.
    expect(canShowShell({ ...base, runtimeClass: resolveRuntimeClass(undefined, runtimeClasses) })).toBe(false);
    expect(
      canShowShell({ ...base, canCreateSessions: false, runtimeClass: resolveRuntimeClass('general-purpose', runtimeClasses) })
    ).toBe(false);
    expect(
      canShowShell({ ...base, sessionAllowance: 0, runtimeClass: resolveRuntimeClass('general-purpose', runtimeClasses) })
    ).toBe(false);
    // An unreadable allowance doesn't hide it; the create explains.
    expect(
      canShowShell({ ...base, sessionAllowance: undefined, runtimeClass: resolveRuntimeClass('general-purpose', runtimeClasses) })
    ).toBe(true);
  });

  test('reads the session allowance from the project buckets', () => {
    expect(sessionAllowance({ items: [{ spec: { resourceType: SESSION_RESOURCE_TYPE }, status: { limit: 3 } }] })).toBe(3);
    expect(sessionAllowance({ items: [] })).toBe(0);
  });
});

describe('parseCommand', () => {
  test('splits words and keeps quoted text literally', () => {
    expect(parseCommand(`/bin/sh -c 'echo "$HOME"'`)).toEqual({ ok: true, argv: ['/bin/sh', '-c', 'echo "$HOME"'] });
  });

  test('refuses an empty or unterminated command', () => {
    expect(parseCommand('  ')).toMatchObject({ ok: false });
    expect(parseCommand(`sh -c 'x`)).toEqual({ ok: false, error: 'Close the single quote.' });
  });
});

describe('shellStatusPill', () => {
  test('maps the session phase to the header pill', () => {
    expect(shellStatusPill({ phase: 'waiting' })).toEqual({ label: 'Connecting', status: 'pending' });
    expect(shellStatusPill({ phase: 'connected' })).toEqual({ label: 'Connected', status: 'success' });
    expect(shellStatusPill({ phase: 'ended', message: 'x' })).toEqual({ label: 'Ended', status: 'unknown' });
  });
});
