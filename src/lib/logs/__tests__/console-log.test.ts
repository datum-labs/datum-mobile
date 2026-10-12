import { stripAnsi } from '../ansi';
import { shortInstanceName, toConsoleLogEntries } from '../console-log';
import { accessLogStream, consoleStream, streams } from './fixtures';

describe('toConsoleLogEntries', () => {
  test('merges instances newest first, strips ANSI and keeps the instance', () => {
    const rows = toConsoleLogEntries(
      streams(
        consoleStream('web-ashburn-0', [
          ['1791840198133397616', '\u001b[90m    at node:internal/main/eval_string:74:3\u001b[39m'],
        ]),
        consoleStream('web-dallas-0', [['1791840198133398367', '[    0.108305] reboot: Restarting system']])
      )
    );
    expect(rows.map((r) => [r.instance, r.message])).toEqual([
      ['web-dallas-0', '[    0.108305] reboot: Restarting system'],
      ['web-ashburn-0', '    at node:internal/main/eval_string:74:3'],
    ]);
    expect(rows[0]?.labels).not.toHaveProperty('k8s_pod_name');
  });

  test('drops ALB access-log streams', () => {
    expect(toConsoleLogEntries(streams(accessLogStream('1')))).toEqual([]);
  });

  test('ids are stable and unique per instance and timestamp', () => {
    const rows = toConsoleLogEntries(
      streams(
        consoleStream('a', [
          ['5', 'one'],
          ['5', 'two'],
        ]),
        consoleStream('b', [['5', 'three']])
      )
    );
    expect(rows.map((r) => r.id).sort()).toEqual(['5-a', '5-a-1', '5-b']);
  });

  test('reads severity from the line when the stream has none', () => {
    const [row] = toConsoleLogEntries(
      streams(consoleStream('a', [['1', 'TypeError: Cannot read properties of undefined']]))
    );
    expect(row?.severity).toBe('ERROR');
    expect(row?.badge).toBe('danger');
  });
});

describe('stripAnsi', () => {
  test('removes CSI and OSC sequences and carriage returns', () => {
    expect(stripAnsi('\u001b[1;31mred\u001b[0m text\r')).toBe('red text');
    expect(stripAnsi('\u001b]0;title\u0007after')).toBe('after');
    expect(stripAnsi('plain')).toBe('plain');
  });
});

describe('shortInstanceName', () => {
  test('drops the workload prefix', () => {
    expect(shortInstanceName('web-ashburn-us-east-1-0', 'web')).toBe('ashburn-us-east-1-0');
    expect(shortInstanceName('other-0', 'web')).toBe('other-0');
    expect(shortInstanceName('web-', 'web')).toBe('web-');
    expect(shortInstanceName(undefined, 'web')).toBeUndefined();
  });
});
