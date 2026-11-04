'use client';

import { useEffect, useState } from 'react';
import type { CustomLayerInterface, Map } from 'maplibre-gl';
import { createWindField, createWindTexture, type WindPoint } from '@/lib/wind-field';

type Status = 'loading' | 'ready' | 'error';

function imageUrl(pixels: Uint8ClampedArray, width: number, height: number) {
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

export default function WindLayer({ map }: { map: Map }) {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let particles: import('mapbox-exif-layer').NewParticleMotion | undefined;
    const controller = new AbortController();

    const load = async () => {
      try {
        const [response, wind] = await Promise.all([
          fetch('/api/weather/wind-data?grid=polar', { signal: controller.signal }),
          import('mapbox-exif-layer'),
        ]);
        if (!response.ok) throw new Error(`Wind data request failed (${response.status})`);
        const data: { points: WindPoint[] } = await response.json();
        const texture = createWindTexture(createWindField(data.points));
        if (disposed) return;
        const windUrl = imageUrl(texture.wind, texture.width, texture.height);
        if (particles) {
          particles.setSource(windUrl);
        } else {
          const bounds: [number, number, number, number] = [-180, 89.9, 180, -89.9];
          particles = new wind.NewParticleMotion({
            id: 'wind-particles', source: windUrl, bounds, sourceType: 'auto',
            mapRuntime: 'maplibre', readyForDisplay: true, unit: 'mps', velocityRange: [-50, 50],
            // Keep the field legible at world scale and avoid thousands of competing dashes.
            particleCount: zoom => zoom < 4 ? 4200 : zoom < 8 ? 1800 : 850,
            updateInterval: 70, velocityFactor: 0.028, pointSize: 1.05, trailLength: 10,
            fadeOpacity: 0.72, trailSizeDecay: 0.94, ageThreshold: 0.35, maxAge: 120,
            color: [[0, [160, 212, 242]], [8, [156, 245, 217]], [16, [209, 255, 186]], [30, [255, 244, 184]]],
          });
          try {
            map.addLayer(particles as unknown as CustomLayerInterface, 'day-night-fill');
          } catch (error) {
            if (map.getLayer('wind-particles')) map.removeLayer('wind-particles');
            particles = undefined;
            throw error;
          }
        }
        setStatus('ready');
        timer = setTimeout(load, 60 * 60 * 1000);
      } catch (error) {
        if (disposed) return;
        console.warn('[wind] Could not load wind layer:', error);
        setStatus('error');
        timer = setTimeout(load, 60 * 1000);
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      if (map.getLayer('wind-particles')) map.removeLayer('wind-particles');
    };
  }, [map]);

  return (
    <div role="status" className="pointer-events-none absolute bottom-40 left-4 z-[210] rounded-xl border border-emerald-200/20 bg-slate-950/90 px-3 py-2 text-[10px] text-emerald-50 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-1.5 font-mono font-semibold uppercase tracking-wider"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Wind · 10 m</div>
      <div className="mt-1 font-mono text-white/65">{status === 'loading' ? 'Loading wind data…' : status === 'error' ? 'Wind unavailable · retrying' : 'Open-Meteo · animated flow'}</div>
    </div>
  );
}
