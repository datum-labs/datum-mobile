import { httpStatusBadgeType, logSeverity, severityBadgeType } from '../severity';

describe('severityBadgeType (datum-ui parity)', () => {
  test('maps known severities', () => {
    expect(severityBadgeType('ERROR')).toBe('danger');
    expect(severityBadgeType('WARN')).toBe('warning');
    expect(severityBadgeType('INFO')).toBe('info');
    expect(severityBadgeType('DEBUG')).toBe('muted');
    expect(severityBadgeType('nope')).toBe('muted');
    expect(severityBadgeType(undefined)).toBe('muted');
  });
});

describe('httpStatusBadgeType (datum-ui parity)', () => {
  test('maps status classes', () => {
    expect(httpStatusBadgeType(201)).toBe('success');
    expect(httpStatusBadgeType(301)).toBe('info');
    expect(httpStatusBadgeType(404)).toBe('warning');
    expect(httpStatusBadgeType(500)).toBe('danger');
    expect(httpStatusBadgeType(undefined)).toBe('muted');
  });
});

describe('logSeverity', () => {
  test('a stream label wins', () => {
    expect(logSeverity({ severity: 'warning' }, 'ERROR: ignored')).toBe('WARN');
    expect(logSeverity({ detected_level: 'error' }, '')).toBe('ERROR');
  });

  test('reads structured and conventional markers', () => {
    expect(logSeverity({}, '{"level":"error","msg":"boom"}')).toBe('ERROR');
    expect(logSeverity({}, 'ts=1 level=warn msg=slow')).toBe('WARN');
    expect(logSeverity({}, '[DEBUG] cache miss')).toBe('DEBUG');
    expect(logSeverity({}, '2026-10-12T19:00:00Z INFO listening on :8080')).toBe('INFO');
    expect(logSeverity({}, 'Uncaught ReferenceError: x is not defined')).toBe('ERROR');
  });

  test('does not guess from prose or kernel timestamps', () => {
    expect(logSeverity({}, '[    0.108305] reboot: Restarting system')).toBeUndefined();
    expect(logSeverity({}, 'some info about an error')).toBeUndefined();
  });
});
