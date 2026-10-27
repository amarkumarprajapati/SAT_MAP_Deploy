"use client";

import React, { useMemo } from "react";
import {
  Ship,
  X,
  Compass,
  Radio,
  MapPin,
  ArrowRight,
  ShieldAlert,
  Fuel,
  Box,
} from "lucide-react";
import { calculateVoyageDetails, VoyageDetails } from "@/lib/maritime-route";

interface ShipDetailPanelProps {
  ship: Record<string, unknown>;
  onClose: () => void;
  position: { x: number; y: number };
}

export default function ShipDetailPanel({
  ship,
  onClose,
  position,
}: ShipDetailPanelProps) {
  const voyage: VoyageDetails = useMemo(
    () => calculateVoyageDetails(ship),
    [ship],
  );

  const shipName = String(ship.name || "Unidentified Vessel").toUpperCase();
  const mmsi = String(ship.mmsi || ship.id || "—");

  // Accent color by vessel classification
  const accentColor =
    voyage.vesselCategory === "military"
      ? "#ff1744"
      : voyage.vesselCategory === "tanker"
        ? "#ff9500"
        : "#00e5ff";

  const reportedNumber = (...values: unknown[]) => {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return null;
  };
  const draught = reportedNumber(ship.draught, ship.draft);
  const length = reportedNumber(ship.length, ship.dimensionA);
  const width = reportedNumber(ship.width, ship.dimensionB);
  const dimensions =
    length && width ? `${length}m × ${width}m` : "Not reported";
  const hasDestination = Boolean(String(ship.destination || "").trim());
  const firstSeenAt = Number(ship.trackStartAt ?? ship.firstSeenAt);
  const firstSeenLabel =
    Number.isFinite(firstSeenAt) && firstSeenAt > 0
      ? new Date(firstSeenAt < 1e12 ? firstSeenAt * 1000 : firstSeenAt)
          .toISOString()
          .replace("T", " ")
          .slice(0, 16)
      : "Not reported";

  return (
    <aside
      className="fixed z-180 w-[min(300px,calc(100vw-1rem))] max-h-[min(70vh,460px)] overflow-y-auto rounded-xl border border-cyan-500/30 bg-[#07101df5] text-white backdrop-blur-2xl font-sans select-none scrollbar-thin scrollbar-thumb-white/10"
      style={{
        left: position.x,
        top: position.y,
        transform:
          position.y > 360
            ? "translate(-50%, calc(-100% - 12px))"
            : "translate(-50%, 12px)",
      }}
      aria-label="Vessel Profile Details"
    >
      {/* ── Top Header Banner with Vessel Visual & Tactical HUD ── */}
      <div className="relative h-24 overflow-hidden border-b border-white/10 bg-gradient-to-b from-[#0a1829] to-[#060e18]">
        {/* Scanline & Tactical Grid Overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0, 229, 255, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 229, 255, 0.15) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07101d] via-[#07101d]/60 to-transparent" />

        {/* Category Pill & Flag Badge */}
        <div className="absolute left-2.5 top-2.5 flex items-center gap-1 z-10">
          <span
            className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider backdrop-blur-md"
            style={{
              borderColor: `${accentColor}70`,
              backgroundColor: `${accentColor}25`,
              color: accentColor,
            }}
          >
            {voyage.vesselCategory === "tanker" ? (
              <Fuel size={9} />
            ) : voyage.vesselCategory === "military" ? (
              <ShieldAlert size={9} />
            ) : (
              <Box size={9} />
            )}
            {voyage.vesselCategory} vessel
          </span>
          <span className="flex items-center gap-1 rounded-full border border-white/15 bg-black/60 px-1.5 py-0.5 text-[9px] text-zinc-200">
            <span>{voyage.flagEmoji}</span>
            <span className="font-mono text-[8px] uppercase tracking-wider text-zinc-300">
              {voyage.countryCode}
            </span>
          </span>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close vessel details"
          className="absolute right-2.5 top-2.5 z-10 rounded-md border border-white/15 bg-black/60 p-1 text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X size={13} />
        </button>

        {/* Vessel Header Title & Telemetry Stamp */}
        <div className="absolute bottom-2 left-3 right-3 z-10">
          <div className="flex items-center justify-between">
            <h2
              className="truncate text-base font-bold tracking-wide text-white "
              title={shipName}
            >
              {shipName}
            </h2>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-zinc-300">
            <span className="font-medium text-cyan-300 truncate max-w-[170px]">
              {voyage.vesselTypeName}
            </span>
            <span className="text-zinc-600">·</span>
            <span className="font-mono text-[9px] text-zinc-400">
              MMSI {mmsi}
            </span>
          </div>
        </div>
      </div>

      {/* ── Content Body ── */}
      <div className="p-2.5 space-y-2.5">
        {/* ── MarineTraffic Inspired Route & Voyage Card ── */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 ">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[8px] font-mono uppercase tracking-[0.15em] font-bold text-cyan-400 flex items-center gap-1">
              <Compass size={10} />
              VOYAGE & ROUTE TELEMETRY
            </span>
            <span className="text-[8px] font-mono text-zinc-500">
              AIS / ESTIMATE
            </span>
          </div>

          {/* Departure vs Destination Ports */}
          <div className="grid grid-cols-2 gap-2">
            {/* Start / Departure Port */}
            <div className="min-w-0 pr-1">
              <div className="flex items-center gap-1 text-[7.5px] uppercase tracking-wider text-emerald-400 font-bold">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                DEPARTURE / START
              </div>
              <div
                className="mt-0.5 truncate font-bold text-xs text-white"
                title={voyage.startName}
              >
                {typeof ship.trackStartLat === "number" ||
                typeof ship.firstSeenLat === "number"
                  ? voyage.startName
                  : "First observed position"}
              </div>
              <div className="mt-0.5 text-[9px] font-mono text-zinc-400">
                <span className="text-zinc-500">First seen:</span>{" "}
                {firstSeenLabel}
              </div>
            </div>

            {/* End / Destination Port */}
            <div className="min-w-0 text-right pl-1">
              <div className="flex items-center justify-end gap-1 text-[7.5px] uppercase tracking-wider text-amber-400 font-bold">
                DESTINATION / END
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              </div>
              <div
                className="mt-0.5 truncate font-bold text-xs text-amber-300 font-mono"
                title={voyage.endName}
              >
                {hasDestination
                  ? String(ship.destination).trim()
                  : "Not reported"}
              </div>
              <div className="mt-0.5 text-[9px] font-mono text-zinc-400">
                {hasDestination ? (
                  <>
                    <span className="text-zinc-500">ETA:</span> {voyage.etaTime}
                  </>
                ) : (
                  "ETA unavailable"
                )}
              </div>
            </div>
          </div>

          {/* Route Progress Line with Directional Ship Arrow (MarineTraffic Style) */}
          {hasDestination && (
            <div className="mt-2.5 relative px-1">
              <div className="h-1 w-full bg-white/10 rounded-full relative overflow-visible">
                {/* Completed track */}
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-amber-400 rounded-full"
                  style={{ width: `${voyage.progressPercent}%` }}
                />

                {/* Start Dot */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-emerald-400 border border-[#07101d]" />

                {/* End Dot */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-2 h-2 rounded-full bg-amber-400 border border-[#07101d]" />

                {/* Moving Directional Arrow Marker */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-500 flex items-center justify-center"
                  style={{ left: `${voyage.progressPercent}%` }}
                >
                  <div className="relative">
                    <div className="w-4 h-4 rounded-full bg-cyan-400 text-[#07101d] flex items-center justify-center font-bold animate-pulse">
                      <ArrowRight size={9} strokeWidth={3} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Distance Summary */}
              <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-zinc-400">
                <span className="text-emerald-300">
                  {voyage.distanceCoveredKm.toFixed(0)} km (
                  {voyage.progressPercent}%)
                </span>
                <span className="text-amber-300">
                  {voyage.distanceRemainingKm.toFixed(0)} km left
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Marine Telemetry Specifications (MarineTraffic 3-Column Table) ── */}
        <div className="grid grid-cols-3 gap-1.5">
          {/* 1. Navigational Status */}
          <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2 flex flex-col justify-between">
            <span className="text-[7.5px] uppercase tracking-wider text-zinc-500 font-semibold truncate">
              Nav Status
            </span>
            <div className="mt-1 flex items-center gap-1">
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  voyage.isMoving
                    ? "animate-pulse bg-emerald-400"
                    : "bg-sky-400"
                }`}
              />
              <span className="font-semibold text-[10px] text-zinc-200 leading-tight truncate">
                {voyage.navStatus}
              </span>
            </div>
          </div>

          {/* 2. Speed / Course */}
          <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2 flex flex-col justify-between">
            <span className="text-[7.5px] uppercase tracking-wider text-zinc-500 font-semibold truncate">
              Speed / Course
            </span>
            <div className="mt-1">
              <span className="font-mono text-xs font-bold text-cyan-300">
                {voyage.speedKnots}{" "}
                <small className="text-[8px] font-normal text-zinc-400">
                  kn
                </small>
              </span>
              <span className="text-zinc-500 mx-0.5">/</span>
              <span className="font-mono text-[11px] text-zinc-300">
                {voyage.headingDeg}°
              </span>
            </div>
          </div>

          {/* 3. Draught */}
          <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2 flex flex-col justify-between">
            <span className="text-[7.5px] uppercase tracking-wider text-zinc-500 font-semibold truncate">
              Draught
            </span>
            <div className="mt-1 font-mono text-xs font-bold text-amber-300">
              {draught ?? "—"}{" "}
              <small className="text-[8px] font-normal text-zinc-400">m</small>
            </div>
          </div>
        </div>

        {/* ── Precision Coordinates & Vessel Specs ── */}
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
            <div className="flex items-center gap-1 text-[8px] text-zinc-500 uppercase font-mono">
              <MapPin size={10} className="text-cyan-400" />
              <span>Position</span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] font-semibold text-zinc-200">
              {voyage.currLat.toFixed(3)}°, {voyage.currLng.toFixed(3)}°
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
            <div className="flex items-center gap-1 text-[8px] text-zinc-500 uppercase font-mono">
              <Ship size={10} className="text-amber-400" />
              <span>Dimensions</span>
            </div>
            <div
              className="mt-0.5 font-mono text-[10px] font-semibold text-zinc-200 truncate"
              title={dimensions}
            >
              {dimensions}
            </div>
          </div>
        </div>

        {/* ── Footer / AIS Source Telemetry ── */}
        <div className="pt-1.5 border-t border-white/10 flex items-center justify-between text-[9px] text-zinc-500">
          <span className="flex items-center gap-1">
            <Radio size={10} className="text-emerald-400 animate-pulse" />
            <span>AIS Live feed</span>
          </span>
          <span className="font-mono text-zinc-400">
            {voyage.updatedAgoStr}
          </span>
        </div>
      </div>
    </aside>
  );
}
