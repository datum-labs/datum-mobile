import { transformControlPlaneStatus } from '../control-plane';
import { ControlPlaneStatus } from '../types';

const cond = (type: string, status: string, message = '', reason = type) => ({
  type,
  status,
  reason,
  message,
});

describe('transformControlPlaneStatus', () => {
  test('missing status or conditions is pending', () => {
    expect(transformControlPlaneStatus(undefined)).toEqual({
      status: ControlPlaneStatus.Pending,
      message: 'Resource is being provisioned',
    });
    expect(transformControlPlaneStatus({ conditions: [] }).status).toBe(ControlPlaneStatus.Pending);
  });

  test('auto-detects Ready first', () => {
    const result = transformControlPlaneStatus({
      conditions: [cond('Accepted', 'False', 'nope'), cond('Ready', 'True')],
    });
    expect(result.status).toBe(ControlPlaneStatus.Success);
  });

  test('falls back to Accepted + Programmed, joining distinct messages', () => {
    const result = transformControlPlaneStatus({
      conditions: [cond('Accepted', 'False', 'Waiting'), cond('Programmed', 'False', 'waiting')],
    });
    expect(result.status).toBe(ControlPlaneStatus.Pending);
    expect(result.message).toBe('Waiting');
  });

  test('uses Accepted alone, then the first condition', () => {
    expect(transformControlPlaneStatus({ conditions: [cond('Accepted', 'True')] }).status).toBe(
      ControlPlaneStatus.Success
    );
    expect(
      transformControlPlaneStatus({ conditions: [cond('Verified', 'False'), cond('X', 'True')] })
        .message
    ).toBe('Awaiting verified');
  });

  test('null requiredConditions checks every condition', () => {
    const status = { conditions: [cond('Ready', 'True'), cond('Other', 'False', 'blocked')] };
    expect(transformControlPlaneStatus(status).status).toBe(ControlPlaneStatus.Success);
    const strict = transformControlPlaneStatus(status, { requiredConditions: null });
    expect(strict.status).toBe(ControlPlaneStatus.Pending);
    expect(strict.message).toBe('blocked');
  });

  test('includes condition details on request', () => {
    const result = transformControlPlaneStatus(
      { conditions: [cond('Accepted', 'True'), cond('Programmed', 'False', 'x', 'Pending')] },
      { includeConditionDetails: true }
    );
    expect(result.isAccepted).toBe(true);
    expect(result.isProgrammed).toBe(false);
    expect(result.programmedReason).toBe('Pending');
    expect(result.conditions).toHaveLength(2);
  });

  test('carries extra status fields through, like the portal', () => {
    const result = transformControlPlaneStatus({
      conditions: [cond('Ready', 'True')],
      canonicalHostname: 'x.datumproxy.net',
    });
    expect(result.canonicalHostname).toBe('x.datumproxy.net');
  });
});
