'use client';

import { useEffect, useState } from 'react';
import type { CustomLayerInterface, Map } from 'maplibre-gl';
import { createWindField, createWindTexture, type WindPoint } from '@/lib/wind-field';

type Status = 'loading' | 'ready' | 'error';

function toPng(pixels: Uint8ClampedArray, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create wind texture');
  const image = context.createImageData(width, height);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Open-Meteo wind vectors rendered as subtle white particles in 2D and 3D. */
export default function WindLayer({ map }: { map: Map }) {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let particles: import('mapbox-exif-layer').NewParticleMotion | undefined;

    const load = async () => {
      try {
        const [response, windModule] = await Promise.all([
          fetch('/api/weather/wind-data?grid=global', { signal: controller.signal }),
          import('mapbox-exif-layer'),
        ]);
        if (!response.ok) throw new Error(`Wind request failed (${response.status})`);
        const data: { points: WindPoint[] } = await response.json();
        const texture = createWindTexture(createWindField(data.points), 720, 360);
        if (disposed) return;

        const source = toPng(texture.wind, texture.width, texture.height);
        if (particles) {
          particles.setSource(source);
        } else {
          particles = new windModule.NewParticleMotion({
          id: 'wind-particles',
          source,
          bounds: [-180, 89.9, 180, -89.9],
          sourceType: 'auto',
          mapRuntime: 'maplibre',
          readyForDisplay: true,
          unit: 'mps',
          velocityRange: [-50, 50],
          // Keep the global view readable and movement calm at every zoom.
          particleCount: (zoom) => zoom < 3 ? 2400 : zoom < 6 ? 1900 : zoom < 9 ? 1200 : 700,
          updateInterval: 55,
          velocityFactor: 0.018,
          pointSize: 1.2,
          trailLength: 5,
          fadeOpacity: 0.94,
          trailSizeDecay: 0.94,
          ageThreshold: 0.25,
          maxAge: 100,
          color: [[0, [255, 255, 255]], [50, [255, 255, 255]]],
          });
          map.addLayer(particles as unknown as CustomLayerInterface,
            map.getLayer('day-night-fill') ? 'day-night-fill' : undefined);
        }
        setStatus('ready');
        refreshTimer = setTimeout(load, 60 * 60 * 1000);
      } catch (error) {
        if (disposed) return;
        console.warn('[wind] Could not load global wind:', error);
        setStatus('error');
        refreshTimer = setTimeout(load, 60 * 1000);
      }
    };

    void load();
    return () => {
      disposed = true;
      controller.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
      if (map.getLayer('wind-particles')) map.removeLayer('wind-particles');
    };
  }, [map]);

  return (
    <div role="status" className="pointer-events-none absolute bottom-40 left-4 z-[210] rounded-xl border border-white/15 bg-[#070b14]/85 px-3 py-1.5 font-mono text-[9px] text-white/75 shadow-lg backdrop-blur-md">
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-white/80" />
      {status === 'loading' ? 'Loading live wind…' : status === 'error' ? 'Wind data unavailable · retrying' : 'LIVE WIND · Open-Meteo'}
    </div>
  );
}
