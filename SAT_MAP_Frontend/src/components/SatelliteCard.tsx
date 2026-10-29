'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { FileText, X, Crosshair, Route, Circle } from 'lucide-react';
import SatelliteIcon from './SatelliteIcon';
import { fetchSatelliteWikiSummary } from '@/lib/satellite-intel';

export interface SatelliteDetail {
  shipCardOpen?: boolean;
  name: string;
  lat?: number | null;
  lng?: number | null;
  alt?: number | null;
  color?: string;
  mission?: string;
  category?: string;
  noradId?: string;
  country?: string;
  countryCode?: string | null;
  flag?: string;
  timeZone?: string;
  localTime?: string;
  line1?: string;
  line2?: string;
  periodMinutes?: number | null;
  speedKmS?: number | null;
  headingDeg?: number | null;
  updatedAt?: number;
  totalInViewCount?: number;
  inViewCountsByType?: {
    all: number;
    cargo: number;
    tanker: number;
    military: number;
  };
  inViewShips?: Array<{
    mmsi: string;
    name: string;
    type: string;
    speed: number;
    destination: string;
    lat: number;
    lng: number;
    heading?: number;
    flag?: string;
    distanceKm?: number;
    lastSeenAt?: number;
    trackStartLat?: number;
    trackStartLng?: number;
    trackStartAt?: number;
    trackDistanceKm?: number;
    trackPointCount?: number;
    track?: Array<{ lat: number; lng: number; timestamp: number; speed?: number | null }>;
  }>;
  track: 'loading' | 'ready' | 'unavailable';
}

const EARTH_RADIUS_KM = 6371;

function regime(altKm?: number | null): { label: string; note: string } {
  if (altKm == null || !Number.isFinite(altKm)) return { label: 'ORBIT', note: 'Earth orbit' };
  if (altKm < 2000) return { label: 'LEO', note: 'Low Earth orbit' };
  if (altKm < 35000) return { label: 'MEO', note: 'Medium Earth orbit' };
  if (altKm <= 36500) return { label: 'GEO', note: 'Geostationary belt' };
  return { label: 'HEO', note: 'High / highly elliptical' };
}

function speedKmS(altKm: number, periodMinutes: number): number {
  return (2 * Math.PI * (EARTH_RADIUS_KM + altKm)) / (periodMinutes * 60);
}

function period(minutes: number): string {
  if (minutes < 100) return `${minutes.toFixed(1)} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes - hours * 60);
  return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m`;
}

function heading(degrees: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const bearing = Math.round(degrees) % 360;
  return `${directions[Math.round(bearing / 45) % 8]} ${bearing}°`;
}

function colorSafe(value: string | undefined): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value ?? '')) ? String(value) : 'var(--cyan-primary)';
}

export default function SatelliteCard({
  sat,
  onClose,
  onOpenIntel,
  onOpenSlider,
  onFocusTrack,
  onTogglePlayback,
  onToggleCircumference,
  isCircumferenceActive = false,
  isPlaybackActive = false,
}: {
  sat: SatelliteDetail;
  onClose: () => void;
  onOpenIntel?: () => void;
  onOpenSlider?: () => void;
  onFocusTrack?: () => void;
  onTogglePlayback?: () => void;
  onToggleCircumference?: () => void;
  isCircumferenceActive?: boolean;
  isPlaybackActive?: boolean;
}) {
  const accent = colorSafe(sat.color);
  const shell = regime(sat.alt);

  // Satellite Imagery state — real satellite image only, no hardcoded category images
  const [imageState, setImageState] = useState<{
    satName: string;
    url: string | null;
    title: string | null;
    extract: string | null;
    wikiUrl: string | null;
    isLoading: boolean;
  }>({
    satName: sat.name,
    url: null,
    title: null,
    extract: null,
    wikiUrl: null,
    isLoading: true,
  });

  const isCurrent = imageState.satName === sat.name;
  const isImageLoading = !isCurrent || imageState.isLoading;
  const imageUrl = isCurrent ? imageState.url : null;
  const imageTitle = isCurrent ? imageState.title : null;
  const missionSummary = isCurrent ? imageState.extract : null;
  const missionWikiUrl = isCurrent ? imageState.wikiUrl : null;

  useEffect(() => {
    let active = true;

    fetchSatelliteWikiSummary(sat.name)
      .then((res) => {
        if (!active) return;
        setImageState({
          satName: sat.name,
          url: res?.thumbnailUrl || null,
          title: res?.title || sat.name,
          extract: res?.extract || null,
          wikiUrl: res?.wikiUrl || null,
          isLoading: false,
        });
      })
      .catch(() => {
        if (active) {
          setImageState({
            satName: sat.name,
            url: null,
            title: null,
            extract: null,
            wikiUrl: null,
            isLoading: false,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [sat.name]);

  const [satTime, setSatTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      setSatTime(`${h}:${m}:${s} UTC`);
    };
    updateTime();
    const iv = setInterval(updateTime, 1000);
    return () => clearInterval(iv);
  }, []);

  const velocityVal =
    sat.speedKmS != null
      ? sat.speedKmS.toFixed(4)
      : sat.periodMinutes && sat.alt != null
      ? speedKmS(sat.alt, sat.periodMinutes).toFixed(2)
      : '—';

  return (
    <div
      className={`pointer-events-auto fixed ${sat.shipCardOpen ? 'right-[440px]' : 'right-6'} bottom-6 z-[350] w-84 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/90 shadow-2xl backdrop-blur-2xl transition-all duration-200 select-none animate-in fade-in slide-in-from-bottom-2`}
      style={{
        borderTop: `2px solid ${accent}`,
      }}
      role="dialog"
      aria-label={`Satellite ${sat.name}`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5 bg-white/[0.02]">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${accent}15`, border: `1px solid ${accent}40` }}
          >
            <SatelliteIcon className="w-4 h-4" accent={accent} hasBlink={true} blinkColor="red" rotation={sat.headingDeg ?? 0} />
          </div>
          <h3 className="truncate text-xs font-bold tracking-wider font-mono text-white" title={sat.name}>
            {sat.name}
          </h3>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onToggleCircumference && <button type="button" onClick={onToggleCircumference} className={`p-1.5 rounded-lg transition-colors ${isCircumferenceActive ? 'text-cyan-200 bg-cyan-500/15' : 'text-slate-400 hover:text-cyan-300 hover:bg-white/10'}`} title={isCircumferenceActive ? 'Hide 3D satellite horizon view' : 'Show 3D satellite horizon view'} aria-label="Toggle 3D satellite horizon view" aria-pressed={isCircumferenceActive}><Circle className="h-3.5 w-3.5" /></button>}
          {onTogglePlayback && <button type="button" onClick={onTogglePlayback} className={`p-1.5 rounded-lg transition-colors ${isPlaybackActive ? 'text-cyan-200 bg-cyan-500/15' : 'text-slate-400 hover:text-cyan-300 hover:bg-white/10'}`} title={isPlaybackActive ? 'Hide orbital playback controls' : 'Show orbital playback controls'} aria-label="Toggle satellite track playback"><Route className="h-3.5 w-3.5" /></button>}
          {onFocusTrack && (
            <button
              type="button"
              onClick={onFocusTrack}
              className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-white/10 transition-colors"
              title="Focus Satellite on Map"
              aria-label="Focus satellite"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          )}
          {onOpenIntel && (
            <button
              type="button"
              onClick={onOpenIntel}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-mono font-bold tracking-wider bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 hover:border-cyan-300 text-cyan-300 hover:text-white transition-all cursor-pointer"
              title="Open Complete Intelligence Dossier"
            >
              <FileText className="h-3 w-3" />
              <span>DOSSIER</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors focus:outline-none"
            aria-label="Clear satellite selection"
            title="Clear selection (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* SATELLITE IMAGE BANNER / SHIMMER UNTIL DATA LOADS (NO HARDCODED PLACEHOLDERS) */}
      {isImageLoading ? (
        <div className="relative h-36 w-full overflow-hidden bg-slate-900/80 border-b border-white/10 flex flex-col items-center justify-center p-3 select-none">
          <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-cyan-400/15 to-transparent" />
          <SatelliteIcon className="w-8 h-8 mb-2 text-cyan-400" accent={accent} hasBlink={true} blinkColor="red" />
          <span className="text-[10px] font-mono font-bold text-cyan-300 tracking-widest flex items-center gap-1.5 uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            ACQUIRING SATELLITE IMAGERY…
          </span>
          <span className="text-[8px] font-mono text-slate-400 mt-1 truncate max-w-[85%]">
            Syncing OSINT payload for {sat.name}
          </span>
        </div>
      ) : imageUrl ? (
        <div className="relative h-36 w-full overflow-hidden bg-slate-950 border-b border-white/10 group">
          <Image
            src={imageUrl}
            alt={imageTitle || sat.name}
            fill
            sizes="(max-width: 768px) 100vw, 384px"
            className="object-cover object-center group-hover:scale-105 transition-transform duration-700"
            unoptimized
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/25 to-black/20 pointer-events-none" />



          {/* Bottom Image Caption */}
          <div className="absolute bottom-1.5 left-2.5 right-2.5 flex items-center justify-between text-[9px] font-mono pointer-events-none">
            <span className="truncate text-slate-200 font-semibold" title={imageTitle || sat.name}>
              {imageTitle || sat.name}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex h-20 items-center gap-3 border-b border-white/10 bg-slate-900/70 px-4">
          <SatelliteIcon className="h-8 w-8 shrink-0 text-cyan-400" accent={accent} />
          <div className="min-w-0">
            <p className="text-[9px] font-mono font-bold tracking-widest text-cyan-300">NO VERIFIED IMAGE AVAILABLE</p>
            <p className="mt-1 truncate text-[10px] text-slate-400">{imageTitle || sat.name}</p>
          </div>
        </div>
      )}

      <div className="border-b border-white/10 bg-slate-900/70 px-3 py-2">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded border border-white/10 text-slate-300">{shell.label}</span>
          {sat.category && <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: `${accent}50`, color: accent }}>{sat.category.replace('_', ' ')}</span>}
          <span className="ml-auto text-[9px] font-mono text-cyan-300">{satTime}</span>
        </div>
        <p className="text-[10px] font-semibold text-slate-200">{sat.mission || 'Active Orbital Payload'}</p>
        {missionSummary && <p className="mt-1 text-[9px] leading-snug text-slate-400 line-clamp-2">{missionSummary}</p>}
      </div>

      {missionWikiUrl && (
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
          <span className="truncate text-[8px] font-mono tracking-wider text-cyan-300">SATELLITE DATA</span>
          <a href={missionWikiUrl} target="_blank" rel="noreferrer" className="ml-2 flex-shrink-0 text-[8px] font-mono text-cyan-200 underline underline-offset-2 hover:text-white">
            SOURCE
          </a>
        </div>
      )}

      {onOpenIntel && (
        <div className="px-3 py-1.5 border-b border-cyan-400/20 bg-cyan-950/20">
          <button
            type="button"
            onClick={onOpenIntel}
            className="w-full flex items-center justify-between rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-cyan-200 transition-colors hover:bg-cyan-500/20"
          >
            <span className="flex items-center gap-2 text-[9px] font-mono font-bold tracking-wider">
              <FileText className="h-3.5 w-3.5" /> Mission Details
            </span>
            <span className="text-[9px] font-mono font-bold">OPEN →</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 p-3 bg-black/45 border-b border-white/5">
        {/* 1 - LATITUDE BOX */}
        <div className="bg-slate-900/75 hover:bg-slate-900 border border-cyan-400/25 hover:border-cyan-400/50 rounded-xl p-2.5 flex flex-col justify-between transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-mono tracking-widest text-cyan-400 uppercase font-bold">
              1 · LATITUDE
            </span>
            <span className="text-[8px] font-mono text-cyan-300/70">
              {sat.lat != null ? (sat.lat >= 0 ? 'N' : 'S') : ''}
            </span>
          </div>
          <span className="text-sm font-mono font-bold text-cyan-300 tabular-nums mt-0.5">
            {sat.lat != null && Number.isFinite(sat.lat) ? (
              <>
                {sat.lat.toFixed(4)}
                <span className="text-[10px] font-normal text-slate-400 font-sans">°</span>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>

        {/* 2 - LONGITUDE BOX */}
        <div className="bg-slate-900/75 hover:bg-slate-900 border border-cyan-400/25 hover:border-cyan-400/50 rounded-xl p-2.5 flex flex-col justify-between transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-mono tracking-widest text-cyan-400 uppercase font-bold">
              2 · LONGITUDE
            </span>
            <span className="text-[8px] font-mono text-cyan-300/70">
              {sat.lng != null ? (sat.lng >= 0 ? 'E' : 'W') : ''}
            </span>
          </div>
          <span className="text-sm font-mono font-bold text-cyan-300 tabular-nums mt-0.5">
            {sat.lng != null && Number.isFinite(sat.lng) ? (
              <>
                {sat.lng.toFixed(4)}
                <span className="text-[10px] font-normal text-slate-400 font-sans">°</span>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>

        {/* 3 - VELOCITY BOX */}
        <div className="bg-slate-900/70 hover:bg-slate-900/90 border border-emerald-400/25 hover:border-emerald-400/50 rounded-xl p-2.5 flex flex-col justify-between transition-colors shadow-[0_0_10px_rgba(0,230,118,0.05)]">
          <span className="text-[8px] font-mono tracking-widest text-emerald-400 uppercase font-bold">
            3 · VELOCITY
          </span>
          <span className="text-sm font-mono font-bold text-emerald-300 tabular-nums mt-0.5">
            {velocityVal}
            {velocityVal !== '—' && (
              <span className="text-[10px] font-normal text-slate-400 font-sans"> km/s</span>
            )}
          </span>
        </div>

        {/* 4 - ALTITUDE BOX */}
        <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 rounded-xl p-2.5 flex flex-col justify-between transition-colors">
          <span className="text-[8px] font-mono tracking-widest text-slate-500 uppercase">
            ALTITUDE
          </span>
          <span className="text-sm font-mono font-bold text-slate-200 tabular-nums mt-0.5">
            {sat.alt != null && Number.isFinite(sat.alt) ? (
              <>
                {Number(sat.alt.toFixed(1)).toLocaleString(undefined, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}{' '}
                <span className="text-[10px] font-normal text-slate-400 font-sans">km</span>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>

        <div className="bg-slate-900/60 border border-white/5 rounded-xl p-2.5">
          <span className="text-[8px] font-mono tracking-widest text-slate-500 uppercase">ORBIT PERIOD</span>
          <p className="mt-0.5 text-xs font-mono font-semibold text-slate-300 tabular-nums">
            {sat.periodMinutes ? period(sat.periodMinutes) : '—'}
          </p>
        </div>
        <div className="bg-slate-900/60 border border-white/5 rounded-xl p-2.5">
          <span className="text-[8px] font-mono tracking-widest text-slate-500 uppercase">ORBIT REGIME</span>
          <p className="mt-0.5 text-xs font-mono font-semibold text-slate-300">{shell.note}</p>
        </div>
        <div className="col-span-2 bg-slate-900/60 border border-white/5 rounded-xl p-2.5">
          <span className="text-[8px] font-mono tracking-widest text-slate-500 uppercase">ORBIT DIRECTION</span>
          <p className="mt-0.5 text-xs font-mono font-semibold text-slate-300 tabular-nums">
            {sat.headingDeg != null ? heading(sat.headingDeg) : '—'}
          </p>
        </div>

      </div>

      {/* REST OF DETAILS: NORAD ID & COUNTRY METADATA */}
      <div className="px-3.5 py-2 border-b border-white/5 text-[9px] font-mono flex items-center justify-between bg-black/20">
        <div className="flex items-center gap-2">
          <span className="text-slate-500 tracking-wider">NORAD ID</span>
          <span className="text-slate-300 font-bold tabular-nums bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
            {sat.noradId || '—'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-slate-500 tracking-wider flex-shrink-0">SAT TIME</span>
          <span className="text-cyan-400 font-bold tabular-nums truncate">
            {satTime}
          </span>
        </div>
      </div>

      {/* AIS positions inside the satellite's geometric line-of-sight horizon. */}
      {(sat.inViewCountsByType || (sat.totalInViewCount ?? sat.inViewShips?.length ?? 0) > 0) && (
        <div className="p-2.5 border-b border-white/5 bg-cyan-950/20">
          <button
            type="button"
            onClick={() => onOpenSlider?.()}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 transition-all duration-200 group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
              </span>
              <span className="text-[10px] font-mono font-bold tracking-wider">
                {sat.totalInViewCount ?? sat.inViewShips?.length ?? 0} AIS SHIPS IN HORIZON
              </span>
            </div>
            <span className="text-[9px] font-mono text-cyan-300 font-semibold group-hover:translate-x-1 transition-transform flex items-center gap-1">
              OPEN SLIDER →
            </span>
          </button>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[8px] font-mono text-slate-300">
            <span className="rounded border border-white/10 px-1.5 py-1">CARGO {sat.inViewCountsByType?.cargo ?? 0}</span>
            <span className="rounded border border-white/10 px-1.5 py-1">TANKER {sat.inViewCountsByType?.tanker ?? 0}</span>
            <span className="rounded border border-white/10 px-1.5 py-1">MILITARY {sat.inViewCountsByType?.military ?? 0}</span>
          </div>

        </div>
      )}

    
    </div>
  );
}
