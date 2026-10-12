import {
  albRouteNameRegexp,
  buildAlbLogQL,
  buildInstanceLogQL,
  matcherClauses,
  statusClassMatcher,
} from '../logql';

describe('buildAlbLogQL (portal o11y-log.helpers parity)', () => {
  test('selects one ALB by Envoy route_name, not resource_name', () => {
    expect(buildAlbLogQL('gw-1')).toBe('{route_name=~"httproute/[^/]+/gw-1/.*"}');
    expect(albRouteNameRegexp('gw-1')).toBe('httproute/[^/]+/gw-1/.*');
  });

  test('merges extra label matchers into the stream selector', () => {
    expect(buildAlbLogQL('gw-1', { filters: { method: ['GET'] } })).toBe(
      '{route_name=~"httproute/[^/]+/gw-1/.*", method="GET"}'
    );
  });

  test('escapes regex metacharacters and quotes in the ALB name', () => {
    expect(buildAlbLogQL('gw"1')).toBe('{route_name=~"httproute/[^/]+/gw\\"1/.*"}');
    expect(buildAlbLogQL('gw.1')).toBe('{route_name=~"httproute/[^/]+/gw\\\\.1/.*"}');
  });

  test('drops identity and host labels so a filter cannot escape the ALB', () => {
    expect(
      buildAlbLogQL('gw-1', {
        filters: {
          route_name: ['httproute/ns/other/rule/0'],
          resource_name: ['other'],
          authority: ['origin.internal'],
          response_code: ['200'],
          method: ['GET'],
        },
      })
    ).toBe('{route_name=~"httproute/[^/]+/gw-1/.*", method="GET"}');
  });

  test('filters a status class server-side with a response_code regexp', () => {
    expect(statusClassMatcher('4xx')).toBe('response_code=~"4.."');
    expect(buildAlbLogQL('gw-1', { statusClass: '5xx', filters: { method: ['POST'] } })).toBe(
      '{route_name=~"httproute/[^/]+/gw-1/.*", response_code=~"5..", method="POST"}'
    );
  });
});

describe('matcherClauses (datum-ui buildLogQL parity)', () => {
  test('exact match for one value, regexp for several, nothing for none', () => {
    expect(matcherClauses({ severity: ['ERROR'] })).toEqual(['severity="ERROR"']);
    expect(matcherClauses({ severity: ['ERROR', 'WARN'] })).toEqual(['severity=~"ERROR|WARN"']);
    expect(matcherClauses({ severity: [] })).toEqual([]);
  });

  test('drops label names that are not valid Loki identifiers', () => {
    expect(matcherClauses({ 'severity="ERROR"} |= "password" #': ['INFO'], 'foo}': ['x'] })).toEqual([]);
  });
});

describe('buildInstanceLogQL', () => {
  test('pins one instance exactly', () => {
    expect(buildInstanceLogQL(['web-ashburn-0'])).toBe('{datum_instance_name="web-ashburn-0"}');
  });

  test('uses ONE regexp selector for several instances, never `or`', () => {
    const q = buildInstanceLogQL(['web-b.1', 'web-a', 'web-a']);
    expect(q).toBe('{datum_instance_name=~"web-a|web-b\\\\.1"}');
    expect(q).not.toContain(' or ');
  });

  test('is empty with no instances', () => {
    expect(buildInstanceLogQL([])).toBe('');
  });
});
