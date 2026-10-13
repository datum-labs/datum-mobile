import { resolveAnswerLink } from '../links';

const ctx = { projectId: 'demo', portalUrl: 'https://cloud.datum.net' };

describe('resolveAnswerLink', () => {
  it.each([
    ['/project/demo/alb/web-alb', '/alb/web-alb'],
    ['/project/demo/alb/web-alb/metrics', '/alb/web-alb'],
    ['/project/demo/edge/web-alb/overview', '/alb/web-alb'],
    ['/project/demo/alb', '/edge'],
    ['/project/demo/domains/example-com/overview', '/domains/example-com'],
    ['/project/demo/dns-zones/zone-1/dns-records', '/dns/zone-1'],
    ['/project/demo/services/compute/workloads/api', '/workloads/api'],
    ['/project/demo/services/compute/workloads/api/instances/api-0', '/instances/api-0'],
    ['/project/demo/workloads', '/compute'],
    ['/project/demo/instances/api-0', '/instances/api-0'],
    ['/project/demo/networks/default', '/networks/default'],
    ['/project/demo/connectors/laptop', '/connectors/laptop'],
    ['/project/demo/home', '/home'],
    ['/project/demo', '/home'],
    ['https://cloud.datum.net/project/demo/alb/web-alb?tab=x#y', '/alb/web-alb'],
    ['/project/demo/alb/a%20b', '/alb/a%20b'],
  ])('%s → %s', (href, route) => {
    expect(resolveAnswerLink(href, ctx)).toEqual({ kind: 'route', href: route });
  });

  it.each([
    ['https://docs.datum.net/alb', 'https://docs.datum.net/alb'],
    ['/project/other/alb/web-alb', 'https://cloud.datum.net/project/other/alb/web-alb'],
    ['/project/demo/settings/billing', 'https://cloud.datum.net/project/demo/settings/billing'],
    ['/org/acme/members', 'https://cloud.datum.net/org/acme/members'],
    ['mailto:support@datum.net', 'mailto:support@datum.net'],
  ])('%s opens in the browser', (href, url) => {
    expect(resolveAnswerLink(href, ctx)).toEqual({ kind: 'external', url });
  });
});
