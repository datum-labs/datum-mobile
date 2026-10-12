import { hostnameUrl, isOpenableHostname } from '../hostnames';

describe('isOpenableHostname', () => {
  it('opens concrete hostnames', () => {
    expect(isOpenableHostname('tale-cheap-nkn3b.prism.staging.env.datum.net')).toBe(true);
  });
  it('does not open wildcards or bare labels', () => {
    expect(isOpenableHostname('*.wild.mdj-test.online')).toBe(false);
    expect(isOpenableHostname('localhost')).toBe(false);
  });
});

it('builds an https URL', () => {
  expect(hostnameUrl('example.com')).toBe('https://example.com');
});
