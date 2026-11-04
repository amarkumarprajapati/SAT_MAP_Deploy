"use client";

import { useEffect, useMemo, useState } from "react";
import { Anchor, Clock3, MapPin, Route, Ship, X } from "lucide-react";
import { api } from "@/config/api";

type VesselRecord = Record<string, unknown> & {
  track?: Array<Record<string, unknown>>;
};

function displayValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "")
    return "Not reported";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  if (/timestamp|seenat$/i.test(key)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const date = new Date(
        numeric < 10_000_000_000 ? numeric * 1000 : numeric,
      );
      if (!Number.isNaN(date.valueOf())) return date.toLocaleString();
    }
  }
  return String(value);
}

function labelFor(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function VesselFullDetailsPanel({
  ship,
  onClose,
}: {
  ship: Record<string, unknown>;
  onClose: () => void;
}) {
  const mmsi = String(ship.mmsi ?? ship.id ?? "");
  const [result, setResult] = useState<{
    mmsi: string;
    data: VesselRecord | null;
    loading: boolean;
    error: string | null;
  }>({ mmsi: "", data: null, loading: true, error: null });

  useEffect(() => {
    if (!mmsi) {
      setResult({
        mmsi,
        data: null,
        loading: false,
        error: "No MMSI is available for this vessel.",
      });
      return;
    }
    const controller = new AbortController();
    setResult({ mmsi, data: null, loading: true, error: null });
    fetch(api.maritimeShip(mmsi), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "No backend AIS record was found for this vessel."
              : `Vessel details request failed (${response.status}).`,
          );
        return response.json() as Promise<VesselRecord>;
      })
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ mmsi, data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            mmsi,
            data: null,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not load vessel details.",
          });
      });
    return () => controller.abort();
  }, [mmsi]);

  const data = result.mmsi === mmsi ? result.data : null;
  const loading = result.mmsi !== mmsi || result.loading;
  const error = result.mmsi === mmsi ? result.error : null;
  const route = Array.isArray(data?.track) ? data.track : [];
  const rows = useMemo(
    () =>
      Object.entries(data ?? {}).filter(
        ([key, value]) =>
          key !== "track" &&
          value !== null &&
          value !== undefined &&
          value !== "",
      ),
    [data],
  );
  const currentName = String(data?.name ?? ship.name ?? "Unidentified Vessel");
  const lat = Number(data?.lat ?? ship.lat);
  const lng = Number(data?.lng ?? ship.lng);
  const distance = Number(data?.trackDistanceKm ?? ship.trackDistanceKm ?? 0);

  return (
    <aside
      className="pointer-events-auto fixed right-3 top-[76px] bottom-[36px] z-[250] flex w-[370px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-cyan-400/30 bg-[#07101df5] text-white backdrop-blur-2xl"
      aria-label="Full vessel details"
    >
      <header className="flex items-start justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-cyan-950/50 to-transparent p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-2 text-cyan-300">
            <Ship size={16} />
          </span>
          <div className="min-w-0">
            <div className="font-mono text-[8px] font-bold tracking-[.18em] text-cyan-300">
              VESSEL DATA · BACKEND AIS
            </div>
            <h2
              className="mt-1 truncate text-sm font-bold tracking-wide"
              title={currentName}
            >
              {currentName}
            </h2>
            <div className="mt-0.5 font-mono text-[9px] text-zinc-400">
              MMSI {mmsi || "Not reported"}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide vessel details"
          title="Hide vessel details"
          className="rounded-md border border-white/15 bg-black/30 p-1.5 text-zinc-400 hover:border-rose-400/40 hover:text-rose-300"
        >
          <X size={15} />
        </button>
      </header>

      <div className="grid grid-cols-2 gap-1.5 border-b border-white/10 p-2.5">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-zinc-500">
            <MapPin size={10} className="text-cyan-300" /> Current position
          </div>
          <div className="mt-1 font-mono text-[10px] text-zinc-100">
            {Number.isFinite(lat) ? lat.toFixed(5) : "—"}°,{" "}
            {Number.isFinite(lng) ? lng.toFixed(5) : "—"}°
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-zinc-500">
            <Anchor size={10} className="text-cyan-300" /> Speed / course
          </div>
          <div className="mt-1 font-mono text-[10px] text-zinc-100">
            {displayValue("speed", data?.speed ?? ship.speed)} kn /{" "}
            {displayValue("heading", data?.heading ?? ship.heading)}°
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-zinc-500">
            <Route size={10} className="text-emerald-300" /> Route distance
          </div>
          <div className="mt-1 font-mono text-[10px] text-zinc-100">
            {Number.isFinite(distance) ? distance.toFixed(1) : "0.0"} km
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-zinc-500">
            <Clock3 size={10} className="text-amber-300" /> Route fixes
          </div>
          <div className="mt-1 font-mono text-[10px] text-zinc-100">
            {route.length.toLocaleString()} loaded ·{" "}
            {displayValue(
              "trackPointCount",
              data?.trackPointCount ?? ship.trackPointCount,
            )}{" "}
            total
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {loading ? (
          <div className="py-8 text-center font-mono text-[10px] text-zinc-500">
            LOADING BACKEND AIS DETAILS…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] text-amber-200">
            {error}
          </div>
        ) : (
          <>
            <div className="mb-2 font-mono text-[8px] font-bold tracking-[.16em] text-cyan-300">
              ALL AVAILABLE AIS FIELDS · {rows.length}
            </div>
            <dl className="space-y-1">
              {rows.map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5"
                >
                  <dt className="break-words text-[9px] text-zinc-500">
                    {labelFor(key)}
                  </dt>
                  <dd className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-right font-mono text-[9px] text-zinc-200">
                    {displayValue(key, value)}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mb-2 mt-4 font-mono text-[8px] font-bold tracking-[.16em] text-cyan-300">
              RECENT TRACK HISTORY · {route.length}
            </div>
            {route.length ? (
              <div className="space-y-1">
                {route
                  .slice(-12)
                  .reverse()
                  .map((point, index) => (
                    <div
                      key={`${String(point.timestamp ?? index)}-${index}`}
                      className="grid grid-cols-[1fr_auto] gap-2 rounded-md bg-white/[0.025] px-2 py-1.5 font-mono text-[8px] text-zinc-300"
                    >
                      <span>
                        {Number(point.lat).toFixed(4)}°,{" "}
                        {Number(point.lng).toFixed(4)}° ·{" "}
                        {displayValue("speed", point.speed)} kn
                      </span>
                      <span className="text-zinc-500">
                        {displayValue("timestamp", point.timestamp)}
                      </span>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="text-[9px] text-zinc-500">
                No persisted route fixes are available yet.
              </div>
            )}
          </>
        )}
      </div>
      <footer className="border-t border-white/10 px-3 py-2 font-mono text-[8px] text-zinc-500">
        Source: {String(data?.dataSource ?? "AIS live selection")} · refreshed
        on vessel selection
      </footer>
    </aside>
  );
}
