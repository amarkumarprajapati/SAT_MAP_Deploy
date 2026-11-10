
"use client";

import { useEffect, useState } from "react";
import type { CustomLayerInterface, Map } from "maplibre-gl";
import {
  createWindField,
  createWindTexture,
  type WindPoint,
} from "@/lib/wind-field";

type Status = "loading" | "ready" | "error";

function toPng(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot create wind texture");

  const image = ctx.createImageData(width, height);
  image.data.set(pixels);
  ctx.putImageData(image, 0, 0);

  return canvas.toDataURL("image/png");
}

export default function WindLayer({ map }: { map: Map }) {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let disposed = false;
    let particles:
      | import("mapbox-exif-layer").NewParticleMotion
      | undefined;

    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let requestController: AbortController | undefined;

    // Re-add the same particle layer after a basemap style reload.
    const ensureLayer = () => {
      if (
        disposed ||
        !particles ||
        !map.isStyleLoaded() ||
        map.getLayer("wind-particles")
      ) return;

      try {
        map.addLayer(
          particles as unknown as CustomLayerInterface,
          map.getLayer("day-night-fill")
            ? "day-night-fill"
            : undefined
        );
      } catch (error) {
        console.warn("[Wind] Layer installation failed:", error);
      }
    };

    map.on("style.load", ensureLayer);

    const load = async () => {
      requestController = new AbortController();

      try {
        const response = await fetch(
          "/api/weather/wind-data?grid=global",
          {
            signal: requestController.signal,
            cache: "no-store",
          }
        );

        if (!response.ok) {
          throw new Error(`Wind API returned ${response.status}`);
        }

        const data: { points: WindPoint[] } = await response.json();

        if (!data.points?.length) {
          throw new Error("Wind API returned no wind points");
        }

        const field = createWindField(data.points);
        const texture = createWindTexture(field, 720, 360);

        if (disposed) return;

        const source = toPng(
          texture.wind,
          texture.width,
          texture.height
        );

        if (particles) {
          particles.setSource(source);
        } else {
          const windModule = await import("mapbox-exif-layer");

          if (disposed) return;


          particles = new windModule.NewParticleMotion({
            id: "wind-particles",
            source,

            bounds: [-180, 90, 180, -90],
            sourceType: "auto",
            mapRuntime: "maplibre",
            readyForDisplay: true,

            unit: "mps",
            velocityRange: [-50, 50],

            color: [
              [0, [255, 255, 255]],
              [50, [255, 255, 255]],
            ],

            // Reduced particle density.
            particleCount: (zoom) =>
              zoom < 3 ? 8000 :
                zoom < 5 ? 7000 :
                  zoom < 7 ? 5500 :
                    zoom < 9 ? 4000 :
                      2500,

            // Smooth movement.
            updateInterval: 35,
            velocityFactor: 0.045,

            // Fine, subtle trails.
            pointSize: 1.25,
            trailLength: 8,
            trailSizeDecay: 0.90,
            fadeOpacity: 0.82,

            // Longer particle lifetime.
            ageThreshold: 600,
            maxAge: 1200,
          });

        }

        ensureLayer();

        if (!disposed) {
          setStatus("ready");
        }

        // Refresh forecast data every hour.
        refreshTimer = setTimeout(
          () => void load(),
          60 * 60 * 1000
        );

      } catch (error) {
        if (disposed ||
          (error instanceof Error && error.name === "AbortError")) {
          return;
        }

        console.error("[Wind] Loading failed:", error);
        setStatus("error");

        // Retry after one minute.
        refreshTimer = setTimeout(
          () => void load(),
          60 * 1000
        );
      }
    };

    void load();

    return () => {
      disposed = true;

      requestController?.abort();

      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      map.off("style.load", ensureLayer);

      if (map.getLayer("wind-particles")) {
        map.removeLayer("wind-particles");
      }
    };
  }, [map]);

  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-40 left-4 z-[210]
        rounded-xl border border-white/15 bg-[#070b14]/85
        px-3 py-1.5 font-mono text-[9px] text-white/75
        shadow-lg backdrop-blur-md"
    >
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-white/80" />
      {status === "loading"
        ? "Loading live wind..."
        : status === "error"
          ? "Wind unavailable · retrying"
          : "LIVE WIND · Open-Meteo"}
    </div>
  );
}
