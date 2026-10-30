"use client";

import { useEffect, useRef, useState, useCallback, memo } from "react";
import * as maplibregl from "maplibre-gl";
import { installTerrainTileProtocol } from "@/lib/terrain-tiles";
import {
  createSatelliteLayer,
  parseColor,
  type SatPoint,
} from "@/lib/satellite-layer";
import {
  MAP_DEFAULTS,
  MAP_PALETTE_KEYS,
  readMapPalette,
  satColorFor,
  type MapPalette,
} from "@/lib/map-palette";
import { STYLE_EVENT } from "@/lib/style-tokens";
import SatelliteCard, {
  type SatelliteDetail,
} from "@/components/SatelliteCard";
import SatelliteIntelSidebar from "@/components/SatelliteIntelSidebar";
import SatelliteVesselsSlider from "@/components/SatelliteVesselsSlider";
import MapControls from "@/components/MapControls";
import MapPopups, { createHomeMarkerPopup } from "@/components/MapPopups";
import { attachTerrain } from "@/lib/map-terrain";
import { applyMapProjection } from "@/lib/map-projection";
import { SatelliteRow, LTmapProps } from "@/lib/map.types";
import {
  orbitPath,
  orbitalPeriodMinutes,
  propagateTelemetry,
  propagateTLE,
  splitAtAntimeridian,
} from "@/lib/orbit";
import { getSolarTerminator } from "@/lib/solar-terminator";
import { generateFootprintFeatures } from "@/lib/footprint-circle";
import { getLocationTimeInfo, formatTimeInZone } from "@/lib/country-time";
import { api, styleUrl, mapImageryTileUrl } from "@/config/api";
import { X, Play, Pause, FastForward } from "lucide-react";
import ShipDetailPanel from "@/components/ShipDetailPanel";
import { calculateVoyageDetails } from "@/lib/maritime-route";

function SatellitePlaybackBar({
  satellite,
  time,
  playing,
  rate,
  heading,
  onToggle,
  onRateChange,
  onSeek,
  onClose,
}: {
  satellite: SatelliteDetail;
  time: number;
  playing: boolean;
  rate: number;
  heading: number;
  onToggle: () => void;
  onRateChange: (rate: number) => void;
  onSeek: (time: number) => void;
  onClose: () => void;
}) {
  const periodMs = Math.max(60_000, (satellite.periodMinutes ?? 95) * 60_000);

  const [anchor, setAnchor] = useState({
    satId: satellite.noradId,
    centerTime: time,
  });

  const isStale =
    anchor.satId !== satellite.noradId ||
    Math.abs(time - anchor.centerTime) > periodMs;

  if (isStale) {
    setAnchor({
      satId: satellite.noradId,
      centerTime: time,
    });
  }

  const centerTime = isStale ? time : anchor.centerTime;
  const start = centerTime - periodMs / 2;
  const end = centerTime + periodMs / 2;
  const clampedTime = Math.min(end, Math.max(start, time));
  const progressPct =
    periodMs > 0
      ? Math.max(0, Math.min(100, ((clampedTime - start) / periodMs) * 100))
      : 50;

  const dateLabel = new Date(time).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  const hasTle = Boolean(satellite.line1 && satellite.line2);

  return (
    <section
      className="pointer-events-auto fixed bottom-10 left-1/2 z-[230] w-[min(840px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-cyan-500/35 bg-[#060a14]/95 text-white shadow-[0_16px_50px_rgba(0,0,0,0.85),0_0_30px_rgba(0,229,255,0.15)] backdrop-blur-2xl"
      aria-label="Satellite orbital playback controls"
    >
      {/* ── TOP BAR: BALANCED CONTROLS & SATELLITE TELEMETRY ── */}
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-2.5">
        {/* Left: Play/Pause button + Satellite name + Status badge */}
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onToggle}
            disabled={!hasTle}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-slate-950 shadow-[0_0_14px_rgba(0,229,255,0.45)] transition-all hover:bg-cyan-300 hover:shadow-[0_0_18px_rgba(0,229,255,0.6)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            title={
              hasTle
                ? playing
                  ? "Pause playback"
                  : "Play orbital track"
                : "Playback needs orbital elements"
            }
            aria-label={playing ? "Pause playback" : "Play orbital track"}
          >
            {playing ? (
              <Pause size={13} className="fill-slate-950" />
            ) : (
              <Play size={13} className="fill-slate-950 ml-0.5" />
            )}
          </button>

          <div className="flex min-w-0 items-center gap-2">
            <span
              className="truncate font-mono text-xs font-bold tracking-wide text-white"
              title={satellite.name}
            >
              {satellite.name}
            </span>
            <span className="shrink-0 flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-cyan-300">
              <span
                className={`w-1.5 h-1.5 rounded-full ${playing ? "bg-cyan-400 animate-pulse" : "bg-zinc-500"}`}
              />
              <span>
                {playing ? "LIVE PLAYBACK" : "PAUSED"} · {rate}×
              </span>
            </span>
          </div>
        </div>

        {/* Right: Heading telemetry + Speed pills + Skip + Close */}
        <div className="flex shrink-0 items-center gap-2">
          {Number.isFinite(heading) && (
            <div className="hidden font-mono text-[10px] text-zinc-400 sm:flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
              <span className="text-zinc-500 font-medium">HDG</span>
              <span className="text-cyan-300 font-bold">
                {Math.round(heading)}°
              </span>
            </div>
          )}

          <div className="hidden sm:block w-px h-3.5 bg-white/10" />

          {/* Speed Selector Pills */}
          <div className="flex items-center gap-0.5 bg-black/40 p-0.5 rounded-lg border border-white/[0.08]">
            {[1, 10, 60, 300, 900].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onRateChange(value)}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold transition-all cursor-pointer ${
                  rate === value
                    ? "bg-cyan-400 text-slate-950 font-bold shadow-[0_0_8px_rgba(0,229,255,0.4)]"
                    : "text-zinc-400 hover:bg-white/10 hover:text-white"
                }`}
                title={`Playback speed ${value}x`}
              >
                {value}×
              </button>
            ))}
          </div>

          {/* Step forward */}
          <button
            type="button"
            onClick={() => onSeek(time + periodMs / 4)}
            className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] px-1.5 py-1 font-mono text-[9px] text-zinc-300 transition-all hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-200 cursor-pointer"
            title="Skip forward +1/4 orbit"
          >
            <FastForward size={11} />
          </button>

          <div className="w-px h-3.5 bg-white/10" />

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close playback controls"
            className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── BOTTOM SECTION: FULL-WIDTH SCRUBBER & TIMESTAMPS ── */}
      <div className="px-4 pt-2.5 pb-2.5">
        <input
          aria-label="Seek along satellite orbit"
          type="range"
          min={start}
          max={end}
          step={1000}
          value={clampedTime}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none accent-cyan-400 transition-all"
          style={{
            background: `linear-gradient(to right, #00e5ff 0%, #00e5ff ${progressPct}%, rgba(255, 255, 255, 0.12) ${progressPct}%, rgba(255, 255, 255, 0.12) 100%)`,
          }}
        />

        <div className="mt-1.5 flex items-center justify-between font-mono text-[9px] text-zinc-400 tabular-nums">
          <span>{new Date(start).toLocaleTimeString()}</span>
          <span className="font-semibold text-cyan-300 drop-shadow-[0_0_8px_rgba(0,229,255,0.45)]">
            <span className="text-zinc-500 font-normal">MISSION CLOCK · </span>
            {dateLabel}
          </span>
          <span>{new Date(end).toLocaleTimeString()}</span>
        </div>
      </div>

      {!hasTle && (
        <div className="px-4 pb-2 font-mono text-[9px] text-cyan-300/80">
          This satellite has no orbital elements (TLE) for trajectory playback.
        </div>
      )}
    </section>
  );
}

const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };
const DOUBLE_RIGHT_MS = 500;
const DOUBLE_RIGHT_SLOP_PX = 12;

function buildSatelliteHorizonCone(lng: number, lat: number, alt: number) {
  const footprint = generateFootprintFeatures({ lng, lat, alt });
  const boundary = footprint.features.find(
    (feature) => feature.geometry.type === "LineString",
  );
  if (!boundary || boundary.geometry.type !== "LineString") return [];
  const ring = boundary.geometry.coordinates;
  const satellite = { lng, lat, altKm: alt };
  const groundRing = ring.map(([pointLng, pointLat]) => ({
    lng: pointLng,
    lat: pointLat,
    altKm: 0,
  }));
  return [[satellite, ...groundRing, groundRing[0]]];
}

function LTmap({
  data,
  activeLayers,
  onMouseCoords,
  onRightClick,
  onViewStateChange,
  onReady,
  flyToLocation,
  projection = "globe",
  terrainEnabled = false,
  terrainRetry = 0,
  terrainFocus = 0,
  onTerrainStatusChange,
  mapStyle = "dark",
  theme = "core",
  arcgisLayers = [],
  homeLocation,
  onMapCenter,
  showMapControls = false,
  laserView = false,
  onTrackShip,
  onShipSelect,
  liveTrackedShip,
  onCountryClick,
  onSatelliteSelect,
  clearSatelliteTrigger,
  intelOpenTrigger,
  isIntelOpen: isIntelOpenProp,
  onIntelOpenChange,
  onSliderOpenChange,
  areaDrawMode = false,
  areaDrawShape = "rectangle",
  areaPlaybackCommand,
  selectedAnalysisArea,
  onAreaPlaybackUpdate,
  onAreaCapturedSatellites,
  clearAreaTrigger = 0,
  onAreaSelected,
  geospatialVideoFrames = null,
  geospatialVideoFrame = null,
}: LTmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomReadoutRef = useRef<HTMLSpanElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const satPlaybackTimeRef = useRef<number | null>(null);
  const satRowsRef = useRef<SatelliteRow[]>([]);
  const [palette, setPalette] = useState<MapPalette>(MAP_DEFAULTS);
  const paletteRef = useRef<MapPalette>(MAP_DEFAULTS);
  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);
  const onCountryClickRef = useRef(onCountryClick);
  useEffect(() => {
    onCountryClickRef.current = onCountryClick;
  }, [onCountryClick]);
  const [mapReady, setMapReady] = useState(false);
  const areaStartRef = useRef<[number, number] | null>(null);
  const areaDrawModeRef = useRef(areaDrawMode);
  useEffect(() => {
    areaDrawModeRef.current = areaDrawMode;
  }, [areaDrawMode]);
  const areaShapeRef = useRef(areaDrawShape);
  useEffect(() => {
    areaShapeRef.current = areaDrawShape;
    areaStartRef.current = null;
  }, [areaDrawShape]);
  const freehandRef = useRef<[number, number][]>([]);
  const areaPointerDraggedRef = useRef(false);
  const areaPlaybackCallbackRef = useRef(onAreaPlaybackUpdate);
  useEffect(() => {
    areaPlaybackCallbackRef.current = onAreaPlaybackUpdate;
  }, [onAreaPlaybackUpdate]);
  const areaCapturedCallbackRef = useRef(onAreaCapturedSatellites);
  useEffect(() => {
    areaCapturedCallbackRef.current = onAreaCapturedSatellites;
  }, [onAreaCapturedSatellites]);
  const areaPlaybackRunningRef = useRef(false);
  const areaPlaybackCommandRef = useRef(0);
  const areaScanGenerationRef = useRef(0);
  useEffect(() => {
    if (
      !mapReady ||
      !areaPlaybackCommand ||
      areaPlaybackCommand.id === areaPlaybackCommandRef.current
    )
      return;
    areaPlaybackCommandRef.current = areaPlaybackCommand.id;
    if (areaPlaybackCommand.action === "seek") {
      satPlaybackTimeRef.current = areaPlaybackCommand.time ?? Date.now();
      areaPlaybackRunningRef.current = false;
      areaPlaybackCallbackRef.current?.({
        time: satPlaybackTimeRef.current,
        running: false,
        passes: [],
      });
      return;
    }
    if (areaPlaybackCommand.action === "cancel") {
      areaScanGenerationRef.current++;
      areaPlaybackRunningRef.current = false;
      areaPlaybackCallbackRef.current?.({
        time: Date.now(),
        running: false,
        passes: [],
      });
      return;
    }
    if (areaPlaybackCommand.action === "pause") {
      areaPlaybackRunningRef.current = false;
      areaPlaybackCallbackRef.current?.({
        time: satPlaybackTimeRef.current ?? Date.now(),
        running: false,
        passes: [],
      });
      return;
    }
    const hours = areaPlaybackCommand.hours;
    const start =
      areaPlaybackCommand.time ?? satPlaybackTimeRef.current ?? Date.now();
    const windowStart =
      areaPlaybackCommand.windowStart ?? areaPlaybackCommand.time ?? start;
    const end = windowStart + hours * 3_600_000;
    satPlaybackTimeRef.current = start;
    areaPlaybackRunningRef.current = true;
    const scanGeneration = ++areaScanGenerationRef.current;
    const ring = selectedAnalysisArea?.geometry?.coordinates?.[0];
    const contains = (lng: number, lat: number) => {
      if (!selectedAnalysisArea) return false;
      if (!ring?.length)
        return (
          lng >= selectedAnalysisArea.west &&
          lng <= selectedAnalysisArea.east &&
          lat >= selectedAnalysisArea.south &&
          lat <= selectedAnalysisArea.north
        );
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i],
          [xj, yj] = ring[j];
        if (
          yi > lat !== yj > lat &&
          lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
        )
          inside = !inside;
      }
      return inside;
    };
    const rows = satRowsRef.current.filter((row) => row.line1 && row.line2);
    const collected = new Map<
      string,
      {
        name: string;
        category: string;
        firstPass: number;
        lastPass: number;
        passes: number;
        windows: Array<{ start: number; end: number }>;
      }
    >();
    void (async () => {
      for (
        let offset = 0;
        offset < rows.length &&
        scanGeneration === areaScanGenerationRef.current;
        offset += 8
      ) {
        for (const row of rows.slice(offset, offset + 8)) {
          let wasInside = false;
          let record = collected.get(row.noradId ?? row.name);
          for (let t = windowStart; t <= end; t += 120_000) {
            const pos = propagateTLE(row.line1!, row.line2!, new Date(t));
            const inside = Boolean(pos && contains(pos.lng, pos.lat));
            if (inside && !wasInside) {
              record = record ?? {
                name: row.name,
                category: row.category ?? "uncategorized",
                firstPass: t,
                lastPass: t,
                passes: 0,
                windows: [],
              };
              record.passes++;
              record.firstPass = Math.min(record.firstPass, t);
              record.lastPass = t;
              record.windows.push({ start: t, end: t });
            }
            if (inside && record) {
              record.lastPass = t;
              const currentWindow = record.windows[record.windows.length - 1];
              if (currentWindow) currentWindow.end = t;
            }
            wasInside = inside;
          }
          if (record) collected.set(row.noradId ?? row.name, record);
        }
        areaPlaybackCallbackRef.current?.({
          time: satPlaybackTimeRef.current ?? start,
          running: areaPlaybackRunningRef.current,
          passes: [...collected.values()],
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (scanGeneration === areaScanGenerationRef.current)
        areaPlaybackCallbackRef.current?.({
          time: satPlaybackTimeRef.current ?? start,
          running: areaPlaybackRunningRef.current,
          passes: [...collected.values()],
        });
    })();
    const playbackRate = areaPlaybackCommand.rate ?? 1;
    let previous = performance.now();
    let frame = 0;
    let lastReport = 0;
    let playbackRemainder = 0;
    const advance = (now: number) => {
      const elapsed = Math.max(0, now - previous) + playbackRemainder;
      previous = now;
      const stepCount = Math.floor(elapsed / 100);
      playbackRemainder = elapsed - stepCount * 100;
      if (stepCount === 0) {
        frame = requestAnimationFrame(advance);
        return;
      }
      const next = Math.min(
        end,
        (satPlaybackTimeRef.current ?? start) +
          stepCount * 100 * 900 * playbackRate,
      );
      satPlaybackTimeRef.current = next;
      if (now - lastReport > 250) {
        lastReport = now;
        areaPlaybackCallbackRef.current?.({
          time: next,
          running: next < end,
          passes: [...collected.values()],
        });
      }
      if (next >= end) {
        areaPlaybackRunningRef.current = false;
        areaPlaybackCallbackRef.current?.({
          time: end,
          running: false,
          passes: [...collected.values()],
        });
        return;
      }
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [mapReady, areaPlaybackCommand, selectedAnalysisArea]);
  const areaClearRef = useRef(clearAreaTrigger);
  useEffect(() => {
    if (
      !mapReady ||
      !clearAreaTrigger ||
      clearAreaTrigger === areaClearRef.current
    )
      return;
    areaClearRef.current = clearAreaTrigger;
    const source = mapRef.current?.getSource("analysis-area") as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(EMPTY_FC as GeoJSON.FeatureCollection);
    areaStartRef.current = null;
  }, [mapReady, clearAreaTrigger]);
  const areaCallbackRef = useRef(onAreaSelected);
  useEffect(() => {
    areaCallbackRef.current = onAreaSelected;
  }, [onAreaSelected]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    if (!map.getSource("analysis-area")) {
      map.addSource("analysis-area", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "analysis-area-fill",
        type: "fill",
        source: "analysis-area",
        paint: { "fill-color": "#22d3ee", "fill-opacity": 0.14 },
      });
      map.addLayer({
        id: "analysis-area-outline",
        type: "line",
        source: "analysis-area",
        paint: {
          "line-color": "#67e8f9",
          "line-width": 2,
          "line-dasharray": [2, 1],
        },
      });
    }
    const setArea = (
      area: {
        west: number;
        south: number;
        east: number;
        north: number;
        geometry?: GeoJSON.Polygon;
      } | null,
    ) => {
      const source = map.getSource("analysis-area") as maplibregl.GeoJSONSource;
      if (!area) {
        source.setData(EMPTY_FC as GeoJSON.FeatureCollection);
        areaCallbackRef.current?.(null);
        return;
      }
      const { west, south, east, north } = area;
      const geometry = area.geometry ?? {
        type: "Polygon" as const,
        coordinates: [
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        ],
      };
      source.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry }],
      });
      areaCallbackRef.current?.(area);
    };
    const commitPolygon = (points: [number, number][]) => {
      if (points.length < 3) return;
      const ring = [...points, points[0]];
      const geometry: GeoJSON.Polygon = {
        type: "Polygon",
        coordinates: [ring],
      };
      setArea({
        west: Math.min(...points.map((p) => p[0])),
        east: Math.max(...points.map((p) => p[0])),
        south: Math.min(...points.map((p) => p[1])),
        north: Math.max(...points.map((p) => p[1])),
        geometry,
      });
    };
    const onClick = (event: maplibregl.MapMouseEvent) => {
      if (!areaDrawModeRef.current) return;
      if (areaPointerDraggedRef.current) {
        areaPointerDraggedRef.current = false;
        return;
      }
      const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      if (areaShapeRef.current === "freehand") return;
      if (areaShapeRef.current === "polygon") {
        freehandRef.current.push(point);
        return;
      }
      if (!areaStartRef.current) {
        areaStartRef.current = point;
        return;
      }
      const [lng, lat] = areaStartRef.current;
      areaStartRef.current = null;
      const west = Math.min(lng, point[0]),
        east = Math.max(lng, point[0]),
        south = Math.min(lat, point[1]),
        north = Math.max(lat, point[1]);
      if (areaShapeRef.current === "circle") {
        const radius =
          Math.hypot(
            (east - west) * Math.cos(((lat + point[1]) * Math.PI) / 360),
            north - south,
          ) / 2;
        const centerLng = (west + east) / 2,
          centerLat = (south + north) / 2;
        const ring: [number, number][] = Array.from({ length: 65 }, (_, i) => {
          const a = (2 * Math.PI * i) / 64;
          return [
            centerLng +
              (radius * Math.cos(a)) /
                Math.max(0.1, Math.cos((centerLat * Math.PI) / 180)),
            centerLat + radius * Math.sin(a),
          ];
        });
        setArea({
          west,
          south,
          east,
          north,
          geometry: { type: "Polygon", coordinates: [ring] },
        });
      } else setArea({ west, east, south, north });
    };
    const onDoubleClick = (event: maplibregl.MapMouseEvent) => {
      if (!areaDrawModeRef.current || areaShapeRef.current !== "polygon")
        return;
      event.preventDefault();
      const points = freehandRef.current;
      freehandRef.current = [];
      commitPolygon(points);
    };
    const onMouseDown = (event: maplibregl.MapMouseEvent) => {
      if (!areaDrawModeRef.current || areaShapeRef.current === "polygon")
        return;
      event.preventDefault();
      areaPointerDraggedRef.current = false;
      areaStartRef.current = [event.lngLat.lng, event.lngLat.lat];
      freehandRef.current =
        areaShapeRef.current === "freehand"
          ? [[event.lngLat.lng, event.lngLat.lat]]
          : [];
      map.dragPan.disable();
    };
    let lastPointerPoint: [number, number] | null = null;
    const onMouseMove = (event: maplibregl.MapMouseEvent) => {
      if (!areaDrawModeRef.current || !areaStartRef.current) return;
      areaPointerDraggedRef.current = true;
      const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      lastPointerPoint = point;
      if (areaShapeRef.current === "freehand") {
        freehandRef.current.push(point);
        return;
      }
      const [lng, lat] = areaStartRef.current;
      const west = Math.min(lng, point[0]),
        east = Math.max(lng, point[0]),
        south = Math.min(lat, point[1]),
        north = Math.max(lat, point[1]);
      if (areaShapeRef.current === "circle") {
        const radius =
          Math.hypot(
            (east - west) * Math.cos(((lat + point[1]) * Math.PI) / 360),
            north - south,
          ) / 2;
        const centerLng = (west + east) / 2,
          centerLat = (south + north) / 2;
        const ring: [number, number][] = Array.from({ length: 65 }, (_, i) => {
          const a = (2 * Math.PI * i) / 64;
          return [
            centerLng +
              (radius * Math.cos(a)) /
                Math.max(0.1, Math.cos((centerLat * Math.PI) / 180)),
            centerLat + radius * Math.sin(a),
          ];
        });
        const source = map.getSource(
          "analysis-area",
        ) as maplibregl.GeoJSONSource;
        source.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Polygon", coordinates: [ring] },
            },
          ],
        });
      } else {
        const source = map.getSource(
          "analysis-area",
        ) as maplibregl.GeoJSONSource;
        source.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [west, south],
                    [east, south],
                    [east, north],
                    [west, north],
                    [west, south],
                  ],
                ],
              },
            },
          ],
        });
      }
    };
    const onMouseUp = (event: maplibregl.MapMouseEvent) => {
      if (
        !areaStartRef.current ||
        !areaDrawModeRef.current ||
        areaShapeRef.current === "polygon"
      )
        return;
      const end = event?.lngLat
        ? ([event.lngLat.lng, event.lngLat.lat] as [number, number])
        : lastPointerPoint;
      const start = areaStartRef.current;
      areaStartRef.current = null;
      map.dragPan.enable();
      lastPointerPoint = null;
      if (!end) {
        areaPointerDraggedRef.current = false;
        freehandRef.current = [];
        return;
      }
      if (areaShapeRef.current === "freehand") {
        const points = freehandRef.current;
        freehandRef.current = [];
        commitPolygon(points);
      } else if (areaPointerDraggedRef.current) {
        const west = Math.min(start[0], end[0]),
          east = Math.max(start[0], end[0]),
          south = Math.min(start[1], end[1]),
          north = Math.max(start[1], end[1]);
        if (areaShapeRef.current === "circle") {
          const radius =
              Math.hypot(
                (east - west) * Math.cos(((start[1] + end[1]) * Math.PI) / 360),
                north - south,
              ) / 2,
            centerLng = (west + east) / 2,
            centerLat = (south + north) / 2;
          const ring: [number, number][] = Array.from(
            { length: 65 },
            (_, i) => {
              const a = (2 * Math.PI * i) / 64;
              return [
                centerLng +
                  (radius * Math.cos(a)) /
                    Math.max(0.1, Math.cos((centerLat * Math.PI) / 180)),
                centerLat + radius * Math.sin(a),
              ];
            },
          );
          setArea({
            west,
            east,
            south,
            north,
            geometry: { type: "Polygon", coordinates: [ring] },
          });
        } else setArea({ west, east, south, north });
      } else {
        areaPointerDraggedRef.current = false;
      }
    };
    const onCanvasMouseLeave = () => {
      if (
        !areaStartRef.current ||
        !areaDrawModeRef.current ||
        areaShapeRef.current === "polygon"
      )
        return;
      onMouseUp({
        lngLat: lastPointerPoint
          ? { lng: lastPointerPoint[0], lat: lastPointerPoint[1] }
          : undefined,
      } as maplibregl.MapMouseEvent);
    };
    map.on("click", onClick);
    map.on("dblclick", onDoubleClick);
    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    map.getCanvas().addEventListener("mouseleave", onCanvasMouseLeave);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDoubleClick);
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      map.getCanvas().removeEventListener("mouseleave", onCanvasMouseLeave);
      map.dragPan.enable();
    };
  }, [mapReady]);
  useEffect(() => {
    if (!mapReady || !selectedAnalysisArea) return;
    const map = mapRef.current;
    if (!map) return;
    const ring = selectedAnalysisArea.geometry?.coordinates[0];
    const timer = setInterval(() => {
      const captured = satRowsRef.current.filter((row) => {
        if (!ring?.length)
          return (
            row.lng >= selectedAnalysisArea.west &&
            row.lng <= selectedAnalysisArea.east &&
            row.lat >= selectedAnalysisArea.south &&
            row.lat <= selectedAnalysisArea.north
          );
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i],
            [xj, yj] = ring[j];
          if (
            yi > row.lat !== yj > row.lat &&
            row.lng < ((xj - xi) * (row.lat - yi)) / (yj - yi) + xi
          )
            inside = !inside;
        }
        return inside;
      });
      areaCapturedCallbackRef.current?.(captured);
      const passing = captured.length > 0;
      if (map.getLayer("analysis-area-fill"))
        map.setPaintProperty(
          "analysis-area-fill",
          "fill-color",
          passing ? "#fb7185" : "#22d3ee",
        );
      if (map.getLayer("analysis-area-outline"))
        map.setPaintProperty(
          "analysis-area-outline",
          "line-color",
          passing ? "#fda4af" : "#67e8f9",
        );
    }, 500);
    return () => {
      clearInterval(timer);
      if (map.getLayer("analysis-area-fill"))
        map.setPaintProperty("analysis-area-fill", "fill-color", "#22d3ee");
      if (map.getLayer("analysis-area-outline"))
        map.setPaintProperty("analysis-area-outline", "line-color", "#67e8f9");
    };
  }, [mapReady, selectedAnalysisArea]);
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const sourceId = "area-pass-footprints";
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "area-pass-footprint-fill",
        type: "fill",
        source: sourceId,
        filter: ["==", ["get", "kind"], "footprint-fill"],
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: "area-pass-footprint-line",
        type: "line",
        source: sourceId,
        filter: ["==", ["get", "kind"], "footprint-line"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": 0.85,
        },
      });
    }
    if (!selectedAnalysisArea) {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(
        EMPTY_FC as GeoJSON.FeatureCollection,
      );
      return;
    }
    const ring = selectedAnalysisArea.geometry?.coordinates[0];
    const timer = setInterval(() => {
      const features: GeoJSON.Feature[] = [];
      for (const row of satRowsRef.current) {
        if (
          !Number.isFinite(row.lat) ||
          !Number.isFinite(row.lng) ||
          !Number.isFinite(row.alt)
        )
          continue;
        let inside =
          !ring?.length &&
          row.lng >= selectedAnalysisArea.west &&
          row.lng <= selectedAnalysisArea.east &&
          row.lat >= selectedAnalysisArea.south &&
          row.lat <= selectedAnalysisArea.north;
        if (ring?.length) {
          inside = false;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i],
              [xj, yj] = ring[j];
            if (
              yi > row.lat !== yj > row.lat &&
              row.lng < ((xj - xi) * (row.lat - yi)) / (yj - yi) + xi
            )
              inside = !inside;
          }
        }
        if (!inside) continue;
        const color = satColorFor(row.category, row.color, paletteRef.current);
        features.push(
          ...(generateFootprintFeatures(
            { lng: row.lng, lat: row.lat, alt: row.alt, color },
            72,
          ).features as GeoJSON.Feature[]),
        );
      }
      const source = map.getSource(sourceId) as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData({ type: "FeatureCollection", features });
    }, 300);
    return () => clearInterval(timer);
  }, [mapReady, selectedAnalysisArea]);
  const lastTerrainFocus = useRef(terrainFocus);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    if (homeLocation) {
      if (!homeMarkerRef.current) {
        const el = document.createElement("div");
        el.className =
          "w-3 h-3 bg-cyan-400 rounded-full border-2 border-[#06060c] shadow-[0_0_12px_rgba(0,229,255,0.8)] cursor-pointer";

        const popup = createHomeMarkerPopup(homeLocation);

        homeMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([homeLocation.lng, homeLocation.lat])
          .setPopup(popup)
          .addTo(map);
      } else {
        homeMarkerRef.current.setLngLat([homeLocation.lng, homeLocation.lat]);
      }
    } else {
      if (homeMarkerRef.current) {
        homeMarkerRef.current.remove();
        homeMarkerRef.current = null;
      }
    }
  }, [mapReady, homeLocation]);

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const onMouseCoordsRef = useRef(onMouseCoords);
  useEffect(() => {
    onMouseCoordsRef.current = onMouseCoords;
  }, [onMouseCoords]);

  const onRightClickRef = useRef(onRightClick);
  useEffect(() => {
    onRightClickRef.current = onRightClick;
  }, [onRightClick]);

  const onViewStateChangeRef = useRef(onViewStateChange);
  useEffect(() => {
    onViewStateChangeRef.current = onViewStateChange;
  }, [onViewStateChange]);

  const prevArcgisLayersRef = useRef<string[]>([]);
  const satLayerRef = useRef<ReturnType<typeof createSatelliteLayer> | null>(
    null,
  );
  const satPickedRef = useRef<number | null>(null);
  const satSelectedIdRef = useRef<string | null>(null);
  const satEpochRef = useRef<number | null>(null);
  const lastSelectedPositionUiUpdateRef = useRef(0);
  const lastPlaybackOrbitUpdateRef = useRef(0);
  const satOrbitIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const lastShipsUpdateTimeRef = useRef(0);
  const pendingShipsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const prevShipSubLayersRef = useRef("");
  const lastSatShipsCalcRef = useRef<{
    time: number;
    lat: number;
    lng: number;
    satId: string;
    ships: unknown;
  } | null>(null);
  const [selectedSat, setSelectedSat] = useState<SatelliteDetail | null>(null);
  const [coverageAreaMode, setCoverageAreaMode] = useState<"total" | "view">("total");
  const [coverageViewBounds, setCoverageViewBounds] = useState<{ west: number; south: number; east: number; north: number } | null>(null);
  const [showSatCircumference, setShowSatCircumference] = useState(false);
  const showSatCircumferenceRef = useRef(false);
  useEffect(() => {
    showSatCircumferenceRef.current = showSatCircumference;
  }, [showSatCircumference]);
  const selectedSatRef = useRef<SatelliteDetail | null>(null);
  useEffect(() => {
    selectedSatRef.current = selectedSat;
  }, [selectedSat]);
  const [satPlaybackOpen, setSatPlaybackOpen] = useState(false);
  const [satPlaybackPlaying, setSatPlaybackPlaying] = useState(false);
  const [satPlaybackRate, setSatPlaybackRate] = useState(60);
  const [satPlaybackTime, setSatPlaybackTime] = useState<number | null>(null);
  const [satPlaybackHeading, setSatPlaybackHeading] = useState(0);
  const satPlaybackDisplayRef = useRef<number | null>(null);
  const satPlaybackUiTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const satPlaybackRateRef = useRef(60);
  const satHeadingRef = useRef(0);
  const [selectedShip, setSelectedShip] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [selectedShipCardPosition, setSelectedShipCardPosition] = useState({
    x: 400,
    y: 500,
  });
  const selectedShipRef = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    selectedShipRef.current = selectedShip;
  }, [selectedShip]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedShip) return;
    const updatePosition = () => {
      const lat = Number(selectedShip.lat);
      const lng = Number(selectedShip.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const point = map.project([lng, lat]);
      const margin = Math.min(190, Math.max(20, (window.innerWidth - 20) / 2));
      setSelectedShipCardPosition({
        x: Math.max(margin, Math.min(window.innerWidth - margin, point.x)),
        y: Math.max(20, Math.min(window.innerHeight - 20, point.y)),
      });
    };
    updatePosition();
    map.on("move", updatePosition);
    map.on("resize", updatePosition);
    return () => {
      map.off("move", updatePosition);
      map.off("resize", updatePosition);
    };
  }, [selectedShip, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const sourceId = "selected-ship-route";
    map.addSource(sourceId, { type: "geojson", data: EMPTY_FC });

    // 5. Selected Vessel Under-Halo
    map.addLayer({
      id: "selected-ship-halo",
      type: "circle",
      source: sourceId,
      filter: ["==", ["get", "kind"], "selected-vessel"],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          9,
          5,
          15,
          10,
          22,
        ],
        "circle-color": "#ffd600",
        "circle-opacity": 0.35,
        "circle-blur": 0.6,
        "circle-stroke-color": "#fffbeb",
        "circle-stroke-width": 1.5,
      },
    });

    // 6. Selected Vessel Symbol (Changes the ship icon itself to glowing gold!)
    map.addLayer({
      id: "selected-ship-vessel",
      type: "symbol",
      source: sourceId,
      filter: ["==", ["get", "kind"], "selected-vessel"],
      layout: {
        "icon-image": [
          "match",
          ["get", "type"],
          "tanker",
          "ship-marker-tanker-selected",
          "military",
          "ship-marker-military-selected",
          "container",
          "ship-marker-container-selected",
          "cargo",
          "ship-marker-cargo-selected",
          "ship-marker-selected",
        ],
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.75,
          5,
          1.05,
          10,
          1.4,
        ],
        "icon-rotate": ["coalesce", ["get", "heading"], 0],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": 1.0,
      },
    });

    // 7. Selected Vessel Label
    map.addLayer({
      id: "selected-ship-vessel-name",
      type: "symbol",
      source: sourceId,
      filter: ["==", ["get", "kind"], "selected-vessel"],
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-font": ["Open Sans Bold"],
        "text-offset": [0, 1.8],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#ffd600",
        "text-halo-color": "#07101d",
        "text-halo-width": 2.5,
      },
    });

    const layerIds = [
      "selected-ship-vessel-name",
      "selected-ship-vessel",
      "selected-ship-halo",
    ];

    return () => {
      for (const id of layerIds) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("selected-ship-route") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    if (!selectedShip) {
      source.setData(EMPTY_FC);
      return;
    }

    const voyage = calculateVoyageDetails(selectedShip);
    const features: GeoJSON.Feature[] = [];

    // Selected vessel icon: selection is communicated by color only.
    features.push({
      type: "Feature",
      properties: {
        kind: "selected-vessel",
        type: voyage.vesselCategory,
        heading: voyage.headingDeg,
        name: String(
          selectedShip.name ||
            (selectedShip.mmsi ? `MMSI ${selectedShip.mmsi}` : "Vessel"),
        ),
      },
      geometry: {
        type: "Point",
        coordinates: [voyage.currLng, voyage.currLat],
      },
    });

    source.setData({ type: "FeatureCollection", features });
  }, [selectedShip]);
  useEffect(() => {
    if (
      !liveTrackedShip ||
      String(liveTrackedShip.mmsi || liveTrackedShip.id || "") !==
        String(selectedShip?.mmsi || selectedShip?.id || "")
    )
      return;
    const t = setTimeout(() => {
      setSelectedShip((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...liveTrackedShip };
        return Object.keys(next).every((key) => Object.is(next[key], prev[key]))
          ? prev
          : next;
      });
    }, 0);
    return () => clearTimeout(t);
  }, [liveTrackedShip, selectedShip?.mmsi, selectedShip?.id]);
  const [showVesselsSlider, setShowVesselsSlider] = useState(false);
  const [hoveredSat, setHoveredSat] = useState<{
    name: string;
    category?: string;
    alt?: number | null;
    x: number;
    y: number;
  } | null>(null);

  const onIntelOpenChangeRef = useRef(onIntelOpenChange);
  useEffect(() => {
    onIntelOpenChangeRef.current = onIntelOpenChange;
  }, [onIntelOpenChange]);

  const onSliderOpenChangeRef = useRef(onSliderOpenChange);
  useEffect(() => {
    onSliderOpenChangeRef.current = onSliderOpenChange;
  }, [onSliderOpenChange]);

  const [internalIntelOpen, setInternalIntelOpen] = useState(false);
  const isIntelOpen =
    isIntelOpenProp !== undefined ? isIntelOpenProp : internalIntelOpen;
  const setIntelOpen = useCallback((open: boolean) => {
    setInternalIntelOpen(open);
    onIntelOpenChangeRef.current?.(open);
  }, []);

  useEffect(() => {
    onSliderOpenChangeRef.current?.(Boolean(isIntelOpen || showVesselsSlider));
  }, [isIntelOpen, showVesselsSlider]);

  const onSatelliteSelectRef = useRef(onSatelliteSelect);
  const lastNotifiedSatelliteIdRef = useRef<string | null>(null);
  useEffect(() => {
    onSatelliteSelectRef.current = onSatelliteSelect;
  }, [onSatelliteSelect]);

  const clearSat = useCallback(() => {
    if (satOrbitIntervalRef.current) clearInterval(satOrbitIntervalRef.current);
    satOrbitIntervalRef.current = null;
    satPickedRef.current = null;
    satSelectedIdRef.current = null;
    satLayerRef.current?.setSelected(null);
    satLayerRef.current?.setOrbit(null);
    setSelectedSat(null);
    setShowSatCircumference(false);
    setSatPlaybackOpen(false);
    setSatPlaybackPlaying(false);
    setSatPlaybackTime(null);
    satPlaybackTimeRef.current = null;
    satPlaybackDisplayRef.current = null;
    if (satPlaybackUiTimerRef.current)
      clearInterval(satPlaybackUiTimerRef.current);
    satPlaybackUiTimerRef.current = null;
    lastNotifiedSatelliteIdRef.current = null;
    setShowVesselsSlider(false);
    setIntelOpen(false);
    onSatelliteSelectRef.current?.(null);
  }, [setIntelOpen]);

  useEffect(() => {
    satPlaybackRateRef.current = satPlaybackRate;
  }, [satPlaybackRate]);
  useEffect(() => {
    if (!satPlaybackPlaying || !selectedSat?.line1 || !selectedSat.line2)
      return;
    let previous = performance.now();
    let frame = 0;
    satPlaybackDisplayRef.current = satPlaybackTimeRef.current;
    if (satPlaybackUiTimerRef.current)
      clearInterval(satPlaybackUiTimerRef.current);
    satPlaybackUiTimerRef.current = setInterval(() => {
      const current = satPlaybackTimeRef.current;
      if (current == null || current === satPlaybackDisplayRef.current) return;
      satPlaybackDisplayRef.current = current;
      setSatPlaybackTime(current);
    }, 250);
    const advance = (now: number) => {
      const elapsed = Math.min(250, now - previous);
      previous = now;
      const next =
        (satPlaybackTimeRef.current ?? Date.now()) +
        elapsed * satPlaybackRateRef.current;
      satPlaybackTimeRef.current = next;
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => {
      cancelAnimationFrame(frame);
      if (satPlaybackUiTimerRef.current)
        clearInterval(satPlaybackUiTimerRef.current);
      satPlaybackUiTimerRef.current = null;
    };
  }, [
    satPlaybackPlaying,
    selectedSat?.noradId,
    selectedSat?.line1,
    selectedSat?.line2,
  ]);

  useEffect(() => {
    const id = selectedSat?.noradId ?? null;
    if (lastNotifiedSatelliteIdRef.current === id) return;
    lastNotifiedSatelliteIdRef.current = id;
    onSatelliteSelectRef.current?.(selectedSat);
  }, [selectedSat]);

  useEffect(() => {
    if (clearSatelliteTrigger) {
      const t = setTimeout(() => clearSat(), 0);
      return () => clearTimeout(t);
    }
  }, [clearSatelliteTrigger, clearSat]);

  useEffect(() => {
    if (intelOpenTrigger) {
      const t = setTimeout(() => setIntelOpen(true), 0);
      return () => clearTimeout(t);
    }
  }, [intelOpenTrigger, setIntelOpen]);

  const createIcon = useCallback(
    (map: maplibregl.Map, id: string, color: string, size: number) => {
      if (map.hasImage(id)) return;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const cx = size / 2;
      const cy = size / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size * 0.4);
      ctx.lineTo(cx - size * 0.12, cy + size * 0.1);
      ctx.lineTo(cx - size * 0.4, cy + size * 0.2);
      ctx.lineTo(cx - size * 0.4, cy + size * 0.3);
      ctx.lineTo(cx - size * 0.12, cy + size * 0.15);
      ctx.lineTo(cx, cy + size * 0.35);
      ctx.lineTo(cx + size * 0.12, cy + size * 0.15);
      ctx.lineTo(cx + size * 0.4, cy + size * 0.3);
      ctx.lineTo(cx + size * 0.4, cy + size * 0.2);
      ctx.lineTo(cx + size * 0.12, cy + size * 0.1);
      ctx.closePath();
      ctx.fill();
      map.addImage(id, {
        width: size,
        height: size,
        data: new Uint8Array(ctx.getImageData(0, 0, size, size).data),
      });
    },
    [],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    maplibregl.setWorkerUrl(
      `/vendor/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`,
    );
    const facingLng = Math.max(
      -180,
      Math.min(180, -new Date().getTimezoneOffset() / 4),
    );
    const baseOptions = {
      container,
      style: styleUrl,
      center: [facingLng, 20] as [number, number],
      zoom: 1.8,
      minZoom: 1.5,
      maxZoom: 18,
      doubleClickZoom: false,
      attributionControl: {
        compact: true,
        customAttribution: "Geocoding © OpenStreetMap contributors",
      } as const,
      maxPitch: 85,
    };

    const attributeFallbacks: maplibregl.MapOptions["canvasContextAttributes"][] =
      [
        undefined,
        { powerPreference: "low-power", failIfMajorPerformanceCaveat: false },
        {
          powerPreference: "low-power",
          failIfMajorPerformanceCaveat: false,
          antialias: false,
        },
      ];

    let map: maplibregl.Map | undefined;
    for (const canvasContextAttributes of attributeFallbacks) {
      try {
        map = new maplibregl.Map(
          canvasContextAttributes
            ? { ...baseOptions, canvasContextAttributes }
            : baseOptions,
        );
        break;
      } catch (e) {
        container.innerHTML = "";
        if (
          canvasContextAttributes ===
          attributeFallbacks[attributeFallbacks.length - 1]
        )
          throw e;
        console.warn(
          "[L&T] WebGL context rejected, retrying with weaker attributes:",
          e instanceof Error ? e.message : e,
        );
      }
    }
    if (!map) return;

    map.on(
      "error",
      (e: {
        error?: { status?: number; name?: string; message?: string };
        message?: string;
      }) => {
        const err = e?.error;
        const status = err?.status;
        const msg = (err?.message || e?.message || "").toLowerCase();
        if (
          status === 0 ||
          err?.name === "AbortError" ||
          msg.includes("failed to fetch (0)") ||
          msg.includes("status: 0") ||
          msg.includes("aborted") ||
          msg.includes("cartocdn.com")
        ) {
          return;
        }
        console.warn("[MapLibre error]", err || e);
      },
    );

    map.on("load", () => {
      mapRef.current = map;
      map.resize();
      const bootStyle = getComputedStyle(document.body);
      const boot = readMapPalette((name) => bootStyle.getPropertyValue(name));
      const flightCom = boot.flightCivil;
      const flightPriv = boot.flightPrivate;
      const flightGov = boot.flightGov;
      const flightMil = boot.flightMilitary;

      createIcon(map, "plane-cyan", flightCom, 24);
      createIcon(map, "plane-green", flightPriv, 24);
      createIcon(map, "plane-pink", flightGov, 24);
      createIcon(map, "plane-red", flightMil, 24);
      createIcon(map, "plane-grey", boot.flightUnknown, 24);
      const registerShipIcon = (
        id: string,
        hullColor: string,
        detailColor: string,
        typeKind: "cargo" | "tanker" | "military" = "cargo",
      ) => {
        if (map.hasImage(id)) return;
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d")!;

        ctx.shadowColor = hullColor;
        ctx.shadowBlur = 4;

        if (typeKind === "military") {
          ctx.beginPath();
          ctx.moveTo(16, 2);
          ctx.lineTo(23, 14);
          ctx.lineTo(21, 29);
          ctx.lineTo(11, 29);
          ctx.lineTo(9, 14);
          ctx.closePath();
          ctx.fillStyle = hullColor;
          ctx.fill();

          ctx.shadowBlur = 0;
          ctx.strokeStyle = "#020b14";
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(16, 9, 1.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#1c0307";
          ctx.strokeStyle = detailColor;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.rect(13, 15, 6, 6);
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = `${detailColor}99`;
          ctx.lineWidth = 1;
          ctx.strokeRect(12.5, 23, 7, 5);
        } else if (typeKind === "tanker") {
          ctx.beginPath();
          ctx.moveTo(16, 2);
          ctx.bezierCurveTo(24, 5, 25, 16, 24, 28);
          ctx.lineTo(8, 28);
          ctx.bezierCurveTo(7, 16, 8, 5, 16, 2);
          ctx.closePath();
          ctx.fillStyle = hullColor;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "#020b14";
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.fillStyle = "#261403";
          ctx.strokeStyle = `${detailColor}99`;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.arc(16, 10, 2.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(16, 17, 2.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#120802";
          ctx.strokeStyle = detailColor;
          ctx.lineWidth = 1.2;
          ctx.strokeRect(12, 22.5, 8, 5);
        } else {
          ctx.beginPath();
          ctx.moveTo(16, 2);
          ctx.bezierCurveTo(22, 7, 24, 15, 23, 23);
          ctx.lineTo(21, 29);
          ctx.lineTo(11, 29);
          ctx.lineTo(9, 23);
          ctx.bezierCurveTo(8, 15, 10, 7, 16, 2);
          ctx.closePath();
          ctx.fillStyle = hullColor;
          ctx.fill();

          ctx.shadowBlur = 0;
          ctx.strokeStyle = "#020b14";
          ctx.lineWidth = 1.6;
          ctx.stroke();

          // Stacked container bays on deck
          ctx.fillStyle = "#061726";
          ctx.strokeStyle = `${hullColor}aa`;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(12.5, 7, 7, 5);
          ctx.strokeRect(12.5, 13, 7, 5);

          // Aft superstructure bridge
          ctx.fillStyle = "#03101c";
          ctx.strokeStyle = detailColor;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.rect(12.5, 19.5, 7, 6);
          ctx.fill();
          ctx.stroke();

          // Center radar mast
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(16, 22, 1.2, 0, Math.PI * 2);
          ctx.fill();

          // Bow navigation light
          ctx.beginPath();
          ctx.arc(16, 4, 1, 0, Math.PI * 2);
          ctx.fill();
        }

        map.addImage(id, {
          width: 32,
          height: 32,
          data: new Uint8Array(ctx.getImageData(0, 0, 32, 32).data),
        });
      };

      registerShipIcon("ship-marker", "#00e5ff", "#38bdf8", "cargo");
      registerShipIcon("ship-marker-cargo", "#00e5ff", "#38bdf8", "cargo");
      registerShipIcon("ship-marker-container", "#00e5ff", "#38bdf8", "cargo");
      registerShipIcon("ship-marker-tanker", "#ff9500", "#fbbf24", "tanker");
      registerShipIcon(
        "ship-marker-military",
        "#ff1744",
        "#f87171",
        "military",
      );

      // Highlighted Selected Vessel Icons (luminous gold hull with ivory superstructure)
      registerShipIcon("ship-marker-selected", "#ffd600", "#fffbeb", "cargo");
      registerShipIcon(
        "ship-marker-cargo-selected",
        "#ffd600",
        "#fffbeb",
        "cargo",
      );
      registerShipIcon(
        "ship-marker-container-selected",
        "#ffd600",
        "#fffbeb",
        "cargo",
      );
      registerShipIcon(
        "ship-marker-tanker-selected",
        "#ffd600",
        "#fffbeb",
        "tanker",
      );
      registerShipIcon(
        "ship-marker-military-selected",
        "#ffd600",
        "#fffbeb",
        "military",
      );

      const sources = [
        "day-night",
        "military",
        "satellites",
        "sat-footprint",
        "maritime",
        "maritime-choke",
        "maritime-ships",
        "sat-ships-in-view",
        "geospatial-video-track",
        "geospatial-video-frame",
      ];
      sources.forEach((s) =>
        map.addSource(s, { type: "geojson", data: EMPTY_FC }),
      );

      // Day & Night Solar Shadow layer (fill only, no dividing line)
      map.addLayer({
        id: "day-night-fill",
        type: "fill",
        source: "day-night",
        filter: ["==", ["get", "kind"], "night"],
        paint: {
          "fill-color": "#020617",
          "fill-opacity": 0.44,
        },
      });

      map.addLayer({
        id: "geospatial-video-track-line",
        type: "line",
        source: "geospatial-video-track",
        paint: {
          "line-color": "#42f5d7",
          "line-width": 2.5,
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "geospatial-video-footprint-fill",
        type: "fill",
        source: "geospatial-video-frame",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": "#f5a623",
          "fill-opacity": 0.22,
          "fill-outline-color": "#ffd166",
        },
      });
      map.addLayer({
        id: "geospatial-video-footprint-outline",
        type: "line",
        source: "geospatial-video-frame",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "line-color": "#ffd166",
          "line-width": 2,
          "line-opacity": 1,
        },
      });
      map.addLayer({
        id: "geospatial-video-sensor",
        type: "circle",
        source: "geospatial-video-frame",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#42f5d7",
          "circle-stroke-color": "#071018",
          "circle-stroke-width": 2,
        },
      });

      map.addLayer({
        id: "sat-glow",
        type: "circle",
        source: "satellites",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 5, 5, 9],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.3,
          "circle-blur": 1,
        },
      });
      map.addLayer({
        id: "sat-dots",
        type: "circle",
        source: "satellites",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            5,
            5,
            8,
            10,
            12,
          ],
          "circle-color": ["get", "color"],
          "circle-opacity": 1.0,
        },
      });
      map.addLayer({
        id: "sat-footprint-fill",
        type: "fill",
        source: "sat-footprint",
        filter: [
          "match",
          ["geometry-type"],
          ["Polygon", "MultiPolygon"],
          true,
          false,
        ],
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#00E5FF"],
          "fill-opacity": 0.18,
          "fill-outline-color": "rgba(0, 0, 0, 0)",
          "fill-antialias": false,
        },
      });
      map.addLayer({
        id: "sat-footprint-line",
        type: "line",
        source: "sat-footprint",
        filter: [
          "match",
          ["geometry-type"],
          ["LineString", "MultiLineString"],
          true,
          false,
        ],
        paint: {
          "line-color": "#FFFFFF",
          "line-opacity": 0.85,
          "line-dasharray": [1.5, 1.5],
          "line-width": 1.5,
        },
      });
      map.addLayer({
        id: "sat-footprint-laser",
        type: "line",
        source: "sat-footprint",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#50f7ff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.5, 8, 3],
          "line-opacity": 0.95,
          "line-blur": 1.3,
          "line-dasharray": [1.2, 2.2],
        },
      });
      if (!map.getLayer("sat-3d")) {
        satLayerRef.current = createSatelliteLayer("sat-3d");
        map.addLayer(
          satLayerRef.current as unknown as maplibregl.CustomLayerInterface,
        );
      }

      const flightLayers = [
        { id: "fl-military", src: "military", icon: "plane-red" },
      ];
      flightLayers.forEach((l) => {
        map.addLayer({
          id: l.id,
          type: "symbol",
          source: l.src,
          layout: {
            "icon-image": l.icon,
            "icon-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              1,
              0.4,
              5,
              0.7,
              10,
              1,
            ],
            "icon-rotate": ["get", "heading"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": 0.85 },
        });
      });

      map.addLayer({
        id: "maritime-glow",
        type: "circle",
        source: "maritime",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            6,
            5,
            12,
            10,
            20,
          ],
          "circle-color": [
            "match",
            ["get", "type"],
            "naval",
            "#D32F2F",
            "energy",
            "#E65100",
            "#26C6DA",
          ],
          "circle-opacity": 0.08,
          "circle-blur": 1,
        },
      });
      map.addLayer({
        id: "maritime-dots",
        type: "circle",
        source: "maritime",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            3,
            5,
            5,
            10,
            9,
          ],
          "circle-color": [
            "match",
            ["get", "type"],
            "naval",
            "#D32F2F",
            "energy",
            "#E65100",
            "#26C6DA",
          ],
          "circle-opacity": 0.8,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": [
            "match",
            ["get", "type"],
            "naval",
            "#D32F2F",
            "energy",
            "#E65100",
            "#26C6DA",
          ],
          "circle-stroke-opacity": 0.35,
        },
      });
      map.addLayer({
        id: "maritime-label",
        type: "symbol",
        source: "maritime",
        minzoom: 4,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 9,
          "text-font": ["Open Sans Regular"],
          "text-offset": [0, 1.8],
          "text-max-width": 12,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#26C6DA",
          "text-halo-color": "#000",
          "text-halo-width": 1,
          "text-opacity": 0.7,
        },
      });

      // Maritime chokepoints
      map.addLayer({
        id: "choke-glow",
        type: "circle",
        source: "maritime-choke",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            10,
            5,
            18,
            10,
            28,
          ],
          "circle-color": "#E65100",
          "circle-opacity": 0.1,
          "circle-blur": 1,
        },
      });
      map.addLayer({
        id: "choke-dots",
        type: "circle",
        source: "maritime-choke",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            4,
            5,
            7,
            10,
            12,
          ],
          "circle-color": [
            "match",
            ["get", "risk"],
            "CRITICAL",
            "#D32F2F",
            "HIGH",
            "#E65100",
            "ELEVATED",
            "#F9A825",
            "#26A69A",
          ],
          "circle-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "choke-label",
        type: "symbol",
        source: "maritime-choke",
        minzoom: 3,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 10,
          "text-font": ["Open Sans Bold"],
          "text-offset": [0, 2],
          "text-max-width": 14,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#E65100",
          "text-halo-color": "#000",
          "text-halo-width": 1,
          "text-opacity": 0.9,
        },
      });

      // Maritime Ships Under-Glow
      map.addLayer({
        id: "ship-glow",
        type: "circle",
        source: "maritime-ships",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            3.5,
            5,
            6,
            10,
            10,
          ],
          "circle-color": [
            "match",
            ["get", "type"],
            "tanker",
            "#ff9500",
            "military",
            "#ff1744",
            "container",
            "#00e5ff",
            "cargo",
            "#00e5ff",
            "#00e5ff",
          ],
          "circle-opacity": 0.45,
          "circle-blur": 0.85,
        },
      });

      // Maritime Ships
      map.addLayer({
        id: "ship-dots",
        type: "symbol",
        source: "maritime-ships",
        layout: {
          "icon-image": [
            "match",
            ["get", "type"],
            "tanker",
            "ship-marker-tanker",
            "military",
            "ship-marker-military",
            "container",
            "ship-marker-container",
            "cargo",
            "ship-marker-cargo",
            "ship-marker",
          ],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            0.52,
            5,
            0.72,
            10,
            0.95,
          ],
          "icon-rotate": ["coalesce", ["get", "heading"], 0],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": 0.95 },
      });
      map.addLayer({
        id: "ship-label",
        type: "symbol",
        source: "maritime-ships",
        minzoom: 5,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 9,
          "text-font": ["Open Sans Regular"],
          "text-offset": [0, 1.2],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": [
            "match",
            ["get", "type"],
            "military",
            "#ff1744",
            "tanker",
            "#ff9500",
            "container",
            "#00e5ff",
            "cargo",
            "#00e5ff",
            "#00e5ff",
          ],
          "text-halo-color": "#000",
          "text-halo-width": 1,
        },
      });
      map.addLayer({
        id: "sat-ship-in-view-ring",
        type: "circle",
        source: "sat-ships-in-view",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            4,
            6,
            8,
            12,
            11,
          ],
          "circle-color": "#ffd54f",
          "circle-opacity": 0.25,
          "circle-stroke-color": "#ffe082",
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": 0.95,
        },
      });
      setMapReady(true);
      requestAnimationFrame(() => onReadyRef.current?.());
      if (process.env.NODE_ENV === "development")
        (window as unknown as { __ltmap?: maplibregl.Map }).__ltmap = map;
    });

    let lastMove = 0;
    map.on("mousemove", (e) => {
      const now = Date.now();
      if (now - lastMove > 100) {
        lastMove = now;
        onMouseCoordsRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      }
    });

    let lastRightClick: { at: number; x: number; y: number } | null = null;
    map.on("contextmenu", (e) => {
      e.preventDefault();
      const open = () =>
        onRightClickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      if ((e.originalEvent as PointerEvent).pointerType === "touch") {
        open();
        return;
      }

      const now = performance.now();
      const { x, y } = e.point;
      const isSecond =
        lastRightClick !== null &&
        now - lastRightClick.at < DOUBLE_RIGHT_MS &&
        Math.hypot(x - lastRightClick.x, y - lastRightClick.y) <
          DOUBLE_RIGHT_SLOP_PX;
      if (isSecond) {
        lastRightClick = null;
        open();
      } else {
        lastRightClick = { at: now, x, y };
      }
    });

    const reportViewState = () => {
      const c = map.getCenter();
      onViewStateChangeRef.current?.({
        zoom: map.getZoom(),
        latitude: c.lat,
        longitude: c.lng,
      });
    };
    map.on("load", reportViewState);
    map.on("moveend", reportViewState);

    // Keep the zoom readout in sync without rerendering the full dashboard
    // for every camera animation frame.
    const updateZoomReadout = () => {
      const readout = zoomReadoutRef.current;
      if (readout) readout.textContent = map.getZoom().toFixed(1);
    };
    map.on("zoom", updateZoomReadout);
    updateZoomReadout();

    const reportCamera = () => {
      const center = map.getCenter();
      container.dataset.mapCamera = JSON.stringify({
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        lat: center.lat,
        lng: center.lng,
      });
    };
    map.on("load", reportCamera);
    map.on("moveend", reportCamera);
    map.on("idle", reportCamera);
    reportCamera();

    const CLICKABLE_LAYERS = new Set([
      "eq-circles",
      "fires-heat",
      "weather-dots",
      "infra-dots",
      "maritime-dots",
      "choke-dots",
      "balloon-dots",
      "rad-dots",
      "ship-dots",
      "sweep-device-dots",
      "scan-targets-dots",
      "sdk-sea",
      "sdk-air",
      "sdk-intel",
      "malware-dots",
      "cyber-heads",
      "cf-outage-dots",
      "cf-attack-dots",
      "flight-dots",
      "military-dots",
      "jet-dots",
      "private-dots",
      "alert-pin-dots",
    ]);

    map.on("click", (e) => {
      const layer = satLayerRef.current;
      if (!layer) return;
      const hits = map.queryRenderedFeatures(e.point);
      if (hits.some((f) => f.layer?.id && CLICKABLE_LAYERS.has(f.layer.id)))
        return;

      let idx: number | null = null;
      let p: SatelliteRow | null = null;

      const currentProjectionType =
        (map.getProjection() as unknown as { type?: string })?.type ??
        "mercator";
      const isGlobe = currentProjectionType === "globe";
      if (!isGlobe) {
        const satHitLayers = ["sat-dots", "sat-glow"].filter((id) =>
          Boolean(map.getLayer(id)),
        );
        const satHits = satHitLayers.length
          ? map.queryRenderedFeatures(e.point, { layers: satHitLayers })
          : [];
        if (satHits.length > 0) {
          const f = satHits[0];
          p =
            satRowsRef.current.find(
              (r) => r.noradId === f.properties?.noradId,
            ) || null;
          idx = p ? satRowsRef.current.indexOf(p) : null;
        }
      } else {
        idx = layer.pick(e.point.x, e.point.y);
        p = idx == null ? null : satRowsRef.current[idx];
      }

      if (idx == null || !p) {
        const locInfo = getLocationTimeInfo(e.lngLat.lat, e.lngLat.lng);
        onCountryClickRef.current?.(locInfo);
        return;
      }

      layer.setOrbit(null);
      if (satOrbitIntervalRef.current)
        clearInterval(satOrbitIntervalRef.current);
      satPickedRef.current = idx;
      satSelectedIdRef.current = p.noradId ?? null;
      layer.setSelected(idx);
      setSatPlaybackPlaying(false);
      setSatPlaybackOpen(false);
      setSatPlaybackTime(null);
      satPlaybackTimeRef.current = null;

      popupRef.current?.remove();
      const selectedAt = new Date();
      const livePosition =
        p.line1 && p.line2 ? propagateTLE(p.line1, p.line2, selectedAt) : null;
      if (livePosition) {
        p.lat = livePosition.lat;
        p.lng = livePosition.lng;
        p.alt = livePosition.altKm;
        layer.updatePoint(idx, {
          lng: livePosition.lng,
          lat: livePosition.lat,
          altKm: livePosition.altKm,
          color: parseColor(
            satColorFor(p.category, p.color, paletteRef.current),
          ),
          size:
            p.category === "science" || /ISS|TIANGONG/i.test(p.name || "")
              ? 30
              : 20,
        });
      }
      const satLoc = getLocationTimeInfo(
        livePosition?.lat ?? p.lat,
        livePosition?.lng ?? p.lng,
      );
      const satTime = formatTimeInZone(satLoc.timeZone, new Date());
      const satDetail: SatelliteDetail = {
        name: p.name,
        lat: livePosition?.lat ?? p.lat,
        lng: livePosition?.lng ?? p.lng,
        alt: livePosition?.altKm ?? p.alt,
        color: satColorFor(p.category, p.color, paletteRef.current),
        mission: p.mission,
        category: p.category,
        noradId: p.noradId,
        country: satLoc.country,
        countryCode: satLoc.countryCode,
        flag: satLoc.flag,
        timeZone: satLoc.timeZone,
        localTime: satTime,
        line1: p.line1,
        line2: p.line2,
        periodMinutes:
          p.periodMinutes ?? (p.line2 ? orbitalPeriodMinutes(p.line2) : null),
        track: "ready",
      };
      setSelectedSat(satDetail);
      satHeadingRef.current = livePosition
        ? (propagateTelemetry(p.line1 || "", p.line2 || "", selectedAt)
            ?.headingDeg ?? 0)
        : 0;
      setSatPlaybackHeading(Math.round(satHeadingRef.current));
      setIntelOpen(false);
      setShowVesselsSlider(false);
      const updateOrbit = () => {
        if (!p.line1 || !p.line2) {
          layer.setOrbit(null);
          return;
        }
        // Keep the live marker at the centre of the full revolution, as in
        // Osiris. Starting the line at now leaves the marker at one endpoint
        // and stale catalogue positions can make them look like separate paths.
        const anchor = new Date(satPlaybackTimeRef.current ?? Date.now());
        const current = propagateTLE(p.line1, p.line2, anchor);
        if (current) {
          p.lat = current.lat;
          p.lng = current.lng;
          p.alt = current.altKm;
        }
        const orbit = orbitPath(p.line1, p.line2, 240, anchor);
        layer.setOrbit(
          splitAtAntimeridian(orbit).map((run) =>
            run.map((point) => ({
              lng: point.lng,
              lat: point.lat,
              altKm: point.altKm,
            })),
          ),
          0xffd54f,
        );
      };
      updateOrbit();
      satOrbitIntervalRef.current = setInterval(updateOrbit, 500);
    });

    let lastHoverPick = -Infinity;
    map.on("mousemove", (e) => {
      const layer = satLayerRef.current;
      if (map.isMoving() || performance.now() - lastHoverPick < 40) return;
      lastHoverPick = performance.now();

      requestAnimationFrame(() => {
        if (map.isMoving()) return;
        const canvas = map.getCanvas();

        const currentProjectionType =
          (map.getProjection() as unknown as { type?: string })?.type ??
          "mercator";
        const isGlobe = currentProjectionType === "globe";
        let hoveredIndex: number | null = null;
        let hoveredRow: SatelliteRow | null = null;

        if (!isGlobe) {
          const satHitLayers = ["sat-dots", "sat-glow"].filter((id) =>
            Boolean(map.getLayer(id)),
          );
          const satHits = satHitLayers.length
            ? map.queryRenderedFeatures(e.point, { layers: satHitLayers })
            : [];
          if (satHits.length > 0) {
            const f = satHits[0];
            hoveredRow =
              satRowsRef.current.find(
                (r) => r.noradId === f.properties?.noradId,
              ) || null;
          }
        } else if (layer) {
          hoveredIndex = layer.pick(e.point.x, e.point.y);
          hoveredRow =
            hoveredIndex != null ? satRowsRef.current[hoveredIndex] : null;
        }

        if (hoveredRow) {
          canvas.style.cursor = "pointer";
          setHoveredSat({
            name: hoveredRow.name,
            category: hoveredRow.category,
            alt: hoveredRow.alt,
            x: e.point.x,
            y: e.point.y,
          });
        } else {
          if (canvas.style.cursor === "pointer") canvas.style.cursor = "";
          setHoveredSat((prev) => (prev ? null : prev));
        }
      });
    });

    map.on("mouseout", () => setHoveredSat(null));
    map.on("movestart", () => setHoveredSat(null));

    const sizeToContainer = new ResizeObserver(() => map.resize());
    sizeToContainer.observe(container);

    return () => {
      if (satOrbitIntervalRef.current)
        clearInterval(satOrbitIntervalRef.current);
      satOrbitIntervalRef.current = null;
      sizeToContainer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [createIcon, setIntelOpen]);

  const setGeo = useCallback((source: string, features: unknown[]) => {
    const src = mapRef.current?.getSource(source) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src)
      src.setData({
        type: "FeatureCollection",
        features: features as unknown as GeoJSON.Feature[],
      });
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current?.getSource("geospatial-video-track") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    const frames = geospatialVideoFrames ?? [];
    const stride = Math.max(1, Math.ceil(frames.length / 4000));
    const positions = frames
      .filter((_, index) => index % stride === 0)
      .map(frame => [frame.sensor.lng, frame.sensor.lat] as [number, number]);
    if (frames.length > 1) {
      const last = frames[frames.length - 1];
      const previous = positions[positions.length - 1];
      if (!previous || previous[0] !== last.sensor.lng || previous[1] !== last.sensor.lat)
        positions.push([last.sensor.lng, last.sensor.lat]);
    }
    const features: GeoJSON.Feature[] = positions.length > 1 ? [{
      type: "Feature",
      properties: { kind: "video-track" },
      geometry: { type: "LineString", coordinates: positions },
    }] : [];
    source.setData({ type: "FeatureCollection", features });
  }, [mapReady, geospatialVideoFrames]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current?.getSource("geospatial-video-frame") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    const features: GeoJSON.Feature[] = [];
    if (geospatialVideoFrame?.footprint?.length) {
      features.push({
        type: "Feature",
        properties: { kind: "frame-footprint" },
        geometry: {
          type: "Polygon",
          coordinates: geospatialVideoFrame.footprint as GeoJSON.Position[][],
        },
      });
    }
    if (geospatialVideoFrame) {
      features.push({
        type: "Feature",
        properties: { kind: "sensor-position" },
        geometry: {
          type: "Point",
          coordinates: [geospatialVideoFrame.sensor.lng, geospatialVideoFrame.sensor.lat],
        },
      });
    }
    source.setData({ type: "FeatureCollection", features });
  }, [mapReady, geospatialVideoFrame]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const fill = map.getLayer("sat-footprint-fill");
    const line = map.getLayer("sat-footprint-line");
    const laser = map.getLayer("sat-footprint-laser");
    if (!fill || !line || !laser) return;
    const showCoverage = activeLayers.rf_coverage !== false && !selectedSat;
    map.setLayoutProperty("sat-footprint-fill", "visibility", laserView || !showCoverage ? "none" : "visible");
    map.setLayoutProperty("sat-footprint-line", "visibility", laserView || !showCoverage ? "none" : "visible");
    map.setLayoutProperty("sat-footprint-laser", "visibility", laserView || !showCoverage ? "none" : "visible");
  }, [mapReady, laserView, activeLayers.rf_coverage, selectedSat]);

  useEffect(() => {
    if (
      !mapReady ||
      !selectedSat ||
      selectedSat.lat == null ||
      selectedSat.lng == null ||
      selectedSat.alt == null
    ) {
      setGeo("sat-footprint", []);
      satLayerRef.current?.setCone(null);
      return;
    }
    // During playback the selected satellite's footprint is updated directly
    // with its marker in the animation loop below.
    if (satPlaybackPlaying) return;
    setGeo("sat-footprint", []);
  }, [selectedSat, mapReady, setGeo, satPlaybackPlaying]);

  useEffect(() => {
    if (!mapReady) return;
    if (satPlaybackPlaying) return;
    if (!selectedSat || selectedSat.lat == null || selectedSat.lng == null || selectedSat.alt == null) {
      satLayerRef.current?.setCone(null);
      return;
    }
    satLayerRef.current?.setCone(
      buildSatelliteHorizonCone(selectedSat.lng, selectedSat.lat, selectedSat.alt),
      parseColor(selectedSat.color),
    );
  }, [showSatCircumference, selectedSat, mapReady, satPlaybackPlaying]);

  useEffect(() => {
    if (!mapReady) return;
    const toFeatures = (arr: unknown, decimate: number = 1) => {
      let filtered = Array.isArray(arr) ? arr : [];
      if (decimate > 1) {
        filtered = filtered.filter((_, i) => i % decimate === 0);
      }
      return (filtered as Array<Record<string, unknown>>).map((f) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [Number(f.lng || 0), Number(f.lat || 0)],
        },
        properties: {
          callsign: f.callsign,
          heading: f.heading || 0,
          alt: f.alt,
          model: f.model,
          speed_knots: f.speed_knots,
          registration: f.registration,
          icao24: f.icao24,
        },
      }));
    };
    setGeo(
      "military",
      activeLayers.military ? toFeatures(data.military_flights) : [],
    );
  }, [mapReady, data.military_flights, activeLayers.military, setGeo]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const anyShipActive = !!(
      activeLayers.ship_cargo ||
      activeLayers.ship_tanker ||
      activeLayers.ship_military
    );
    const visibility = anyShipActive ? "visible" : "none";
    for (const id of [
      "ship-glow",
      "ship-dots",
      "ship-label",
      "sat-ship-in-view-ring",
    ]) {
      if (mapRef.current.getLayer(id))
        mapRef.current.setLayoutProperty(id, "visibility", visibility);
    }
  }, [
    mapReady,
    activeLayers.ship_cargo,
    activeLayers.ship_tanker,
    activeLayers.ship_military,
  ]);

  // ── Ports & Chokepoints layer (updates only when static ports/chokepoints change) ──
  useEffect(() => {
    if (!mapReady) return;
    setGeo(
      "maritime",
      activeLayers.maritime && Array.isArray(data.maritime_ports)
        ? (data.maritime_ports as Array<Record<string, unknown>>).map((p) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [Number(p.lng || 0), Number(p.lat || 0)],
            },
            properties: {
              name: p.name,
              country: p.country,
              type: p.type,
              volume: p.volume,
              fleet: p.fleet,
              rank: p.rank,
              congestion: p.congestion,
              dwell_time: p.dwell_time,
            },
          }))
        : [],
    );
    setGeo(
      "maritime-choke",
      activeLayers.maritime && Array.isArray(data.maritime_chokepoints)
        ? (data.maritime_chokepoints as Array<Record<string, unknown>>).map(
            (c) => ({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [Number(c.lng || 0), Number(c.lat || 0)],
              },
              properties: { name: c.name, traffic: c.traffic, risk: c.risk },
            }),
          )
        : [],
    );
  }, [
    mapReady,
    data.maritime_ports,
    data.maritime_chokepoints,
    activeLayers.maritime,
    setGeo,
  ]);

  // ── Day & Night Solar Terminator Layer ──
  useEffect(() => {
    if (!mapReady) return;

    if (!activeLayers.day_night) {
      setGeo("day-night", []);
      return;
    }

    const updateTerminator = () => {
      const { features } = getSolarTerminator(new Date());
      setGeo("day-night", features);
    };

    updateTerminator();
    const interval = setInterval(updateTerminator, 30000);
    return () => clearInterval(interval);
  }, [mapReady, activeLayers.day_night, setGeo]);

  // ── Throttled Maritime Ships Layer (prevents MapLibre freeze with 20k vessels) ──
  useEffect(() => {
    if (!mapReady) return;

    const showCargo = !!activeLayers.ship_cargo;
    const showTanker = !!activeLayers.ship_tanker;
    const showMilitary = !!activeLayers.ship_military;
    const anyShipActive = showCargo || showTanker || showMilitary;

    if (
      !anyShipActive ||
      !Array.isArray(data.maritime_ships) ||
      data.maritime_ships.length === 0
    ) {
      if (pendingShipsTimeoutRef.current)
        clearTimeout(pendingShipsTimeoutRef.current);
      setGeo("maritime-ships", []);
      return;
    }

    const updateShipSource = () => {
      lastShipsUpdateTimeRef.current = Date.now();
      const rawShips = (data.maritime_ships || []) as Array<
        Record<string, unknown>
      >;

      const ships = rawShips.filter((s) => {
        const t = s.type;
        if (t === "cargo" || t === "container") return showCargo;
        if (t === "tanker") return showTanker;
        if (t === "military") return showMilitary;
        return showCargo;
      });

      const features = new Array(ships.length);
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        features[i] = {
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
          properties: {
            name: s.name || (s.mmsi ? s.mmsi.toString() : ""),
            type: s.type || "cargo",
            speed: s.speed,
            heading: s.heading,
            destination: s.destination,
            flag: s.flag,
            mmsi: s.mmsi,
            firstSeenLat: s.firstSeenLat,
            firstSeenLng: s.firstSeenLng,
            firstSeenAt: s.firstSeenAt,
            lastSeenAt: s.lastSeenAt ?? s.timestamp,
            trackStartLat: s.trackStartLat,
            trackStartLng: s.trackStartLng,
            trackStartAt: s.trackStartAt,
            trackDistanceKm: s.trackDistanceKm,
            trackPointCount: s.trackPointCount,
            track: s.track,
          },
        };
      }
      setGeo("maritime-ships", features);
    };

    const now = Date.now();
    const elapsed = now - lastShipsUpdateTimeRef.current;
    const currentSubKey = `${showCargo}_${showTanker}_${showMilitary}`;
    const filterChanged = prevShipSubLayersRef.current !== currentSubKey;
    prevShipSubLayersRef.current = currentSubKey;
    const THROTTLE_MS = 2000;

    if (filterChanged || elapsed >= THROTTLE_MS) {
      if (pendingShipsTimeoutRef.current)
        clearTimeout(pendingShipsTimeoutRef.current);
      updateShipSource();
    } else if (!pendingShipsTimeoutRef.current) {
      pendingShipsTimeoutRef.current = setTimeout(() => {
        pendingShipsTimeoutRef.current = null;
        updateShipSource();
      }, THROTTLE_MS - elapsed);
    }

    return () => {
      if (pendingShipsTimeoutRef.current) {
        clearTimeout(pendingShipsTimeoutRef.current);
        pendingShipsTimeoutRef.current = null;
      }
    };
  }, [
    mapReady,
    data.maritime_ships,
    activeLayers.ship_cargo,
    activeLayers.ship_tanker,
    activeLayers.ship_military,
    setGeo,
  ]);

  const selectedSatId = selectedSat?.noradId;
  const selectedSatLat = selectedSat?.lat;
  const selectedSatLng = selectedSat?.lng;
  const selectedSatAlt = selectedSat?.alt;

  useEffect(() => {
    const shipSource = Array.isArray(data.satellite_maritime_ships)
      ? data.satellite_maritime_ships
      : data.maritime_ships;
    if (
      !mapReady ||
      !selectedSatId ||
      selectedSatLat == null ||
      selectedSatLng == null ||
      selectedSatAlt == null ||
      !Array.isArray(shipSource)
    ) {
      lastSatShipsCalcRef.current = null;
      setGeo("sat-ships-in-view", []);
      const timer = setTimeout(() => {
        setSelectedSat((prev) =>
          prev?.inViewShips?.length || prev?.totalInViewCount
            ? { ...prev, inViewShips: [], totalInViewCount: 0 }
            : prev,
        );
      }, 0);
      return () => clearTimeout(timer);
    }

    const now = Date.now();
    const prevCalc = lastSatShipsCalcRef.current;
    if (
      prevCalc &&
      prevCalc.satId === selectedSatId &&
      prevCalc.ships === shipSource &&
      now - prevCalc.time < 1500 &&
      Math.abs(selectedSatLat - prevCalc.lat) < 0.04 &&
      Math.abs(selectedSatLng - prevCalc.lng) < 0.04
    ) {
      return;
    }
    lastSatShipsCalcRef.current = {
      time: now,
      lat: selectedSatLat,
      lng: selectedSatLng,
      satId: selectedSatId,
      ships: shipSource,
    };

    const earthKm = 6371;
    const viewingRadiusKm =
      earthKm * Math.acos(earthKm / (earthKm + Math.max(0, selectedSatAlt)));
    const toRad = Math.PI / 180;
    const satLatRad = selectedSatLat * toRad;
    const cosSatLat = Math.cos(satLatRad);

    const ships = shipSource as Array<Record<string, unknown>>;
    const coveredFeatures: GeoJSON.Feature[] = [];
    const shipSummary: NonNullable<SatelliteDetail["inViewShips"]> = [];
    const typeCounts = { all: 0, cargo: 0, tanker: 0, military: 0 };

    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      const sLat = Number(s.lat);
      const sLng = Number(s.lng);
      if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;

      const dLat = (sLat - selectedSatLat) * toRad;
      const dLng = (sLng - selectedSatLng) * toRad;
      const a =
        Math.sin(dLat / 2) ** 2 +
        cosSatLat * Math.cos(sLat * toRad) * Math.sin(dLng / 2) ** 2;
      const distance = 2 * earthKm * Math.asin(Math.min(1, Math.sqrt(a)));
      if (distance <= viewingRadiusKm) {
        coveredFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [sLng, sLat] },
          properties: {
            name: s.name || String(s.mmsi ?? "VESSEL"),
            type: s.type || "cargo",
            speed: s.speed,
            heading: s.heading,
            destination: s.destination,
            flag: s.flag,
            mmsi: s.mmsi,
            firstSeenLat: s.firstSeenLat,
            firstSeenLng: s.firstSeenLng,
            firstSeenAt: s.firstSeenAt,
            lastSeenAt: s.lastSeenAt ?? s.timestamp,
            trackStartLat: s.trackStartLat,
            trackStartLng: s.trackStartLng,
            trackStartAt: s.trackStartAt,
            trackDistanceKm: s.trackDistanceKm,
            trackPointCount: s.trackPointCount,
            track: s.track,
          },
        });

        const sType = String(s.type || "cargo").toLowerCase();
        typeCounts.all++;
        if (sType === "cargo" || sType === "container") typeCounts.cargo++;
        else if (sType === "tanker") typeCounts.tanker++;
        else if (sType === "military") typeCounts.military++;

        const trackArr = Array.isArray(s.track)
          ? (s.track as Array<{
              lat: number;
              lng: number;
              timestamp: number;
              speed?: number | null;
            }>)
          : undefined;

        shipSummary.push({
          mmsi: String(s.mmsi ?? s.id ?? s.name ?? `SHIP-${i}`),
          name: String(s.name || s.mmsi || "VESSEL"),
          type: String(s.type || "cargo"),
          speed: Number(s.speed ?? 0),
          heading:
            s.heading != null && Number.isFinite(Number(s.heading))
              ? Number(s.heading)
              : undefined,
          lat: sLat,
          lng: sLng,
          destination: String(s.destination || ""),
          flag: String(s.flag || "UNK"),
          distanceKm: distance,
          lastSeenAt: s.lastSeenAt
            ? Number(s.lastSeenAt)
            : s.timestamp
              ? Number(s.timestamp)
              : undefined,
          trackStartLat:
            s.trackStartLat != null ? Number(s.trackStartLat) : undefined,
          trackStartLng:
            s.trackStartLng != null ? Number(s.trackStartLng) : undefined,
          trackStartAt:
            s.trackStartAt != null ? Number(s.trackStartAt) : undefined,
          trackDistanceKm:
            s.trackDistanceKm != null ? Number(s.trackDistanceKm) : undefined,
          trackPointCount:
            s.trackPointCount != null ? Number(s.trackPointCount) : undefined,
          track: trackArr,
        });
      }
    }

    setGeo("sat-ships-in-view", coveredFeatures);

    shipSummary.sort(
      (a, b) => Number(a.distanceKm ?? 0) - Number(b.distanceKm ?? 0),
    );

    const topShips = shipSummary.slice(0, 500);
    const totalCount = shipSummary.length;

    setSelectedSat((prev) => {
      if (!prev || prev.noradId !== selectedSatId) return prev;
      const old = prev.inViewShips ?? [];
      const oldTotal = prev.totalInViewCount;

      const totalChanged = oldTotal !== totalCount;
      const lengthChanged = old.length !== topShips.length;
      const firstShipChanged =
        old.length > 0 &&
        topShips.length > 0 &&
        old[0].mmsi !== topShips[0].mmsi;

      if (
        !totalChanged &&
        !lengthChanged &&
        !firstShipChanged &&
        prev.inViewCountsByType
      ) {
        return prev;
      }

      return {
        ...prev,
        totalInViewCount: totalCount,
        inViewCountsByType: typeCounts,
        inViewShips: topShips,
      };
    });
  }, [
    mapReady,
    selectedSatId,
    selectedSatLat,
    selectedSatLng,
    selectedSatAlt,
    data.maritime_ships,
    data.satellite_maritime_ships,
    setGeo,
  ]);

  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.body);
      const next = readMapPalette((name) => cs.getPropertyValue(name));
      setPalette((prev) =>
        MAP_PALETTE_KEYS.every((k) => prev[k] === next[k]) ? prev : next,
      );
    };
    read();
    const raf = requestAnimationFrame(read);
    window.addEventListener(STYLE_EVENT, read);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener(STYLE_EVENT, read);
    };
  }, [theme]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const updateMapIcon = (id: string, color: string, size: number) => {
      if (!map.hasImage(id)) return;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const cx = size / 2;
      const cy = size / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size * 0.4);
      ctx.lineTo(cx - size * 0.12, cy + size * 0.1);
      ctx.lineTo(cx - size * 0.4, cy + size * 0.2);
      ctx.lineTo(cx - size * 0.4, cy + size * 0.3);
      ctx.lineTo(cx - size * 0.12, cy + size * 0.15);
      ctx.lineTo(cx, cy + size * 0.35);
      ctx.lineTo(cx + size * 0.12, cy + size * 0.15);
      ctx.lineTo(cx + size * 0.4, cy + size * 0.3);
      ctx.lineTo(cx + size * 0.4, cy + size * 0.2);
      ctx.lineTo(cx + size * 0.12, cy + size * 0.1);
      ctx.closePath();
      ctx.fill();
      map.updateImage(id, {
        width: size,
        height: size,
        data: new Uint8Array(ctx.getImageData(0, 0, size, size).data),
      });
    };

    updateMapIcon("plane-cyan", palette.flightCivil, 24);
    updateMapIcon("plane-green", palette.flightPrivate, 24);
    updateMapIcon("plane-pink", palette.flightGov, 24);
    updateMapIcon("plane-red", palette.flightMilitary, 24);
    updateMapIcon("plane-grey", palette.flightUnknown, 24);
  }, [mapReady, palette]);

  const toSatPoints = useCallback(
    (rows: SatelliteRow[]): SatPoint[] =>
      rows.map((s) => ({
        lng: s.lng,
        lat: s.lat,
        altKm: s.alt,
        color: parseColor(satColorFor(s.category, s.color, palette)),
        size:
          s.category === "science" || /ISS|TIANGONG/i.test(s.name || "")
            ? 30.0
            : 20.0,
      })),
    [palette],
  );

  const resyncSatSelection = useCallback((rows: SatelliteRow[]) => {
    const id = satSelectedIdRef.current;
    if (!id) return;
    const i = rows.findIndex((r) => r.noradId === id);
    if (i < 0) {
      return;
    }
    satPickedRef.current = i;
    satLayerRef.current?.setSelected(i);

    const sat = rows[i];
    const c = satColorFor(sat.category, sat.color, paletteRef.current);

    setSelectedSat((prev) =>
      prev && prev.noradId === sat.noradId
        ? {
            ...prev,
            lat: prev.updatedAt ? prev.lat : sat.lat,
            lng: prev.updatedAt ? prev.lng : sat.lng,
            alt: prev.updatedAt ? prev.alt : sat.alt,
            color: c,
          }
        : prev,
    );
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const show =
      activeLayers.satellites ||
      activeLayers.sat_comms ||
      activeLayers.sat_military ||
      activeLayers.sat_navigation ||
      activeLayers.sat_earth ||
      activeLayers.sat_science;
    const vis = show && projection !== "globe" ? "visible" : "none";
    if (map.getLayer("sat-dots"))
      map.setLayoutProperty("sat-dots", "visibility", vis);
    if (map.getLayer("sat-glow"))
      map.setLayoutProperty("sat-glow", "visibility", vis);
    if (map.getLayer("sat-dots")) map.setFilter("sat-dots", null);
    if (map.getLayer("sat-glow")) map.setFilter("sat-glow", null);
    satLayerRef.current?.setFocusOnly(false);
  }, [mapReady, activeLayers, selectedSat?.noradId, projection]);

  useEffect(() => {
    if (!mapReady) return;
    const sats: SatelliteRow[] = Array.isArray(data.satellites)
      ? (data.satellites as SatelliteRow[])
      : [];
    const al = activeLayers;
    const at =
      typeof data.satellites_at === "string"
        ? Date.parse(data.satellites_at)
        : typeof data.satellites_at === "number"
          ? data.satellites_at
          : NaN;
    satEpochRef.current = Number.isFinite(at) ? at : null;

    if (al.satellites) {
      setGeo(
        "satellites",
        sats.map((s: SatelliteRow) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
          properties: {
            name: s.name,
            color: satColorFor(s.category, s.color, palette),
            mission: s.mission,
            alt: s.alt,
            noradId: s.noradId,
            category: s.category,
          },
        })),
      );
      const trackedId = satSelectedIdRef.current;
      const previousRows = satRowsRef.current;
      const preserved =
        trackedId && satPlaybackTimeRef.current != null
          ? previousRows.find((row) => row.noradId === trackedId)
          : null;
      const mappedSats = preserved
        ? sats.map((row) =>
            row.noradId === trackedId
              ? {
                  ...row,
                  lat: preserved.lat,
                  lng: preserved.lng,
                  alt: preserved.alt,
                }
              : row,
          )
        : sats;
      satRowsRef.current = mappedSats;
      satLayerRef.current?.setPoints(
        projection === "globe" ? toSatPoints(mappedSats) : [],
      );
      resyncSatSelection(mappedSats);
      return;
    }

    const enabledCategories: string[] = [];
    if (al.sat_comms) enabledCategories.push("comms");
    if (al.sat_military) enabledCategories.push("military");
    if (al.sat_navigation) enabledCategories.push("navigation");
    if (al.sat_earth) enabledCategories.push("earth_obs");
    if (al.sat_science) enabledCategories.push("science");

    if (enabledCategories.length === 0) {
      setGeo("satellites", []);
      satRowsRef.current = [];
      satLayerRef.current?.setPoints([]);
      if (satSelectedIdRef.current != null) {
        clearSat();
      }
      return;
    }

    const filtered = sats.filter(
      (s: SatelliteRow) => s.category && enabledCategories.includes(s.category),
    );
    const trackedId = satSelectedIdRef.current;
    if (trackedId && satPlaybackTimeRef.current != null) {
      const previous = satRowsRef.current.find(
        (row) => row.noradId === trackedId,
      );
      const incoming = filtered.find((row) => row.noradId === trackedId);
      if (previous && incoming) {
        incoming.lat = previous.lat;
        incoming.lng = previous.lng;
        incoming.alt = previous.alt;
      }
    }
    setGeo(
      "satellites",
      filtered.map((s: SatelliteRow) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: {
          name: s.name,
          color: satColorFor(s.category, s.color, palette),
          mission: s.mission,
          alt: s.alt,
          noradId: s.noradId,
          category: s.category,
        },
      })),
    );
    satRowsRef.current = filtered;
    satLayerRef.current?.setPoints(
      projection === "globe" ? toSatPoints(filtered) : [],
    );
    resyncSatSelection(filtered);
  }, [
    mapReady,
    data.satellites,
    data.satellites_at,
    activeLayers,
    setGeo,
    toSatPoints,
    resyncSatSelection,
    clearSat,
    projection,
    palette,
  ]);

  // Refresh the whole constellation together at 10 Hz. Satellite motion stays
  // visually continuous while avoiding SGP4 and GeoJSON work on every display frame.
  useEffect(() => {
    if (!mapReady) return;
    let timer: ReturnType<typeof setTimeout>;

    const updateSatellitePositions = () => {
      const rows = satRowsRef.current;
      if (!rows.length) return;
      const time = new Date(satPlaybackTimeRef.current ?? Date.now());
      let selectedUpdate: {
        row: SatelliteRow;
        pos: { lat: number; lng: number; altKm: number };
      } | null = null;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.line1 || !row.line2) continue;
        const pos = propagateTLE(row.line1, row.line2, time);
        if (!pos) continue;
        row.lat = pos.lat;
        row.lng = pos.lng;
        row.alt = pos.altKm;
        if (row.noradId === satSelectedIdRef.current)
          selectedUpdate = { row, pos };
      }
      if (projection === "globe") {
        satLayerRef.current?.setPoints(toSatPoints(rows));
      } else {
        const source = mapRef.current?.getSource("satellites") as
          | maplibregl.GeoJSONSource
          | undefined;
        source?.setData({
          type: "FeatureCollection",
          features: rows.map((row) => ({
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [row.lng, row.lat],
            },
            properties: {
              name: row.name,
              color: satColorFor(row.category, row.color, paletteRef.current),
              mission: row.mission,
              alt: row.alt,
              noradId: row.noradId,
              category: row.category,
            },
          })),
        });
      }

      if (selectedUpdate) {
        const { row, pos } = selectedUpdate;
        if (satPlaybackPlaying) {
          const color = satColorFor(row.category, row.color, paletteRef.current);
          const footprint = generateFootprintFeatures({
            lng: pos.lng,
            lat: pos.lat,
            alt: pos.altKm,
            color,
            elevationMaskDeg: 10,
          });
          setGeo("sat-footprint", footprint.features);
          if (showSatCircumferenceRef.current) {
            satLayerRef.current?.setCone(
              buildSatelliteHorizonCone(pos.lng, pos.lat, pos.altKm),
              parseColor(color),
            );
          }
        }
        const nowWallClock = performance.now();
        const playbackActive = satPlaybackTimeRef.current != null;
        const updateTelemetry =
          nowWallClock - lastSelectedPositionUiUpdateRef.current >=
          (playbackActive ? 50 : 300);
        const telemetry = updateTelemetry && row.line1 && row.line2
          ? propagateTelemetry(row.line1, row.line2, time)
          : null;
        if (satPlaybackTimeRef.current != null) {
          const now = performance.now();
          if (
            now - lastPlaybackOrbitUpdateRef.current >= 1000 &&
            row.line1 &&
            row.line2
          ) {
            lastPlaybackOrbitUpdateRef.current = now;
            const orbit = orbitPath(row.line1, row.line2, 240, time);
            satLayerRef.current?.setOrbit(
              splitAtAntimeridian(orbit).map((run) =>
                run.map((point) => ({
                  lng: point.lng,
                  lat: point.lat,
                  altKm: point.altKm,
                })),
              ),
              0xffd54f,
            );
          }
        }
        if (updateTelemetry) {
          lastSelectedPositionUiUpdateRef.current = nowWallClock;
          satHeadingRef.current = telemetry?.headingDeg ?? 0;
          if (satPlaybackTimeRef.current != null) {
            const heading = Math.round(satHeadingRef.current);
            setSatPlaybackHeading((previous) =>
              previous === heading ? previous : heading,
            );
          }
          const loc = getLocationTimeInfo(pos.lat, pos.lng);
          const localTime = formatTimeInZone(loc.timeZone, time);
          setSelectedSat((prev) =>
            prev && prev.noradId === row.noradId
              ? {
                  ...prev,
                  lat: pos.lat,
                  lng: pos.lng,
                  alt: pos.altKm,
                  speedKmS: telemetry?.speedKmS ?? prev.speedKmS,
                  headingDeg: telemetry?.headingDeg ?? prev.headingDeg,
                  country: loc.country,
                  countryCode: loc.countryCode,
                  flag: loc.flag,
                  timeZone: loc.timeZone,
                  localTime,
                  line1: prev.line1 || row.line1,
                  line2: prev.line2 || row.line2,
                  updatedAt: time.getTime(),
                }
              : prev,
          );
        }
      }
    };

    const update = () => {
      if (typeof document === "undefined" || !document.hidden) {
        updateSatellitePositions();
      }
      if (satPlaybackTimeRef.current != null && !satPlaybackPlaying) return;
      timer = setTimeout(update, satPlaybackPlaying ? 50 : 100);
    };
    update();
    return () => clearTimeout(timer);
  }, [mapReady, projection, toSatPoints, satPlaybackPlaying, satPlaybackTime, setGeo]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    try {
      const projectionChanged = applyMapProjection(map, projection);
      const configureSky =
        projectionChanged || !containerRef.current?.dataset.mapProjection;
      if (containerRef.current)
        containerRef.current.dataset.mapProjection = projection;
      if (projection === "globe") {
        if (configureSky && map.getPitch() < 0.5)
          map.easeTo({ pitch: 20, duration: 1200 });
        try {
          if (configureSky)
            map.setSky({
              "sky-color": "#04040A",
              "sky-horizon-blend": 0.5,
              "horizon-color": "#0a0a1a",
              "horizon-fog-blend": 0.3,
              "fog-color": "#04040A",
              "fog-ground-blend": 0.9,
            });
        } catch (e) {
          console.warn(
            "[L&T] Suppressed error:",
            e instanceof Error ? e.message : e,
          );
        }
      } else {
        if (map.getPitch() > 0.5) map.easeTo({ pitch: 0, duration: 350 });
      }
    } catch (e) {
      console.warn("Projection switch failed:", e);
    }
  }, [mapReady, projection]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !terrainEnabled) return;
    const map = mapRef.current;
    installTerrainTileProtocol(maplibregl.addProtocol);
    const dispose = attachTerrain(map, (status) =>
      onTerrainStatusChange?.(status),
    );
    return () => {
      if (mapRef.current === map) dispose();
    };
  }, [mapReady, terrainEnabled, terrainRetry, onTerrainStatusChange]);

  useEffect(() => {
    if (
      !mapReady ||
      !mapRef.current ||
      !terrainFocus ||
      !terrainEnabled ||
      lastTerrainFocus.current === terrainFocus
    )
      return;
    lastTerrainFocus.current = terrainFocus;
    const map = mapRef.current;
    map.easeTo({
      zoom: Math.max(10.5, map.getZoom()),
      pitch: 45,
      duration: 650,
    });
  }, [mapReady, terrainFocus, terrainEnabled]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !flyToLocation) return;
    const map = mapRef.current;
    map.flyTo({
      center: [flyToLocation.lng, flyToLocation.lat],
      zoom: flyToLocation.zoom ?? 8,
      duration: flyToLocation.duration ?? 2000,
    });
  }, [mapReady, flyToLocation]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const enabled = activeLayers.terrain_3d;

    try {
      if (enabled) {
        if (!map.getLayer("ltmap-3d-buildings")) {
          map.addLayer({
            id: "ltmap-3d-buildings",
            source: "carto",
            "source-layer": "building",
            type: "fill-extrusion",
            minzoom: 14.5,
            paint: {
              "fill-extrusion-color": [
                "interpolate",
                ["linear"],
                ["get", "render_height"],
                0,
                "#1a1a2e",
                20,
                "#16213e",
                50,
                "#0f3460",
                120,
                "#533483",
                300,
                "#e94560",
              ],
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14.5,
                0,
                15.5,
                ["get", "render_height"],
              ],
              "fill-extrusion-base": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14.5,
                0,
                15.5,
                ["get", "render_min_height"],
              ],
              "fill-extrusion-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14.5,
                0,
                15,
                0.7,
              ],
            },
          });
        }

        if (map.getPitch() < 40) {
          map.easeTo({ pitch: 50, duration: 1200 });
        }
      } else {
        if (map.getLayer("ltmap-3d-buildings"))
          map.removeLayer("ltmap-3d-buildings");
      }
    } catch (e) {
      console.warn("[L&T] 3D terrain toggle error:", e);
    }
  }, [mapReady, activeLayers.terrain_3d]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    try {
      if (mapStyle !== "dark") {
        if (!map.getSource("satellite-tiles")) {
          map.addSource("satellite-tiles", {
            type: "raster",
            tiles: [
              mapImageryTileUrl,
            ],
            tileSize: 256,
            maxzoom: 18,
          });
        }
        if (!map.getLayer("satellite-layer")) {
          // Keep imagery above the dark basemap fills while leaving satellite
          // markers and other overlays visible above it.
          const firstOverlay = [
            "day-night-fill",
            "sat-footprint-fill",
            "sat-glow",
            "sat-dots",
          ].find((id) => map.getLayer(id));
          map.addLayer(
            {
              id: "satellite-layer",
              type: "raster",
              source: "satellite-tiles",
              paint: { "raster-opacity": 1 },
            },
            firstOverlay,
          );
        } else {
          map.setLayoutProperty("satellite-layer", "visibility", "visible");
        }
      } else {
        if (map.getLayer("satellite-layer")) {
          map.setLayoutProperty("satellite-layer", "visibility", "none");
        }
      }
    } catch (e) {
      console.warn("Style switch failed:", e);
    }
  }, [mapReady, mapStyle]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const currentLayers = arcgisLayers || [];
    const currentIds = currentLayers.map((l) => l.id);

    prevArcgisLayersRef.current.forEach((id) => {
      if (!currentIds.includes(id)) {
        const sourceId = `arcgis-${id}`;
        if (map.getLayer(`${sourceId}-fill`))
          map.removeLayer(`${sourceId}-fill`);
        if (map.getLayer(`${sourceId}-line`))
          map.removeLayer(`${sourceId}-line`);
        if (map.getLayer(`${sourceId}-circle`))
          map.removeLayer(`${sourceId}-circle`);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }
    });
    prevArcgisLayersRef.current = currentIds;

    currentLayers.forEach((layer) => {
      const sourceId = `arcgis-${layer.id}`;
      const c = layer.color || "#0072CE";
      const o = layer.opacity ?? 0.8;
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: "geojson",
          data: layer.geojson as GeoJSON.GeoJSON,
        });
        map.addLayer({
          id: `${sourceId}-fill`,
          type: "fill",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": c,
            "fill-opacity": o * 0.15,
            "fill-outline-color": c,
          },
        });
        map.addLayer({
          id: `${sourceId}-line`,
          type: "line",
          source: sourceId,
          filter: [
            "match",
            ["geometry-type"],
            ["LineString", "Polygon"],
            true,
            false,
          ],
          paint: {
            "line-color": c,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              4,
              0.6,
              10,
              1.4,
              14,
              2,
              18,
              3,
            ],
            "line-opacity": o,
          },
        });
        map.addLayer({
          id: `${sourceId}-circle`,
          type: "circle",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": c,
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              4,
              1.5,
              8,
              2.5,
              11,
              4,
              14,
              6,
              18,
              9,
            ],
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              0.4,
              14,
              1.2,
            ],
            "circle-stroke-color": "#000",
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6,
              0.55,
              12,
              0.85,
            ],
          },
        });
      } else {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(
          layer.geojson as GeoJSON.GeoJSON,
        );
        if (map.getLayer(`${sourceId}-fill`)) {
          map.setPaintProperty(`${sourceId}-fill`, "fill-color", c);
          map.setPaintProperty(`${sourceId}-fill`, "fill-opacity", o * 0.15);
          map.setPaintProperty(`${sourceId}-fill`, "fill-outline-color", c);
        }
        if (map.getLayer(`${sourceId}-line`)) {
          map.setPaintProperty(`${sourceId}-line`, "line-color", c);
          map.setPaintProperty(`${sourceId}-line`, "line-opacity", o);
        }
        if (map.getLayer(`${sourceId}-circle`)) {
          map.setPaintProperty(`${sourceId}-circle`, "circle-color", c);
          map.setPaintProperty(`${sourceId}-circle`, "circle-opacity", o);
        }
      }
    });
  }, [mapReady, arcgisLayers]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const reportCenter = () => {
      const c = map.getCenter();
      const b = map.getBounds();
      setCoverageViewBounds(b ? { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() } : null);
      onMapCenter?.({
        lat: c.lat,
        lng: c.lng,
        bounds: b
          ? {
              west: b.getWest(),
              south: b.getSouth(),
              east: b.getEast(),
              north: b.getNorth(),
            }
          : undefined,
      });
    };

    reportCenter();

    map.on("moveend", reportCenter);
    return () => {
      map.off("moveend", reportCenter);
    };
  }, [mapReady, onMapCenter]);

  useEffect(() => {
    if (!selectedSat) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") clearSat();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSat, clearSat]);

  useEffect(() => {
    const noradId = selectedSat?.noradId;
    if (!noradId) return;
    if (satPlaybackTimeRef.current != null) {
      return;
    }

    let active = true;
    let source: EventSource | null = null;
    const updateFromLocalTle = () => {
      const row = satRowsRef.current.find((sat) => sat.noradId === noradId);
      if (!row?.line1 || !row.line2) return;
      const now = new Date(satPlaybackTimeRef.current ?? Date.now());
      const pos = propagateTLE(row.line1, row.line2, now);
      if (!pos || !active) return;
      row.lat = pos.lat;
      row.lng = pos.lng;
      row.alt = pos.altKm;
      const telemetry = propagateTelemetry(row.line1, row.line2, now);
      satHeadingRef.current = telemetry?.headingDeg ?? 0;
      setSatPlaybackHeading(Math.round(satHeadingRef.current));
      const loc = getLocationTimeInfo(pos.lat, pos.lng);
      const localTime = formatTimeInZone(loc.timeZone, now);
      setSelectedSat((prev) =>
        prev && prev.noradId === noradId
          ? {
              ...prev,
              lat: pos.lat,
              lng: pos.lng,
              alt: pos.altKm,
              speedKmS: telemetry?.speedKmS ?? prev.speedKmS,
              headingDeg: telemetry?.headingDeg ?? prev.headingDeg,
              country: loc.country,
              countryCode: loc.countryCode,
              flag: loc.flag,
              timeZone: loc.timeZone,
              localTime,
              line1: prev.line1 || row.line1,
              line2: prev.line2 || row.line2,
              updatedAt: Date.now(),
            }
          : prev,
      );
      if (satPickedRef.current !== null) {
        satLayerRef.current?.updatePoint(satPickedRef.current, {
          lng: pos.lng,
          lat: pos.lat,
          altKm: pos.altKm,
          color: parseColor(
            satColorFor(row.category, row.color, paletteRef.current),
          ),
          size:
            row.category === "science" || /ISS|TIANGONG/i.test(row.name || "")
              ? 30
              : 20,
        });
      }
      if (projection !== "globe") {
        const source = mapRef.current?.getSource("satellites") as
          | maplibregl.GeoJSONSource
          | undefined;
        if (source) {
          source.setData({
            type: "FeatureCollection",
            features: satRowsRef.current.map((sat) => ({
              type: "Feature" as const,
              geometry: {
                type: "Point" as const,
                coordinates: [sat.lng, sat.lat],
              },
              properties: {
                name: sat.name,
                color: satColorFor(sat.category, sat.color, paletteRef.current),
                mission: sat.mission,
                alt: sat.alt,
                noradId: sat.noradId,
                category: sat.category,
              },
            })),
          });
        }
      }
    };
    const applyLivePosition = (data: {
      position?: {
        lat: number;
        lng: number;
        altKm: number;
        speedKmS?: number;
        headingDeg?: number;
      };
    }) => {
        if (
          data.position &&
          active &&
          Number.isFinite(data.position.lat) &&
          Number.isFinite(data.position.lng) &&
          Number.isFinite(data.position.altKm)
        ) {
          const { lat, lng, altKm, speedKmS, headingDeg } = data.position;
          const loc = getLocationTimeInfo(lat, lng);
          const localTime = formatTimeInZone(loc.timeZone, new Date());
          setSelectedSat((prev) => {
            if (!prev || prev.noradId !== noradId) return prev;
            return {
              ...prev,
              lat,
              lng,
              alt: altKm,
              speedKmS,
              headingDeg,
              country: loc.country,
              countryCode: loc.countryCode,
              flag: loc.flag,
              timeZone: loc.timeZone,
              localTime,
              updatedAt: Date.now(),
            };
          });

          if (satPickedRef.current !== null && satLayerRef.current) {
            const idx = satPickedRef.current;
            const currentPoint = satRowsRef.current[idx];
            if (currentPoint) {
              const c = parseColor(
                satColorFor(
                  currentPoint.category,
                  currentPoint.color,
                  paletteRef.current,
                ),
              );
              satLayerRef.current.updatePoint(idx, {
                lng,
                lat,
                altKm,
                color: c,
                size:
                  currentPoint.category === "science" ||
                  /ISS|TIANGONG/i.test(currentPoint.name || "")
                    ? 30.0
                    : 20.0,
              });
            }
          }
        }
    };

    source = new EventSource(api.satellitePositionStream(noradId));
    source.onmessage = (event) => {
      try {
        applyLivePosition(JSON.parse(event.data));
      } catch {
        updateFromLocalTle();
      }
    };
    source.onerror = () => {
      // Keep the map responsive while EventSource retries its connection.
      updateFromLocalTle();
    };
    updateFromLocalTle();
    return () => {
      active = false;
      source?.close();
    };
  }, [selectedSat?.noradId, satPlaybackTime, projection]);



  const handleSelectShipFromSlider = useCallback(
    (ship: NonNullable<SatelliteDetail["inViewShips"]>[number]) => {
      const lat = Number(ship.lat);
      const lng = Number(ship.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !mapRef.current)
        return;
      mapRef.current.flyTo({
        center: [lng, lat],
        zoom: Math.max(mapRef.current.getZoom(), 8),
        duration: 1500,
      });
      onTrackShip?.(ship.mmsi);
      setSelectedShip(ship as unknown as Record<string, unknown>);
    },
    [onTrackShip],
  );

  const handlePlaybackToggle = useCallback(() => {
    if (!selectedSat?.line1 || !selectedSat.line2) return;
    if (satPlaybackTimeRef.current == null) {
      const now = Date.now();
      satPlaybackTimeRef.current = now;
      setSatPlaybackTime(now);
    }
    setSatPlaybackPlaying((value) => !value);
  }, [selectedSat]);

  const handlePlaybackSeek = useCallback((time: number) => {
    satPlaybackTimeRef.current = time;
    setSatPlaybackTime(time);
  }, []);

  const handlePlaybackClose = useCallback(() => {
    setSatPlaybackPlaying(false);
    setSatPlaybackOpen(false);
    satPlaybackTimeRef.current = null;
    setSatPlaybackTime(null);
  }, []);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      {selectedShip && (
        <ShipDetailPanel
          ship={selectedShip}
          position={selectedShipCardPosition}
          onClose={() => {
            setSelectedShip(null);
            onShipSelect?.(null);
            onTrackShip?.(null);
          }}
        />
      )}
      {mapReady && (
        <MapPopups
          mapRef={mapRef}
          popupRef={popupRef}
          onTrackShip={onTrackShip}
          onShipSelect={(ship) => setSelectedShip(ship)}
          liveTrackedShip={liveTrackedShip}
        />
      )}
      {mapReady && showMapControls && <MapControls mapRef={mapRef} />}
      {selectedSat && !isIntelOpen && !showVesselsSlider && (
        <SatelliteCard
          sat={{ ...selectedSat, shipCardOpen: Boolean(selectedShip) }}
          onClose={clearSat}
          onToggleCircumference={() => setShowSatCircumference((visible) => !visible)}
          isCircumferenceActive={showSatCircumference}
          onTogglePlayback={() => {
            setSatPlaybackOpen((open) => {
              const next = !open;
              if (next && satPlaybackTimeRef.current == null) {
                const epoch = Date.now();
                satPlaybackTimeRef.current = epoch;
                setSatPlaybackTime(epoch);
              }
              return next;
            });
            if (satPlaybackTimeRef.current == null) {
              satPlaybackTimeRef.current = Date.now();
              setSatPlaybackTime(satPlaybackTimeRef.current);
            }
          }}
          isPlaybackActive={satPlaybackOpen}
          onOpenIntel={() => {
            setShowVesselsSlider(false);
            setIntelOpen(true);
          }}
          onOpenSlider={() => {
            setIntelOpen(false);
            setShowVesselsSlider(true);
          }}
          onFocusTrack={() => {
            if (
              mapRef.current &&
              selectedSat.lng != null &&
              selectedSat.lat != null
            ) {
              mapRef.current.flyTo({
                center: [selectedSat.lng, selectedSat.lat],
                zoom: Math.max(mapRef.current.getZoom(), 4),
                duration: 1500,
              });
            }
          }}
        />
      )}
      {selectedSat?.lat != null && selectedSat.lng != null && selectedSat.alt != null && (() => {
        const coverage = generateFootprintFeatures({ lng: selectedSat.lng, lat: selectedSat.lat, alt: selectedSat.alt, elevationMaskDeg: 10 });
        const totalAreaKm2 = 2 * Math.PI * 6371 ** 2 * (1 - Math.cos(coverage.angularRadiusRad));
        let viewAreaKm2 = totalAreaKm2;
        const bounds = coverageViewBounds;
        if (bounds) {
          const west = bounds.west, east = bounds.east;
          const south = Math.max(-90, bounds.south), north = Math.min(90, bounds.north);
          const cols = 72, rows = 48;
          const dLon = (east - west) * Math.PI / 180 / cols;
          const dLat = (north - south) * Math.PI / 180 / rows;
          const satLat = selectedSat.lat * Math.PI / 180, satLng = selectedSat.lng * Math.PI / 180;
          viewAreaKm2 = 0;
          for (let row = 0; row < rows; row++) {
            const lat = (south + (row + 0.5) * (north - south) / rows) * Math.PI / 180;
            const cellArea = 6371 ** 2 * dLon * dLat * Math.cos(lat);
            for (let col = 0; col < cols; col++) {
              const lng = (west + (col + 0.5) * (east - west) / cols) * Math.PI / 180;
              const cosDistance = Math.sin(satLat) * Math.sin(lat) + Math.cos(satLat) * Math.cos(lat) * Math.cos(lng - satLng);
              if (Math.acos(Math.max(-1, Math.min(1, cosDistance))) <= coverage.angularRadiusRad) viewAreaKm2 += cellArea;
            }
          }
        }
        const areaKm2 = coverageAreaMode === "total" ? totalAreaKm2 : viewAreaKm2;
        return (
          <div className="pointer-events-auto fixed bottom-10 left-1/2 z-[220] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-cyan-400/30 bg-[#060a14]/95 px-3.5 py-3 font-mono text-[10px] text-cyan-100 shadow-xl backdrop-blur-xl sm:bottom-12">
            <div className="flex items-center justify-between"><span className="text-[9px] uppercase tracking-widest text-cyan-300">Ground coverage · {selectedSat.name}</span><span className="text-[8px] text-zinc-500">ESTIMATE</span></div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div><span className="text-zinc-500">{coverageAreaMode === "total" ? "Total coverage area" : "Coverage in current view"}</span><div className="text-sm font-semibold text-white">{areaKm2 >= 1e6 ? `${(areaKm2 / 1e6).toFixed(2)}M km²` : `${Math.round(areaKm2).toLocaleString()} km²`}</div></div>
              <div><span className="text-zinc-500">Footprint radius</span><div className="text-sm font-semibold text-white">{Math.round(coverage.radiusKm).toLocaleString()} km</div></div>
            </div>
            <div className="mt-2 border-t border-white/10 pt-2 text-[9px] leading-relaxed text-zinc-400">
              <div><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-cyan-300/70 align-middle" />Cyan cone: selected satellite&apos;s estimated ground coverage</div>
              <div className="mt-1">Dotted edge: 10° minimum elevation · altitude {Math.round(selectedSat.alt).toLocaleString()} km</div>
            </div>
            <div className="mt-2 flex justify-end"><button type="button" onClick={() => setCoverageAreaMode(mode => mode === "total" ? "view" : "total")} className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[9px] font-semibold text-cyan-200 hover:bg-cyan-400/20">Show {coverageAreaMode === "total" ? "current viewing area" : "total coverage area"}</button></div>
          </div>
        );
      })()}
      {selectedSat && showVesselsSlider && (
        <SatelliteVesselsSlider
          sat={selectedSat}
          onClose={() => setShowVesselsSlider(false)}
          onSelectShip={handleSelectShipFromSlider}
        />
      )}
      {selectedSat && satPlaybackOpen && !isIntelOpen && !showVesselsSlider && (
        <SatellitePlaybackBar
          satellite={selectedSat}
          time={satPlaybackTime ?? selectedSat.updatedAt ?? 0}
          playing={satPlaybackPlaying}
          rate={satPlaybackRate}
          heading={satPlaybackHeading}
          onToggle={handlePlaybackToggle}
          onRateChange={(rate) => setSatPlaybackRate(rate)}
          onSeek={handlePlaybackSeek}
          onClose={handlePlaybackClose}
        />
      )}
      <SatelliteIntelSidebar
        sat={selectedSat}
        isOpen={isIntelOpen}
        onClose={() => setIntelOpen(false)}
        onOpenSlider={() => {
          setIntelOpen(false);
          setShowVesselsSlider(true);
        }}
      />
      {hoveredSat && (
        <div
          className="pointer-events-none fixed z-450 -translate-x-1/2 -translate-y-full -mt-2.5 px-2.5 py-1 rounded-lg bg-[#060a14]/94 backdrop-blur-md border border-cyan-400/50 shadow-[0_0_15px_rgba(0,229,255,0.3)] flex items-center gap-1.5 transition-all select-none animate-in fade-in duration-100"
          style={{ left: hoveredSat.x, top: hoveredSat.y }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping flex-shrink-0" />
          <span className="text-xs font-mono font-bold tracking-wider text-amber-300 whitespace-nowrap drop-shadow-[0_0_6px_rgba(255,215,0,0.3)]">
            {hoveredSat.name}
          </span>
          {hoveredSat.category && (
            <span className="text-[8px] uppercase font-mono px-1 py-0.2 rounded bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 font-semibold whitespace-nowrap">
              {hoveredSat.category.replace("_", " ")}
            </span>
          )}
          {hoveredSat.alt != null && (
            <span className="text-[9px] font-mono text-zinc-400 whitespace-nowrap">
              {Math.round(hoveredSat.alt)}km
            </span>
          )}
        </div>
      )}
    </>
  );
}

export default memo(LTmap);
