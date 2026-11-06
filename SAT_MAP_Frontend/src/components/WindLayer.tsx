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

// Ventusky / Windy style color gradient stops (value in normalized [0, 1] range corresponding to 0 to 45 m/s)
// Soft deep navy -> rich indigo/purple -> teal -> vibrant cyan -> bright turquoise
const WIND_COLORMAP: Array<[number, [number, number, number]]> = [
  [0.0, [26, 32, 70]],      // 0 km/h: deep navy/indigo
  [0.05, [48, 54, 115]],    // ~8 km/h: dark soft purple-navy
  [0.12, [72, 60, 138]],    // ~20 km/h: indigo violet
  [0.22, [63, 85, 156]],    // ~35 km/h: blue purple
  [0.35, [41, 128, 168]],   // ~55 km/h: ocean blue
  [0.48, [38, 166, 172]],   // ~78 km/h: teal
  [0.62, [68, 206, 178]],   // ~100 km/h: bright turquoise
  [0.78, [130, 230, 160]],  // ~126 km/h: lime mint
  [0.90, [220, 245, 140]],  // ~145 km/h: pale bright yellow-green
  [1.0, [255, 250, 180]],   // 160+ km/h: warm bright yellow
];

export default function WindLayer({ map }: { map: Map }) {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raster: import('mapbox-exif-layer').SmoothRaster | undefined;
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

        const bounds: [number, number, number, number] = [-180, 89.9, 180, -89.9];
        const windUrl = imageUrl(texture.wind, texture.width, texture.height);
        const speedUrl = imageUrl(texture.speed, texture.width, texture.height);

        // 1. SmoothRaster: Continuous, smooth colored wind speed field (Ventusky/Windy style)
        if (raster) {
          raster.setSource(speedUrl);
        } else {
          raster = new wind.SmoothRaster({
            id: 'wind-speed-raster',
            source: speedUrl,
            bounds,
            sourceType: 'jpeg',
            mapRuntime: 'maplibre',
            readyForDisplay: true,
            opacity: 0.78,
            color: WIND_COLORMAP,
            scalarValueRange: [0, 1],
          });
          try {
            map.addLayer(raster as unknown as CustomLayerInterface, 'day-night-fill');
          } catch (error) {
            if (map.getLayer('wind-speed-raster')) map.removeLayer('wind-speed-raster');
            raster = undefined;
            console.warn('[wind] Could not add smooth wind speed raster:', error);
          }
        }

        // 2. NewParticleMotion: Flowing, smooth wind streamlines on top of the colored field
        if (particles) {
          particles.setSource(windUrl);
        } else {
          particles = new wind.NewParticleMotion({
            id: 'wind-particles',
            source: windUrl,
            bounds,
            sourceType: 'auto',
            mapRuntime: 'maplibre',
            readyForDisplay: true,
            unit: 'mps',
            velocityRange: [-50, 50],
            // Dense, smooth flowing streamlines matching Ventusky & Windy
            particleCount: (zoom) => (zoom < 3 ? 6500 : zoom < 6 ? 4800 : zoom < 9 ? 3200 : 1600),
            updateInterval: 35, // Smooth ~30-60 fps animation updates
            velocityFactor: 0.045, // Fluid, realistic motion speed
            pointSize: 1.8,
            trailLength: 14,
            fadeOpacity: 0.88,
            trailSizeDecay: 0.92,
            ageThreshold: 0.25,
            maxAge: 110,
            // White-cyan flowing streamlines that contrast beautifully against the colored heatmap
            color: [
              [0, [255, 255, 255]],
              [8, [240, 250, 255]],
              [16, [210, 245, 255]],
              [30, [180, 240, 255]],
            ],
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
      if (map.getLayer('wind-speed-raster')) map.removeLayer('wind-speed-raster');
    };
  }, [map]);

  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-40 left-4 z-[210] rounded-xl border border-cyan-400/30 bg-[#070b14]/90 px-3.5 py-2 text-[10px] text-cyan-50 shadow-xl backdrop-blur-md"
    >
      <div className="flex items-center gap-1.5 font-mono font-semibold uppercase tracking-wider">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
        Wind & Atmospheric Flow · 10 m
      </div>
      <div className="mt-1 font-mono text-white/70">
        {status === 'loading'
          ? 'Loading live wind field…'
          : status === 'error'
          ? 'Wind unavailable · retrying'
          : 'Open-Meteo · Ventusky/Windy styled streamlines'}
      </div>
    </div>
  );
}
