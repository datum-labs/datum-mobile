import {
  albHostValues,
  logRequestHost,
  parseDurationMs,
  pickAlbLogLabels,
  splitPathQuery,
  toAccessLogEntries,
} from '../access-log';
import { accessLogStream, streams } from './fixtures';

describe('toAccessLogEntries', () => {
  test('builds a typed row from the labels of an empty-Body Envoy log', () => {
    const [row] = toAccessLogEntries(streams(accessLogStream('1791834887401579958')));
    expect(row).toMatchObject({
      id: '1791834887401579958-req-1791834887401579958',
      method: 'GET',
      path: '/static/favicon.ico',
      status: 200,
      durationMs: 16,
      host: 'app.example.com',
      badge: 'success',
      line: '',
    });
  });

  test('drops collector labels and Envoy "-" placeholders', () => {
    const [row] = toAccessLogEntries(streams(accessLogStream('1')));
    expect(row?.fields).not.toHaveProperty('k8s_pod_name');
    expect(row?.fields).not.toHaveProperty('route_name');
    expect(row?.fields).not.toHaveProperty('referer');
    expect(row?.fields).not.toHaveProperty('response_flags');
    expect(row?.fields.user_agent).toBe('Mozilla/5.0');
  });

  test('colours status classes and treats code 0 (no response) as muted', () => {
    const rows = toAccessLogEntries(
      streams(
        accessLogStream('5', { response_code: '503' }),
        accessLogStream('4', { response_code: '404' }),
        accessLogStream('3', { response_code: '301' }),
        accessLogStream('2', { response_code: '0', response_flags: 'DC' })
      )
    );
    expect(rows.map((r) => [r.status, r.badge])).toEqual([
      [503, 'danger'],
      [404, 'warning'],
      [301, 'info'],
      [0, 'muted'],
    ]);
    expect(rows[3]?.fields.response_flags).toBe('DC');
  });

  test('keeps list ids unique when a client reuses a request id', () => {
    const rows = toAccessLogEntries(
      streams(accessLogStream('7', { request_id: 'dup' }), accessLogStream('7', { request_id: 'dup' }))
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });
});

describe('logRequestHost (datum-ui host.ts parity)', () => {
  test('lets an explicit host label override everything', () => {
    expect(
      logRequestHost({ host: 'override.example.com', requested_server_name: 'app.example.com' })
    ).toBe('override.example.com');
  });

  test('prefers the name the client used over origin authority', () => {
    expect(
      logRequestHost({
        authority: 'www.example.com',
        requested_server_name: 'app.example.com',
        x_forwarded_host: 'app.example.com',
      })
    ).toBe('app.example.com');
  });

  test('falls back through Envoy host labels', () => {
    expect(logRequestHost({ authority: 'origin.internal' })).toBe('origin.internal');
    expect(logRequestHost({ resource_name: 'gateway-eu-west' })).toBe('gateway-eu-west');
    expect(logRequestHost({ host: '  ' })).toBeUndefined();
    expect(logRequestHost({ requested_server_name: '-' })).toBeUndefined();
  });
});

describe('albHostValues', () => {
  test('lists every distinct host once', () => {
    expect(
      albHostValues({
        requested_server_name: 'app.example.com',
        x_forwarded_host: 'app.example.com',
        authority: 'origin.internal',
      })
    ).toEqual(['app.example.com', 'origin.internal']);
  });
});

describe('pickAlbLogLabels', () => {
  test('keeps the allowlist only', () => {
    expect(pickAlbLogLabels({ method: 'GET', 'milo.project.id': 'p', duration: '4' })).toEqual({
      method: 'GET',
      duration: '4',
    });
  });
});

describe('parseDurationMs', () => {
  test('reads bare and suffixed milliseconds', () => {
    expect(parseDurationMs('16')).toBe(16);
    expect(parseDurationMs('12ms')).toBe(12);
    expect(parseDurationMs('-')).toBeUndefined();
    expect(parseDurationMs('nope')).toBeUndefined();
  });
});

describe('splitPathQuery', () => {
  test('separates pathname and decoded params', () => {
    expect(splitPathQuery('/search?q=a%20b&tag=x&tag=y&flag#frag')).toEqual({
      pathname: '/search',
      params: [
        ['q', 'a b'],
        ['tag', 'x'],
        ['tag', 'y'],
        ['flag', ''],
      ],
    });
    expect(splitPathQuery('/plain')).toEqual({ pathname: '/plain', params: [] });
    expect(splitPathQuery('/bad?x=%E0%A4%A')).toEqual({ pathname: '/bad', params: [['x', '%E0%A4%A']] });
  });
});
