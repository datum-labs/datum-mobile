import { compareNsDesc, countLokiValues, flattenLokiStreams, nextNs, nsToMs } from '../loki';
import { accessLogStream, streams } from './fixtures';

describe('flattenLokiStreams', () => {
  test('merges streams and sorts newest first by nanosecond timestamp', () => {
    const entries = flattenLokiStreams(
      streams(
        accessLogStream('1791834887401579958'),
        accessLogStream('1791834887401579959'),
        { stream: { a: 'b' }, values: [['999999999999999999', 'older, shorter ns']] }
      )
    );
    expect(entries.map((e) => e.timestampNs)).toEqual([
      '1791834887401579959',
      '1791834887401579958',
      '999999999999999999',
    ]);
    expect(entries[0]?.timeMs).toBe(1791834887401);
  });

  test('copies labels per row and keeps duplicate lines unique', () => {
    const entries = flattenLokiStreams(
      streams({
        stream: { severity: 'INFO' },
        values: [
          ['1000000000', 'same'],
          ['1000000000', 'same'],
        ],
      })
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]?.id).not.toBe(entries[1]?.id);
    (entries[0] as { labels: Record<string, string> }).labels.severity = 'ERROR';
    expect(entries[1]?.labels.severity).toBe('INFO');
  });

  test('returns an empty list for error, vector and missing responses', () => {
    expect(flattenLokiStreams({ status: 'error', error: 'bad_data' })).toEqual([]);
    expect(flattenLokiStreams({ status: 'success', data: { resultType: 'vector', result: [] } })).toEqual([]);
    expect(flattenLokiStreams(undefined)).toEqual([]);
  });

  test('skips values with a non-numeric timestamp', () => {
    expect(flattenLokiStreams(streams({ stream: {}, values: [['nope', 'x']] }))).toEqual([]);
    expect(Number.isNaN(nsToMs('nope'))).toBe(true);
  });
});

describe('compareNsDesc', () => {
  test('orders digit strings numerically without BigInt', () => {
    expect(compareNsDesc('10', '9')).toBeLessThan(0);
    expect(compareNsDesc('9', '10')).toBeGreaterThan(0);
    expect(compareNsDesc('0010', '10')).toBe(0);
  });
});

describe('countLokiValues', () => {
  test('counts every value across streams, to detect a hit limit', () => {
    expect(
      countLokiValues(
        streams(accessLogStream('1'), { stream: {}, values: [['2', 'a'], ['3', 'b']] })
      )
    ).toBe(3);
    expect(countLokiValues({ status: 'error' })).toBe(0);
  });
});

describe('nextNs', () => {
  test('adds one to a digit string, carrying', () => {
    expect(nextNs('1791834887401579958')).toBe('1791834887401579959');
    expect(nextNs('1999')).toBe('2000');
    expect(nextNs('99')).toBe('100');
  });
});
