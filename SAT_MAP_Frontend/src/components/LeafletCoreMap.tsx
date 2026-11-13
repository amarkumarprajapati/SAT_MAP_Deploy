"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LTmapProps, SatelliteRow } from "@/lib/map.types";
import { createWindField, type WindPoint } from "@/lib/wind-field";
import type { Map as LeafletMapInstance } from "leaflet";

type CoreMapProps = LTmapProps;
type AnyRow = Record<string, unknown>;
const numeric = (value: unknown) => Number(value);
const finite = (value: unknown) => Number.isFinite(numeric(value));
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_BASEMAPS_KEY?.trim();
const cartoTileUrl = (url: string) => CARTO_KEY ? `${url}?key=${encodeURIComponent(CARTO_KEY)}` : url;
const LegacyGlobe = dynamic(() => import("@/components/LTmap"), { ssr: false });

function filteredShips(data: Record<string, unknown>, layers: Record<string, boolean>) {
  const rows = Array.isArray(data.maritime_ships) ? data.maritime_ships as AnyRow[] : [];
  return rows.filter((ship) => {
    const type = String(ship.type ?? "cargo").toLowerCase();
    if (type === "tanker") return !!layers.ship_tanker;
    if (type === "military" || type === "naval") return !!layers.ship_military;
    return !!layers.ship_cargo;
  });
}

function filteredSatellites(data: Record<string, unknown>, layers: Record<string, boolean>) {
  const rows = Array.isArray(data.satellites) ? data.satellites as SatelliteRow[] : [];
  return rows.filter((sat) => {
    const category = String(sat.category ?? "").toLowerCase();
    if (category === "military") return !!layers.sat_military;
    if (category === "navigation") return !!layers.sat_navigation;
    if (category === "earth_obs" || category === "earth observation") return !!layers.sat_earth;
    if (category === "science") return !!layers.sat_science;
    if (category === "communications" || category === "comms") return !!layers.sat_comms;
    return !!layers.satellites;
  });
}

function hasSatelliteLayer(layers: Record<string, boolean>) {
  return !!(layers.satellites || layers.sat_comms || layers.sat_military || layers.sat_navigation || layers.sat_earth || layers.sat_science);
}

function shipColor(ship: AnyRow) {
  const type = String(ship.type ?? "cargo").toLowerCase();
  return type === "tanker" ? "#ff9500" : type === "military" || type === "naval" ? "#ff405b" : "#00e5ff";
}

function useWindCanvas(map: LeafletMapInstance | null, enabled: boolean) {
  const [status, setStatus] = useState<"loading" | "ready" | "stale" | "error">("loading");
  useEffect(() => {
    if (!map || !enabled) return;
    let disposed = false;
    let frame = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let ctx: CanvasRenderingContext2D | null = null;
    let field: ReturnType<typeof createWindField> | undefined;
    let particles: Array<{ x: number; y: number; age: number }> = [];

    const resize = () => {
      if (!canvas) return;
      const size = map.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(size.x * dpr));
      canvas.height = Math.max(1, Math.round(size.y * dpr));
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: Math.max(350, Math.min(1100, Math.round(size.x * size.y / 950))) }, () => ({
        x: Math.random() * size.x,
        y: Math.random() * size.y,
        age: Math.random() * 100,
      }));
    };

    const animate = () => {
      if (disposed || !ctx || !field || !canvas || document.hidden) {
        if (!disposed) frame = requestAnimationFrame(animate);
        return;
      }
      const size = map.getSize();
      ctx.fillStyle = "rgba(3, 8, 15, 0.12)";
      ctx.fillRect(0, 0, size.x, size.y);
      const zoom = map.getZoom();
      const baseSpeed = 0.0032 * 2 ** Math.max(0, Math.min(zoom, 8));
      ctx.lineWidth = 1.15;
      ctx.strokeStyle = "rgba(224, 243, 250, 0.68)";
      ctx.beginPath();
      for (const p of particles) {
        const fromX = p.x;
        const fromY = p.y;
        const coordinate = map.containerPointToLatLng([p.x, p.y]);
        const vector = field(coordinate.lng, coordinate.lat);
        const eastScale = 1 / Math.max(0.28, Math.cos((coordinate.lat * Math.PI) / 180));
        p.x += vector.u * baseSpeed * eastScale;
        p.y -= vector.v * baseSpeed;
        p.age += 1;
        if (p.age > 110 || p.x < -5 || p.y < -5 || p.x > size.x + 5 || p.y > size.y + 5) {
          p.x = Math.random() * size.x;
          p.y = Math.random() * size.y;
          p.age = 0;
          continue;
        }
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      frame = requestAnimationFrame(animate);
    };

    const load = async () => {
      controller = new AbortController();
      try {
        const response = await fetch("/api/weather/wind-data?grid=global", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          if (response.status === 503) {
            setStatus("loading");
            refreshTimer = setTimeout(() => void load(), 15 * 1000);
            return;
          }
          throw new Error(`Wind API returned ${response.status}`);
        }
        const body = await response.json() as { points?: WindPoint[]; stale?: boolean };
        if (!body.points?.length) throw new Error("Wind API returned no points");
        const nextField = createWindField(body.points);
        if (disposed) return;
        field = nextField;
        setStatus(body.stale ? "stale" : "ready");
        if (!frame) frame = requestAnimationFrame(animate);
        refreshTimer = setTimeout(() => void load(), 60 * 60 * 1000);
      } catch (error) {
        if (disposed || (error instanceof Error && error.name === "AbortError")) return;
        console.error("[Wind] Loading failed:", error);
        setStatus("error");
        refreshTimer = setTimeout(() => void load(), 60 * 1000);
      }
    };

    canvas = document.createElement("canvas");
    canvas.className = "leaflet-wind-particles";
    Object.assign(canvas.style, { position: "absolute", top: "0", left: "0", zIndex: "350", pointerEvents: "none" });
    map.getContainer().appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    map.on("resize", resize);
    document.addEventListener("visibilitychange", resize);
    void load();

    return () => {
      disposed = true;
      controller?.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
      cancelAnimationFrame(frame);
      map.off("resize", resize);
      document.removeEventListener("visibilitychange", resize);
      canvas?.remove();
    };
  }, [map, enabled]);
  return status;
}

function LeafletMapView({ props }: { props: CoreMapProps }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const baseLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const shipLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const satelliteLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const propsRef = useRef(props);
  const [map, setMap] = useState<LeafletMapInstance | null>(null);
  const [windEnabled, setWindEnabled] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const windStatus = useWindCanvas(map, windEnabled && !!props.activeLayers.wind);

  useEffect(() => { propsRef.current = props; }, [props]);

  useEffect(() => {
    let disposed = false;
    let instance: LeafletMapInstance | undefined;
    void import("leaflet").then((L) => {
      if (disposed || !containerRef.current) return;
      instance = L.map(containerRef.current, {
        center: propsRef.current.homeLocation ? [propsRef.current.homeLocation.lat, propsRef.current.homeLocation.lng] : [20, 0], zoom: 2, minZoom: 1.4, maxZoom: 18,
        worldCopyJump: true, preferCanvas: true, zoomControl: false,
      });
      baseLayerRef.current = L.tileLayer(cartoTileUrl("https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png"), {
        attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19, crossOrigin: true,
      }).addTo(instance);
      L.control.zoom({ position: "bottomright" }).addTo(instance);
      shipLayerRef.current = L.layerGroup().addTo(instance);
      satelliteLayerRef.current = L.layerGroup().addTo(instance);
      mapRef.current = instance;
      setMap(instance);
      const report = () => {
        const center = instance!.getCenter();
        const bounds = instance!.getBounds();
        propsRef.current.onViewStateChange?.({ zoom: instance!.getZoom(), latitude: center.lat, longitude: center.lng });
        propsRef.current.onMapCenter?.({
          lat: center.lat, lng: center.lng, zoom: instance!.getZoom(),
          bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
        });
      };
      instance.on("moveend zoomend", report);
      instance.on("click", (event) => {
        const { lat, lng } = event.latlng;
        propsRef.current.onMouseCoords?.({ lat, lng });
      });
      instance.on("contextmenu", (event) => propsRef.current.onRightClick?.({ lat: event.latlng.lat, lng: event.latlng.lng }));
      let lastMouseReport = 0;
      instance.on("mousemove", (event) => {
        const now = performance.now();
        if (now - lastMouseReport < 80) return;
        lastMouseReport = now;
        propsRef.current.onMouseCoords?.({ lat: event.latlng.lat, lng: event.latlng.lng });
      });
      instance.whenReady(() => {
        setMapReady(true);
        propsRef.current.onReady?.();
        report();
      });
      requestAnimationFrame(() => instance?.invalidateSize());
    }).catch((error) => console.error("[Map] Leaflet failed to load:", error));
    return () => {
      disposed = true;
      instance?.remove();
      mapRef.current = null;
      shipLayerRef.current = null;
      satelliteLayerRef.current = null;
      baseLayerRef.current = null;
      setMap(null);
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    void import("leaflet").then((L) => {
      const style = props.mapStyle;
      if (map !== mapRef.current || propsRef.current.mapStyle !== style) return;
      const url = style === "satellite"
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : cartoTileUrl("https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png");
      baseLayerRef.current = L.tileLayer(url, { attribution: style === "satellite" ? "Tiles © Esri" : "© OpenStreetMap contributors © CARTO", maxZoom: 19, crossOrigin: true }).addTo(map);
    });
  }, [map, props.mapStyle]);

  useEffect(() => {
    const LPromise = import("leaflet");
    void LPromise.then((L) => {
      if (map !== mapRef.current || !shipLayerRef.current || !satelliteLayerRef.current) return;
      const shipsLayer = shipLayerRef.current;
      const satellitesLayer = satelliteLayerRef.current;
      shipsLayer.clearLayers();
      satellitesLayer.clearLayers();
      if (props.activeLayers.ship_cargo || props.activeLayers.ship_tanker || props.activeLayers.ship_military) {
        for (const ship of filteredShips(props.data, props.activeLayers).slice(0, 1600)) {
          const lat = numeric(ship.lat), lng = numeric(ship.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
          const marker = L.circleMarker([lat, lng], { radius: 4, color: shipColor(ship), weight: 1, opacity: .9, fillColor: shipColor(ship), fillOpacity: .78 });
          marker.on("click", () => {
            const entity = { ...ship, type: "ship", lat, lng };
            propsRef.current.onEntityClick?.(entity);
            propsRef.current.onShipSelect?.(entity);
          });
          marker.addTo(shipsLayer);
        }
      }
      if (hasSatelliteLayer(props.activeLayers)) {
        for (const sat of filteredSatellites(props.data, props.activeLayers).slice(0, 1800)) {
          const lat = numeric(sat.lat), lng = numeric(sat.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
          const marker = L.circleMarker([lat, lng], { radius: 4, color: sat.color || "#ffd166", weight: 1, fillColor: sat.color || "#ffd166", fillOpacity: .88 });
          marker.on("click", () => {
            const entity = { ...sat, type: "satellite", lat, lng };
            propsRef.current.onEntityClick?.(entity);
            propsRef.current.onSatelliteSelect?.(entity as never);
          });
          marker.addTo(satellitesLayer);
        }
      }
    });
  }, [map, props.data, props.activeLayers]);

  useEffect(() => {
    if (!map || !props.flyToLocation) return;
    map.flyTo([props.flyToLocation.lat, props.flyToLocation.lng], props.flyToLocation.zoom ?? map.getZoom(), { duration: (props.flyToLocation.duration ?? 900) / 1000 });
  }, [map, props.flyToLocation]);

  const toggleWind = useCallback(() => setWindEnabled((value) => !value), []);
  return (
    <div className="absolute inset-0 bg-[#070b12]">
      <div ref={containerRef} className="absolute inset-0 z-0" />
      {props.activeLayers.wind && (
        <button type="button" onClick={toggleWind} className="absolute left-4 bottom-28 z-[500] rounded-lg border border-white/15 bg-black/70 px-3 py-2 text-[10px] font-mono tracking-wider text-white/80 backdrop-blur" aria-pressed={windEnabled}>
          {windEnabled ? `WIND ${windStatus === "ready" ? "ON" : windStatus === "stale" ? "CACHED" : windStatus === "error" ? "RETRYING" : "LOADING"}` : "WIND OFF"}
        </button>
      )}
      {!mapReady && <div className="absolute inset-0 grid place-items-center pointer-events-none text-[10px] font-mono tracking-[.25em] text-white/40">INITIALIZING 2D MAP</div>}
    </div>
  );
}

export default function LeafletCoreMap(props: CoreMapProps) {
  return props.projection === "mercator" ? <LeafletMapView props={props} /> : <LegacyGlobe {...props} />;
}
