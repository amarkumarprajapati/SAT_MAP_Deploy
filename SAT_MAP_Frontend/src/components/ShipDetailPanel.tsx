"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Radio, Route, Info, Flame } from "lucide-react";
import { calculateVoyageDetails, VoyageDetails } from "@/lib/maritime-route";
import { api } from "@/config/api";
import type {
  VesselWikiInfo,
  ShipGeneralInfo,
  ShipDetailPanelProps,
} from "@/helper";

function formatAisDateTime(val: unknown): string {
  if (!val) return "—";
  let ms: number | null = null;
  const num = Number(val);
  if (Number.isFinite(num) && num > 0) {
    ms = num < 10_000_000_000 ? num * 1000 : num;
  } else if (typeof val === "string") {
    const parsed = Date.parse(val);
    if (Number.isFinite(parsed)) ms = parsed;
  }
  if (!ms) return String(val);
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export default function ShipDetailPanel({
  ship,
  onClose,
  position,
  onOpenRouteTelemetry,
  onOpenFullDetails,
}: ShipDetailPanelProps) {
  const voyage: VoyageDetails = useMemo(
    () => calculateVoyageDetails(ship),
    [ship],
  );

  const mmsi = String(ship.mmsi || ship.id || "");
  const rawShipName = String(ship.name || "").trim();

  // Store details mapped by vessel key to derive loading purely without synchronous setState in effect
  const vesselKey = `${mmsi}_${rawShipName}`;
  const [loadedVesselKey, setLoadedVesselKey] = useState<string | null>(null);
  const [generalData, setGeneralData] = useState<ShipGeneralInfo | null>(null);
  const [wiki, setWiki] = useState<VesselWikiInfo | null>(null);

  // Derive loading status: true if current vessel's data has not loaded yet
  const loading = loadedVesselKey !== vesselKey;

  useEffect(() => {
    let isSubscribed = true;
    const controller = new AbortController();
    const fetchPromises = [];

    // 1. Fetch general vessel metadata from backend endpoint
    if (mmsi) {
      fetchPromises.push(
        fetch(api.maritimeShipGeneral(mmsi), { signal: controller.signal })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      );
    } else {
      fetchPromises.push(Promise.resolve(null));
    }

    // 2. Fetch Wikipedia vessel info (real image & article extract)
    if (rawShipName) {
      fetchPromises.push(
        fetch(api.vesselInfo(rawShipName), { signal: controller.signal })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      );
    } else {
      fetchPromises.push(Promise.resolve(null));
    }

    Promise.all(fetchPromises).then(([gen, wk]) => {
      if (!isSubscribed) return;
      setGeneralData(gen);
      setWiki(wk);
      setLoadedVesselKey(vesselKey);
    });

    return () => {
      isSubscribed = false;
      controller.abort();
    };
  }, [vesselKey, mmsi, rawShipName]);

  const shipName = String(
    generalData?.name || ship.name || "Unidentified Vessel",
  ).toUpperCase();
  const subType =
    generalData?.subtype ||
    (voyage.vesselCategory === "tanker"
      ? "Chemical Tanker"
      : voyage.vesselCategory === "military"
        ? "Naval Vessel"
        : "Container Ship");

  // Country Flag Emoji, Code and Full Country Name
  const countryCode = (
    generalData?.countryCode ||
    voyage.countryCode ||
    (typeof ship.flag === "string" && ship.flag.length === 2 ? ship.flag : "IN")
  ).toUpperCase();
  const countryName = generalData?.country || voyage.countryName || null;
  const countryFlag = voyage.flagEmoji || "🌐";

  // Vessel Photo (only real photo if returned, no hardcoded placeholder images)
  const vesselPhotoUrl = generalData?.photoUrl || wiki?.thumbnailUrl || null;
  const photoAuthor =
    generalData?.photoAuthor ||
    (wiki?.found ? "Wikimedia Commons" : "MarineTraffic contributor");

  // ATD & ETA display
  const atdRaw = generalData?.atd || ship.firstSeenAt || ship.trackStartAt;
  const atdDisplay = atdRaw ? formatAisDateTime(atdRaw) : "—";
  const etaRaw = generalData?.eta || ship.eta;
  const etaDisplay = etaRaw ? formatAisDateTime(etaRaw) : "—";

  // Clean port names and check if real data exists
  const rawDeparture =
    generalData?.departurePort ||
    (typeof ship.origin === "string" ? ship.origin : "");
  const rawDestination =
    generalData?.destinationPort ||
    (typeof ship.destination === "string" ? ship.destination : "");

  const originPort = useMemo(() => {
    if (!rawDeparture) return null;
    const trimmed = rawDeparture.trim();
    if (
      !trimmed ||
      /^port\s*of(\s*departure)?$/i.test(trimmed) ||
      /^unknown$/i.test(trimmed) ||
      trimmed === "-"
    ) {
      return null;
    }
    return trimmed;
  }, [rawDeparture]);

  const destPort = useMemo(() => {
    if (!rawDestination) return null;
    const trimmed = rawDestination.trim();
    if (!trimmed || /^unknown$/i.test(trimmed) || trimmed === "-") {
      return null;
    }
    return trimmed;
  }, [rawDestination]);

  // Draught & Speed/Course
  const rawDraught = ship.draught ?? ship.draft;
  const draughtVal =
    rawDraught != null && Number(rawDraught) > 0
      ? `${Number(rawDraught).toFixed(1)}m`
      : null;
  const speedKn =
    voyage.speedKnots != null ? Number(voyage.speedKnots).toFixed(1) : "0.0";
  const courseDeg = voyage.headingDeg ?? "0";

  return (
    <aside
      className="fixed z-180 w-[min(330px,calc(100vw-1rem))] overflow-hidden rounded-xl border border-cyan-500/30 bg-[#09131f] text-zinc-100  font-sans select-none backdrop-blur-xl"
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
      {/* ── Top Header Bar (Dark Tactical Theme) ── */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#070e17] px-2.5 py-2 text-zinc-100">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-base select-none shrink-0 leading-none"
            title={countryName ? `${countryName} (${countryCode})` : countryCode}
          >
            {countryFlag}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[9.5px] font-mono px-1 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/30 text-cyan-300 font-bold shrink-0">
                {countryCode}
              </span>
              <h2
                className="truncate text-[13px] font-bold tracking-tight text-white drop-shadow"
                title={shipName}
              >
                {shipName}
              </h2>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-medium truncate mt-0.5">
              <span>{subType}</span>
              {countryName && countryName !== "International Registry" && (
                <>
                  <span className="text-zinc-600">•</span>
                  <span className="text-zinc-300 truncate">{countryName}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 text-zinc-400 ml-1">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close vessel details"
            className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* ── Shimmer Skeleton Placeholder or Real Content ── */}
      {loading ? (
        <div className="animate-pulse p-3 space-y-3 bg-[#09131f]">
          <div className="h-40 w-full rounded-lg bg-white/5" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-8 rounded bg-white/5" />
            <div className="h-8 rounded bg-white/5" />
          </div>
          <div className="h-10 rounded bg-white/[0.03]" />
          <div className="h-6 rounded bg-white/5" />
          <div className="grid grid-cols-3 gap-2">
            <div className="h-12 rounded bg-white/[0.03]" />
            <div className="h-12 rounded bg-white/[0.03]" />
            <div className="h-12 rounded bg-white/[0.03]" />
          </div>
        </div>
      ) : (
        <div>
          {/* ── Real Vessel Photo (if available) with marinetraffic attribution ── */}
          {vesselPhotoUrl ? (
            <div className="relative h-44 w-full overflow-hidden bg-slate-950">
              <img
                src={vesselPhotoUrl}
                alt={shipName}
                className="h-full w-full object-cover object-center brightness-90"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09131f] via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-1.5 left-2.5 z-10 text-white drop-shadow">
                <div className="text-[11px] font-extrabold tracking-tight text-white">
                  marinetraffic
                </div>
                <div className="text-[8.5px] text-zinc-300 font-normal">
                  © {photoAuthor}
                </div>
              </div>
            </div>
          ) : (
            <div className="relative h-20 w-full bg-gradient-to-r from-[#070e17] via-[#0d1b2a] to-[#070e17] p-2.5 flex items-center justify-between text-white border-b border-white/5">
              <div>
                <span className="text-[9px] font-mono tracking-wider text-cyan-400 uppercase font-semibold">
                  AIS LIVE MONITORED
                </span>
                <div className="text-xs font-bold text-zinc-100 mt-0.5">
                  MMSI {mmsi}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-mono text-zinc-400">
                  {voyage.updatedAgoStr}
                </span>
              </div>
            </div>
          )}

          {/* ── Sub-header Actions: Vessel Details Button ── */}
          <div className="flex items-center gap-2 p-2.5 border-b border-white/10 bg-[#0b1624]">
            <button
              type="button"
              onClick={() => onOpenFullDetails?.(ship)}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 py-1.5 px-3 text-center text-xs font-bold text-white transition cursor-pointer active:scale-[0.98]"
              title="Open full technical dossier on the right side"
            >
              <span>Vessel details</span>
            </button>
          </div>

          {/* ── Route Telemetry Progress Bar Section (Dark Theme) ── */}
          <div className="p-3 bg-[#09131f] space-y-2 border-b border-white/10">
            {/* Origin & Destination Ports */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col min-w-0 max-w-[48%]">
                <span className="text-[9px] uppercase tracking-wider font-semibold text-zinc-400">
                  Departure
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  {originPort ? (
                    <span
                      className="text-xs font-bold text-white truncate"
                      title={originPort}
                    >
                      {originPort}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-zinc-400">
                      At Sea
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end text-right min-w-0 max-w-[48%]">
                <span className="text-[9px] uppercase tracking-wider font-semibold text-zinc-400">
                  Destination
                </span>
                <div className="flex items-baseline justify-end gap-1 mt-0.5">
                  {destPort ? (
                    <span
                      className="text-xs font-bold text-white truncate"
                      title={destPort}
                    >
                      {destPort}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-zinc-400">
                      Undisclosed
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ATD & Reported ETA timestamps - 2-Column Grid eliminating text overlap */}
            <div className="grid grid-cols-2 gap-2 text-[10px] pt-1">
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] uppercase tracking-wider font-semibold text-zinc-400">
                  ATD
                </span>
                <span
                  className="text-zinc-300 font-mono text-[10px] truncate mt-0.5"
                  title={atdDisplay}
                >
                  {atdDisplay}
                </span>
              </div>
              <div className="flex flex-col items-end text-right min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-zinc-400">
                    Reported ETA
                  </span>
                  <Info size={10} className="text-zinc-500 shrink-0" />
                </div>
                <span
                  className="text-zinc-300 font-mono text-[10px] truncate mt-0.5"
                  title={etaDisplay}
                >
                  {etaDisplay}
                </span>
              </div>
            </div>

            {/* MarineTraffic Route Slider Graphic */}
            <div className="relative flex items-center py-2">
              <div className="relative flex-1 flex items-center">
                {/* Start circle dot */}
                <div className="h-2 w-2 rounded-full bg-cyan-400 shrink-0 shadow-[0_0_8px_rgba(0,229,255,0.6)]" />
                {/* Active blue track */}
                <div className="h-[2.5px] w-1/2 bg-cyan-400" />
                {/* Forward pointing arrow head */}
                <div
                  className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[9px] border-l-cyan-300 shrink-0"
                  style={{ transform: "translateX(-2px)" }}
                />
                {/* Remaining track */}
                <div className="h-[2px] flex-1 bg-zinc-700" />
                {/* End circle dot */}
                <div className="h-2 w-2 rounded-full bg-zinc-500 shrink-0" />
              </div>
            </div>

            {/* Action Buttons: Past Track (opens bottom Route Telemetry) & Use Route Tool */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => onOpenRouteTelemetry?.(ship)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-950/60 hover:bg-cyan-900/80 px-2.5 py-1.5 text-xs font-bold text-cyan-200 transition cursor-pointer"
                title="Open historical ship track and playback animation"
              >
                <Route size={13} className="text-cyan-400 shrink-0" />
                <span>Past track</span>
              </button>

              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-1 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 px-2 py-1.5 text-xs font-semibold text-zinc-300 transition cursor-pointer"
              >
                <span>Use route tool</span>
                <Info size={11} className="text-zinc-500" />
              </button>
            </div>
          </div>

          {/* ── 3-Column Specifications Grid ── */}
          <div className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10 bg-[#070e17] p-2.5 text-zinc-200">
            {/* Navigational Status */}
            <div className="pr-1.5">
              <div className="text-[9px] text-zinc-400 font-medium leading-tight">
                Navigational status:
              </div>
              <div className="mt-0.5 text-[10.5px] font-bold text-white leading-tight">
                {voyage.navStatus}
              </div>
            </div>

            {/* Speed / Course */}
            <div className="px-2">
              <div className="text-[9px] text-zinc-400 font-medium leading-tight">
                Speed/Course:
              </div>
              <div className="mt-0.5 text-[11px] font-bold text-cyan-300 font-mono">
                {speedKn}kn / {courseDeg}°
              </div>
            </div>

            {/* Draught */}
            <div className="pl-2">
              <div className="text-[9px] text-zinc-400 font-medium leading-tight">
                Draught:
              </div>
              <div className="mt-0.5 text-[11px] font-bold text-amber-300 font-mono">
                {draughtVal || "—"}
              </div>
            </div>
          </div>

          {/* ── Footer / Received Time Ago & AIS Source ── */}
          <div className="flex items-center justify-between p-2.5 text-[9.5px] text-zinc-400 bg-[#070e17]">
            <div>
              Received:{" "}
              <span className="font-bold text-zinc-200">
                {voyage.updatedAgoStr}
              </span>{" "}
              {/* (AIS source: Roaming) */}
            </div>
            <div className="flex items-center gap-1 font-mono text-[9px] text-emerald-400">
              <Radio size={10} className="animate-pulse" />
              <span>LIVE</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
