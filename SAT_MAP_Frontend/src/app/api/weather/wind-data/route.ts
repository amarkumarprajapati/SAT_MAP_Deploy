import { NextResponse } from 'next/server';

// The fixed grid stays valid as the camera moves. Open-Meteo returns locations
// in the same order as the coordinates supplied in each batch.
const locations = Array.from({ length: 13 }, (_, y) =>
  Array.from({ length: 24 }, (_, x) => ({ lat: -90 + y * 15, lon: -180 + x * 15 })),
).flat();

export async function GET() {
  try {
    const batches = [];
    for (let i = 0; i < locations.length; i += 60) {
      const batch = locations.slice(i, i + 60);
      const params = new URLSearchParams({
        latitude: batch.map(p => p.lat).join(','),
        longitude: batch.map(p => p.lon).join(','),
        current: 'wind_speed_10m,wind_direction_10m',
        wind_speed_unit: 'ms',
        cell_selection: 'nearest',
      });
      batches.push(fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(20000),
      }).then(async response => {
        if (!response.ok) throw new Error(`Wind provider returned ${response.status}`);
        const body = await response.json();
        const values = Array.isArray(body) ? body : [body];
        if (values.length !== batch.length) throw new Error('Incomplete wind data');
        return values.map((value, index) => {
          const speed = value.current?.wind_speed_10m;
          const direction = value.current?.wind_direction_10m;
          if (!Number.isFinite(speed) || !Number.isFinite(direction)) throw new Error('Invalid wind data');
          return { ...batch[index], speed, direction };
        });
      }));
    }
    return NextResponse.json({ points: (await Promise.all(batches)).flat() }, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (error) {
    console.error('[wind] Failed to load wind data:', error);
    return NextResponse.json({ error: 'Wind data is temporarily unavailable' }, {
      status: 502, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
