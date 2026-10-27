import { describe, it, expect } from 'vitest';
import { getSubsolarPoint, getSolarTerminator } from './solar-terminator';

describe('solar-terminator', () => {
  it('computes subsolar point accurately for mid-October 2026', () => {
    // 2026-10-13 12:00:00 UTC: Sun should be near 0 deg longitude and negative declination (-8 deg approx)
    const date = new Date('2026-10-13T12:00:00Z');
    const pt = getSubsolarPoint(date);

    expect(pt.lat).toBeLessThan(0); // Southern hemisphere in October
    expect(pt.lat).toBeGreaterThan(-15);
    expect(Math.abs(pt.lng)).toBeLessThan(5); // Near Greenwich meridian at 12:00 UTC
  });

  it('generates valid GeoJSON features for day/night map layer', () => {
    const { subsolar, features } = getSolarTerminator(new Date('2026-10-13T15:00:00Z'));

    expect(subsolar).toBeDefined();
    expect(features.length).toBe(1);

    const nightPoly = features.find(f => f.properties.kind === 'night');
    expect(nightPoly).toBeDefined();
    expect(nightPoly?.geometry.type).toBe('Polygon');
    if (nightPoly?.geometry.type === 'Polygon') {
      const ring = nightPoly.geometry.coordinates[0];
      expect(ring.length).toBeGreaterThan(100);
      // Ring must be closed
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });
});
