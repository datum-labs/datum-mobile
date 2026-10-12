import { toAccessLogEntries } from '../access-log';
import { toConsoleLogEntries } from '../console-log';
import { filterAccessLogs, filterConsoleLogs } from '../filter';
import { formatDurationMs, formatLogTime, formatUtcTimestamp } from '../format';
import { DEFAULT_LOG_RANGE, isLogRangeKey, resolveLogWindow } from '../time-range';
import { accessLogStream, consoleStream, streams } from './fixtures';

describe('filterAccessLogs', () => {
  const rows = toAccessLogEntries(
    streams(
      accessLogStream('3', { path: '/api/users', response_code: '500' }),
      accessLogStream('2', { path: '/healthz', requested_server_name: 'other.example.com', x_forwarded_host: '-' }),
      accessLogStream('1', { path: '/', authority: 'origin.internal' })
    )
  );

  test('matches path, any host, method and status, case-insensitively', () => {
    expect(filterAccessLogs(rows, '/API').map((r) => r.path)).toEqual(['/api/users']);
    expect(filterAccessLogs(rows, 'other.example').map((r) => r.path)).toEqual(['/healthz']);
    expect(filterAccessLogs(rows, '500').map((r) => r.path)).toEqual(['/api/users']);
    expect(filterAccessLogs(rows, '  ')).toHaveLength(3);
  });

  test('does not match fields the row hides (user agent)', () => {
    expect(filterAccessLogs(rows, 'mozilla')).toEqual([]);
  });
});

describe('filterConsoleLogs', () => {
  const rows = toConsoleLogEntries(
    streams(
      consoleStream('web-ashburn-0', [['2', 'listening on :8080']]),
      consoleStream('web-dallas-0', [['1', 'Restarting']])
    )
  );

  test('matches the message and the instance', () => {
    expect(filterConsoleLogs(rows, 'LISTEN').map((r) => r.instance)).toEqual(['web-ashburn-0']);
    expect(filterConsoleLogs(rows, 'dallas').map((r) => r.message)).toEqual(['Restarting']);
  });
});

describe('formatting', () => {
  test('formatLogTime shows the clock today and the date otherwise', () => {
    const t = new Date(2026, 9, 12, 14, 3, 22, 401).getTime();
    expect(formatLogTime(t, new Date(2026, 9, 12, 20).getTime())).toBe('14:03:22.401');
    expect(formatLogTime(t, new Date(2026, 9, 13, 1).getTime())).toBe('Oct 12 14:03:22.401');
    expect(formatLogTime(Number.NaN)).toBe('—');
  });

  test('formatUtcTimestamp', () => {
    expect(formatUtcTimestamp(Date.UTC(2026, 9, 12, 19, 54, 47, 401))).toBe('2026-10-12 19:54:47.401 UTC');
  });

  test('formatDurationMs', () => {
    expect(formatDurationMs(16)).toBe('16 ms');
    expect(formatDurationMs(1240)).toBe('1.24 s');
    expect(formatDurationMs(15_500)).toBe('15.5 s');
    expect(formatDurationMs(125_000)).toBe('2m 05s');
    expect(formatDurationMs(undefined)).toBeUndefined();
  });
});

describe('time ranges', () => {
  test('resolve to RFC 3339 bounds ending now', () => {
    const now = Date.UTC(2026, 9, 12, 20, 0, 0);
    expect(resolveLogWindow('30m', now)).toEqual({
      start: '2026-10-12T19:30:00.000Z',
      end: '2026-10-12T20:00:00.000Z',
    });
    expect(resolveLogWindow('24h', now).start).toBe('2026-10-11T20:00:00.000Z');
  });

  test('default and guard', () => {
    expect(DEFAULT_LOG_RANGE).toBe('30m');
    expect(isLogRangeKey('6h')).toBe(true);
    expect(isLogRangeKey('7d')).toBe(false);
  });
});
