import { jsonResponse } from '@/test/helpers';

import { locationService } from '../locations';

jest.mock('@/auth/instance', () => ({
  session: {
    getState: () => ({ status: 'signedIn', devToken: false }),
    getAccessToken: jest.fn(async () => 'token-1'),
    handleUnauthorized: jest.fn(async () => 'token-2'),
    refresh: jest.fn(async () => 'token-2'),
  },
}));
jest.mock('@/config/env', () => ({ env: { apiUrl: 'https://api.example.test', telemetryUrl: '', variant: 'staging' } }));

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('locationService.list', () => {
  test('GETs the cluster-scoped catalog in the project control plane and maps topology', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        kind: 'LocationList',
        items: [
          {
            metadata: { name: 'us-central-1', labels: { 'networking.datumapis.com/location': 'us-central-1' } },
            spec: {
              locationClassRef: { name: 'datum-managed' },
              topology: {
                'topology.datum.net/city': 'Dallas',
                'topology.datum.net/country': 'United States',
                'topology.datum.net/region': 'us-central-1',
              },
            },
          },
        ],
      })
    );
    await expect(locationService.list('proj-a')).resolves.toEqual([
      {
        name: 'us-central-1',
        region: 'us-central-1',
        city: 'Dallas',
        cityCode: undefined,
        country: 'United States',
        locationLabel: 'us-central-1',
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.example.test/apis/resourcemanager.miloapis.com/v1alpha1/projects/proj-a/control-plane/apis/locations.miloapis.com/v1alpha1/locations?limit=500'
    );
    expect(init.method).toBe('GET');
  });

  test('403 and 404 degrade to an empty catalog; other failures throw', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { kind: 'Status', message: 'forbidden' }));
    await expect(locationService.list('proj-a')).resolves.toEqual([]);
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { kind: 'Status', message: 'not found' }));
    await expect(locationService.list('proj-a')).resolves.toEqual([]);
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { kind: 'Status', message: 'boom' }));
    await expect(locationService.list('proj-a')).rejects.toMatchObject({ status: 500 });
  });
});
