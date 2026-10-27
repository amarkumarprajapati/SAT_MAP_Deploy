import { describe, it, expect } from 'vitest';
import { generateFootprintFeatures } from './footprint-circle';

describe('generateFootprintFeatures', () => {
  it('generates a standard circular disc for equatorial satellite', () => {
    const res = generateFootprintFeatures({
      lat: 0,
      lng: 0,
      alt: 500,
      color: '#00E5FF',
    });

    expect(res.enclosesNorthPole).toBe(false);
    expect(res.enclosesSouthPole).toBe(false);
    expect(res.features).toHaveLength(2);

    const fill = res.features[0];
    const line = res.features[1];

    expect(fill.geometry.type).toBe('Polygon');
    expect(line.geometry.type).toBe('LineString');
    expect(fill.properties.color).toBe('#00E5FF');
    expect(line.properties.color).toBe('#00E5FF');

    const polygon = fill.geometry as { type: 'Polygon'; coordinates: number[][][] };
    const ring = polygon.coordinates[0];
    expect(ring.length).toBeGreaterThan(100);
    // First point must equal last point to close
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('correctly handles North Pole enclosing satellites without wedges or spokes', () => {
    // DMSP satellite at 77.11° N, alt 863 km (angular radius ~28.27°)
    const res = generateFootprintFeatures({
      lat: 77.11,
      lng: 42.87,
      alt: 863,
      color: '#FF5252',
    });

    expect(res.enclosesNorthPole).toBe(true);
    expect(res.enclosesSouthPole).toBe(false);
    expect(res.features).toHaveLength(2);

    const fill = res.features[0];
    const line = res.features[1];

    expect(fill.geometry.type).toBe('Polygon');
    expect(line.geometry.type).toBe('LineString');

    const polygon = fill.geometry as { type: 'Polygon'; coordinates: number[][][] };
    const linestring = line.geometry as { type: 'LineString'; coordinates: number[][] };

    // LineString must span smoothly from -180 to +180 with identical boundary latitudes
    const firstPt = linestring.coordinates[0];
    const lastPt = linestring.coordinates[linestring.coordinates.length - 1];
    expect(firstPt[0]).toBe(-180);
    expect(lastPt[0]).toBe(180);
    expect(Math.abs(firstPt[1] - lastPt[1])).toBeLessThan(1e-5);

    // All boundary latitudes must be valid (between 0 and 90 deg N)
    for (const pt of linestring.coordinates) {
      expect(pt[1]).toBeGreaterThanOrEqual(40);
      expect(pt[1]).toBeLessThanOrEqual(90);
    }

    // Polygon ring must close seamlessly
    const ring = polygon.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('correctly handles South Pole enclosing satellites', () => {
    const res = generateFootprintFeatures({
      lat: -82.0,
      lng: -120.0,
      alt: 650,
      color: '#69F0AE',
    });

    expect(res.enclosesNorthPole).toBe(false);
    expect(res.enclosesSouthPole).toBe(true);
    expect(res.features).toHaveLength(2);

    const fill = res.features[0];
    const line = res.features[1];

    expect(fill.geometry.type).toBe('Polygon');
    expect(line.geometry.type).toBe('LineString');

    const linestring = line.geometry as { type: 'LineString'; coordinates: number[][] };
    const firstPt = linestring.coordinates[0];
    const lastPt = linestring.coordinates[linestring.coordinates.length - 1];
    expect(firstPt[0]).toBe(-180);
    expect(lastPt[0]).toBe(180);
    expect(Math.abs(firstPt[1] - lastPt[1])).toBeLessThan(1e-5);

    // All boundary latitudes must be in the Southern Hemisphere
    for (const pt of linestring.coordinates) {
      expect(pt[1]).toBeLessThanOrEqual(0);
      expect(pt[1]).toBeGreaterThanOrEqual(-90);
    }
  });

  it('handles satellite exactly at the North Pole (lat 90°)', () => {
    const res = generateFootprintFeatures({
      lat: 90,
      lng: 0,
      alt: 800,
    });

    expect(res.enclosesNorthPole).toBe(true);
    const linestring = res.features[1].geometry as { type: 'LineString'; coordinates: number[][] };

    // At the exact pole, the horizon circle is a constant latitude parallel
    const expectedLat = 90 - (res.angularRadiusRad * 180) / Math.PI;
    for (const pt of linestring.coordinates) {
      expect(Math.abs(pt[1] - expectedLat)).toBeLessThan(0.01);
    }
  });
});
