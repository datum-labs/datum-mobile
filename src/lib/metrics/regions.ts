// Regions an ALB serves from: the project's Location catalog (locations.miloapis.com) merged
// with the regions Envoy reports traffic for. Ported from cloud-portal
// app/features/edge/proxy/overview/{enrich-active-pops,active-pops-metrics,region-coordinates}.ts
// and app/resources/locations/location.adapter.ts.
import { formatMs, formatPercent, formatRps } from './format';

export const TOPOLOGY_REGION = 'topology.datum.net/region';
export const TOPOLOGY_CITY = 'topology.datum.net/city';
export const TOPOLOGY_CITY_CODE = 'topology.datum.net/city-code';
export const TOPOLOGY_COUNTRY = 'topology.datum.net/country';
export const LABEL_LOCATION = 'networking.datumapis.com/location';

/** The fields of a `locations.miloapis.com/v1alpha1` Location the app reads. */
export interface RawLocation {
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: { topology?: Record<string, string> };
}

export interface EdgeLocation {
  name: string;
  /** `topology.datum.net/region`: the code Envoy's region label carries. */
  region?: string;
  city?: string;
  cityCode?: string;
  country?: string;
  /** `networking.datumapis.com/location` label. */
  locationLabel?: string;
}

/** Portal `toLocation`, without coordinates (the app draws no map). */
export function toLocation(raw: RawLocation): EdgeLocation {
  const topology = raw.spec?.topology ?? {};
  return {
    name: raw.metadata?.name ?? '',
    region: topology[TOPOLOGY_REGION],
    city: topology[TOPOLOGY_CITY],
    cityCode: topology[TOPOLOGY_CITY_CODE],
    country: topology[TOPOLOGY_COUNTRY],
    locationLabel: raw.metadata?.labels?.[LABEL_LOCATION],
  };
}

/**
 * City and country for Datum edge region codes, for regions the Location
 * catalog doesn't describe (it can be empty, forbidden or still projecting).
 * From the comments on the portal's `REGION_COORDINATES` table.
 */
export const REGION_PLACES: Record<string, { city: string; country: string }> = {
  'ae-north-1': { city: 'Dubai', country: 'United Arab Emirates' },
  'au-east-1': { city: 'Sydney', country: 'Australia' },
  'br-east-1': { city: 'São Paulo', country: 'Brazil' },
  'ca-east-1': { city: 'Toronto', country: 'Canada' },
  'cl-central-1': { city: 'Santiago', country: 'Chile' },
  'de-central-1': { city: 'Frankfurt', country: 'Germany' },
  'gb-south-1': { city: 'London', country: 'United Kingdom' },
  'in-west-1': { city: 'Mumbai', country: 'India' },
  'jp-east-1': { city: 'Tokyo', country: 'Japan' },
  'nl-west-1': { city: 'Amsterdam', country: 'Netherlands' },
  'sg-central-1': { city: 'Singapore', country: 'Singapore' },
  'us-central-1': { city: 'Dallas', country: 'United States' },
  'us-east-1': { city: 'Ashburn', country: 'United States' },
  'us-east-2': { city: 'New York City', country: 'United States' },
  'us-west-1': { city: 'San Jose', country: 'United States' },
  'za-central-1': { city: 'Johannesburg', country: 'South Africa' },
};

/** Lowercase and strip a trailing zone letter: "US-EAST-1-b" → "us-east-1". */
export function normalizeRegionCode(regionCode: string): string {
  return regionCode.toLowerCase().replace(/-[a-z]$/, '');
}

function locationMatchKeys(location: EdgeLocation): string[] {
  return [location.name, location.region, location.locationLabel]
    .filter((key): key is string => !!key?.trim())
    .map(normalizeRegionCode);
}

function placeOf(code: string, location?: EdgeLocation): string {
  const fallback = REGION_PLACES[normalizeRegionCode(code)];
  const city = location?.city?.trim() || fallback?.city;
  const country = location?.country?.trim() || fallback?.country;
  return [city, country].filter((part, i, all) => part && all.indexOf(part) === i).join(', ');
}

export interface RegionDirectoryEntry {
  /** Location name, or the Prometheus region code for a region the catalog lacks. */
  key: string;
  /** Region code shown as the row title (the portal's `city`, which is the region). */
  region: string;
  /** "Ashburn, United States"; empty when nothing is known. */
  place: string;
  /** Envoy reports this region for the proxy. */
  active: boolean;
  /** The Prometheus region value metrics are keyed by. */
  trafficRegion?: string;
}

/**
 * Portal `buildLocationDirectory`: every catalog Location, marked active
 * when a traffic region matches it (by name, topology region or location
 * label, ignoring case and zone suffix), plus traffic regions the catalog
 * doesn't know so their traffic isn't dropped.
 */
export function buildRegionDirectory(
  locations: readonly EdgeLocation[],
  activeRegions: readonly string[]
): RegionDirectoryEntry[] {
  const matched = new Set<string>();
  const catalog = locations
    .filter((location) => location.name)
    .map((location): RegionDirectoryEntry => {
      const keys = new Set(locationMatchKeys(location));
      const trafficRegion = activeRegions.find(
        (value) => keys.has(normalizeRegionCode(value)) || keys.has(value.toLowerCase())
      );
      if (trafficRegion) matched.add(trafficRegion);
      return {
        key: location.name,
        region: location.region || location.name,
        place: placeOf(location.region || location.name, location),
        active: !!trafficRegion,
        trafficRegion,
      };
    });
  const extras = activeRegions
    .filter((value) => value && !matched.has(value))
    .map((value): RegionDirectoryEntry => ({
      key: value,
      region: value,
      place: placeOf(value),
      active: true,
      trafficRegion: value,
    }));
  return [...catalog, ...extras];
}

export interface RegionTraffic {
  /** Requests per second by Prometheus region value. Its keys are the active regions. */
  rps: Record<string, number>;
  serverErrorRps: Record<string, number>;
  /** p95 latency (ms) by region. */
  p95: Record<string, number>;
}

export interface RegionRow extends RegionDirectoryEntry {
  rps: number | null;
  /** 5xx share of requests (0–1); null without traffic. */
  serverErrorRatio: number | null;
  p95: number | null;
  /** rps relative to the busiest region (0–1), for a bar. */
  share: number;
}

export interface RegionTrafficView {
  rows: RegionRow[];
  activeCount: number;
}

/**
 * Directory rows with each region's traffic: active first, busiest first,
 * then by region code. A region with requests but no 5xx series reads 0%.
 */
export function regionTrafficView(locations: readonly EdgeLocation[], traffic: RegionTraffic): RegionTrafficView {
  const active = Object.keys(traffic.rps).filter(Boolean);
  const directory = buildRegionDirectory(locations, active);
  const rows = directory.map((entry): RegionRow => {
    const key = entry.trafficRegion;
    const rps = key !== undefined && entry.active ? (traffic.rps[key] ?? null) : null;
    const errors = key !== undefined ? traffic.serverErrorRps[key] : undefined;
    const p95 = key !== undefined ? traffic.p95[key] : undefined;
    return {
      ...entry,
      rps,
      serverErrorRatio: rps !== null && rps > 0 ? (errors ?? 0) / rps : null,
      p95: p95 !== undefined && Number.isFinite(p95) && p95 > 0 ? p95 : null,
      share: 0,
    };
  });
  const max = Math.max(0, ...rows.map((row) => row.rps ?? 0));
  return {
    rows: rows
      .map((row) => ({ ...row, share: max > 0 && row.rps ? row.rps / max : 0 }))
      .sort(
        (a, b) =>
          Number(b.active) - Number(a.active) || (b.rps ?? 0) - (a.rps ?? 0) || a.region.localeCompare(b.region)
      ),
    activeCount: rows.filter((row) => row.active).length,
  };
}

/** Portal active-pops `formatRps`: "<0.01 req/s" for a trickle. */
export function formatRegionRps(value: number | null): string {
  if (value === null) return '—';
  if (value > 0 && value < 0.01) return '<0.01 req/s';
  return formatRps(value, 2);
}

/** "p95 475ms · 0.0% 5xx", leaving out what isn't known; empty when neither is. */
export function formatRegionDetail(row: Pick<RegionRow, 'p95' | 'serverErrorRatio'>): string {
  return [
    row.p95 !== null ? `p95 ${formatMs(row.p95)}` : null,
    row.serverErrorRatio !== null ? `${formatPercent(row.serverErrorRatio, 1)} 5xx` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
