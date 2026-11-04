export type WindPoint = { lat: number; lon: number; speed: number; direction: number };
type Vector = { u: number; v: number };
export type WindField = (lon: number, lat: number) => Vector;
const wrap = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;

export function createWindField(points: WindPoint[]): WindField {
  if (points.length !== 312) throw new Error('Incomplete wind grid');
  const u = new Float32Array(312);
  const v = new Float32Array(312);
  const seen = new Set<number>();
  for (const p of points) {
    if (![p.lat, p.lon, p.speed, p.direction].every(Number.isFinite)) throw new Error('Invalid wind grid');
    const row = (p.lat + 90) / 15, col = (p.lon + 180) / 15;
    if (!Number.isInteger(row) || row < 0 || row > 12 || !Number.isInteger(col) || col < 0 || col > 23) throw new Error('Invalid wind grid');
    const index = row * 24 + col;
    seen.add(index);
    // Meteorological direction is where the wind comes from, clockwise from north.
    const angle = p.direction * Math.PI / 180;
    u[index] = -p.speed * Math.sin(angle);
    v[index] = -p.speed * Math.cos(angle);
  }
  if (seen.size !== 312) throw new Error('Incomplete wind grid');
  return (lon, lat) => {
    const x = (wrap(lon) + 180) / 15;
    const y = (Math.max(-90, Math.min(90, lat)) + 90) / 15;
    const x0 = Math.floor(x), y0 = Math.min(11, Math.floor(y));
    const dx = x - x0, dy = y - y0;
    const a = y0 * 24 + x0, b = y0 * 24 + (x0 + 1) % 24, c = a + 24, d = b + 24;
    const mix = (grid: Float32Array) => (grid[a] * (1 - dx) + grid[b] * dx) * (1 - dy) + (grid[c] * (1 - dx) + grid[d] * dx) * dy;
    return { u: mix(u), v: mix(v) };
  };
}

// PNG channels required by mapbox-exif-layer: U/V in red/green and blue=255
// for valid vectors. The small polar margin avoids Mercator's exact-pole singularity.
export function createWindTexture(field: WindField, width = 360, height = 180) {
  const wind = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const lat = 89.9 - (y + 0.5) / height * 179.8;
    for (let x = 0; x < width; x++) {
      const lon = (x + 0.5) / width * 360 - 180;
      const { u, v } = field(lon, lat);
      const offset = (y * width + x) * 4;
      wind[offset] = Math.round(Math.max(0, Math.min(255, (u + 50) / 100 * 255)));
      wind[offset + 1] = Math.round(Math.max(0, Math.min(255, (v + 50) / 100 * 255)));
      wind[offset + 2] = 255;
      wind[offset + 3] = 255;
    }
  }
  return { wind, width, height };
}
