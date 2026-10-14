// Ported from cloud-portal app/features/edge/proxy/overview/enrich-active-pops.test.ts and
// app/resources/locations/location.adapter.test.ts, plus the app's per-region merge.
import {
  buildRegionDirectory,
  formatRegionDetail,
  formatRegionRps,
  normalizeRegionCode,
  regionTrafficView,
  toLocation,
  type EdgeLocation,
} from '..';

const ashburn: EdgeLocation = {
  name: 'us-east-1',
  region: 'us-east-1',
  city: 'Ashburn',
  cityCode: 'IAD',
  country: 'United States',
  locationLabel: 'us-east-1',
};
const dallas: EdgeLocation = {
  name: 'us-central-1',
  region: 'us-central-1',
  city: 'Dallas',
  cityCode: 'DFW',
  country: 'United States',
  locationLabel: 'us-central-1',
};

describe('toLocation', () => {
  test('maps name, topology and the location label (as staging returns them)', () => {
    expect(
      toLocation({
        metadata: { name: 'us-east-1', labels: { 'networking.datumapis.com/location': 'us-east-1' } },
        spec: {
          topology: {
            'topology.datum.net/city': 'Ashburn',
            'topology.datum.net/city-code': 'IAD',
            'topology.datum.net/country': 'United States',
            'topology.datum.net/country-code': 'US',
            'topology.datum.net/region': 'us-east-1',
          },
        },
      })
    ).toEqual(ashburn);
  });

  test('missing topology leaves fields undefined', () => {
    expect(toLocation({ metadata: { name: 'unknown-1' } })).toEqual({
      name: 'unknown-1',
      region: undefined,
      city: undefined,
      cityCode: undefined,
      country: undefined,
      locationLabel: undefined,
    });
  });
});

describe('buildRegionDirectory', () => {
  test('lists every catalog location and marks those with traffic', () => {
    const directory = buildRegionDirectory([ashburn, dallas], ['us-east-1']);
    expect(directory).toEqual([
      { key: 'us-east-1', region: 'us-east-1', place: 'Ashburn, United States', active: true, trafficRegion: 'us-east-1' },
      { key: 'us-central-1', region: 'us-central-1', place: 'Dallas, United States', active: false, trafficRegion: undefined },
    ]);
  });

  test('matches by topology region or location label, ignoring case and zone suffix', () => {
    const renamed = { ...ashburn, name: 'iad', region: 'east', locationLabel: 'us-east-1' };
    expect(buildRegionDirectory([renamed], ['US-EAST-1-b'])[0]).toMatchObject({
      key: 'iad',
      region: 'east',
      active: true,
      trafficRegion: 'US-EAST-1-b',
    });
  });

  test('appends traffic regions the catalog lacks, with the fallback place table', () => {
    const directory = buildRegionDirectory([ashburn], ['us-east4', 'sg-central-1']);
    expect(directory.map((d) => [d.key, d.active, d.place])).toEqual([
      ['us-east-1', false, 'Ashburn, United States'],
      ['us-east4', true, ''],
      ['sg-central-1', true, 'Singapore'],
    ]);
  });

  test('an empty or forbidden catalog still lists the active regions', () => {
    expect(buildRegionDirectory([], ['de-central-1'])).toEqual([
      { key: 'de-central-1', region: 'de-central-1', place: 'Frankfurt, Germany', active: true, trafficRegion: 'de-central-1' },
    ]);
  });

  test('a bare location falls back to the table for its place', () => {
    expect(buildRegionDirectory([{ name: 'gb-south-1' }], [])[0].place).toBe('London, United Kingdom');
  });

  test('normalizeRegionCode', () => {
    expect(normalizeRegionCode('US-East-1-b')).toBe('us-east-1');
    expect(normalizeRegionCode('us-east4')).toBe('us-east4');
  });
});

describe('regionTrafficView', () => {
  test('merges per-region metrics: active first, busiest first, idle last', () => {
    const london = { name: 'gb-south-1', region: 'gb-south-1', city: 'London', country: 'United Kingdom' };
    const view = regionTrafficView([ashburn, dallas, london], {
      rps: { 'us-east-1': 2, 'gb-south-1': 8 },
      serverErrorRps: { 'gb-south-1': 0.4 },
      p95: { 'us-east-1': 475, 'gb-south-1': 120 },
    });
    expect(view.activeCount).toBe(2);
    expect(view.rows.map((r) => [r.region, r.active, r.rps, r.serverErrorRatio, r.p95, r.share])).toEqual([
      ['gb-south-1', true, 8, 0.05, 120, 1],
      ['us-east-1', true, 2, 0, 475, 0.25],
      ['us-central-1', false, null, null, null, 0],
    ]);
  });

  test('an active region with no requests in the window has no ratios (staging: rate 0, no p95)', () => {
    const [row] = regionTrafficView([ashburn], { rps: { 'us-east-1': 0 }, serverErrorRps: { 'us-east-1': 0 }, p95: {} }).rows;
    expect(row).toMatchObject({ active: true, rps: 0, serverErrorRatio: null, p95: null, share: 0 });
    expect(formatRegionRps(row.rps)).toBe('0.00 req/s');
    expect(formatRegionDetail(row)).toBe('');
  });

  test('no traffic anywhere: every region idle', () => {
    const view = regionTrafficView([ashburn, dallas], { rps: {}, serverErrorRps: {}, p95: {} });
    expect(view.activeCount).toBe(0);
    expect(view.rows.every((r) => !r.active)).toBe(true);
  });
});

describe('region formatting', () => {
  test('requests per second, with a floor for a trickle', () => {
    expect(formatRegionRps(null)).toBe('—');
    expect(formatRegionRps(0.004)).toBe('<0.01 req/s');
    expect(formatRegionRps(12.5)).toBe('12.50 req/s');
  });

  test('p95 and 5xx share', () => {
    expect(formatRegionDetail({ p95: 475, serverErrorRatio: 0.0123 })).toBe('p95 475ms · 1.2% 5xx');
    expect(formatRegionDetail({ p95: 1500, serverErrorRatio: null })).toBe('p95 1.50s');
    expect(formatRegionDetail({ p95: null, serverErrorRatio: 0 })).toBe('0.0% 5xx');
  });
});
