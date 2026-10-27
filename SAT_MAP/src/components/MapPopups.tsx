'use client';

import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';

/** Safe HTML character escaping to prevent XSS in MapLibre popups */
export const htmlEsc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const BASE_POPUP_STYLE = `
  background: rgba(8, 12, 22, 0.96);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 16px;
  padding: 14px 16px;
  box-shadow: 0 20px 45px -10px rgba(0,0,0,0.85);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #f1f5f9;
  box-sizing: border-box;
`;

export interface ShipPopupProps {
  type?: string;
  heading?: number | string | null;
  speed?: number | string | null;
  track?: Array<{ lat: number; lng: number; timestamp: number; speed?: number | null }> | string;
  trackStartLat?: number | null;
  trackStartLng?: number | null;
  trackStartAt?: number | null;
  firstSeenLat?: number | null;
  firstSeenLng?: number | null;
  firstSeenAt?: number | null;
  lastSeenAt?: number | null;
  timestamp?: number | null;
  trackDistanceKm?: number | null;
  trackPointCount?: number | null;
  flag?: string;
  name?: string;
  mmsi?: string | number;
  id?: string | number;
  destination?: string;
  [key: string]: unknown;
}

export interface FlightPopupProps {
  callsign?: string;
  alt?: number;
  speed_knots?: number;
  heading?: number;
  icao24?: string;
  model?: string;
  [key: string]: unknown;
}

export interface PortPopupProps {
  type?: string;
  name?: string;
  country?: string;
  congestion?: string;
  dwell_time?: string;
  volume?: string;
  fleet?: string;
  rank?: string | number;
  [key: string]: unknown;
}

export interface ChokepointPopupProps {
  name?: string;
  traffic?: string;
  risk?: string;
  [key: string]: unknown;
}

/**
 * 1. Maritime Ship Detail Popup
 * Modern tactical OSINT HUD card without third-party external links.
 */
export function renderShipPopup(p: ShipPopupProps, coords: [number, number], isLive = false): string {
  const isMilitary = p.type === 'military';
  const isTanker = p.type === 'tanker';
  const color = isMilitary ? '#FF1744' : isTanker ? '#FF9500' : '#00E5FF';
  const icon = isMilitary ? '⚔️' : isTanker ? '🛢️' : '🚢';

  const headingVal = p.heading != null && Number(p.heading) >= 0 ? `${Number(p.heading).toFixed(0)}°` : '—';
  const speedVal = Number(p.speed || 0).toFixed(1);
  const statusLabel = Number(p.speed || 0) > 0.5 ? 'UNDERWAY' : 'MOORED / ANCHORED';
  const statusColor = Number(p.speed || 0) > 0.5 ? '#10b981' : '#38bdf8';
  const track: Array<{ lat: number; lng: number; timestamp: number; speed?: number | null }> = Array.isArray(p.track) ? p.track : [];
  const startLat = p.trackStartLat ?? p.firstSeenLat ?? track[0]?.lat;
  const startLng = p.trackStartLng ?? p.firstSeenLng ?? track[0]?.lng;
  const startAt = p.trackStartAt ?? p.firstSeenAt ?? track[0]?.timestamp;
  const lastSeenAt = p.lastSeenAt ?? p.timestamp ?? track.at(-1)?.timestamp;
  const startLabel = startAt ? new Date(Number(startAt) * 1000).toLocaleString() : 'First position observed by this feed';
  const lastSeenLabel = lastSeenAt ? new Date(Number(lastSeenAt) * 1000).toLocaleString() : 'Unavailable';
  const distance = Number(p.trackDistanceKm);
  const distanceLabel = Number.isFinite(distance) ? `${distance.toFixed(1)} km AIS track` : 'Accumulates while AIS updates arrive';
  const trackHtml = `
    <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:8px;margin-top:8px">
      <div style="color:#67e8f9;font-size:9px;font-weight:800;letter-spacing:.08em;margin-bottom:6px">OBSERVED AIS TRACK</div>
      <div style="color:#94a3b8;font-size:9px;margin-bottom:4px">START: ${startLat != null && startLng != null ? `${Number(startLat).toFixed(4)}°, ${Number(startLng).toFixed(4)}°` : 'Waiting for position history'}</div>
      <div style="color:#94a3b8;font-size:9px;margin-bottom:4px">START TIME: ${htmlEsc(startLabel)}</div>
      <div style="color:#94a3b8;font-size:9px;margin-bottom:4px">LAST AIS: ${htmlEsc(lastSeenLabel)}</div>
      <div style="color:#e2e8f0;font-size:9px;margin-bottom:4px">DISTANCE: ${htmlEsc(distanceLabel)} · ${track.length || Number(p.trackPointCount) || 0} recent points</div>
      <div style="color:#64748b;font-size:8px;line-height:1.4">Start is when this server first observed the vessel; AIS does not provide its actual voyage origin.</div>
    </div>`;

  return `
  <div style="${BASE_POPUP_STYLE} border: 1px solid ${color}60; border-top: 3px solid ${color}; min-width: 295px; max-width: 335px; box-shadow: 0 20px 45px -10px rgba(0,0,0,0.85), 0 0 25px -5px ${color}25;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; background: ${color}20; border: 1px solid ${color}50; font-size: 11px;">${icon}</span>
        <span style="color: ${color}; font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">${(p.type || 'VESSEL').toUpperCase()}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 5px;">
        ${isLive ? '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 4px; background: rgba(0, 229, 255, 0.15); border: 1px solid rgba(0, 229, 255, 0.4); color: #00E5FF; font-size: 8px; font-weight: 800; letter-spacing: 0.05em;"><span style="width: 5px; height: 5px; border-radius: 50%; background: #00e5ff; box-shadow: 0 0 6px #00e5ff;"></span>LIVE AIS</span>' : ''}
        <span style="color: #94a3b8; font-size: 9px; font-weight: 600; letter-spacing: 0.05em;">FLAG: <span style="color: #e2e8f0;">${htmlEsc(p.flag || 'UNK')}</span></span>
      </div>
    </div>

    <div style="margin-bottom: 12px;">
      <div style="color: #ffffff; font-size: 13px; font-weight: 800; letter-spacing: 0.02em; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${htmlEsc(p.name || 'UNIDENTIFIED VESSEL')}">${htmlEsc(p.name || 'UNIDENTIFIED VESSEL')}</div>
      <div style="color: #64748b; font-size: 10px; margin-top: 2px;">MMSI: <span style="color: #94a3b8; font-weight: 600;">${htmlEsc(p.mmsi || 'N/A')}</span></div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px;">
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 7px 9px;">
        <div style="color: #64748b; font-size: 8px; letter-spacing: 0.08em; font-weight: 600; text-transform: uppercase;">SPEED</div>
        <div style="color: ${color}; font-size: 12px; font-weight: 700; margin-top: 2px;">${speedVal} <span style="font-size: 9px; font-weight: 500; color: #94a3b8;">kn</span></div>
      </div>
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 7px 9px;">
        <div style="color: #64748b; font-size: 8px; letter-spacing: 0.08em; font-weight: 600; text-transform: uppercase;">HEADING</div>
        <div style="color: #f1f5f9; font-size: 12px; font-weight: 700; margin-top: 2px;">${headingVal}</div>
      </div>
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 7px 9px;">
        <div style="color: #64748b; font-size: 8px; letter-spacing: 0.08em; font-weight: 600; text-transform: uppercase;">LATITUDE</div>
        <div style="color: #e2e8f0; font-size: 11px; font-weight: 600; margin-top: 2px;">${coords[1].toFixed(4)}°</div>
      </div>
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 7px 9px;">
        <div style="color: #64748b; font-size: 8px; letter-spacing: 0.08em; font-weight: 600; text-transform: uppercase;">LONGITUDE</div>
        <div style="color: #e2e8f0; font-size: 11px; font-weight: 600; margin-top: 2px;">${coords[0].toFixed(4)}°</div>
      </div>
    </div>

    <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 8px; font-size: 9px; line-height: 1.5;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
        <span style="color: #64748b; font-weight: 600;">DESTINATION:</span>
        <span style="color: #38bdf8; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;" title="${htmlEsc(p.destination || 'Not reported')}">${htmlEsc(p.destination || 'Not reported')}</span>
      </div>
      ${p.firstSeenLat != null && p.firstSeenLng != null ? `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
        <span style="color: #64748b; font-weight: 600;">FIRST SEEN:</span>
        <span style="color: #94a3b8;">${Number(p.firstSeenLat).toFixed(3)}°, ${Number(p.firstSeenLng).toFixed(3)}°</span>
      </div>` : ''}
      ${trackHtml}
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(255, 255, 255, 0.06);">
        <span style="color: #64748b; font-weight: 600;">STATUS:</span>
        <span style="color: ${statusColor}; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
          <span style="display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: ${statusColor};"></span>
          ${statusLabel}
        </span>
      </div>
  </div>`;
}

/**
 * 2. Military Aircraft Popup
 */
export function renderFlightPopup(p: FlightPopupProps, coords: [number, number]): string {
  const cs = (p.callsign || '').trim();
  const alt = p.alt ? `${Math.round(p.alt)} m` : '—';
  const speed = p.speed_knots ? `${p.speed_knots} kt` : '—';
  const heading = p.heading != null ? `${Math.round(p.heading)}°` : '—';

  return `
  <div style="${BASE_POPUP_STYLE} border: 1px solid #FF174460; border-top: 3px solid #FF1744; min-width: 290px; box-shadow: 0 20px 45px -10px rgba(0,0,0,0.85), 0 0 20px #FF174420;">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #FF174440;padding-bottom:8px;margin-bottom:10px;">
      <div style="color:#FF1744;font-size:11px;font-weight:800;letter-spacing:0.1em;display:flex;align-items:center;gap:5px;">
        <span>✈️</span> [ MILITARY AIRCRAFT ]
      </div>
      <div style="color:#94a3b8;font-size:9px;font-weight:600;">ICAO: ${htmlEsc(p.icao24 || '')}</div>
    </div>

    <div style="color:#ffffff;font-size:14px;font-weight:800;margin-bottom:10px;letter-spacing:0.04em;">
      ${htmlEsc(cs || 'UNKNOWN CALLSIGN')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;background:rgba(15,23,42,0.7);padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
      <div><span style="color:#64748b;font-size:8px;font-weight:600;">ALTITUDE</span><br/><span style="color:#FF1744;font-size:11px;font-weight:700;">${alt}</span></div>
      <div><span style="color:#64748b;font-size:8px;font-weight:600;">SPEED</span><br/><span style="color:#FF1744;font-size:11px;font-weight:700;">${speed}</span></div>
      <div><span style="color:#64748b;font-size:8px;font-weight:600;">HEADING</span><br/><span style="color:#f1f5f9;font-size:11px;font-weight:700;">${heading}</span></div>
      <div><span style="color:#64748b;font-size:8px;font-weight:600;">MODEL / TYPE</span><br/><span style="color:#38bdf8;font-size:10px;font-weight:600;">${htmlEsc(p.model || 'MIL-SPEC')}</span></div>
      <div><span style="color:#64748b;font-size:8px;font-weight:600;">LATITUDE</span><br/><span style="color:#e2e8f0;font-size:10px;">${coords[1].toFixed(4)}°</span></div>
      <div><span style="color:#64748b;font-size:8px;font-weight:600;">LONGITUDE</span><br/><span style="color:#e2e8f0;font-size:10px;">${coords[0].toFixed(4)}°</span></div>
    </div>
  </div>`;
}

/**
 * 3. Maritime Port & Naval Base Popup
 */
export function renderPortPopup(p: PortPopupProps): string {
  const isNaval = p.type === 'naval';
  const isEnergy = p.type === 'energy';
  const color = isNaval ? '#FF1744' : isEnergy ? '#FF9500' : '#00E5FF';
  const typeLabel = isNaval ? 'NAVAL BASE' : isEnergy ? 'ENERGY PORT' : 'CONTAINER TERMINAL';

  const congestionHtml = p.congestion
    ? `
      <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <div><span style="color:#64748b;font-size:8px;font-weight:600;">CONGESTION</span><br/><span style="color:${p.congestion === 'SEVERE' ? '#FF1744' : p.congestion === 'CONGESTED' ? '#FF9500' : '#10b981'};font-weight:bold;font-size:10px;">${htmlEsc(p.congestion)}</span></div>
          <div><span style="color:#64748b;font-size:8px;font-weight:600;">EST. DWELL TIME</span><br/><span style="color:#e2e8f0;font-weight:bold;font-size:10px;">${htmlEsc(p.dwell_time || 'Normal')}</span></div>
        </div>
      </div>`
    : '';

  return `
  <div style="${BASE_POPUP_STYLE} border: 1px solid ${color}50; border-top: 3px solid ${color}; min-width: 270px;">
    <div style="color:${color};font-weight:800;font-size:13px;margin-bottom:3px;">${htmlEsc(p.name)}</div>
    <div style="color:#94a3b8;font-size:9px;font-weight:600;margin-bottom:8px;">${typeLabel} — ${htmlEsc(p.country)}</div>
    ${p.volume ? `<div style="font-size:9px;color:#cbd5e1;margin-bottom:3px;">Traffic Volume: <span style="color:${color};font-weight:bold;">${htmlEsc(p.volume)}</span></div>` : ''}
    ${p.fleet ? `<div style="font-size:9px;color:#cbd5e1;margin-bottom:3px;">Assigned Fleet: <span style="color:${color};font-weight:bold;">${htmlEsc(p.fleet)}</span></div>` : ''}
    ${p.rank ? `<div style="font-size:9px;color:#cbd5e1;">Global Rank: <span style="color:${color};font-weight:bold;">#${htmlEsc(p.rank)}</span></div>` : ''}
    ${congestionHtml}
  </div>`;
}

/**
 * 4. Maritime Chokepoint Popup
 */
export function renderChokepointPopup(p: ChokepointPopupProps): string {
  const riskCol =
    p.risk === 'CRITICAL' ? '#FF1744' : p.risk === 'HIGH' ? '#FF9500' : p.risk === 'ELEVATED' ? '#FFD700' : '#10b981';

  return `
  <div style="${BASE_POPUP_STYLE} border: 1px solid ${riskCol}50; border-top: 3px solid ${riskCol}; min-width: 260px;">
    <div style="color:#FF9500;font-weight:800;font-size:13px;margin-bottom:6px;">${htmlEsc(p.name)}</div>
    <div style="font-size:9px;color:#94a3b8;margin-bottom:4px;">Strategic Traffic: <span style="color:#fff;font-weight:bold;">${htmlEsc(p.traffic)}</span></div>
    <div style="font-size:9px;color:#94a3b8;">Risk Evaluation: <span style="color:${riskCol};font-weight:bold;">${htmlEsc(p.risk)}</span></div>
  </div>`;
}

/**
 * 5. Current User Location Popup
 */
export function renderHomeLocationPopup(location: { lat: number; lng: number }): string {
  return `
  <style>
    .custom-me-popup .maplibregl-popup-content { background: transparent; padding: 0; box-shadow: none; }
    .custom-me-popup .maplibregl-popup-tip { display: none; }
  </style>
  <div class="p-4 bg-black/85 backdrop-blur-xl border border-cyan-500/30 rounded-2xl shadow-2xl text-white font-mono w-56 pointer-events-auto">
    <div class="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-white/10">
      <div class="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_#00e5ff] animate-pulse"></div>
      <span class="font-bold tracking-widest text-cyan-400 text-[10px]">CURRENT LOCATION</span>
    </div>
    <div class="space-y-2 text-[10px] text-zinc-300">
      <div class="flex justify-between items-center">
        <span class="text-zinc-500">LATITUDE</span>
        <span class="font-bold text-white">${location.lat.toFixed(4)}°</span>
      </div>
      <div class="flex justify-between items-center">
        <span class="text-zinc-500">LONGITUDE</span>
        <span class="font-bold text-white">${location.lng.toFixed(4)}°</span>
      </div>
      <div class="flex justify-between items-center pt-2 mt-2 border-t border-white/5">
        <span class="text-zinc-500">ACCURACY</span>
        <span class="font-bold text-emerald-400">GPS / HIGH</span>
      </div>
      <div class="flex justify-between items-center">
        <span class="text-zinc-500">STATUS</span>
        <span class="font-bold text-cyan-400">TRACKED</span>
      </div>
    </div>
  </div>`;
}

/**
 * Helper to display MapLibre popup and manage reference
 */
export function showMapPopup(
  map: maplibregl.Map,
  popupRef: React.MutableRefObject<maplibregl.Popup | null>,
  coords: [number, number],
  html: string,
  options: maplibregl.PopupOptions = {}
): maplibregl.Popup {
  popupRef.current?.remove();
  const p = new maplibregl.Popup({ closeButton: true, maxWidth: '420px', offset: 14, ...options })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);
  popupRef.current = p;
  return p;
}

/**
 * Convenience helper to render and show a ship popup, optionally subscribing to live updates
 */
export function showShipPopup(
  map: maplibregl.Map,
  popupRef: React.MutableRefObject<maplibregl.Popup | null>,
  ship: ShipPopupProps,
  coords: [number, number],
  onTrackShip?: (mmsi: string | number | null) => void
): maplibregl.Popup {
  const mmsi = ship.mmsi || ship.id;
  if (mmsi) onTrackShip?.(mmsi);
  const pop = showMapPopup(map, popupRef, coords, renderShipPopup(ship, coords, Boolean(mmsi)));
  if (mmsi && onTrackShip) {
    pop.once('close', () => {
      onTrackShip(null);
    });
  }
  return pop;
}

/**
 * Creates a MapLibre marker popup for the user's home/current location
 */
export function createHomeMarkerPopup(location: { lat: number; lng: number }): maplibregl.Popup {
  const popupContent = document.createElement('div');
  popupContent.innerHTML = renderHomeLocationPopup(location);
  return new maplibregl.Popup({ offset: 15, closeButton: false, className: 'custom-me-popup' }).setDOMContent(popupContent);
}

export interface MapPopupsProps {
  map?: maplibregl.Map | null;
  mapRef?: React.RefObject<maplibregl.Map | null>;
  popupRef: React.RefObject<maplibregl.Popup | null> | React.MutableRefObject<maplibregl.Popup | null>;
  onTrackShip?: (mmsi: string | number | null) => void;
  onShipSelect?: (ship: Record<string, unknown> | null) => void;
  liveTrackedShip?: ShipPopupProps | null;
}


export function MapPopups({ map: propMap, mapRef, popupRef, onTrackShip, onShipSelect, liveTrackedShip }: MapPopupsProps) {
  const trackedMmsiRef = useRef<string | null>(null);
  const liveTrackedShipRef = useRef(liveTrackedShip);

  useEffect(() => {
    liveTrackedShipRef.current = liveTrackedShip;
  }, [liveTrackedShip]);

  useEffect(() => {
    const map = mapRef ? mapRef.current : propMap;
    if (!map) return;

    const interactiveLayers = ['fl-military', 'ship-dots', 'ship-label', 'sat-ship-in-view-ring', 'maritime-dots', 'choke-dots', 'selected-ship-vessel'];
    const onMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    interactiveLayers.forEach(layer => {
      map.on('mouseenter', layer, onMouseEnter);
      map.on('mouseleave', layer, onMouseLeave);
    });

    // 1. Military aircraft click
    const onFlightClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features?.length) return;
      const p = (e.features[0].properties || {}) as FlightPopupProps;
      const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
      showMapPopup(map, popupRef, coords, renderFlightPopup(p, coords));
    };
    map.on('click', 'fl-military', onFlightClick);

    // 2. Maritime ships click (focuses and tracks via WebSocket on-demand)
    const onShipClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features?.length) return;
      const p = { ...(e.features[0].properties as unknown as ShipPopupProps) };
      if (typeof p.track === 'string') {
        try {
          p.track = JSON.parse(p.track);
        } catch {
          // Ignore
        }
      }
      const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
      const mmsi = String(p.mmsi || p.id || '');
      trackedMmsiRef.current = mmsi || null;
      if (mmsi) {
        onTrackShip?.(mmsi);
        const live = liveTrackedShipRef.current && String(liveTrackedShipRef.current.mmsi || liveTrackedShipRef.current.id || '') === mmsi
          ? liveTrackedShipRef.current
          : null;
        if (live) Object.assign(p, live);
      }

      popupRef.current?.remove();
      map.easeTo({ center: coords, duration: 800 });
      onShipSelect?.({ ...p, lat: coords[1], lng: coords[0] });
    };
    map.on('click', 'ship-dots', onShipClick);
    map.on('click', 'sat-ship-in-view-ring', onShipClick);
    map.on('click', 'selected-ship-vessel', onShipClick);

    // 3. Maritime ports click
    const onPortClick = (e: maplibregl.MapLayerMouseEvent) => {
      const p = (e.features?.[0]?.properties || {}) as unknown as PortPopupProps;
      if (!p) return;
      const coords = (e.features![0].geometry as GeoJSON.Point).coordinates as [number, number];
      showMapPopup(map, popupRef, coords, renderPortPopup(p));
    };
    map.on('click', 'maritime-dots', onPortClick);

    // 4. Maritime chokepoints click
    const onChokeClick = (e: maplibregl.MapLayerMouseEvent) => {
      const p = (e.features?.[0]?.properties || {}) as unknown as ChokepointPopupProps;
      if (!p) return;
      const coords = (e.features![0].geometry as GeoJSON.Point).coordinates as [number, number];
      showMapPopup(map, popupRef, coords, renderChokepointPopup(p));
    };
    map.on('click', 'choke-dots', onChokeClick);

    return () => {
      interactiveLayers.forEach(layer => {
        map.off('mouseenter', layer, onMouseEnter);
        map.off('mouseleave', layer, onMouseLeave);
      });
      map.off('click', 'fl-military', onFlightClick);
      map.off('click', 'ship-dots', onShipClick);
      map.off('click', 'sat-ship-in-view-ring', onShipClick);
      map.off('click', 'selected-ship-vessel', onShipClick);
      map.off('click', 'maritime-dots', onPortClick);
      map.off('click', 'choke-dots', onChokeClick);
      if (trackedMmsiRef.current) {
        trackedMmsiRef.current = null;
      }
    };
  }, [mapRef, propMap, popupRef, onTrackShip, onShipSelect]);

  return null;
}

export default MapPopups;
