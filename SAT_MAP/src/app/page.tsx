'use client';

import { useEffect, useState, useRef, useCallback, useMemo, startTransition } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { Globe, MapPinned, Satellite, Moon, LocateFixed, LayoutDashboard, FileText, Pencil, FastForward, X, Circle, Square, Pentagon, Spline, Pause, Rewind, Eraser, Layers3, SlidersHorizontal, ZoomIn, ZoomOut, Newspaper, Film } from 'lucide-react';
import ScaleBar from '@/components/ScaleBar';
import ErrorBoundary from '@/components/ErrorBoundary';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
const LTmap = dynamic(() => import('@/components/LTmap'), { ssr: false });
const LayerPanel = dynamic(() => import('@/components/LayerPanel'));
import DashboardOverlay from '@/components/DashboardOverlay';
import RightTacticalDock from '@/components/RightTacticalDock';
import NewsTicker from '@/components/NewsTicker';
import GeospatialVideoPanel from '@/components/GeospatialVideoPanel';
import type { GeoVideoFrame } from '@/lib/geospatial-video';
import { pickLandingCity } from '@/lib/landing-cities';
import { LocationTimeInfo, formatTimeInZone } from '@/lib/country-time';
import type { SatelliteDetail } from '@/components/SatelliteCard';
import { API_ENDPOINTS, api, apiClient, getApiUrl } from '@/config/api';

const HeaderClock = ({
  countryTime,
  satellite,
  ship,
  isSliderOpen,
  onReset,
  onOpenIntel,
}: {
  countryTime: LocationTimeInfo | null;
  satellite: SatelliteDetail | null;
  ship: Record<string, unknown> | null;
  isIntelOpen?: boolean;
  isSliderOpen?: boolean;
  onReset: () => void;
  onOpenIntel?: () => void;
}) => {
  const [time, setTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      if (satellite) {
        const h = String(now.getUTCHours()).padStart(2, '0');
        const m = String(now.getUTCMinutes()).padStart(2, '0');
        const s = String(now.getUTCSeconds()).padStart(2, '0');
        setTime(`${h}:${m}:${s} UTC`);
      } else if (ship) {
        const stamp = Number(ship.lastSeenAt ?? ship.timestamp);
        setTime(stamp ? new Date(stamp < 1e12 ? stamp * 1000 : stamp).toLocaleString() : 'Awaiting AIS');
      } else if (countryTime) {
        setTime(formatTimeInZone(countryTime.timeZone, now));
      } else {
        setTime(now.toLocaleTimeString('en-US', { hour12: false }) + ' LOCAL');
      }
    };
    updateTime();
    const iv = setInterval(updateTime, 1000);
    return () => clearInterval(iv);
  }, [satellite, countryTime, ship]);

  if (ship) {
    const speed = Number(ship.speed || 0);
    const shipName = typeof ship.name === 'string' ? ship.name : 'Unidentified vessel';
    return <div className="pointer-events-auto flex max-w-[min(60vw,700px)] items-center gap-2 rounded-xl border border-cyan-400/30 bg-[#07101df2] px-3 py-2 font-mono shadow-[0_8px_30px_rgba(0,0,0,.55)] backdrop-blur-xl">
      <span className={`h-2 w-2 shrink-0 rounded-full ${speed > .5 ? 'animate-pulse bg-emerald-400' : 'bg-sky-400'}`} />
      <span className="truncate text-[11px] font-bold text-white" title={shipName}>{shipName}</span>
      <span className={`shrink-0 text-[9px] font-bold ${speed > .5 ? 'text-emerald-300' : 'text-sky-300'}`}>{speed > .5 ? 'UNDERWAY' : 'STOPPED'}</span>
      <span className="hidden shrink-0 border-l border-white/15 pl-2 text-[9px] text-cyan-200 sm:inline">{time || 'Awaiting AIS'}</span>
      <button type="button" onClick={onReset} aria-label="Clear selected ship" className="ml-1 shrink-0 rounded px-1 text-zinc-400 hover:bg-white/10 hover:text-white">×</button>
    </div>;
  }

  if (satellite) {

    if (isSliderOpen) {
      return (
        <div className="pointer-events-auto flex items-center gap-2 px-2.5 py-1 rounded-xl bg-cyan-950/40 border border-cyan-400/40 shadow-[0_0_15px_rgba(0,229,255,0.2)] text-xs font-mono">
          <div className="flex items-center gap-1.5 text-white font-bold flex-shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
            </span>
            <span className="text-cyan-300 font-bold truncate max-w-130px sm:max-w-180px" title={satellite.name}>
              {satellite.name}
            </span>
            {satellite.category && (
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-400/30 hidden sm:inline-block">
                {satellite.category.replace('_', ' ')}
              </span>
            )}
          </div>

          {satellite.alt != null && (
            <>
              <div className="w-px h-3.5 bg-white/20 hidden sm:block" />
              <div className="hidden sm:flex items-center gap-1 text-[10px] text-zinc-300 font-semibold tabular-nums flex-shrink-0">
                <span className="text-zinc-500">ALT</span>
                <span className="text-white">{satellite.alt.toFixed(0)}km</span>
              </div>
            </>
          )}

          <div className="w-px h-3.5 bg-white/20" />

          {/* Deselect / Clear Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
            title="Deselect satellite (Esc)"
            className="w-4 h-4 rounded flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/20 transition-all text-[10px] font-bold cursor-pointer flex-shrink-0"
          >
            ✕
          </button>
        </div>
      );
    }

    // When slider is closed: full telemetry pill with responsive classes that gracefully adapt across viewport sizes
    return (
      <div className="pointer-events-auto flex items-center gap-2 px-2.5 sm:px-3 py-1 rounded-xl bg-slate-950/90 border border-cyan-400/40 shadow-[0_0_20px_rgba(0,229,255,0.25)] text-xs font-mono max-w-full">
        {/* Sat identification */}
        <div className="flex items-center gap-1.5 text-white font-bold flex-shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
          </span>
          <span className="text-cyan-300 font-bold truncate max-w-110px sm:max-w-150px lg:max-w-180px" title={satellite.name}>
            {satellite.name}
          </span>
          {satellite.category && (
            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/10 text-zinc-300 font-semibold border border-white/10 hidden sm:inline-block">
              {satellite.category.replace('_', ' ')}
            </span>
          )}
        </div>

        <div className="w-px h-3.5 bg-white/20 hidden sm:block" />

        {/* Live Coordinates */}
        <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-zinc-300 tabular-nums flex-shrink-0">
          <span className="text-zinc-500 font-medium">POS</span>
          <span className="text-cyan-300 font-bold">
            {satellite.lat != null ? `${satellite.lat >= 0 ? '+' : ''}${satellite.lat.toFixed(2)}°` : '—'},{' '}
            {satellite.lng != null ? `${satellite.lng >= 0 ? '+' : ''}${satellite.lng.toFixed(2)}°` : '—'}
          </span>
        </div>

        {/* Altitude & Velocity */}
        {(satellite.alt != null || satellite.speedKmS != null) && (
          <>
            <div className="w-px h-3.5 bg-white/20 hidden lg:block" />
            <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-zinc-300 tabular-nums flex-shrink-0">
              {satellite.alt != null && (
                <span>
                  <span className="text-zinc-500">ALT </span>
                  <span className="text-white font-semibold">{satellite.alt.toFixed(0)}km</span>
                </span>
              )}
              {satellite.speedKmS != null && (
                <span>
                  <span className="text-zinc-500">VEL </span>
                  <span className="text-white font-semibold">{satellite.speedKmS.toFixed(2)}km/s</span>
                </span>
              )}
            </div>
          </>
        )}

        <div className="w-px h-3.5 bg-white/20 hidden xl:block" />

        {/* Ground country & local time */}
        <div className="hidden xl:flex items-center gap-1.5 text-[10px] text-zinc-200 flex-shrink-0">
          <span>{satellite.flag || '🌐'}</span>
          <span className="font-bold uppercase max-w-100px 2xl:max-w-140px truncate" title={satellite.country || 'Ocean'}>
            {satellite.country || 'Ocean'}
          </span>
          <span className="text-cyan-300 font-bold tabular-nums drop-shadow-[0_0_6px_rgba(0,229,255,0.4)]">
            {time}
          </span>
        </div>

        {/* Intel Drawer Button */}
        {onOpenIntel && (
          <button
            type="button"
            onClick={onOpenIntel}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg border font-bold text-[9px] tracking-wider transition-all cursor-pointer ml-1 flex-shrink-0 bg-cyan-500/15 hover:bg-cyan-500/25 border-cyan-400/40 text-cyan-300 shadow-[0_0_8px_rgba(0,229,255,0.2)]"
            title="Open Satellite Intelligence Dossier"
          >
            <FileText className="w-2.5 h-2.5" />
            <span>DOSSIER</span>
          </button>
        )}

        {/* Clear Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReset();
          }}
          title="Deselect satellite (Esc)"
          className="ml-1 w-4 h-4 rounded flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/20 transition-all text-[10px] font-bold cursor-pointer flex-shrink-0"
        >
          ✕
        </button>
      </div>
    );
  }

  if (countryTime) {
    return (
      <div className="pointer-events-auto flex items-center gap-2 px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-400/40 shadow-[0_0_12px_rgba(0,229,255,0.25)]">
        <span className="text-sm select-none leading-none">{countryTime.flag}</span>
        <span className="font-bold tracking-wider text-[10px] text-white uppercase max-w-[150px] truncate" title={countryTime.country}>
          {countryTime.country}
        </span>
        <span className="text-cyan-300 font-bold tabular-nums text-[11px] drop-shadow-[0_0_6px_rgba(0,229,255,0.5)]">
          {time}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReset();
          }}
          title="Reset to device local time"
          className="ml-0.5 w-4 h-4 rounded flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/20 transition-all text-[10px] font-bold cursor-pointer"
        >
          ✕
        </button>
      </div>
    );
  }

  return <span className="text-cyan-300 font-bold tabular-nums">{time || '--:--:-- LOCAL'}</span>;
};


function ViewSegment({ active, onClick, title, icon: Icon, label, layoutId }: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  layoutId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-semibold tracking-wider transition-all duration-200 cursor-pointer ${active ? 'text-cyan-200 font-bold' : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
        }`}
    >
      {active && (
        <motion.span
          layoutId={layoutId}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className="absolute inset-0 rounded-lg border border-cyan-400/40 bg-cyan-500/20 shadow-[0_0_12px_rgba(0,229,255,0.25)]"
        />
      )}
      <Icon className="w-3.5 h-3.5 relative z-10" />
      <span className="hidden md:inline relative z-10">{label}</span>
    </button>
  );
}


const HUD_EASE = [0.22, 1, 0.36, 1] as const;
const hudIn = (delay: number) => ({ duration: 0.7, ease: HUD_EASE, delay });



export default function Dashboard() {
  // ── SPLIT DATA ATOMS — prevents cascade re-renders ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [militaryFlights, setMilitaryFlights] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [satellites, setSatellites] = useState<any[]>([]);
  const [satellitesAt, setSatellitesAt] = useState<string | number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [maritimeShips, setMaritimeShips] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [maritimePorts, setMaritimePorts] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [maritimeChokepoints, setMaritimeChokepoints] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [categoryCounts, setCategoryCounts] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [totalShips, setTotalShips] = useState<any>(null);
  const [extraData, setExtraData] = useState<Record<string, unknown>>({});

  const [backendStatus, setBackendStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [backendError, setBackendError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [mapView, setMapView] = useState({ zoom: 2.5, latitude: 20, longitude: 0 });
  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lng: number; zoom?: number; alertId?: string; duration?: number; ts: number } | null>(null);
  const [homeLocation, setHomeLocation] = useState<{ lat: number; lng: number } | null>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('LAndT_userLocation');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
            return { lat: parsed.lat, lng: parsed.lng };
          }
        }
      }
    } catch {}
    return null;
  });
  const [selectedCountryTime, setSelectedCountryTime] = useState<LocationTimeInfo | null>(null);
  const [selectedSatellite, setSelectedSatellite] = useState<SatelliteDetail | null>(null);
  const [clearSatTrigger, setClearSatTrigger] = useState(0);
  const [intelOpenTrigger] = useState(0);
  const [isIntelOpen, setIsIntelOpen] = useState(false);
  const [isSliderOpen, setIsSliderOpen] = useState(false);
  const [trackedShipMmsi, setTrackedShipMmsi] = useState<string | number | null>(null);
  const [liveTrackedShip, setLiveTrackedShip] = useState<Record<string, unknown> | null>(null);
  const [selectedShip, setSelectedShip] = useState<Record<string, unknown> | null>(null);
  const maritimeWsRef = useRef<WebSocket | null>(null);
  const trackedShipMmsiRef = useRef(trackedShipMmsi);
  useEffect(() => {
    trackedShipMmsiRef.current = trackedShipMmsi;
  }, [trackedShipMmsi]);

  const handleTrackShip = useCallback((mmsi: string | number | null) => {
    setTrackedShipMmsi(mmsi);
    setLiveTrackedShip(null);
  }, []);

  const mouseCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const coordsDisplayRef = useRef<HTMLDivElement>(null);
  const zoomReadoutRef = useRef<HTMLSpanElement>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [showMapControls, setShowMapControls] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showNewsTicker, setShowNewsTicker] = useState(true);
  const [showGeospatialVideo, setShowGeospatialVideo] = useState(false);
  const [geospatialVideoFrames, setGeospatialVideoFrames] = useState<GeoVideoFrame[] | null>(null);
  const [geospatialVideoFrame, setGeospatialVideoFrame] = useState<GeoVideoFrame | null>(null);
  const handleGeoVideoFrames = useCallback((frames: GeoVideoFrame[] | null) => setGeospatialVideoFrames(frames), []);
  const handleGeoVideoFrame = useCallback((frame: GeoVideoFrame | null) => setGeospatialVideoFrame(frame), []);
  const [areaDrawMode, setAreaDrawMode] = useState(false);
  const [areaDrawShape, setAreaDrawShape] = useState<'circle' | 'rectangle' | 'polygon' | 'freehand'>('rectangle');
  const [areaDrawerOpen, setAreaDrawerOpen] = useState(false);
  const [analysisArea, setAnalysisArea] = useState<{ west: number; south: number; east: number; north: number; geometry?: GeoJSON.Polygon } | null>(null);
  const [areaForecast, setAreaForecast] = useState(false);
  const [areaHours, setAreaHours] = useState(24);
  const [areaPlaybackCommand, setAreaPlaybackCommand] = useState<{ id: number; action: 'play' | 'pause' | 'seek' | 'cancel'; hours: number; time?: number; windowStart?: number; rate?: number }>();
  const [areaPlaybackState, setAreaPlaybackState] = useState<{ time: number; running: boolean; passes: Array<{ name: string; category: string; firstPass: number; lastPass: number; passes: number; windows: Array<{start:number;end:number}> }> }>(() => ({time: Date.now(), running: false, passes: []}));
  const [areaWindowStart, setAreaWindowStart] = useState(0);
  const [areaCapturedSatellites, setAreaCapturedSatellites] = useState<Array<{name:string;category?:string;lat:number;lng:number;alt:number}>>([]);
  const [clearAreaTrigger, setClearAreaTrigger] = useState(0);
  const revealed = true;

  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number; bounds?: { west: number; south: number; east: number; north: number } } | null>(null);
  const [mapProjection, setMapProjection] = useState<'globe' | 'mercator'>('globe');
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite'>('dark');


  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>({
    military: true,
    maritime: false,
    ship_cargo: false,
    ship_tanker: false,
    ship_military: false,
    satellites: true,
    sat_comms: false,
    sat_military: true,
    sat_navigation: true,
    sat_earth: true,
    sat_science: false,
    balloons: false,
    radiation: false,
    sdk_sea: true,
    sdk_air: true,
    sdk_naval: true,
    live_clouds: false,
    day_night: false,
  });

  const [capabilities] = useState<Record<string, boolean>>({});
  const restoredRef = useRef(false);
  const restoreCheckedRef = useRef(false);
  const isMountedRef = useRef(false);
  const layerFetchedRef = useRef<Set<string>>(new Set());

  // Restore map view from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = setTimeout(() => {
      try {
        const savedProj = localStorage.getItem('LAndT_mapProjection');
        if (savedProj === 'mercator' || savedProj === 'globe') {
          setMapProjection(savedProj);
        }

        const saved = localStorage.getItem('LAndT_mapView');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (
            parsed &&
            typeof parsed.latitude === 'number' &&
            Number.isFinite(parsed.latitude) &&
            (parsed.longitude == null || Number.isFinite(parsed.longitude))
          ) {
            restoredRef.current = true;
            setMapView(parsed);
            setFlyToLocation({ lat: parsed.latitude, lng: parsed.longitude ?? 0, zoom: parsed.zoom, duration: 0, ts: Date.now() });
          }
        }
      } catch { }

      restoreCheckedRef.current = true;
      isMountedRef.current = true;
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  // Save map view to localStorage
  useEffect(() => {
    if (!isMountedRef.current || !restoreCheckedRef.current) return;
    const t = setTimeout(() => {
      localStorage.setItem('LAndT_mapView', JSON.stringify(mapView));
    }, 1000);
    return () => clearTimeout(t);
  }, [mapView]);

  // Save map projection to localStorage
  useEffect(() => {
    if (!isMountedRef.current) return;
    localStorage.setItem('LAndT_mapProjection', mapProjection);
  }, [mapProjection]);

  useEffect(() => {
    if (!homeLocation || !restoreCheckedRef.current) return;
    if (restoredRef.current) return; 
    setFlyToLocation({ ...homeLocation, zoom: 8, duration: 3500, ts: Date.now() });
  }, [homeLocation]);

  const resetView = useCallback(() => {
    if (typeof window !== 'undefined' && navigator?.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setHomeLocation(loc);
          try {
            localStorage.setItem('LAndT_userLocation', JSON.stringify(loc));
          } catch {}
          restoredRef.current = false;
          setFlyToLocation({ ...loc, zoom: 8, duration: 2500, ts: Date.now() });
        },
        () => {
          if (homeLocation) {
            restoredRef.current = false;
            setFlyToLocation({ ...homeLocation, zoom: 8, duration: 2500, ts: Date.now() });
          } else {
            setFlyToLocation({ lat: 20, lng: 0, zoom: 2.5, duration: 2500, ts: Date.now() });
          }
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else if (homeLocation) {
      restoredRef.current = false;
      setFlyToLocation({ ...homeLocation, zoom: 8, duration: 2500, ts: Date.now() });
    } else {
      setFlyToLocation({ lat: 20, lng: 0, zoom: 2.5, duration: 2500, ts: Date.now() });
    }
  }, [homeLocation]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const p = new URLSearchParams(window.location.search);
    const layers = p.get('layers');
    if (layers !== null) {
      const active = new Set(layers.split(',').filter(Boolean));
      if (active.has('ships')) {
        active.add('ship_cargo');
        active.add('ship_tanker');
        active.add('ship_military');
      }
      setTimeout(() => {
        setActiveLayers(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(k => { (next as Record<string, boolean>)[k] = active.has(k); });
          return next;
        });
      }, 0);
    }

    // Location is initialized in state; device geolocation updates asynchronously if permitted

    if (navigator?.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setHomeLocation(loc);
          try {
            localStorage.setItem('LAndT_userLocation', JSON.stringify(loc));
          } catch {}
        },
        () => {
          setHomeLocation(prev => {
            if (prev) return prev;
            const city = pickLandingCity();
            return { lat: city.lat, lng: city.lng };
          });
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else {
      setTimeout(() => {
        setHomeLocation(prev => {
          if (prev) return prev;
          const city = pickLandingCity();
          return { lat: city.lat, lng: city.lng };
        });
      }, 0);
    }
  }, []);


  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const active = Object.entries(activeLayers).filter(([, v]) => v).map(([k]) => k).join(',');
      const url = `${window.location.pathname}?layers=${active}`;
      window.history.replaceState(null, '', url);
    }, 1500);
  }, [activeLayers]);


  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as Element)?.tagName)) return;
      if (e.key === 'f' && !e.ctrlKey) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      }
      if (e.key === 'l') setShowLayers(p => !p);
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) setFlyToLocation({ lat: 20, lng: 0, zoom: 2.5, ts: Date.now() });
      if (e.key === 'g') {
        setMapProjection(p => p === 'globe' ? 'mercator' : 'globe');
      }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); };
  }, []);


  const handleMouseCoords = useCallback((coords: { lat: number; lng: number }) => {
    mouseCoordsRef.current = coords;
    if (coordsDisplayRef.current) {
      coordsDisplayRef.current.innerText = `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
    }
  }, []);

  // Region dossier (double right-click)
  const handleRightClick = useCallback(async (coords: { lat: number; lng: number }) => {
    try {
      await apiClient.get(api.regionDossier(coords.lat, coords.lng));
    } catch (e) { console.warn('[L&T] Suppressed error:', e instanceof Error ? e.message : e); }
  }, []);
  // Entity click handler
  const handleEntityClick = useCallback(() => { }, []);

  // ── BACKEND HEALTH & CONNECTIVITY MONITOR ──
  useEffect(() => {
    let active = true;
    const checkConnection = async () => {
      try {
        const res = await apiClient.get(api.health(), { timeout: 6000 });
        if (res.status === 200 && active) {
          setBackendStatus('connected');
          setBackendError('');
        } else if (active) {
          setBackendStatus('error');
          setBackendError(`Health check returned HTTP ${res.status}`);
        }
      } catch (err) {
        console.warn('[L&T] Health check error:', err instanceof Error ? err.message : err);
        if (active) {
          setBackendStatus('error');
          setBackendError(err instanceof Error ? err.message : 'Backend is unreachable');
        }
      }
    };
    // Delay initial health check so map has priority during startup
    const initialHealthTimer = setTimeout(checkConnection, 2500);
    const interval = setInterval(checkConnection, 15000);
    return () => { active = false; clearTimeout(initialHealthTimer); clearInterval(interval); };
  }, []);

  // ── SPLIT FETCHERS — each data category has its own fetcher to avoid cascade ──

  // Generic fetcher for low-frequency/optional data (stats, balloons, radiation, cyber)
  const fetchExtra = useCallback(async (
    url: string,
    transform?: (d: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<boolean> => {
    if (typeof document !== 'undefined' && document.hidden) return false;
    try {
      const primaryUrl = url.startsWith('http') ? url : getApiUrl(url);
      const res = await apiClient.get(primaryUrl);
      if (res.status === 200 && res.data) {
        const d = transform ? transform(res.data) : res.data;
        startTransition(() => {
          setExtraData(prev => ({ ...prev, ...d }));
        });
        setBackendStatus('connected');
        setBackendError('');
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[L&T] Suppressed error:', e instanceof Error ? e.message : e);
      return false;
    }
  }, []);

  // Specific fetcher for military flights — non-urgent (startTransition)
  const fetchFlights = useCallback(async (): Promise<boolean> => {
    if (typeof document !== 'undefined' && document.hidden) return false;
    try {
      const res = await apiClient.get(getApiUrl(API_ENDPOINTS.FLIGHTS));
      if (res.status === 200 && res.data) {
        startTransition(() => {
          const flights = Array.isArray(res.data.military_flights)
            ? res.data.military_flights
            : Array.isArray(res.data) ? res.data : [];
          setMilitaryFlights(flights);
        });
        setBackendStatus('connected');
        setBackendError('');
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[L&T] Flights fetch error:', e instanceof Error ? e.message : e);
      return false;
    }
  }, []);

  // Specific fetcher for satellites — urgent (no startTransition)
  const fetchSatellites = useCallback(async (): Promise<boolean> => {
    const categories = [
      activeLayers.sat_military ? 'military' : null,
      activeLayers.sat_navigation ? 'navigation' : null,
      activeLayers.sat_earth ? 'earth_obs' : null,
    ].filter((value): value is string => Boolean(value));
    if (!activeLayers.satellites || categories.length === 0) {
      setSatellites([]);
      setSatellitesAt(null);
      return true;
    }
    try {
      const res = await apiClient.get(api.satellites({ categories, bounds: mapCenter?.bounds }));
      if (res.status === 200 && res.data) {
        setSatellites(Array.isArray(res.data.satellites) ? res.data.satellites : []);
        setSatellitesAt(res.data.timestamp ?? null);
        setBackendStatus('connected');
        setBackendError('');
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[L&T] Satellites fetch error:', e instanceof Error ? e.message : e);
      setBackendStatus('error');
      setBackendError(e instanceof Error ? e.message : 'Satellite data request failed');
      return false;
    }
  }, [activeLayers.satellites, activeLayers.sat_military, activeLayers.sat_navigation, activeLayers.sat_earth, mapCenter]);

  // Specific fetcher for maritime data — non-urgent (startTransition)
  const maritimeRequestRef = useRef<AbortController | null>(null);
  const fetchMaritime = useCallback(async (): Promise<boolean> => {
    if (typeof document !== 'undefined' && document.hidden) return false;
    const types = [
      activeLayers.ship_cargo ? 'cargo' : null,
      activeLayers.ship_tanker ? 'tanker' : null,
      activeLayers.ship_military ? 'military' : null,
    ].filter((value): value is string => Boolean(value));
    const includePorts = Boolean(activeLayers.maritime);
    if (!includePorts && types.length === 0) {
      maritimeRequestRef.current?.abort();
      maritimeRequestRef.current = null;
      setMaritimeShips([]);
      setMaritimePorts([]);
      setMaritimeChokepoints([]);
      setCategoryCounts({ cargo: 0, tanker: 0, military: 0 });
      setTotalShips(0);
      return true;
    }
    maritimeRequestRef.current?.abort();
    const controller = new AbortController();
    maritimeRequestRef.current = controller;
    try {
      const res = await apiClient.get(api.maritime(types, mapCenter?.bounds, includePorts), { signal: controller.signal });
      if (controller.signal.aborted) return false;
      if (res.status === 200 && res.data) {
        startTransition(() => {
          if (Array.isArray(res.data.ports)) setMaritimePorts(res.data.ports);
          if (Array.isArray(res.data.chokepoints)) setMaritimeChokepoints(res.data.chokepoints);
          if (Array.isArray(res.data.ships)) setMaritimeShips(res.data.ships);
          if (res.data.category_counts !== undefined) setCategoryCounts(res.data.category_counts);
          if (res.data.total_ships !== undefined) setTotalShips(res.data.total_ships);
        });
        setBackendStatus('connected');
        setBackendError('');
        return true;
      }
      return false;
    } catch (e) {
      if (controller.signal.aborted) return false;
      console.warn('[L&T] Maritime fetch error:', e instanceof Error ? e.message : e);
      setBackendStatus('error');
      setBackendError(e instanceof Error ? e.message : 'Maritime data request failed');
      return false;
    }
  }, [activeLayers.maritime, activeLayers.ship_cargo, activeLayers.ship_tanker, activeLayers.ship_military, mapCenter]);

  const activeShipFilter = useMemo<'all' | 'cargo' | 'tanker' | 'military'>(() => {
    const cargo = !!activeLayers.ship_cargo;
    const tanker = !!activeLayers.ship_tanker;
    const military = !!activeLayers.ship_military;

    if (cargo && !tanker && !military) return 'cargo';
    if (!cargo && tanker && !military) return 'tanker';
    if (!cargo && !tanker && military) return 'military';
    return 'all';
  }, [activeLayers.ship_cargo, activeLayers.ship_tanker, activeLayers.ship_military]);

  const fetchersRef = useRef({ fetchSatellites, fetchFlights, fetchExtra, fetchMaritime });
  useEffect(() => {
    fetchersRef.current = { fetchSatellites, fetchFlights, fetchExtra, fetchMaritime };
  }, [fetchSatellites, fetchFlights, fetchExtra, fetchMaritime]);

  // ── INITIAL DATA LOAD — staggered to show map immediately ──
  useEffect(() => {
    if (!mapReady) return;
    if (layerFetchedRef.current.has('initial')) return;
    layerFetchedRef.current.add('initial');
    layerFetchedRef.current.add('flights');
    layerFetchedRef.current.add('satellites');
    layerFetchedRef.current.add('maritime');

    // Progressive staggered data loading: map displays immediately, then data streams in sequentially
    // 1. Satellites (primary orbital layer) — 500ms delay so map canvas and tiles settle first
    const satTimer = setTimeout(() => {
      const loadSatellites = async (attempt = 0): Promise<void> => {
        const loaded = await fetchersRef.current.fetchSatellites();
        if (!loaded && attempt < 4) window.setTimeout(() => void loadSatellites(attempt + 1), 3000);
      };
      void loadSatellites();
    }, 500);

    // 2. Flights (secondary aviation layer) — 1800ms delay
    const flightTimer = setTimeout(() => void fetchersRef.current.fetchFlights(), 1800);

    // 3. Ships & Maritime (heavy vessel layer) — 3200ms delay
    const shipTimer = setTimeout(() => {
      const loadShips = async (attempt = 0): Promise<void> => {
        const loaded = await fetchersRef.current.fetchMaritime();
        if (!loaded && attempt < 4) window.setTimeout(() => void loadShips(attempt + 1), 3000);
      };
      void loadShips();
    }, 3200);

    // 4. Stats & telemetry (least critical) — 4800ms delay
    const statsTimer = setTimeout(() => void fetchersRef.current.fetchExtra(API_ENDPOINTS.STATS), 4800);

    return () => {
      clearTimeout(satTimer);
      clearTimeout(flightTimer);
      clearTimeout(shipTimer);
      clearTimeout(statsTimer);
    };
  }, [mapReady]);

  const viewportFetchInitializedRef = useRef(false);
  useEffect(() => {
    if (!mapReady || !mapCenter?.bounds) return;
    if (!viewportFetchInitializedRef.current) {
      viewportFetchInitializedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      if (activeLayers.satellites) void fetchersRef.current.fetchSatellites();
      void fetchersRef.current.fetchMaritime();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [mapReady, mapCenter?.bounds, activeLayers.satellites, activeLayers.sat_military, activeLayers.sat_navigation, activeLayers.sat_earth, activeLayers.maritime, activeLayers.ship_cargo, activeLayers.ship_tanker, activeLayers.ship_military]);

  // ── LAYER-AWARE POLLING — only poll data for active layers ──
  useEffect(() => {
    const intervals: ReturnType<typeof setInterval>[] = [];
    const stopFns: (() => void)[] = [];
    if (activeLayers.military) {
      intervals.push(setInterval(() => void fetchFlights(), 300000)); // 5 min
    }

    if (activeLayers.balloons) {
      intervals.push(setInterval(() => void fetchExtra('/api/balloons', d => ({ balloons: d.balloons })), 300000)); // 5m
    }
    if (activeLayers.radiation) {
      intervals.push(setInterval(() => void fetchExtra('/api/radiation', d => ({ radiation: d.stations })), 300000)); // 5m
    }
    {
      let vesselTimer: ReturnType<typeof setTimeout>;
      let stopped = false;
      const vesselGapMs = 30_000;
      const pollMaritime = () => {
        if (stopped) return;
        const maritimeActive = activeLayers.maritime || activeLayers.ship_cargo || activeLayers.ship_tanker || activeLayers.ship_military;
        if (maritimeActive) void fetchMaritime();
        vesselTimer = setTimeout(pollMaritime, vesselGapMs);
      };
      vesselTimer = setTimeout(pollMaritime, vesselGapMs);
      stopFns.push(() => { stopped = true; clearTimeout(vesselTimer); });
    }
    if ((activeLayers as Record<string, boolean>).cyber_attacks) {
      intervals.push(setInterval(() => {
        layerFetchedRef.current.delete('cyber_attacks');
        void fetchExtra('/api/cyber-attacks', d => ({ cyber_attacks: d.indicators }));
        layerFetchedRef.current.add('cyber_attacks');
      }, 300000)); // 5m — a blocklist turns over in hours, not seconds
    }
    return () => { intervals.forEach(clearInterval); stopFns.forEach(stop => stop()); };
  }, [activeLayers, fetchFlights, fetchExtra, fetchMaritime]);

  // ── Focused WebSocket Tracking (only streams the vessel you clicked / tracked) ──
  useEffect(() => {
    if (!mapReady || typeof window === 'undefined') return;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      const apiBase = process.env.NEXT_PUBLIC_FASTAPI_URL;
      const stream = apiBase
        ? new URL('/api/maritime/stream', apiBase)
        : new URL('/api/maritime/stream', `${window.location.protocol}//${window.location.hostname}:8000`);
      stream.protocol = stream.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(stream.toString());
      maritimeWsRef.current = socket;

      socket.onopen = () => {
        if (trackedShipMmsiRef.current) {
          socket.send(JSON.stringify({ action: 'track', mmsi: trackedShipMmsiRef.current }));
        }
      };

      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'ship_update' && message.ship) {
            const ship = message.ship;
            setLiveTrackedShip(ship);
            setMaritimeShips(prev => {
              const ships = (Array.isArray(prev) ? prev : []) as Record<string, unknown>[];
              const id = String(ship.mmsi ?? ship.id ?? '');
              const idx = ships.findIndex((s: Record<string, unknown>) => String(s.mmsi ?? s.id ?? '') === id);
              if (idx >= 0) {
                const updated = [...ships];
                updated[idx] = { ...updated[idx], ...ship };
                return updated;
              }
              return prev;
            });
          }
        } catch {
          // Ignore malformed frames
        }
      };

      socket.onclose = () => {
        maritimeWsRef.current = null;
        if (!stopped) reconnectTimer = setTimeout(connect, 3000);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      stopped = true;
      maritimeWsRef.current?.close();
      maritimeWsRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [mapReady]);

  // Synchronize tracking target with WebSocket server
  useEffect(() => {
    const ws = maritimeWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (trackedShipMmsi) {
      ws.send(JSON.stringify({ action: 'track', mmsi: trackedShipMmsi }));
    } else {
      ws.send(JSON.stringify({ action: 'untrack' }));
    }
  }, [trackedShipMmsi]);


  const sdkEntities = useMemo(() => {
    const anyActive = activeLayers.sdk_sea || activeLayers.sdk_air || activeLayers.sdk_naval;
    if (!anyActive) {
      return [];
    }

    interface FlightCoord { lat?: number; lng?: number; callsign?: string }
    const entities: Array<{
      type: 'Feature';
      geometry: { type: 'Point'; coordinates: [number, number] };
      properties: { domain: string; name: string; source: string };
    }> = [];


    const allFlights = (militaryFlights || []) as FlightCoord[];
    const flightStep = Math.max(1, Math.floor(allFlights.length / 60));
    for (let i = 0; i < allFlights.length; i += flightStep) {
      const f = allFlights[i];
      if (!f.lat || !f.lng) continue;
      entities.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
        properties: { domain: 'AIR', name: f.callsign?.trim() || 'TRACK', source: 'ADS-B / OpenSky' },
      });
    }

    return entities;
  }, [militaryFlights, activeLayers.sdk_sea, activeLayers.sdk_air, activeLayers.sdk_naval]);

  // Stable mapData — only recalculates when individual data atoms change
  const mapData = useMemo(() => ({
    military_flights: militaryFlights,
    satellites,
    satellites_at: satellitesAt,
    maritime_ships: maritimeShips,
    maritime_ports: maritimePorts,
    maritime_chokepoints: maritimeChokepoints,
    category_counts: categoryCounts,
    total_ships: totalShips,
    sdk_entities: sdkEntities,
    ...extraData,
  }), [militaryFlights, satellites, satellitesAt, maritimeShips, maritimePorts, maritimeChokepoints, categoryCounts, totalShips, sdkEntities, extraData]);




  return (
    <main className="fixed inset-0 w-full h-full bg-[var(--bg-void)] overflow-hidden">

      {/* ── MAP ── */}
      <ErrorBoundary name="Map">
        <LTmap
          key="core"
          data={mapData}
          activeLayers={activeLayers}
          projection={mapProjection === 'mercator' ? 'mercator' : 'globe'}
          mapStyle={mapStyle === 'satellite' ? 'satellite' : 'dark'}
          onEntityClick={handleEntityClick}
          onMouseCoords={handleMouseCoords}
          onRightClick={handleRightClick}
          onViewStateChange={setMapView}
          onReady={() => setMapReady(true)}
          flyToLocation={flyToLocation}
          homeLocation={homeLocation}
          onMapCenter={setMapCenter}
          showMapControls={showMapControls}
          onTrackShip={handleTrackShip}
          onShipSelect={setSelectedShip}
          liveTrackedShip={liveTrackedShip}
          shipTypeFilter={activeShipFilter}
          onCountryClick={setSelectedCountryTime}
          onSatelliteSelect={sat => {
            setSelectedSatellite(sat);
            if (!sat) {
              setIsIntelOpen(false);
              setIsSliderOpen(false);
            }
          }}
          clearSatelliteTrigger={clearSatTrigger}
          intelOpenTrigger={intelOpenTrigger}
          isIntelOpen={isIntelOpen}
          onIntelOpenChange={isOpen => {
            setIsIntelOpen(isOpen);
            setIsSliderOpen(isOpen);
          }}
          onSliderOpenChange={setIsSliderOpen}
          areaDrawMode={areaDrawMode}
          areaDrawShape={areaDrawShape}
          areaPlaybackCommand={areaPlaybackCommand}
          selectedAnalysisArea={analysisArea}
          onAreaPlaybackUpdate={state => setAreaPlaybackState(previous => ({...state, passes: state.passes.length ? state.passes : previous.passes}))}
          onAreaCapturedSatellites={satellites => setAreaCapturedSatellites(previous => previous.length === satellites.length && previous.every((sat,index) => sat.name === satellites[index]?.name && Math.abs(sat.lat - (satellites[index]?.lat ?? sat.lat)) < 0.01 && Math.abs(sat.lng - (satellites[index]?.lng ?? sat.lng)) < 0.01) ? previous : satellites.map(({name,category,lat,lng,alt})=>({name,category,lat,lng,alt})))}
          clearAreaTrigger={clearAreaTrigger}
          onAreaSelected={area => { setAnalysisArea(area); setAreaCapturedSatellites([]); setAreaForecast(false); setAreaDrawMode(false); setAreaPlaybackState({time:Date.now(),running:false,passes:[]}); setAreaPlaybackCommand({id:Date.now(),action:'cancel',hours:areaHours}); }}
          geospatialVideoFrames={geospatialVideoFrames}
          geospatialVideoFrame={geospatialVideoFrame}
        />
      </ErrorBoundary>
      <RightTacticalDock
        isAreaDrawerOpen={areaDrawerOpen}
        onToggleAreaDrawer={() => {
          setAreaDrawerOpen(open => !open);
        }}
      />
      {areaDrawerOpen && <aside data-hud className="hide-scrollbar fixed left-[76px] top-1/2 z-[205] max-h-[88vh] w-[min(440px,calc(100vw-6rem))] -translate-y-1/2 overflow-y-auto rounded-2xl border border-cyan-500/35 bg-[#060c18]/95 p-4 text-white shadow-[0_16px_60px_rgba(0,0,0,.85),0_0_25px_rgba(0,229,255,0.15)] backdrop-blur-2xl">
        <div className="mb-3 flex items-center justify-between"><div><div className="font-mono text-xs font-bold tracking-[.18em] text-cyan-200">SATELLITE ACCESS</div><div className="mt-1 text-[10px] text-zinc-400">Draw a map area, then forecast orbital passes</div></div><div className="flex items-center gap-1">{analysisArea && <button aria-label="Clear area" title="Clear selected area" onClick={() => {setAnalysisArea(null);setAreaCapturedSatellites([]);setAreaForecast(false);setAreaWindowStart(0);setAreaPlaybackState({time:Date.now(),running:false,passes:[]});setAreaPlaybackCommand({id:Date.now(),action:'cancel',hours:areaHours});setClearAreaTrigger(Date.now());}} className="rounded p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"><Eraser size={14}/></button>}<button type="button" aria-label="Close satellite access drawer" title="Close" onClick={()=>setAreaDrawerOpen(false)} className="rounded p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"><X size={16}/></button></div></div>
        <div className="grid grid-cols-2 gap-1.5">{([{id:'circle',label:'Circle',Icon:Circle},{id:'rectangle',label:'Rectangle',Icon:Square},{id:'polygon',label:'Polygon',Icon:Pentagon},{id:'freehand',label:'Freehand',Icon:Spline}] as const).map(({id,label,Icon})=><button key={id} type="button" onClick={()=>{setAreaDrawShape(id);setAreaDrawMode(true);setAreaForecast(false);}} aria-pressed={areaDrawShape===id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition ${areaDrawShape===id?'border-cyan-300/50 bg-cyan-400/15 text-cyan-100':'border-white/10 bg-black/20 text-zinc-400 hover:text-white'}`}><Icon size={14}/>{label}</button>)}</div>
        <button type="button" onClick={() => {setAreaDrawMode(v => !v);setAreaForecast(false);}} className={`mt-2 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${areaDrawMode ? 'border-cyan-300/60 bg-cyan-400/25 text-cyan-100 shadow-[0_0_12px_rgba(0,229,255,0.25)]' : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'}`}><Pencil size={14}/>{areaDrawMode ? `DRAW ${areaDrawShape.toUpperCase()} ON MAP` : 'START DRAWING'}</button>
        {analysisArea && <>
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2 font-mono text-[9px] leading-relaxed text-zinc-400">N {analysisArea.north.toFixed(3)}° · S {analysisArea.south.toFixed(3)}°<br/>W {analysisArea.west.toFixed(3)}° · E {analysisArea.east.toFixed(3)}°{analysisArea.geometry && <><br/>SHAPE CENTER {(((analysisArea.geometry.coordinates[0].reduce((sum,p)=>sum+p[1],0)/analysisArea.geometry.coordinates[0].length)||0)).toFixed(3)}°, {((analysisArea.geometry.coordinates[0].reduce((sum,p)=>sum+p[0],0)/analysisArea.geometry.coordinates[0].length)||0).toFixed(3)}°</>}</div>
          <section className="mt-2 rounded-lg border border-cyan-300/15 bg-cyan-400/[0.04] p-2.5"><div className="flex items-center justify-between"><h3 className="text-[10px] font-bold tracking-wide text-cyan-100">SATELLITES IN AREA</h3><span className="font-mono text-[9px] text-zinc-400">{areaCapturedSatellites.length} CURRENT</span></div><div className="hide-scrollbar mt-2 max-h-32 space-y-1 overflow-y-auto">{areaCapturedSatellites.length===0?<p className="text-[9px] text-zinc-500">No satellites currently inside the selected shape.</p>:areaCapturedSatellites.map(sat=><div key={sat.name} className="flex items-center justify-between rounded bg-black/20 px-2 py-1"><span className="flex min-w-0 items-center gap-1.5"><Satellite size={11} className="shrink-0 text-cyan-300"/><span className="truncate text-[9px] font-semibold text-zinc-200">{sat.name}</span></span><span className="ml-2 shrink-0 font-mono text-[8px] text-zinc-500">{sat.category?.replace('_',' ') ?? 'UNKNOWN'} · {Math.round(sat.alt)} KM</span></div>)}</div></section>
          <div className="mt-2 flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-1">{[6,12,24,48].map(hours=><button key={hours} type="button" onClick={()=>setAreaHours(hours)} className={`flex-1 rounded px-1 py-1.5 font-mono text-[10px] ${areaHours===hours?'bg-cyan-400/20 text-cyan-100':'text-zinc-500 hover:text-white'}`}>{hours}H</button>)}</div>
          <div className="mt-2 flex gap-1.5"><button type="button" onClick={()=>{const resume=Boolean(areaForecast&&areaWindowStart&&areaPlaybackState.time<areaWindowStart+areaHours*3600000);const start=resume?areaPlaybackState.time:Date.now();const windowStart=resume?areaWindowStart:start;if(!resume)setAreaWindowStart(start);setAreaForecast(true);setAreaPlaybackCommand({id:Date.now(),action:'play',hours:areaHours,time:start,windowStart});}} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-400 px-2 py-2 text-[11px] font-bold text-slate-950 hover:bg-cyan-300"><FastForward size={14}/>{areaPlaybackState.running?'RESTART':'PLAY'} · {areaHours}H</button>{areaForecast&&<button type="button" onClick={()=>setAreaPlaybackCommand({id:Date.now(),action:'pause',hours:areaHours})} className="flex items-center justify-center gap-1 rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 text-[10px] font-bold text-rose-200 hover:bg-rose-500/25"><Pause size={13}/>STOP</button>}</div>
          {areaForecast && <div className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-400/5 p-4"><div className="flex items-center justify-between"><div className="text-sm font-bold text-emerald-200">AREA PASS LOG</div><span className="font-mono text-[10px] text-zinc-400">{areaPlaybackState.passes.length} SATS · {areaPlaybackState.passes.reduce((sum,pass)=>sum+pass.passes,0)} PASSES · {areaPlaybackState.passes.filter(pass=>pass.windows.some(window=>window.start<=areaPlaybackState.time&&window.end>=areaPlaybackState.time)).length} ACTIVE</span></div><div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-zinc-300"><span className={`h-1.5 w-1.5 rounded-full ${areaPlaybackState.running?'animate-pulse bg-emerald-300':'bg-zinc-500'}`}/>{areaPlaybackState.running?'PLAYING':'PAUSED'} · {new Date(areaPlaybackState.time).toLocaleString()}</div>{areaWindowStart>0&&<div className="mt-2 flex gap-2"><button type="button" onClick={()=>setAreaPlaybackCommand({id:Date.now(),action:'seek',hours:areaHours,time:areaWindowStart})} className="flex items-center gap-1 text-[10px] text-cyan-200 hover:text-white"><Rewind size={13}/>REWIND TO START</button><input aria-label="Rewind or seek playback" type="range" min={areaWindowStart} max={areaWindowStart+areaHours*3600000} value={Math.max(areaWindowStart,Math.min(areaWindowStart+areaHours*3600000,areaPlaybackState.time))} onChange={event=>setAreaPlaybackCommand({id:Date.now(),action:'seek',hours:areaHours,time:Number(event.target.value)})} className="min-w-0 flex-1 accent-cyan-300"/></div>}<div className="hide-scrollbar mt-3 max-h-[42vh] space-y-1.5 overflow-y-auto">{areaPlaybackState.passes.length===0?<p className="text-[11px] text-zinc-400">Scanning orbital data for passes through this area…</p>:areaPlaybackState.passes.slice().sort((a,b)=>Number(b.windows.some(window=>window.start<=areaPlaybackState.time&&window.end>=areaPlaybackState.time))-Number(a.windows.some(window=>window.start<=areaPlaybackState.time&&window.end>=areaPlaybackState.time))||b.passes-a.passes).map(pass=>{const active=pass.windows.some(window=>window.start<=areaPlaybackState.time&&window.end>=areaPlaybackState.time);return <div key={pass.name} className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${active?'border-rose-300/35 bg-rose-300/10':'border-white/5 bg-black/20'}`}><div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${active?'animate-pulse bg-rose-300':'bg-cyan-300/50'}`}/><div className="truncate text-[11px] font-semibold text-white">{pass.name}</div>{active&&<span className="shrink-0 text-[8px] font-bold text-rose-200">PASSING</span>}</div><div className="mt-0.5 text-[9px] uppercase text-zinc-500">{pass.category} · {new Date(pass.firstPass).toLocaleTimeString()} → {new Date(pass.lastPass).toLocaleTimeString()}</div></div><span className={`ml-2 shrink-0 rounded px-2 py-1 font-mono text-[10px] ${active?'bg-rose-300/20 text-rose-100':'bg-cyan-400/15 text-cyan-200'}`}>{pass.passes}×</span></div>})}</div></div>}
        </>}        {areaDrawMode && <p className="mt-2 text-[10px] text-cyan-200">{areaDrawShape==='rectangle'||areaDrawShape==='circle'?'Click two opposite corners on the map.':areaDrawShape==='polygon'?'Click polygon points, then double-click to finish.':'Click and drag to draw a freehand area.'}</p>}
      </aside>}
      {/* ── MAP VIEW CONTROLS ── */}
      <motion.div
        data-hud
        initial={{ opacity: 0, y: 20 }}
        animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={hudIn(0.45)}
        className="fixed flex flex-col gap-2 pointer-events-none"
        style={{ left: '24px', bottom: '84px', zIndex: 200 }}
      >
        {/* Unified Control Strip */}
        <div className="flex items-center gap-1 p-1 pointer-events-auto rounded-xl border border-white/15 bg-black/80 backdrop-blur-md shadow-2xl">
          <ViewSegment layoutId="view-projection" active={mapProjection === 'globe'} onClick={() => setMapProjection('globe')} title="3D Globe" icon={Globe} label="3D" />
          <ViewSegment layoutId="view-projection" active={mapProjection === 'mercator'} onClick={() => setMapProjection('mercator')} title="2D Map" icon={MapPinned} label="2D" />
          <div className="w-px h-5 mx-0.5 bg-white/20" />
          <ViewSegment layoutId="view-style" active={mapStyle === 'dark'} onClick={() => setMapStyle('dark')} title="Night Mode" icon={Moon} label="MAP" />
          <ViewSegment layoutId="view-style" active={mapStyle === 'satellite'} onClick={() => setMapStyle('satellite')} title="Satellite View" icon={Satellite} label="SAT" />
          <div className="w-px h-5 mx-0.5 bg-white/20" />
          <ViewSegment layoutId="view-reset" active={false} onClick={resetView} title="Reset View" icon={LocateFixed} label="RESET" />
        </div>

        {/* Scale Bar */}
        <div className="pl-1">
          <ScaleBar zoom={mapView.zoom} latitude={mapView.latitude} />
        </div>
      </motion.div>

      {/* ── UNIFIED HEADER & STATUS BAR ── */}
      <motion.header
        data-hud
        initial={{ opacity: 0, y: -20 }}
        animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        transition={hudIn(0.15)}
        className="fixed top-3 left-6 z-[200] pointer-events-none flex items-center justify-between gap-4 transition-all duration-300 ease-out"
        style={{
          right: isSliderOpen ? '484px' : '24px',
        }}
      >
        {/* Left: Branding */}
        <div className="flex flex-col items-start select-none pointer-events-auto flex-shrink-0">
          <h1 className="text-xl font-bold tracking-[0.3em] text-white font-mono drop-shadow-[0_0_12px_rgba(0,229,255,0.4)] leading-tight">
            L&T
          </h1>
          <span className="text-[10px] font-mono tracking-[0.2em] font-semibold uppercase text-cyan-400">
            GLOBAL INTELLIGENCE PLATFORM
          </span>
        </div>

        {/* Right: Actions, Telemetry Badge & Status */}
        <div className="status-bar-desktop pointer-events-auto flex items-center gap-2.5 sm:gap-3 text-[11px] font-mono tracking-widest text-zinc-300 bg-black/75 backdrop-blur-xl px-3 py-1.5 rounded-xl border border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.7)] max-w-full overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDashboard(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-cyan-500/10 border border-cyan-400/30 rounded-lg text-cyan-300 font-bold hover:bg-cyan-500/20 active:scale-95 transition-all cursor-pointer shadow-[0_0_10px_rgba(0,229,255,0.15)] flex-shrink-0 text-[10px] tracking-wider"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">DASHBOARD</span>
          </button>

          <div className="hidden md:flex items-center gap-0.5 border-l border-white/15 pl-1.5" aria-label="Map tools">
            <button type="button" title={showLayers ? 'Hide map layers' : 'Show map layers'} aria-label={showLayers ? 'Hide map layers' : 'Show map layers'} aria-pressed={showLayers} onClick={() => setShowLayers(value => !value)} className={`rounded-md p-1.5 transition-colors hover:bg-white/10 hover:text-cyan-200 ${showLayers ? 'text-cyan-300' : ''}`}><Layers3 size={15} /></button>
            <button type="button" title={mapStyle === 'dark' ? 'Switch to satellite imagery' : 'Switch to dark map'} aria-label={mapStyle === 'dark' ? 'Switch to satellite imagery' : 'Switch to dark map'} aria-pressed={mapStyle === 'satellite'} onClick={() => setMapStyle(value => value === 'dark' ? 'satellite' : 'dark')} className={`rounded-md p-1.5 transition-colors hover:bg-white/10 hover:text-cyan-200 ${mapStyle === 'satellite' ? 'text-cyan-300' : ''}`}>{mapStyle === 'dark' ? <Satellite size={15} /> : <Moon size={15} />}</button>
            <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => setFlyToLocation({ lat: mapView.latitude, lng: mapView.longitude, zoom: Math.max(1.5, mapView.zoom - 1), duration: 450, ts: Date.now() })} className="rounded-md p-1.5 transition-colors hover:bg-white/10 hover:text-cyan-200"><ZoomOut size={15} /></button>
            <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => setFlyToLocation({ lat: mapView.latitude, lng: mapView.longitude, zoom: Math.min(18, mapView.zoom + 1), duration: 450, ts: Date.now() })} className="rounded-md p-1.5 transition-colors hover:bg-white/10 hover:text-cyan-200"><ZoomIn size={15} /></button>
            <button type="button" title={showMapControls ? 'Hide map controls' : 'Show map controls'} aria-label={showMapControls ? 'Hide map controls' : 'Show map controls'} aria-pressed={showMapControls} onClick={() => setShowMapControls(value => !value)} className={`rounded-md p-1.5 transition-colors hover:bg-white/10 hover:text-cyan-200 ${showMapControls ? 'text-cyan-300' : ''}`}><SlidersHorizontal size={15} /></button>
            <button type="button" title="Reset map view" aria-label="Reset map view" onClick={resetView} className="rounded-md p-1.5 transition-colors hover:bg-white/10 hover:text-cyan-200"><LocateFixed size={15} /></button>
            <button type="button" title={showNewsTicker ? 'Hide live news ticker' : 'Show live news ticker'} aria-label={showNewsTicker ? 'Hide live news ticker' : 'Show live news ticker'} aria-pressed={showNewsTicker} onClick={() => setShowNewsTicker(value => !value)} className={`rounded-md p-1.5 transition-colors hover:bg-white/10 hover:text-cyan-200 ${showNewsTicker ? 'text-cyan-300' : ''}`}><Newspaper size={15} /></button>
            <button type="button" title={showGeospatialVideo ? 'Close geospatial video' : 'Open geospatial video'} aria-label={showGeospatialVideo ? 'Close geospatial video' : 'Open geospatial video'} aria-pressed={showGeospatialVideo} onClick={() => setShowGeospatialVideo(value => !value)} className={`rounded-md p-1.5 transition-colors hover:bg-white/10 hover:text-cyan-200 ${showGeospatialVideo ? 'text-cyan-300' : ''}`}><Film size={15} /></button>
          </div>

          <div className="w-px h-4 bg-white/20 hidden md:block flex-shrink-0" />

          {/* Telemetry Badge / Local Clock */}
          <div className="flex items-center min-w-0">
            <HeaderClock
              countryTime={selectedCountryTime}
              satellite={selectedSatellite}
              ship={selectedShip}
              isIntelOpen={isIntelOpen}
              isSliderOpen={isSliderOpen}
              onReset={() => {
                if (selectedShip) {
                  setSelectedShip(null);
                  handleTrackShip(null);
                }
                setSelectedCountryTime(null);
                setSelectedSatellite(null);
                setIsIntelOpen(false);
                setIsSliderOpen(false);
                setClearSatTrigger(Date.now());
              }}
              onOpenIntel={() => {
                setIsIntelOpen(prev => !prev);
              }}
            />
          </div>

          <div className="w-px h-4 bg-white/20 hidden sm:block flex-shrink-0" />

          {/* Backend Connection Status */}
          <div
            className="hidden sm:flex items-center gap-1.5 font-semibold text-zinc-300 flex-shrink-0 text-[10px]"
            title={backendStatus === 'error' ? backendError || 'Backend is unreachable' : 'Backend connection status'}
          >
            <span className="text-zinc-500 font-mono">STATUS:</span>
            <span
              className={`font-bold flex items-center gap-1 ${
                backendStatus === 'connected'
                  ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                  : 'text-red-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  backendStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
                }`}
              />
              {backendStatus === 'connected' ? 'LIVE' : backendStatus.toUpperCase()}
            </span>
          </div>
        </div>
      </motion.header>

      {showLayers && (
        <div data-hud>
          <LayerPanel
            revealed={revealed}
            data={mapData}
            activeLayers={activeLayers}
            setActiveLayers={setActiveLayers}
            capabilities={capabilities}
          />
        </div>
      )}

      {/* ── FOOTER HUD ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: revealed ? 1 : 0 }} transition={hudIn(0.6)} className="absolute bottom-9 z-200 pointer-events-auto" style={{ left: '24px' }}>
        <div className="flex items-center gap-6 text-[10px] font-mono tracking-wider text-zinc-300 bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-lg border border-white/10 shadow-lg">
          <div className="flex gap-2 items-center" title="Cursor coordinates (hover over map)">
            <span className="text-zinc-400 font-medium">CURSOR</span>
            <span ref={coordsDisplayRef} className="text-cyan-300 font-bold tabular-nums drop-shadow-[0_0_6px_rgba(0,229,255,0.4)]">—</span>
          </div>

          <div className="flex gap-2 items-center" title="Current zoom level">
            <span className="text-zinc-400 font-medium">ZOOM</span>
            <span ref={zoomReadoutRef} className="text-cyan-300 font-bold tabular-nums drop-shadow-[0_0_6px_rgba(0,229,255,0.4)]">{mapView.zoom.toFixed(1)}</span>
          </div>
          <button onClick={() => setShowMapControls(!showMapControls)} className="text-cyan-300 hover:text-white hover:bg-white/10 px-2 py-1 -my-1 rounded transition-colors font-bold tracking-widest border border-white/10 bg-black/50">
            {showMapControls ? 'HIDE CONTROLS' : 'MAP CONTROLS'}
          </button>
        </div>
      </motion.div>

      {/* ── OVERLAYS ── */}
      <div className="vignette absolute inset-0 pointer-events-none z-2" />
      <div className="crt-scanlines absolute inset-0 pointer-events-none z-3 opacity-[0.02]" />

      {/* Keyboard Shortcuts Overlay */}
      <KeyboardShortcuts />

      {/* Dashboard Overlay */}
      <AnimatePresence>
        {showDashboard && <DashboardOverlay
          onClose={() => setShowDashboard(false)}
          data={mapData}
          activeLayers={activeLayers}
          onToggleLayer={key => setActiveLayers(previous => ({
            ...previous,
            [key]: !previous[key],
            ...(key.startsWith('sat_') ? { satellites: true } : {}),
          }))}
          onTabChange={tab => {
            if (tab === 'satellites') {
              if (activeLayers.satellites) void fetchersRef.current.fetchSatellites();
              else setActiveLayers(previous => ({ ...previous, satellites: true }));
            }
            if (tab === 'maritime') void fetchersRef.current.fetchMaritime();
          }}
        />}
      </AnimatePresence>

      {/* ── KEYBOARD SHORTCUTS BAR (BOTTOM CENTER) ── */}
      {showGeospatialVideo && <GeospatialVideoPanel
        onClose={() => {
          setShowGeospatialVideo(false);
          handleGeoVideoFrames(null);
          handleGeoVideoFrame(null);
        }}
        onFramesChange={handleGeoVideoFrames}
        onFrameChange={handleGeoVideoFrame}
      />}

      <div className={`fixed bottom-9 sm:bottom-10 left-1/2 -translate-x-1/2 z-[200] pointer-events-none transition-all duration-200 ${selectedSatellite ? 'hidden lg:flex' : 'flex'}`}>
        <div
          className="pointer-events-auto flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#070b14]/90 border border-cyan-500/25 shadow-[0_8px_30px_rgba(0,0,0,0.8),0_0_15px_rgba(0,229,255,0.1)] backdrop-blur-2xl text-[10px] sm:text-[11px] font-mono text-zinc-300 tracking-wider select-none"
          title="System shortcuts · Click keys or press on keyboard"
        >
          <span>Press</span>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
            }}
            className="px-1.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 font-bold hover:bg-cyan-500/30 hover:text-white transition-all cursor-pointer shadow-[0_0_8px_rgba(0,229,255,0.2)]"
            title="Open Shortcuts Modal (?)"
          >
            ?
          </button>
          <span>for shortcuts ·</span>
          <button
            type="button"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              else document.documentElement.requestFullscreen();
            }}
            className="px-1.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 font-bold hover:bg-cyan-500/30 hover:text-white transition-all cursor-pointer shadow-[0_0_8px_rgba(0,229,255,0.2)]"
            title="Toggle Fullscreen (F)"
          >
            F
          </button>
          <span>fullscreen ·</span>
          <button
            type="button"
            onClick={resetView}
            className="px-1.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 font-bold hover:bg-cyan-500/30 hover:text-white transition-all cursor-pointer shadow-[0_0_8px_rgba(0,229,255,0.2)]"
            title="Reset View (R)"
          >
            R
          </button>
          <span>reset view</span>
        </div>
      </div>

      {/* ── LIVE TELEVISION OSINT & NEWS TICKER (BOTTOM CRAWL) ── */}
      {showNewsTicker && (
        <NewsTicker
          onFlyToLocation={coords =>
            setFlyToLocation({ lat: coords.lat, lng: coords.lng, zoom: coords.zoom ?? 6, ts: Date.now() })
          }
        />
      )}
    </main>
  );
}
