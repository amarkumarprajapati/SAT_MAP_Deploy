"use client";

import { useMemo } from "react";
import {
  Ship,
  X,
  Radio,
  MapPin,
  ShieldAlert,
  Fuel,
  Box,
} from "lucide-react";
import { calculateVoyageDetails, VoyageDetails } from "@/lib/maritime-route";
import { vesselSizeClass } from "@/lib/vessel-size";

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
  const sizeClass = vesselSizeClass(ship).replace("_", " ").toUpperCase();
  const sizeSource = String(ship.sizeSource || "");

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
            <div className="mt-0.5 truncate font-mono text-[8px] text-amber-300" title={sizeSource === "ais_type_estimate" ? "Estimated from AIS vessel type because dimensions are unavailable" : "Classified by AIS vessel dimensions when reported"}>
              {sizeClass} SIZE{sizeSource === "ais_type_estimate" ? " · TYPE ESTIMATE" : " · AIS"}
            </div>
            {/^\d{9}$/.test(mmsi) && (
              <a
                className="mt-1 inline-block font-mono text-[8px] text-cyan-300 underline underline-offset-2 hover:text-cyan-100"
                href="https://www.navcen.uscg.gov/ais-vivs-home"
                target="_blank"
                rel="noreferrer"
                title="Manually search this MMSI in the US Coast Guard vessel verification service"
              >
                Check USCG VIVS (US coverage)
              </a>
            )}
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
