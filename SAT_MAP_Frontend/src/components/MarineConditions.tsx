"use client";

import { useEffect, useState } from "react";
import type * as maplibregl from "maplibre-gl";
import { Wind, Waves } from "lucide-react";

type Conditions = { windKmh?: number; windDirection?: number; waveHeight?: number; seaLevel?: number; at: number };

export default function MarineConditions({ mapRef }: { mapRef: React.RefObject<maplibregl.Map | null> }) {
  const [conditions, setConditions] = useState<Conditions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let lastRequestAt = 0;
    let lastCenter: [number, number] | null = null;
    let controller: AbortController | null = null;
    const update = async (force = false) => {
      const map = mapRef.current;
      if (!map) return;
      const center = map.getCenter();
      const moved = !lastCenter || Math.abs(center.lng - lastCenter[0]) + Math.abs(center.lat - lastCenter[1]) > 0.4;
      if (!force && (!moved || Date.now() - lastRequestAt < 60_000)) return;
      lastCenter = [center.lng, center.lat];
      lastRequestAt = Date.now();
      controller?.abort();
      controller = new AbortController();
      const lat = center.lat.toFixed(3), lng = center.lng.toFixed(3);
      const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=wave_height,sea_level_height_msl&forecast_days=2&timezone=GMT`;
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn`;
      try {
        const [marineResponse, weatherResponse] = await Promise.all([
          fetch(marineUrl, { signal: controller.signal }),
          fetch(weatherUrl, { signal: controller.signal }),
        ]);
        if (!marineResponse.ok || !weatherResponse.ok) throw new Error("Marine data unavailable");
        const [marine, weather] = await Promise.all([marineResponse.json(), weatherResponse.json()]);
        const times: string[] = marine.hourly?.time ?? [];
        const index = times.length ? Math.max(0, times.findIndex((value: string) => new Date(value).getTime() >= Date.now())) : 0;
        if (active) setConditions({
          windKmh: Number(weather.current?.wind_speed_10m),
          windDirection: Number(weather.current?.wind_direction_10m),
          waveHeight: Number(marine.hourly?.wave_height?.[index]),
          seaLevel: Number(marine.hourly?.sea_level_height_msl?.[index]),
          at: Date.now(),
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError") && active) setConditions(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    const map = mapRef.current;
    void update(true);
    const onMoveEnd = () => void update();
    map?.on("moveend", onMoveEnd);
    const refresh = window.setInterval(() => void update(true), 15 * 60_000);
    return () => {
      active = false;
      controller?.abort();
      map?.off("moveend", onMoveEnd);
      window.clearInterval(refresh);
    };
  }, [mapRef]);

  const direction = Number.isFinite(conditions?.windDirection) ? conditions!.windDirection! : 0;
  return (
    <aside className="pointer-events-auto fixed bottom-4 right-4 z-[180] w-[min(238px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-cyan-300/20 bg-[#07101df2] text-white shadow-[0_12px_36px_rgba(0,0,0,.42)] backdrop-blur-xl" aria-label="Local marine conditions">
      <div className="relative h-8 overflow-hidden border-b border-white/10 bg-cyan-950/30">
        <svg className="absolute inset-0 h-full w-full text-cyan-300/45" viewBox="0 0 240 34" preserveAspectRatio="none" aria-hidden="true"><path className="marine-wave marine-wave-one" d="M0 18 Q30 8 60 18 T120 18 T180 18 T240 18"/><path className="marine-wave marine-wave-two" d="M0 24 Q30 14 60 24 T120 24 T180 24 T240 24"/></svg>
        <div className="relative flex h-full items-center gap-1.5 px-2.5 font-mono text-[9px] font-bold tracking-[.14em] text-cyan-100"><Waves size={12}/> MARINE CONDITIONS</div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 p-2.5 font-mono text-[9px]">
        <div><span className="flex items-center gap-1 text-zinc-500"><Wind size={10}/> WIND</span><div className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-white"><span style={{ transform: `rotate(${direction}deg)` }} className="inline-block text-cyan-300">↑</span>{conditions && Number.isFinite(conditions.windKmh) ? `${conditions.windKmh!.toFixed(1)} kn` : loading ? "Loading" : "Unavailable"}</div></div>
        <div><span className="text-zinc-500">WIND FROM</span><div className="mt-0.5 text-xs font-semibold text-white">{conditions && Number.isFinite(conditions.windDirection) ? `${Math.round(direction)}°` : "—"}</div></div>
        <div><span className="text-zinc-500">WAVE HEIGHT</span><div className="mt-0.5 text-xs font-semibold text-white">{conditions && Number.isFinite(conditions.waveHeight) ? `${conditions.waveHeight!.toFixed(1)} m` : "—"}</div></div>
        <div><span className="text-zinc-500">SEA LEVEL · MSL</span><div className="mt-0.5 text-xs font-semibold text-white">{conditions && Number.isFinite(conditions.seaLevel) ? `${conditions.seaLevel!.toFixed(2)} m` : "—"}</div></div>
      </div>
      <div className="border-t border-white/10 px-2.5 py-1.5 text-[8px] text-zinc-500">Forecast model · <a className="text-cyan-300/80 hover:text-cyan-200" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · Sea level includes modeled tides and other effects.</div>
    </aside>
  );
}
