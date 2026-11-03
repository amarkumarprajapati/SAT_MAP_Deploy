"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Route, PanelRightOpen, X } from "lucide-react";
import { calculateVoyageDetails } from "@/lib/maritime-route";

type TrackPoint = { lat: number; lng: number; timestamp?: number | string; speed?: number };

function timestampMs(value: unknown): number | null {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatDateTime(value: unknown): string {
  const ms = timestampMs(value);
  return ms === null ? "TIME NOT REPORTED" : new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ms);
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return "TIME NOT REPORTED";
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function ShipRoutePlaybackBar({ ship, onClose, onToggleDetails, detailsOpen }: { ship: Record<string, unknown>; onClose: () => void; onToggleDetails: () => void; detailsOpen: boolean }) {
  const route = useMemo(() => (Array.isArray(ship.track) ? ship.track : []).map((point) => ({ lat: Number(point.lat), lng: Number(point.lng), timestamp: point.timestamp as number | string | undefined, speed: Number(point.speed) })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)), [ship.track]) as TrackPoint[];
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const startTimeRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const shipId = String(ship.mmsi ?? ship.id ?? "");
  const name = String(ship.name ?? `MMSI ${shipId}`).trim();
  const category = String(ship.type ?? "cargo").toLowerCase();
  const vesselInfo = useMemo(() => calculateVoyageDetails(ship), [ship]);
  const duration = Math.max(7_000, Math.min(24_000, route.length * 180));
  const currentPoint: TrackPoint = { lat: Number(ship.lat), lng: Number(ship.lng) };
  const fallbackPoint = { lat: Number.isFinite(currentPoint.lat) ? currentPoint.lat : 0, lng: Number.isFinite(currentPoint.lng) ? currentPoint.lng : 0 };
  const start = route[0] ?? fallbackPoint;
  const end = route[route.length - 1] ?? fallbackPoint;
  const routeStats = useMemo(() => {
    let distanceKm = 0;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      const radians = Math.PI / 180;
      const dLat = (b.lat - a.lat) * radians;
      const dLng = (b.lng - a.lng) * radians;
      const value = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
      distanceKm += 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
    }
    const speeds = route.map((point) => Number(point.speed)).filter((speed) => Number.isFinite(speed) && speed >= 0);
    const segmentSpeeds: number[] = [];
    for (let i = 1; i < route.length; i++) {
      const from = timestampMs(route[i - 1].timestamp);
      const to = timestampMs(route[i].timestamp);
      if (from === null || to === null || to <= from) continue;
      const a = route[i - 1], b = route[i];
      const radians = Math.PI / 180;
      const dLat = (b.lat - a.lat) * radians;
      const dLng = (b.lng - a.lng) * radians;
      const value = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
      const segmentKm = 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
      const knots = segmentKm / ((to - from) / 3_600_000) / 1.852;
      if (Number.isFinite(knots) && knots <= 90) segmentSpeeds.push(knots);
    }
    const reportedDistance = Number(ship.trackDistanceKm);
    const startMs = timestampMs(ship.trackStartAt ?? ship.firstSeenAt ?? route[0]?.timestamp);
    const endMs = timestampMs(ship.lastSeenAt ?? ship.timestamp ?? route.at(-1)?.timestamp);
    const elapsedMs = startMs !== null && endMs !== null ? Math.max(0, endMs - startMs) : null;
    const totalDistanceKm = Number.isFinite(reportedDistance) && reportedDistance > 0 ? reportedDistance : distanceKm;
    const estimatedAverageKnots = elapsedMs && elapsedMs > 0 ? totalDistanceKm / (elapsedMs / 3_600_000) / 1.852 : null;
    const currentSpeedValue = Number(ship.speed ?? ship.sog);
    const hasCurrentAisSpeed = Number.isFinite(currentSpeedValue) && currentSpeedValue >= 0;
    return {
      distanceKm: totalDistanceKm,
      durationMs: elapsedMs,
      startTime: startMs,
      endTime: endMs,
      averageSpeed: speeds.length ? speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length : estimatedAverageKnots ?? (segmentSpeeds.length ? segmentSpeeds.reduce((sum, speed) => sum + speed, 0) / segmentSpeeds.length : null),
      maxSpeed: speeds.length || segmentSpeeds.length ? Math.max(...speeds, ...segmentSpeeds) : null,
      currentSpeed: hasCurrentAisSpeed ? currentSpeedValue : segmentSpeeds.at(-1) ?? null,
      currentCourse: Number.isFinite(Number(ship.heading ?? ship.course)) ? Number(ship.heading ?? ship.course) : null,
      averageIsEstimated: speeds.length === 0 && (estimatedAverageKnots !== null || segmentSpeeds.length > 0),
      peakIsEstimated: speeds.length === 0 && segmentSpeeds.length > 0,
      currentSpeedEstimated: !hasCurrentAisSpeed && segmentSpeeds.length > 0,
      lastSeen: endMs,
    };
  }, [route, ship.trackDistanceKm, ship.trackStartAt, ship.firstSeenAt, ship.lastSeenAt, ship.timestamp, ship.speed, ship.sog, ship.heading, ship.course]);
  const lastFixAge = (() => {
    const timestamp = Number(routeStats.lastSeen);
    if (!Number.isFinite(timestamp)) return "LIVE FEED";
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  })();

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
            <div className="truncate font-mono text-[8px] text-zinc-400" title={`Flag state: ${vesselInfo.countryName} (${vesselInfo.countryCode})`}>{category.toUpperCase()} · {route.length} AIS FIXES · FLAG {vesselInfo.flagEmoji} {vesselInfo.countryName.toUpperCase()} ({vesselInfo.countryCode})</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={onToggleDetails} aria-pressed={detailsOpen} className={`flex h-9 items-center gap-1.5 rounded-lg border px-2 font-mono text-[9px] font-bold transition ${detailsOpen ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-200" : "border-white/15 bg-white/5 text-zinc-300 hover:border-cyan-300/40 hover:text-cyan-200"}`} aria-label={detailsOpen ? "Hide vessel data card" : "Show vessel data card"} title={detailsOpen ? "Hide vessel data" : "Show vessel data"}>
            <PanelRightOpen size={13} /><span>VESSEL DATA</span>
          </button>
          <button type="button" onClick={togglePlay} disabled={route.length < 2} className="flex h-9 items-center gap-2 rounded-lg border border-cyan-300/50 bg-cyan-300 px-3 font-mono text-[10px] font-extrabold text-slate-950 shadow-[0_0_14px_rgba(0,229,255,.24)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45" aria-label={playing ? "Pause vessel route playback" : "Play vessel route from start to endpoint"} title={playing ? "Pause route playback" : route.length < 2 ? "No historical route fixes available" : "Play route from start to endpoint"}>
            {playing ? <Pause size={14} fill="currentColor" /> : progress >= 1 ? <RotateCcw size={14} /> : <Play size={14} fill="currentColor" />}
            <span>{playing ? "PAUSE" : route.length < 2 ? "NO TRACK" : progress >= 1 ? "REPLAY" : "PLAY ROUTE"}</span>
          </button>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-zinc-400 transition hover:border-rose-400/40 hover:bg-rose-400/10 hover:text-rose-300" aria-label="Close route telemetry" title="Close route telemetry">
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1"><div className="font-mono text-[7px] tracking-wider text-zinc-500">TRACK DISTANCE</div><div className="mt-0.5 font-mono text-[9px] font-bold text-cyan-200">{routeStats.distanceKm.toFixed(1)} km</div></div>
        <div className="rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1"><div className="font-mono text-[7px] tracking-wider text-zinc-500">TIME UNDER TRACK</div><div className="mt-0.5 truncate font-mono text-[9px] font-bold text-sky-200">{formatDuration(routeStats.durationMs)}</div></div>
        <div className="rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1"><div className="font-mono text-[7px] tracking-wider text-zinc-500">CURRENT SPEED / COURSE</div><div className="mt-0.5 truncate font-mono text-[9px] font-bold text-emerald-200">{routeStats.currentSpeed == null ? "—" : `${routeStats.currentSpeed.toFixed(1)}${routeStats.currentSpeedEstimated ? "*" : ""}`} kn / {routeStats.currentCourse == null ? "—" : `${routeStats.currentCourse.toFixed(0)}°`}</div></div>
        <div className="rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1"><div className="font-mono text-[7px] tracking-wider text-zinc-500">AVG / PEAK SPEED</div><div className="mt-0.5 truncate font-mono text-[9px] font-bold text-emerald-200">{routeStats.averageSpeed == null ? "—" : `${routeStats.averageSpeed.toFixed(1)}${routeStats.averageIsEstimated ? "*" : ""}`} / {routeStats.maxSpeed == null ? "—" : `${routeStats.maxSpeed.toFixed(1)}${routeStats.peakIsEstimated ? "*" : ""}`} kn</div></div>
        <div className="rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1"><div className="font-mono text-[7px] tracking-wider text-zinc-500">CURRENT FIX</div><div className="mt-0.5 truncate font-mono text-[9px] font-bold text-zinc-200">{fallbackPoint.lat.toFixed(4)}°, {fallbackPoint.lng.toFixed(4)}°</div></div>
        <div className="rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1"><div className="font-mono text-[7px] tracking-wider text-zinc-500">LAST AIS FIX</div><div className="mt-0.5 truncate font-mono text-[9px] font-bold text-amber-200">{lastFixAge}</div></div>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono text-[8px]">
        <div className="min-w-0"><div className="font-bold tracking-wider text-emerald-300">START · {formatDateTime(routeStats.startTime)}</div><div className="truncate text-zinc-300">{start.lat.toFixed(4)}°, {start.lng.toFixed(4)}°</div></div>
        <div className="text-center text-zinc-500">{Math.round(progress * 100)}%</div>
        <div className="min-w-0 text-right"><div className="font-bold tracking-wider text-amber-300">END · {String(ship.destination ?? "LAST AIS FIX").trim().toUpperCase()}</div><div className="truncate text-zinc-300">{formatDateTime(routeStats.endTime)} · {end.lat.toFixed(4)}°, {end.lng.toFixed(4)}°</div></div>
      </div>
      {(routeStats.averageIsEstimated || routeStats.peakIsEstimated || routeStats.currentSpeedEstimated) && <div className="mt-1 text-right font-mono text-[7px] text-zinc-600">*Speed estimated between timestamped AIS fixes; unmarked values are AIS reported.</div>}
      <input aria-label="Seek through vessel route" type="range" min="0" max="1" step="0.001" value={progress} disabled={route.length < 2} onChange={(event) => seek(Number(event.target.value))} className="ship-route-range mt-1.5 h-2 w-full cursor-pointer accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: `linear-gradient(to right, #34d399 0%, #22d3ee ${progress * 100}%, rgba(255,255,255,.12) ${progress * 100}%, rgba(255,255,255,.12) 100%)` }} />
    </section>
  );
}
