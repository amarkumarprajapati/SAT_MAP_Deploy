"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Route } from "lucide-react";

type TrackPoint = { lat: number; lng: number; timestamp?: number };

export default function ShipRoutePlaybackBar({ ship }: { ship: Record<string, unknown> }) {
  const route = useMemo(() => (Array.isArray(ship.track) ? ship.track : []).map((point) => ({ lat: Number(point.lat), lng: Number(point.lng), timestamp: Number(point.timestamp) })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)), [ship.track]) as TrackPoint[];
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const startTimeRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const shipId = String(ship.mmsi ?? ship.id ?? "");
  const name = String(ship.name ?? `MMSI ${shipId}`).trim();
  const category = String(ship.type ?? "cargo").toLowerCase();
  const duration = Math.max(7_000, Math.min(24_000, route.length * 180));
  const currentPoint: TrackPoint = { lat: Number(ship.lat), lng: Number(ship.lng) };
  const fallbackPoint = { lat: Number.isFinite(currentPoint.lat) ? currentPoint.lat : 0, lng: Number.isFinite(currentPoint.lng) ? currentPoint.lng : 0 };
  const start = route[0] ?? fallbackPoint;
  const end = route[route.length - 1] ?? fallbackPoint;

  const emitPosition = useCallback((fraction: number, started = false) => {
    if (route.length < 2) return;
    const segment = fraction * (route.length - 1);
    const index = Math.min(route.length - 2, Math.floor(segment));
    const portion = Math.max(0, segment - index);
    const a = route[index], b = route[index + 1];
    const lat = a.lat + (b.lat - a.lat) * portion;
    const lngDelta = ((b.lng - a.lng + 540) % 360) - 180;
    const lng = ((a.lng + lngDelta * portion + 540) % 360) - 180;
    const heading = (Math.atan2(Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180), Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180)) * 180 / Math.PI + 360) % 360;
    window.dispatchEvent(new CustomEvent("ltmap:ship-route-playback", { detail: { ship, route, point: { lat, lng, heading }, progress: fraction, started } }));
  }, [route, ship]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    progressRef.current = 0;
    if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
  }, [shipId]);

  useEffect(() => {
    if (!playing || route.length < 2) return;
    const initialProgress = progressRef.current >= 1 ? 0 : progressRef.current;
    progressRef.current = initialProgress;
    setProgress(initialProgress);
    startTimeRef.current = performance.now() - initialProgress * duration;
    let lastUiUpdate = 0;
    let firstFrame = true;
    const frame = (now: number) => {
      const nextProgress = Math.min(1, Math.max(0, (now - startTimeRef.current) / duration));
      progressRef.current = nextProgress;
      emitPosition(nextProgress, firstFrame && initialProgress === 0);
      firstFrame = false;
      if (now - lastUiUpdate > 80 || nextProgress >= 1) {
        lastUiUpdate = now;
        setProgress(nextProgress);
      }
      if (nextProgress >= 1) {
        setPlaying(false);
        return;
      }
      animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
    return () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    };
  }, [playing, duration, route.length, emitPosition]);

  const seek = (value: number) => {
    const next = Math.max(0, Math.min(1, value));
    progressRef.current = next;
    setProgress(next);
    emitPosition(next);
  };
  const togglePlay = () => {
    if (route.length < 2) return;
    if (progressRef.current >= 1) seek(0);
    setPlaying((value) => !value);
  };

  if (!ship) return null;
  return (
    <section className="pointer-events-auto fixed bottom-9 left-1/2 z-[240] w-[min(760px,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border border-cyan-400/30 bg-[#07101df5] px-3 py-2.5 text-white shadow-[0_14px_48px_rgba(0,0,0,.58),0_0_22px_rgba(0,229,255,.10)] backdrop-blur-2xl sm:px-4" aria-label="Vessel route telemetry and playback">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Route size={14} className="shrink-0 text-cyan-300" />
          <div className="min-w-0">
            <div className="truncate font-mono text-[10px] font-bold tracking-[.12em] text-cyan-200">ROUTE TELEMETRY · {name.toUpperCase()}</div>
            <div className="font-mono text-[8px] text-zinc-500">{category.toUpperCase()} · {route.length} AIS FIXES</div>
          </div>
        </div>
        <button type="button" onClick={togglePlay} disabled={route.length < 2} className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-cyan-300/50 bg-cyan-300 px-3 font-mono text-[10px] font-extrabold text-slate-950 shadow-[0_0_14px_rgba(0,229,255,.24)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45" aria-label={playing ? "Pause vessel route playback" : "Play vessel route from start to endpoint"} title={playing ? "Pause route playback" : route.length < 2 ? "No historical route fixes available" : "Play route from start to endpoint"}>
          {playing ? <Pause size={14} fill="currentColor" /> : progress >= 1 ? <RotateCcw size={14} /> : <Play size={14} fill="currentColor" />}
          <span>{playing ? "PAUSE" : route.length < 2 ? "NO TRACK" : progress >= 1 ? "REPLAY" : "PLAY ROUTE"}</span>
        </button>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono text-[8px]">
        <div className="min-w-0"><div className="font-bold tracking-wider text-emerald-300">START</div><div className="truncate text-zinc-300">{start.lat.toFixed(4)}°, {start.lng.toFixed(4)}°</div></div>
        <div className="text-center text-zinc-500">{Math.round(progress * 100)}%</div>
        <div className="min-w-0 text-right"><div className="font-bold tracking-wider text-amber-300">END · {String(ship.destination ?? "LAST AIS FIX").trim().toUpperCase()}</div><div className="truncate text-zinc-300">{end.lat.toFixed(4)}°, {end.lng.toFixed(4)}°</div></div>
      </div>
      <input aria-label="Seek through vessel route" type="range" min="0" max="1" step="0.001" value={progress} disabled={route.length < 2} onChange={(event) => seek(Number(event.target.value))} className="ship-route-range mt-1.5 h-2 w-full cursor-pointer accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: `linear-gradient(to right, #34d399 0%, #22d3ee ${progress * 100}%, rgba(255,255,255,.12) ${progress * 100}%, rgba(255,255,255,.12) 100%)` }} />
    </section>
  );
}
