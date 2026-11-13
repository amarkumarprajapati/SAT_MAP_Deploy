"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LTmapProps, SatelliteRow } from "@/lib/map.types";
import { createWindField, type WindPoint } from "@/lib/wind-field";
import type { Map as LeafletMapInstance } from "leaflet";
import type { Group, WebGLRenderer } from "three";

type CoreMapProps = LTmapProps;
type AnyRow = Record<string, unknown>;
const numeric = (value: unknown) => Number(value);
const finite = (value: unknown) => Number.isFinite(numeric(value));

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
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    if (!map || !enabled) return;
    let disposed = false;
    let frame = 0;
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
        if (!response.ok) throw new Error(`Wind API returned ${response.status}`);
        const body = await response.json() as { points?: WindPoint[] };
        if (!body.points?.length) throw new Error("Wind API returned no points");
        const nextField = createWindField(body.points);
        if (disposed) return;
        field = nextField;
        setStatus("ready");
        frame = requestAnimationFrame(animate);
      } catch (error) {
        if (disposed || (error instanceof Error && error.name === "AbortError")) return;
        console.error("[Wind] Loading failed:", error);
        setStatus("error");
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
      baseLayerRef.current = L.tileLayer("https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
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
        : "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
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
          {windEnabled ? `WIND ${windStatus === "ready" ? "ON" : windStatus === "error" ? "RETRYING" : "LOADING"}` : "WIND OFF"}
        </button>
      )}
      {!mapReady && <div className="absolute inset-0 grid place-items-center pointer-events-none text-[10px] font-mono tracking-[.25em] text-white/40">INITIALIZING 2D MAP</div>}
    </div>
  );
}

function fallbackEarthTexture(width = 1024, height = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#091522"; ctx.fillRect(0, 0, width, height);
  const project = (lon: number, lat: number): [number, number] => [(lon + 180) / 360 * width, (90 - lat) / 180 * height];
  const land = (points: [number, number][]) => {
    ctx.beginPath(); points.forEach(([lon, lat], index) => { const [x, y] = project(lon, lat); index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fillStyle = "#1b3445"; ctx.fill(); ctx.strokeStyle = "#446174"; ctx.lineWidth = 1; ctx.stroke();
  };
  land([[-168,70],[-150,60],[-132,55],[-125,48],[-124,40],[-117,32],[-108,28],[-98,17],[-88,18],[-82,25],[-80,32],[-74,40],[-60,50],[-65,58],[-80,62],[-95,72],[-120,75],[-145,70]]);
  land([[-81,12],[-70,8],[-50,-5],[-43,-20],[-52,-35],[-66,-55],[-75,-42],[-78,-20]]);
  land([[-10,36],[-8,50],[4,58],[20,62],[35,56],[42,48],[32,42],[28,35],[18,36],[10,42],[2,40]]);
  land([[-18,34],[2,37],[24,32],[35,20],[43,8],[40,-8],[30,-23],[18,-35],[4,-34],[-8,-20],[-16,0]]);
  land([[35,55],[48,65],[80,72],[105,68],[130,58],[155,52],[175,60],[160,45],[145,35],[130,28],[120,18],[108,7],[100,5],[93,18],[80,8],[72,20],[60,25],[50,35],[42,42]]);
  land([[112,-11],[130,-12],[150,-20],[154,-34],[142,-40],[126,-35],[114,-25]]);
  land([[-52,82],[-35,78],[-42,60],[-55,58],[-63,70]]);
  ctx.strokeStyle = "rgba(113,174,207,.20)"; ctx.lineWidth = 1;
  for (let lat = -60; lat <= 60; lat += 30) { const [, y] = project(0, lat); ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(width,y); ctx.stroke(); }
  for (let lon = -150; lon <= 180; lon += 30) { const [x] = project(lon,0); ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.stroke(); }
  return canvas;
}

async function globeTexture(THREE: typeof import("three"), satellite: boolean) {
  const canvas = fallbackEarthTexture();
  const ctx = canvas.getContext("2d")!;
  const tileZoom = 2, count = 2 ** tileZoom;
  let loaded = 0;
  await Promise.all(Array.from({ length: count * count }, (_, index) => {
    const x = index % count, y = Math.floor(index / count);
    return new Promise<void>((resolve) => {
      const image = new Image(); image.crossOrigin = "anonymous";
      image.onload = () => {
        const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / count))) * 180 / Math.PI;
        const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / count))) * 180 / Math.PI;
        const top = (90 - north) / 180 * canvas.height;
        const bottom = (90 - south) / 180 * canvas.height;
        ctx.drawImage(image, x * 256, top, 256, bottom - top);
        loaded += 1; resolve();
      };
      image.onerror = () => resolve();
      image.src = satellite
        ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tileZoom}/${y}/${x}`
        : `https://basemaps.cartocdn.com/dark_all/${tileZoom}/${x}/${y}.png`;
    });
  }));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { texture, hasTiles: loaded > 0 };
}

function GlobeMap({ props }: { props: CoreMapProps }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<Group | null>(null);
  const entityGroupRef = useRef<Group | null>(null);
  const runtimeRef = useRef<{ THREE: typeof import("three"); renderer: WebGLRenderer; camera: import("three").PerspectiveCamera; scene: import("three").Scene; earth: import("three").Mesh } | null>(null);
  const propsRef = useRef(props);
  const [status, setStatus] = useState("BUILDING GLOBE");
  useEffect(() => { propsRef.current = props; }, [props]);

  useEffect(() => {
    let disposed = false;
    let animation = 0;
    let resizeObserver: ResizeObserver | undefined;
    const cleanup: Array<() => void> = [];
    void (async () => {
      const host = hostRef.current;
      if (!host) return;
      const THREE = await import("three");
      if (disposed) return;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      camera.position.set(0, 0, 3.25);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.domElement.className = "absolute inset-0 h-full w-full touch-none outline-none";
      renderer.domElement.style.touchAction = "none";
      host.appendChild(renderer.domElement);
      scene.add(new THREE.AmbientLight(0xffffff, 1.45));
      const keyLight = new THREE.DirectionalLight(0x98d8ff, 1.15); keyLight.position.set(-2, 2, 3); scene.add(keyLight);
      const globe = new THREE.Group(); scene.add(globe); globeRef.current = globe;
      const fallback = fallbackEarthTexture();
      const texture = new THREE.CanvasTexture(fallback); texture.colorSpace = THREE.SRGBColorSpace;
      const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 80, 56), new THREE.MeshBasicMaterial({ map: texture }));
      globe.add(earth);
      const entities = new THREE.Group(); globe.add(entities); entityGroupRef.current = entities;
      runtimeRef.current = { THREE, renderer, camera, scene, earth };
      const layer = new THREE.Mesh(new THREE.SphereGeometry(1.035, 32, 24), new THREE.ShaderMaterial({
        transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending,
        vertexShader: "varying vec3 vNormal; void main(){ vNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader: "varying vec3 vNormal; void main(){ float a=pow(0.72-max(0.0,dot(normalize(vNormal),vec3(0.0,0.0,1.0))),2.0); gl_FragColor=vec4(0.0,0.72,1.0,a*0.30); }",
      })); globe.add(layer);

      const updateSize = () => {
        if (!hostRef.current) return;
        const width = Math.max(hostRef.current.clientWidth, 1), height = Math.max(hostRef.current.clientHeight, 1);
        camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height);
      };
      resizeObserver = new ResizeObserver(updateSize); resizeObserver.observe(host);
      const render = () => { if (disposed) return; renderer.render(scene, camera); animation = requestAnimationFrame(render); };
      render();

      const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
      let down: { x: number; y: number; moved: boolean } | null = null;
      const reportGlobeCenter = () => {
        const lat = globe.rotation.x * 57.2958;
        const lng = -globe.rotation.y * 57.2958;
        const zoom = Math.max(1, 4 - camera.position.z);
        propsRef.current.onMapCenter?.({ lat, lng, zoom, bounds: { west: -180, south: -85, east: 180, north: 85 } });
        propsRef.current.onViewStateChange?.({ latitude: lat, longitude: lng, zoom });
      };
      const setPointer = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
      };
      const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY, moved: false }; renderer.domElement.setPointerCapture(event.pointerId); };
      const onMove = (event: PointerEvent) => {
        if (down) {
          const dx = event.clientX - down.x, dy = event.clientY - down.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) down.moved = true;
          if (down.moved && globeRef.current) {
            globeRef.current.rotation.y += dx * 0.0045;
            globeRef.current.rotation.x = Math.max(-1.25, Math.min(1.25, globeRef.current.rotation.x + dy * 0.0045));
            down.x = event.clientX; down.y = event.clientY;
            propsRef.current.onViewStateChange?.({ zoom: Math.max(1, 4 - camera.position.z), latitude: globe.rotation.x * 57.2958, longitude: -globe.rotation.y * 57.2958 });
          }
          return;
        }
        setPointer(event);
        const hit = raycaster.intersectObject(earth, false)[0];
        if (hit) {
          const local = globe.worldToLocal(hit.point.clone()).normalize();
          propsRef.current.onMouseCoords?.({ lat: Math.asin(local.y) * 57.2958, lng: Math.atan2(local.z, local.x) * 57.2958 });
        }
      };
      const onUp = (event: PointerEvent) => {
        const wasClick = down && !down.moved;
        const wasDrag = down?.moved ?? false;
        down = null;
        if (wasDrag) reportGlobeCenter();
        if (!wasClick) return;
        setPointer(event);
        const hit = raycaster.intersectObjects(entities.children, true).find((item) => {
          const records = item.object.userData.entities as AnyRow[] | undefined;
          return item.instanceId !== undefined && !!records?.[item.instanceId];
        });
        const records = hit?.object.userData.entities as AnyRow[] | undefined;
        const entity = hit?.instanceId === undefined ? undefined : records?.[hit.instanceId];
        if (entity) {
          propsRef.current.onEntityClick?.(entity);
          if (entity.type === "ship") propsRef.current.onShipSelect?.(entity);
          if (entity.type === "satellite") propsRef.current.onSatelliteSelect?.(entity as never);
          return;
        }
        const earthHit = raycaster.intersectObject(earth, false)[0];
        if (earthHit) {
          const local = globe.worldToLocal(earthHit.point.clone()).normalize();
          const coords = { lat: Math.asin(local.y) * 57.2958, lng: Math.atan2(local.z, local.x) * 57.2958 };
          propsRef.current.onMouseCoords?.(coords);
        }
      };
      const onContext = (event: MouseEvent) => {
        event.preventDefault(); setPointer(event as PointerEvent);
        const hit = raycaster.intersectObject(earth, false)[0];
        if (hit) { const local = globe.worldToLocal(hit.point.clone()).normalize(); propsRef.current.onRightClick?.({ lat: Math.asin(local.y) * 57.2958, lng: Math.atan2(local.z, local.x) * 57.2958 }); }
      };
      const onWheel = (event: WheelEvent) => {
        event.preventDefault(); camera.position.z = Math.max(1.65, Math.min(5, camera.position.z + event.deltaY * 0.002));
        propsRef.current.onViewStateChange?.({ zoom: Math.max(1, 4 - camera.position.z), latitude: globe.rotation.x * 57.2958, longitude: -globe.rotation.y * 57.2958 });
      };
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("contextmenu", onContext);
      renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
      cleanup.push(() => renderer.domElement.removeEventListener("pointerdown", onDown), () => renderer.domElement.removeEventListener("pointermove", onMove), () => renderer.domElement.removeEventListener("pointerup", onUp), () => renderer.domElement.removeEventListener("contextmenu", onContext), () => renderer.domElement.removeEventListener("wheel", onWheel));

      void globeTexture(THREE, propsRef.current.mapStyle === "satellite").then(({ texture: nextTexture }) => {
        if (disposed) { nextTexture.dispose(); return; }
        (earth.material as import("three").MeshBasicMaterial).map?.dispose();
        (earth.material as import("three").MeshBasicMaterial).map = nextTexture;
        (earth.material as import("three").MeshBasicMaterial).needsUpdate = true;
        setStatus("GLOBE READY");
      }).catch((error) => { console.warn("[Globe] Basemap texture unavailable; using built-in map.", error); setStatus("GLOBE READY"); });
      propsRef.current.onReady?.();
      if (propsRef.current.homeLocation) {
        globe.rotation.y = -propsRef.current.homeLocation.lng * Math.PI / 180;
        globe.rotation.x = propsRef.current.homeLocation.lat * Math.PI / 180;
      }
      reportGlobeCenter();
      setStatus("LOADING BASEMAP");
    })().catch((error) => { console.error("[Globe] Initialization failed:", error); setStatus("GLOBE UNAVAILABLE"); });

    return () => {
      disposed = true; cancelAnimationFrame(animation); resizeObserver?.disconnect(); cleanup.forEach((fn) => fn());
      if (runtimeRef.current) { runtimeRef.current.renderer.dispose(); runtimeRef.current.renderer.domElement.remove(); }
      runtimeRef.current = null; globeRef.current = null; entityGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current, group = entityGroupRef.current;
    if (!runtime || !group) return;
    const { THREE } = runtime;
    for (const object of [...group.children]) {
      group.remove(object);
      const mesh = object as import("three").Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    }
    const addInstances = (records: Array<{ lat: number; lng: number; radius: number; color: string; entity: AnyRow }>, markerSize: number) => {
      if (!records.length) return;
      const mesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 7, 5),
        new THREE.MeshBasicMaterial({ vertexColors: true }),
        records.length,
      );
      const point = new THREE.Object3D();
      records.forEach((record, index) => {
        const latRad = record.lat * Math.PI / 180, lngRad = record.lng * Math.PI / 180;
        point.position.set(record.radius * Math.cos(latRad) * Math.cos(lngRad), record.radius * Math.sin(latRad), record.radius * Math.cos(latRad) * Math.sin(lngRad));
        point.scale.setScalar(markerSize); point.updateMatrix(); mesh.setMatrixAt(index, point.matrix);
        mesh.setColorAt(index, new THREE.Color(record.color));
      });
      mesh.userData.entities = records.map((record) => record.entity);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    };
    if (props.activeLayers.ship_cargo || props.activeLayers.ship_tanker || props.activeLayers.ship_military) {
      const records = [];
      for (const ship of filteredShips(props.data, props.activeLayers).slice(0, 2500)) {
        const lat = numeric(ship.lat), lng = numeric(ship.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) records.push({ lat, lng, radius: 1.007, color: shipColor(ship), entity: { ...ship, type: "ship", lat, lng } });
      }
      addInstances(records, 0.007);
    }
    if (hasSatelliteLayer(props.activeLayers)) {
      const records = [];
      for (const sat of filteredSatellites(props.data, props.activeLayers).slice(0, 2200)) {
        const lat = numeric(sat.lat), lng = numeric(sat.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          const alt = Math.max(0, numeric(sat.alt) || 0);
          records.push({ lat, lng, radius: 1.015 + Math.min(alt, 30000) / 30000 * .15, color: sat.color || "#ffd166", entity: { ...sat, type: "satellite", lat, lng } });
        }
      }
      addInstances(records, 0.009);
    }
  }, [props.data, props.activeLayers, status]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !props.flyToLocation) return;
    globe.rotation.y = -props.flyToLocation.lng * Math.PI / 180;
    globe.rotation.x = props.flyToLocation.lat * Math.PI / 180;
    const runtime = runtimeRef.current;
    if (runtime) runtime.camera.position.z = Math.max(1.65, Math.min(4.8, 5.2 - (props.flyToLocation.zoom ?? 2) * 0.42));
    propsRef.current.onMapCenter?.({ lat: props.flyToLocation.lat, lng: props.flyToLocation.lng, zoom: props.flyToLocation.zoom ?? 2, bounds: { west: -180, south: -85, east: 180, north: 85 } });
  }, [props.flyToLocation]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtime.earth) return;
    void globeTexture(runtime.THREE, props.mapStyle === "satellite").then(({ texture }) => {
      if (runtimeRef.current !== runtime) { texture.dispose(); return; }
      const material = runtime.earth.material as import("three").MeshBasicMaterial;
      material.map?.dispose(); material.map = texture; material.needsUpdate = true;
    });
  }, [props.mapStyle]);

  return <div className="absolute inset-0 overflow-hidden bg-[#030914]"><div ref={hostRef} className="absolute inset-0" /><div className="pointer-events-none absolute bottom-36 left-4 z-20 rounded-lg border border-cyan-300/15 bg-[#06101b]/75 px-3 py-2 font-mono text-[9px] tracking-[.18em] text-cyan-100/70 backdrop-blur">{status} · {filteredSatellites(props.data, props.activeLayers).length.toLocaleString()} SAT · {filteredShips(props.data, props.activeLayers).length.toLocaleString()} VESSELS</div><div className="pointer-events-none absolute bottom-8 left-1/2 z-20 -translate-x-1/2 font-mono text-[9px] tracking-[.16em] text-white/40">DRAG TO ROTATE · SCROLL TO ZOOM</div></div>;
}

export default function LeafletCoreMap(props: CoreMapProps) {
  return props.projection === "mercator" ? <LeafletMapView props={props} /> : <GlobeMap props={props} />;
}
