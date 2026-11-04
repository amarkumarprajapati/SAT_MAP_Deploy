import { describe, expect, it } from 'vitest';
import { createWindField, createWindTexture, type WindPoint } from './wind-field';

function grid(speed: number, direction: number): WindPoint[] {
  return Array.from({ length: 13 }, (_, y) =>
    Array.from({ length: 24 }, (_, x) => ({ lat: -90 + y * 15, lon: -180 + x * 15, speed, direction })),
  ).flat();
}

describe('wind field', () => {
  it('converts a wind from the north into southward motion', () => {
    const field = createWindField(grid(10, 0));
    expect(field(70, 20).u).toBeCloseTo(0);
    expect(field(70, 20).v).toBeCloseTo(-10);
  });

  it('interpolates vectors across the antimeridian', () => {
    const points = grid(10, 90);
    points.find(p => p.lat === 0 && p.lon === -180)!.speed = 20;
    const field = createWindField(points);
    expect(field(180, 0).u).toBeCloseTo(-20);
    expect(field(172.5, 0).u).toBeCloseTo(-15);
  });

  it('uses measured wind at both poles instead of repeating the 75° latitude', () => {
    const points = grid(10, 0);
    points.find(p => p.lat === 90 && p.lon === 0)!.speed = 20;
    points.find(p => p.lat === -90 && p.lon === 0)!.speed = 5;
    const field = createWindField(points);
    expect(field(0, 90).v).toBeCloseTo(-20);
    expect(field(0, -90).v).toBeCloseTo(-5);
    expect(field(0, 75).v).toBeCloseTo(-10);
  });

  it('encodes velocity using the GPU layer format', () => {
    const points = grid(10, 0);
    const texture = createWindTexture(createWindField(points), 8, 4);
    expect(texture.wind).toHaveLength(8 * 4 * 4);
    expect(Array.from(texture.wind.slice(0, 4))).toEqual([128, 102, 255, 255]);
    expect(() => createWindField(points.slice(1))).toThrow();
  });
});
