import { networkManifest, networkNameFor } from '../service';

describe('networkNameFor', () => {
  it('slugs a display name into a DNS-1123 label', () => {
    expect(networkNameFor('Office VPC')).toBe('office-vpc');
    expect(networkNameFor('  Café / Lab #2  ')).toBe('cafe-lab-2');
  });

  it('falls back when nothing usable is left', () => {
    expect(networkNameFor('✨✨')).toBe('network');
  });

  it('caps the length so a suffix still fits', () => {
    const name = networkNameFor('x'.repeat(100), ['x'.repeat(58)]);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^x{58}-[a-z0-9]{4}$/);
  });

  it('adds a suffix when the name is taken', () => {
    expect(networkNameFor('Default', ['default'])).toMatch(/^default-[a-z0-9]{4}$/);
  });
});

describe('networkManifest', () => {
  it('builds an auto-IPAM network with the display name', () => {
    expect(networkManifest({ name: 'office-vpc', displayName: 'Office VPC', ipFamilies: ['IPv6'] })).toEqual({
      apiVersion: 'networking.datumapis.com/v1alpha',
      kind: 'Network',
      metadata: { name: 'office-vpc', annotations: { 'kubernetes.io/display-name': 'Office VPC' } },
      spec: { ipFamilies: ['IPv6'], ipam: { mode: 'Auto' } },
    });
  });
});
