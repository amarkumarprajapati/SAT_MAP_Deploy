"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  Gauge,
  Crosshair,
  Repeat,
  X,
  Compass,
  Navigation,
  Activity,
  MapPin,
  Clock,
  Loader2,
} from "lucide-react";
import { api } from "@/config/api";
import type { TrackPoint, ShipRoutePlaybackBarProps } from "@/helper";

function timestampMs(value: unknown): number | null {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0)
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// Format UTC timestamp like: "04 NOV 2026 08:23:13 UTC"
function formatUtcDateTime(value: unknown): string {
  const ms = timestampMs(value);
  if (ms === null) return "LIVE UTC TELEMETRY";
  const d = new Date(ms);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const seconds = String(d.getUTCSeconds()).padStart(2, "0");
  return `${day} ${month} ${year} ${hours}:${minutes}:${seconds} UTC`;
}

export default function ShipRoutePlaybackBar({
  ship,
  onClose,
}: ShipRoutePlaybackBarProps) {
  const shipId = String(ship.mmsi ?? ship.id ?? "");
  const [fetchedTrack, setFetchedTrack] = useState<TrackPoint[] | null>(null);
  const [loadingTrack, setLoadingTrack] = useState(false);

  // Auto-fetch complete historical track from the API
  useEffect(() => {
    if (!shipId) return;
    const controller = new AbortController();
    setLoadingTrack(true);

    fetch(api.maritimeShipTrack(shipId), { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.track) && data.track.length > 0) {
          const parsed = data.track
            .map((pt: Record<string, unknown>) => ({
              lat: Number(pt.lat),
              lng: Number(pt.lng),
              timestamp: pt.timestamp as number | string | undefined,
              speed: Number(pt.speed),
              heading: Number(pt.heading ?? pt.course),
            }))
            .filter(
              (pt: TrackPoint) =>
                Number.isFinite(pt.lat) && Number.isFinite(pt.lng),
            );
          setFetchedTrack(parsed);
        } else if (Array.isArray(data) && data.length > 0) {
          const parsed: TrackPoint[] = [];
          for (const tuple of data) {
            if (Array.isArray(tuple)) {
              const lng = Number(tuple[0]);
              const lat = Number(tuple[1]);
              const speed = Number(tuple[2]) / 10.0;
              const heading = Number(tuple[4] ?? tuple[3]);
              const rawTs = tuple[6] ?? tuple[5];
              const timestamp =
                typeof rawTs === "string" || typeof rawTs === "number"
                  ? rawTs
                  : undefined;
              if (Number.isFinite(lat) && Number.isFinite(lng)) {
                parsed.push({ lat, lng, speed, heading, timestamp });
              }
            }
          }
          setFetchedTrack(parsed);
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoadingTrack(false);
      });

    return () => {
      controller.abort();
    };
  }, [shipId]);

  const rawRoute = useMemo(() => {
    if (fetchedTrack && fetchedTrack.length > 0) {
      return fetchedTrack;
    }
    return (Array.isArray(ship.track) ? ship.track : [])
      .map((point: Record<string, unknown>) => ({
        lat: Number(point.lat),
        lng: Number(point.lng),
        timestamp: point.timestamp as number | string | undefined,
        speed: Number(point.speed),
        heading: Number(point.heading ?? point.course),
      }))
      .filter(
        (point: TrackPoint) =>
          Number.isFinite(point.lat) && Number.isFinite(point.lng),
      );
  }, [fetchedTrack, ship.track]);

  const route = rawRoute as TrackPoint[];
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 5>(1);
  const [currentUtcTime, setCurrentUtcTime] = useState<string>("");

  const progressRef = useRef(0);
  const startTimeRef = useRef(0);
  const animationRef = useRef<number | null>(null);

  const [activePlaybackId, setActivePlaybackId] = useState(shipId);
  if (activePlaybackId !== shipId) {
    setActivePlaybackId(shipId);
    setPlaying(false);
    setProgress(0);
    progressRef.current = 0;
    setCurrentUtcTime("");
    if (animationRef.current != null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }

  // Derive initial or interpolated UTC time deterministically
  const displayUtcTime =
    currentUtcTime ||
    (route[0]?.timestamp
      ? formatUtcDateTime(route[0].timestamp)
      : "UTC TIME NOT REPORTED");

  // Live interpolated metrics for user telemetry display
  const [currentLat, setCurrentLat] = useState<number>(Number(ship.lat || 0));
  const [currentLng, setCurrentLng] = useState<number>(Number(ship.lng || 0));
  const [currentSpeed, setCurrentSpeed] = useState<number>(
    Number(ship.speed || 0),
  );
  const [currentHeading, setCurrentHeading] = useState<number>(
    Number(ship.heading || ship.course || 0),
  );

  const shipName = String(ship.name || `VESSEL ${shipId}`).toUpperCase();
  const vesselType = String(ship.type || "CARGO").toUpperCase();

  const duration = useMemo(
    () => Math.max(8_000, Math.min(35_000, route.length * 250)) / playbackSpeed,
    [route.length, playbackSpeed],
  );

  const emitPosition = useCallback(
    (fraction: number, started = false) => {
      if (route.length < 2) return;
      const segment = fraction * (route.length - 1);
      const index = Math.min(route.length - 2, Math.floor(segment));
      const portion = Math.max(0, segment - index);
      const a = route[index],
        b = route[index + 1];
      const lngDelta = ((b.lng - a.lng + 540) % 360) - 180;
      const rad = Math.PI / 180;
      const toVector = (lat: number, lng: number) => [Math.cos(lat * rad) * Math.cos(lng * rad), Math.cos(lat * rad) * Math.sin(lng * rad), Math.sin(lat * rad)];
      const va = toVector(a.lat, a.lng), vb = toVector(b.lat, a.lng + lngDelta);
      const omega = Math.acos(Math.max(-1, Math.min(1, va[0]*vb[0] + va[1]*vb[1] + va[2]*vb[2])));
      const denom = Math.sin(omega) || 1;
      const x = Math.sin((1-portion)*omega)/denom*va[0] + Math.sin(portion*omega)/denom*vb[0];
      const y = Math.sin((1-portion)*omega)/denom*va[1] + Math.sin(portion*omega)/denom*vb[1];
      const z = Math.sin((1-portion)*omega)/denom*va[2] + Math.sin(portion*omega)/denom*vb[2];
      const lat = Math.atan2(z, Math.hypot(x, y)) / rad;
      const lng = ((Math.atan2(y, x) / rad + 540) % 360) - 180;
      const heading =
        (Math.atan2(
          Math.sin(((b.lng - a.lng) * Math.PI) / 180) *
            Math.cos((b.lat * Math.PI) / 180),
          Math.cos((a.lat * Math.PI) / 180) *
            Math.sin((b.lat * Math.PI) / 180) -
            Math.sin((a.lat * Math.PI) / 180) *
              Math.cos((b.lat * Math.PI) / 180) *
              Math.cos(((b.lng - a.lng) * Math.PI) / 180),
        ) *
          180) /
          Math.PI +
        (360 % 360);

      const aTime = timestampMs(a.timestamp);
      const bTime = timestampMs(b.timestamp);
      const currentTime =
        aTime && bTime
          ? aTime + (bTime - aTime) * portion
          : (aTime ?? bTime ?? null);
      if (currentTime) {
        setCurrentUtcTime(formatUtcDateTime(currentTime));
      }

      const aSpeed = Number(a.speed || 0);
      const bSpeed = Number(b.speed || 0);
      const speed =
        Number.isFinite(aSpeed) && Number.isFinite(bSpeed)
          ? aSpeed + (bSpeed - aSpeed) * portion
          : aSpeed || bSpeed || 0;

      setCurrentLat(lat);
      setCurrentLng(lng);
      setCurrentHeading(Math.round(heading));
      setCurrentSpeed(Number(speed.toFixed(1)));

      window.dispatchEvent(
        new CustomEvent("ltmap:ship-route-playback", {
          detail: {
            ship,
            route,
            traveledRoute: route,
            point: { lat, lng, heading, speed, timestamp: currentTime },
            progress: fraction,
            started,
          },
        }),
      );
    },
    [route, ship],
  );

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (!playing || route.length < 2) return;
    const initialProgress = progressRef.current >= 1 ? 0 : progressRef.current;
    progressRef.current = initialProgress;
    setProgress(initialProgress);
    startTimeRef.current = performance.now() - initialProgress * duration;
    let lastUiUpdate = 0;
    let firstFrame = true;
    const frame = (now: number) => {
      const nextProgress = Math.min(
        1,
        Math.max(0, (now - startTimeRef.current) / duration),
      );
      progressRef.current = nextProgress;
      emitPosition(nextProgress, firstFrame && initialProgress === 0);
      firstFrame = false;
      if (now - lastUiUpdate > 60 || nextProgress >= 1) {
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
      if (animationRef.current != null)
        cancelAnimationFrame(animationRef.current);
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

  const cycleSpeed = () => {
    setPlaybackSpeed((prev) => (prev === 1 ? 2 : prev === 2 ? 5 : 1));
  };

  if (!ship) return null;

  return (
    <section
      className="pointer-events-auto box-border min-h-0 min-w-0 w-full max-w-[840px] self-end justify-self-center overflow-visible select-none font-sans px-2"
      aria-label="Dark Vessel Route Telemetry & Historical Playback"
    >
      {/* ── Main Dark Capsule Playback Bar ── */}
      <div className="flex items-center gap-2.5 rounded-full border border-cyan-500/40 bg-[#09131ff2] px-3.5 py-2.5 text-zinc-200 backdrop-blur-2xl">
        {/* Circular Play / Pause Button with Cyan Glow */}
        <button
          type="button"
          onClick={togglePlay}
          disabled={route.length < 2}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-slate-950 font-bold hover:bg-cyan-300 disabled:opacity-40 transition cursor-pointer"
          aria-label={playing ? "Pause route playback" : "Play route"}
          title={
            playing
              ? "Pause playback"
              : route.length < 2
                ? "No historical route fixes available"
                : "Play route based on date and time"
          }
        >
          {loadingTrack ? (
            <Loader2 size={18} className="animate-spin text-slate-950" />
          ) : playing ? (
            <Pause size={17} fill="currentColor" />
          ) : progress >= 1 ? (
            <RotateCcw size={17} />
          ) : (
            <Play size={17} fill="currentColor" className="ml-0.5" />
          )}
        </button>

        {/* Reset / Rewind Icon */}
        <button
          type="button"
          onClick={() => seek(0)}
          className="p-1.5 text-zinc-400 hover:text-cyan-300 transition cursor-pointer"
          title="Reset to beginning of route"
        >
          <Repeat size={17} />
        </button>

        {/* Speed multiplier toggle button */}
        <button
          type="button"
          onClick={cycleSpeed}
          className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-zinc-300 hover:text-white font-mono text-[11px] font-bold transition cursor-pointer"
          title={`Cycle playback speed (current: ${playbackSpeed}x)`}
        >
          <Gauge size={14} className="text-cyan-400" />
          <span>{playbackSpeed}x</span>
        </button>

        {/* Center Map on Vessel Icon */}
        <button
          type="button"
          onClick={() => emitPosition(progressRef.current)}
          className="p-1.5 text-zinc-400 hover:text-cyan-300 transition cursor-pointer"
          title="Center on moving vessel position"
        >
          <Crosshair size={17} />
        </button>

        {/* Center Section: UTC Timestamp readout & Interactive Range Slider */}
        <div className="relative flex-1 flex flex-col justify-center min-w-[220px] px-1">
          <div className="flex items-center justify-between text-[11px] font-mono select-text">
            <span className="font-extrabold tracking-wide text-cyan-300 truncate">
              {displayUtcTime}
            </span>
            <span className="text-[10px] text-zinc-400">
              {Math.round(progress * 100)}%
            </span>
          </div>

          {/* Timeline range slider */}
          <input
            aria-label="Seek through vessel historical track"
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={progress}
            disabled={route.length < 2}
            onChange={(event) => seek(Number(event.target.value))}
            className="ship-route-range h-1.5 w-full cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 mt-1"
            style={{
              background: `linear-gradient(to right, #00e5ff 0%, #00e5ff ${progress * 100}%, rgba(255,255,255,0.15) ${progress * 100}%, rgba(255,255,255,0.15) 100%)`,
            }}
          />
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-full transition cursor-pointer"
          aria-label="Close route telemetry"
          title="Close route telemetry"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Dark Telemetry Stats Badges Row (Below Playback Bar) ── */}
      <div className="mt-2 flex items-center justify-center gap-2 flex-wrap font-mono text-[11px] text-zinc-200">
        {/* Vessel Name & Category */}
        <div className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-[#070e17]/90 px-3 py-1 backdrop-blur-md">
          <Activity size={12} className="text-cyan-400" />
          <span className="font-bold text-white tracking-wide truncate max-w-[130px]">
            {shipName}
          </span>
          <span className="text-[9px] text-zinc-400">({vesselType})</span>
        </div>

        {/* Real-time Interpolated Coordinates */}
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#070e17]/90 px-3 py-1 backdrop-blur-md">
          <MapPin size={12} className="text-rose-400" />
          <span className="text-zinc-300">
            {currentLat.toFixed(4)}°, {currentLng.toFixed(4)}°
          </span>
        </div>

        {/* Speed */}
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#070e17]/90 px-3 py-1 backdrop-blur-md">
          <Navigation size={12} className="text-emerald-400" />
          <span className="font-bold text-emerald-300">{currentSpeed} kn</span>
        </div>

        {/* Heading */}
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#070e17]/90 px-3 py-1 backdrop-blur-md">
          <Compass size={12} className="text-amber-400" />
          <span className="font-bold text-amber-300">{currentHeading}°</span>
        </div>

        {/* Fixes Count */}
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#070e17]/90 px-3 py-1 backdrop-blur-md">
          <Clock size={12} className="text-sky-400" />
          <span className="text-zinc-400">
            {route.length}{" "}
            <span className="text-[9px] text-zinc-500 uppercase">fixes</span>
          </span>
        </div>
      </div>
    </section>
  );
}
