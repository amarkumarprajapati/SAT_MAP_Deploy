import { NextResponse } from 'next/server';

// The fixed grid stays valid as the camera moves. Avoid requesting both -180°
// and 180°: they refer to the same meridian and create duplicate provider cells.
const locations = Array.from({ length: 13 }, (_, y) =>
  Array.from({ length: 24 }, (_, x) => ({ lat: -90 + y * 15, lon: -180 + x * 15 })),
).flat();

const batchSize = 48;
const maxAttempts = 3;

async function fetchBatch(batch: typeof locations): Promise<typeof locations> {
  const params = new URLSearchParams({
    latitude: batch.map(p => p.lat).join(','),
    longitude: batch.map(p => p.lon).join(','),
    current: 'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'ms',
    cell_selection: 'nearest',
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        throw new Error(`provider returned HTTP ${response.status}`);
      }

      const body = await response.json();
      const values = Array.isArray(body) ? body : [body];
      if (values.length !== batch.length) {
        throw new Error(`provider returned ${values.length} locations for ${batch.length} requested`);
      }

      return values.map((value, index) => {
        const speed = value.current?.wind_speed_10m;
        const direction = value.current?.wind_direction_10m;
        if (!Number.isFinite(speed) || !Number.isFinite(direction)) {
          throw new Error(`provider returned invalid wind data at location ${index}`);
        }
        return { ...batch[index], speed, direction };
      });
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * attempt));
    }
  }

  throw new Error('Wind provider request failed');
}

export async function GET() {
  try {
    const batches = [];
    for (let i = 0; i < locations.length; i += batchSize) {
      batches.push(fetchBatch(locations.slice(i, i + batchSize)));
    }
    return NextResponse.json({ points: (await Promise.all(batches)).flat() }, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[wind] Failed to load wind data:', message);
    return NextResponse.json({ error: 'Wind data is temporarily unavailable', detail: message }, {
      status: 502, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
