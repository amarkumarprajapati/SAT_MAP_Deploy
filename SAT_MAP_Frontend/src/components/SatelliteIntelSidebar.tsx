'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Rocket,
  Calendar,
  Globe2,
  Shield,
  Clock,
  MapPin,
  Activity,
  Cpu,
  Building2,
} from 'lucide-react';
import SatelliteIcon from './SatelliteIcon';
import { SatelliteDetail } from './SatelliteCard';
import { api, apiClient } from '@/config/api';
import {
  parseOrbitalParameters,
  getSatelliteLaunchIntel,
  fetchSatelliteWikiSummary,
  type WikiSatelliteSummary,
} from '@/lib/satellite-intel';

interface SatelliteIntelSidebarProps {
  sat: SatelliteDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenSlider?: () => void;
}

export default function SatelliteIntelSidebar({
  sat,
  isOpen,
  onClose,
  onOpenSlider,
}: SatelliteIntelSidebarProps) {
  const [rfInfo, setRfInfo] = useState<{
    transmitters: Array<{ id?: string; description?: string | null; alive?: boolean | null; status?: string | null; uplinkLowHz?: number | null; uplinkHighHz?: number | null; downlinkLowHz?: number | null; downlinkHighHz?: number | null; mode?: string | null }>;
    source?: string;
    fetchedAt?: string | null;
    radiusKm?: number;
    elevationMaskDeg?: number;
  } | null>(null);
  const [wikiState, setWikiState] = useState<{
    satKey: string | null;
    data: WikiSatelliteSummary | null;
    isLoading: boolean;
  }>({
    satKey: null,
    data: null,
    isLoading: false,
  });

  const satNoradId = sat?.noradId;
  const satName = sat?.name;
  const satKey = isOpen && satName ? `${satNoradId ?? ''}_${satName}` : null;
  const isCurrent = satKey !== null && wikiState.satKey === satKey;
  const isLoadingWiki = satKey !== null && (!isCurrent || wikiState.isLoading);
  const wikiData = isCurrent ? wikiState.data : null;

  useEffect(() => {
    if (!satName || !isOpen) {
      return;
    }

    let active = true;
    const currentKey = `${satNoradId ?? ''}_${satName}`;

    fetchSatelliteWikiSummary(satName)
      .then(res => {
        if (active) {
          setWikiState({
            satKey: currentKey,
            data: res,
            isLoading: false,
          });
        }
      })
      .catch(() => {
        if (active) {
          setWikiState({
            satKey: currentKey,
            data: null,
            isLoading: false,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [satNoradId, satName, isOpen]);

  useEffect(() => {
    if (!isOpen || !satNoradId) return;
    let active = true;
    Promise.all([
      apiClient.get(api.satelliteTransmitters(satNoradId)).then(response => response.data),
      apiClient.get(api.satelliteCoverage(satNoradId)).then(response => response.data),
    ]).then(([transmitters, coverage]) => {
      if (active) setRfInfo({
        transmitters: transmitters.transmitters ?? [],
        source: transmitters.source,
        fetchedAt: transmitters.fetchedAt,
        radiusKm: coverage.footprintRadiusKm,
        elevationMaskDeg: coverage.elevationMaskDeg,
      });
    }).catch(() => { if (active) setRfInfo(null); });
    return () => { active = false; };
  }, [isOpen, satNoradId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !sat) return null;

  const orbital = parseOrbitalParameters(sat.line1, sat.line2, sat.noradId);
  const launchIntel = getSatelliteLaunchIntel(sat.name, orbital);

  const accent = sat.color || '#00E5FF';

  return (
    <AnimatePresence>
      <motion.aside
        initial={{ x: '100%', opacity: 0.5 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed top-0 right-0 h-full w-[460px] max-w-[100vw] z-[650] flex flex-col pointer-events-auto border-l border-cyan-500/20"
        style={{
          background: 'linear-gradient(180deg, rgba(7,11,18,0.97) 0%, rgba(3,6,10,0.99) 100%)',
          backdropFilter: 'blur(36px) saturate(1.8)',
          WebkitBackdropFilter: 'blur(36px) saturate(1.8)',
        }}
        role="complementary"
        aria-label={`Intelligence Dossier for ${sat.name}`}
      >
        {/* Top Header */}
        <div className="relative px-4 sm:px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-2.5 bg-white/[0.02]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 hover:rotate-6"
              style={{
                background: `${accent}18`,
                border: `1px solid ${accent}50`,
                color: accent,
                boxShadow: `0 0 16px ${accent}25`,
              }}
            >
              <SatelliteIcon className="w-5 h-5" accent={accent} hasBlink={true} blinkColor="red" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono tracking-[0.15em] uppercase font-bold text-cyan-400 block whitespace-nowrap">
                  INTELLIGENCE DOSSIER
                </span>
                <span className="px-1.5 py-0.2 rounded text-[8px] font-mono font-bold uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-400/30 flex-shrink-0">
                  LIVE OSINT
                </span>
              </div>
              <span className="text-[10px] font-mono tracking-wider text-zinc-400 truncate block">
                WIKIPEDIA & SPACE OSINT
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-400/40 text-zinc-300 hover:text-cyan-300 text-[10px] font-mono font-bold tracking-wider transition-all cursor-pointer shadow-sm active:scale-95 flex-shrink-0"
              title="Close Dossier & Return to Satellite Card"
            >
              <span>← CARD</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Intelligence Dossier"
              title="Close Dossier & Return to Satellite Card (Esc)"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 hover:border-white/20 active:scale-95 transition-all cursor-pointer border border-transparent flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div key={sat.noradId || sat.name} className="flex-1 overflow-y-auto styled-scrollbar p-5 space-y-4 animate-in fade-in duration-200">
          {/* Hero Identity Banner */}
          <div
            className="group relative rounded-2xl border p-4 overflow-hidden transition-all duration-300 hover:shadow-[0_8px_32px_rgba(0,229,255,0.18)]"
            style={{
              borderColor: `${accent}40`,
              background: `linear-gradient(135deg, ${accent}12 0%, rgba(15,23,42,0.6) 100%)`,
              boxShadow: `0 8px 30px ${accent}15`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold font-mono tracking-wider text-white truncate" title={sat.name}>
                    {sat.name}
                  </h2>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap text-[10px] font-mono">
                  {sat.noradId && (
                    <span className="px-2 py-0.5 rounded-md bg-white/10 border border-white/10 text-cyan-300 font-bold hover:bg-white/15 transition-colors">
                      NORAD #{sat.noradId}
                    </span>
                  )}
                  {orbital.cosparId !== '—' && (
                    <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10 transition-colors">
                      COSPAR {orbital.cosparId}
                    </span>
                  )}
                  {sat.category && (
                    <span
                      className="px-2 py-0.5 rounded-md border font-semibold uppercase tracking-wider"
                      style={{ borderColor: `${accent}60`, color: accent, background: `${accent}15` }}
                    >
                      {sat.category.replace('_', ' ')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Thumbnail Image from Wikipedia if present, or shimmer skeleton while loading */}
            {isLoadingWiki ? (
              <div className="mt-3.5 relative rounded-xl overflow-hidden border border-cyan-500/25 bg-slate-900/60 aspect-[16/9] flex flex-col items-center justify-center">
                <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-cyan-400/15 to-transparent" />
                <SatelliteIcon className="w-8 h-8 mb-2" accent="#00e5ff" hasBlink={true} blinkColor="cyan" />
                <span className="text-[10px] font-mono text-cyan-300/70 tracking-widest flex items-center gap-1.5 uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                  ACQUIRING IMAGERY & INTEL…
                </span>
              </div>
            ) : wikiData?.thumbnailUrl ? (
              <div className="mt-3.5 relative rounded-xl overflow-hidden border border-white/10 bg-black/60 aspect-video flex items-center justify-center group-hover:border-cyan-400/40 transition-colors">
                <Image
                  src={wikiData.thumbnailUrl}
                  alt={sat.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 420px"
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2.5">
                  <span className="text-[10px] font-mono text-white/90 truncate">
                    {wikiData.title}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Launch Intelligence Card ("When launch, Who launch") */}
          <div className="rounded-2xl border border-white/10 hover:border-cyan-400/30 bg-black/40 p-4 space-y-3.5 transition-all duration-200">
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-2 text-cyan-300">
                <Rocket className="w-4 h-4" />
                <span className="text-[11px] font-mono font-bold tracking-wider uppercase">
                  LAUNCH & OPERATOR INTEL
                </span>
              </div>
              <span className="text-[9px] font-mono text-zinc-400 px-2 py-0.5 rounded bg-white/5 border border-white/10">
                VERIFIED
              </span>
            </div>

            <div className="space-y-2.5 text-[11px] font-mono">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 rounded-xl p-3 transition-all duration-200">
                  <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] mb-1">
                    <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="tracking-wider">LAUNCH TIMELINE</span>
                  </div>
                  <div className="text-white font-bold tracking-wide">
                    {launchIntel.approxLaunchDate}
                  </div>
                </div>

                <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 rounded-xl p-3 transition-all duration-200">
                  <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] mb-1">
                    <Globe2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="tracking-wider">STATE / OPERATOR</span>
                  </div>
                  <div className="text-white font-bold flex items-center gap-1.5 min-w-0" title={`${launchIntel.flag} ${launchIntel.country}`}>
                    <span className="text-sm leading-none flex-shrink-0">{launchIntel.flag}</span>
                    <span className="truncate text-[11px]">{launchIntel.country}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 rounded-xl p-3 transition-all duration-200">
                <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] mb-1">
                  <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="tracking-wider">RESPONSIBLE COMMAND / AGENCY</span>
                </div>
                <div className="text-zinc-200 font-semibold tracking-wide text-[11px] leading-relaxed">
                  {launchIntel.operator}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 rounded-xl p-3 transition-all duration-200">
                  <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] mb-1">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="tracking-wider">LAUNCH VEHICLE</span>
                  </div>
                  <div className="text-zinc-200 font-semibold text-[11px] leading-snug break-words" title={launchIntel.rocket}>
                    {launchIntel.rocket}
                  </div>
                </div>

                <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 rounded-xl p-3 transition-all duration-200">
                  <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] mb-1">
                    <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="tracking-wider">LAUNCH SITE</span>
                  </div>
                  <div className="text-zinc-200 font-semibold text-[11px] leading-snug break-words" title={launchIntel.launchSite}>
                    {launchIntel.launchSite}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* In-View Ships Maritime Correlation Card (if present) */}
          {sat.noradId && (
            <section className="rounded-xl border border-cyan-500/25 bg-cyan-950/10 p-3 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono font-bold tracking-wider text-cyan-300">
                <span>RF TRANSMITTER DATA</span>
                <span>{rfInfo?.transmitters.length ?? '—'} RECORDS</span>
              </div>
              {rfInfo?.transmitters.length ? rfInfo.transmitters.map((tx, index) => {
                const frequency = (low?: number | null, high?: number | null) => {
                  if (low == null && high == null) return null;
                  const lowMhz = low == null ? null : low / 1e6;
                  const highMhz = high == null ? null : high / 1e6;
                  return lowMhz != null && highMhz != null && lowMhz !== highMhz
                    ? `${lowMhz.toFixed(3)}–${highMhz.toFixed(3)} MHz`
                    : `${(lowMhz ?? highMhz)!.toFixed(3)} MHz`;
                };
                return <div key={tx.id ?? index} className="text-[10px] text-zinc-300 space-y-0.5">
                  {tx.description && <div>{tx.description}</div>}
                  <div className="text-zinc-400">Downlink: {frequency(tx.downlinkLowHz, tx.downlinkHighHz) ?? 'unknown'} · Uplink: {frequency(tx.uplinkLowHz, tx.uplinkHighHz) ?? 'unknown'}</div>
                  <div className="text-zinc-500">Mode: {tx.mode || 'unknown'} · Listed status: {tx.status || (tx.alive == null ? 'unknown' : tx.alive ? 'alive' : 'inactive')}</div>
                </div>;
              }) : <p className="text-[10px] text-zinc-400">{rfInfo ? 'No SatNOGS transmitter record for this NORAD ID.' : 'Loading cached transmitter metadata…'}</p>}
              <div className="border-t border-white/5 pt-2 text-[9px] font-mono text-zinc-500">
                Estimated geometric visibility: {rfInfo?.radiusKm != null ? `${Math.round(rfInfo.radiusKm).toLocaleString()} km radius at ${rfInfo.elevationMaskDeg}° elevation` : 'loading'}.
                {' '}This is not a verified RF beam or proof of reception.
                <div className="mt-1">Source: SatNOGS DB (CC BY-SA) · {rfInfo?.fetchedAt ? new Date(rfInfo.fetchedAt).toLocaleString() : rfInfo?.source ?? 'refresh pending'}</div>
              </div>
            </section>
          )}

          {/* In-View Ships Maritime Correlation Card (if present) */}
          {(sat.totalInViewCount ?? sat.inViewShips?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-cyan-400/40 bg-cyan-950/20 p-4 transition-all duration-200 hover:border-cyan-400/70 hover:shadow-[0_0_20px_rgba(0,229,255,0.15)]">
              <div className="flex items-center justify-between pb-2 border-b border-cyan-400/20 mb-3">
                <div className="flex items-center gap-2 text-cyan-300">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
                  </span>
                  <span className="text-[11px] font-mono font-bold tracking-wider uppercase">
                    AIS VESSELS IN MODELED SATELLITE FOOTPRINT
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/40 text-[9px] font-mono font-bold text-cyan-300">
                  {sat.totalInViewCount ?? sat.inViewShips?.length} CONTACTS
                </span>
              </div>
              <p className="text-[10px] font-mono text-zinc-300 mb-3 leading-relaxed">
                {sat.totalInViewCount ?? sat.inViewShips?.length} AIS vessel{(sat.totalInViewCount ?? sat.inViewShips?.length ?? 0) > 1 ? 's are' : ' is'} geographically inside an estimated footprint. This is a line-of-sight estimate, not an RF detection.
              </p>
              {onOpenSlider && (
                <button
                  type="button"
                  onClick={onOpenSlider}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 hover:border-cyan-400 text-cyan-200 text-[10px] font-mono font-bold tracking-wider transition-all duration-200 cursor-pointer shadow-[0_0_12px_rgba(0,229,255,0.25)] group"
                >
                  <span>INSPECT AIS VESSELS</span>
                  <span className="group-hover:translate-x-1 transition-transform">OPEN VESSEL LIST →</span>
                </button>
              )}
            </div>
          )}

          {/* Mission Timeline */}
          <div className="rounded-2xl border border-white/10 hover:border-cyan-400/30 bg-black/40 p-4 space-y-3 transition-all duration-200">
            <div className="flex items-center gap-2 text-cyan-300 pb-2 border-b border-white/5">
              <Clock className="w-4 h-4" />
              <span className="text-[11px] font-mono font-bold tracking-wider uppercase">
                MISSION TIMELINE & LIFECYCLE
              </span>
            </div>

            <div className="space-y-3 pl-2 relative border-l-2 border-cyan-500/30 ml-2 py-1 font-mono text-[11px]">
              <div className="relative pl-4 group/step hover:bg-white/[0.02] rounded-lg p-1.5 transition-colors">
                <div className="absolute -left-[13px] top-2.5 w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#00E5FF]" />
                <div className="text-zinc-400 text-[10px]">MISSION INITIATION & LIFTOFF</div>
                <div className="text-white font-bold">{launchIntel.approxLaunchDate}</div>
                <div className="text-zinc-500 text-[10px] mt-0.5">Payload insertion into target orbit</div>
              </div>

              <div className="relative pl-4 group/step hover:bg-white/[0.02] rounded-lg p-1.5 transition-colors">
                <div className="absolute -left-[13px] top-2.5 w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34D399]" />
                <div className="text-zinc-400 text-[10px]">OPERATIONAL RECONNAISSANCE</div>
                <div className="text-emerald-300 font-bold">ACTIVE FLIGHT OPERATIONS</div>
                <div className="text-zinc-500 text-[10px] mt-0.5">
                  Telemetry synchronized via NORAD tracking
                </div>
              </div>

              {orbital.epochYear && (
                <div className="relative pl-4 group/step hover:bg-white/[0.02] rounded-lg p-1.5 transition-colors">
                  <div className="absolute -left-[13px] top-2.5 w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#F59E0B]" />
                  <div className="text-zinc-400 text-[10px]">LATEST TLE EPHEMERIS EPOCH</div>
                  <div className="text-zinc-200 font-bold">
                    YEAR {orbital.epochYear} · DAY {orbital.epochDay ? orbital.epochDay.toFixed(2) : '—'}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Mission Dossier / Wikipedia Overview */}
          <div className="rounded-2xl border border-white/10 hover:border-cyan-400/30 bg-black/40 p-4 space-y-2.5 transition-all duration-200">
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-2 text-cyan-300">
                <Shield className="w-4 h-4" />
                <span className="text-[11px] font-mono font-bold tracking-wider uppercase">
                  WIKIPEDIA MISSION OVERVIEW
                </span>
              </div>
              <span className="text-[9px] font-mono text-zinc-400">
                {isLoadingWiki ? (
                  <span className="text-cyan-400 font-bold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    QUERYING OSINT…
                  </span>
                ) : (
                  wikiData?.source || 'SPACE CATALOGUE'
                )}
              </span>
            </div>

            {isLoadingWiki ? (
              <div className="space-y-2 py-1">
                <div className="h-3 rounded-md bg-white/10 w-full overflow-hidden relative">
                  <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent" />
                </div>
                <div className="h-3 rounded-md bg-white/10 w-11/12 overflow-hidden relative">
                  <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent" />
                </div>
                <div className="h-3 rounded-md bg-white/10 w-4/5 overflow-hidden relative">
                  <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent" />
                </div>
                <div className="h-3 rounded-md bg-white/10 w-3/5 overflow-hidden relative">
                  <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent" />
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-zinc-300 leading-relaxed font-sans">
                {wikiData?.extract || 'Operational intelligence asset actively monitored.'}
              </p>
            )}
          </div>

          {/* Real-time Orbital & Telemetry Metrics */}
          <div className="rounded-2xl border border-white/10 hover:border-cyan-400/30 bg-black/40 p-4 space-y-3 transition-all duration-200">
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-2 text-cyan-300">
                <Activity className="w-4 h-4" />
                <span className="text-[11px] font-mono font-bold tracking-wider uppercase">
                  LIVE TELEMETRY & ORBITAL MECHANICS
                </span>
              </div>
              <span className="flex items-center gap-1.5 text-[9px] font-mono text-emerald-400 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                REAL-TIME
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 hover:shadow-[0_0_12px_rgba(0,229,255,0.12)] transition-all duration-200 rounded-xl p-2.5">
                <span className="text-[8px] text-zinc-500 uppercase block tracking-wider">ALTITUDE</span>
                <span className="text-cyan-400 font-bold text-sm tabular-nums">
                  {sat.alt != null ? sat.alt.toFixed(1) : '—'}{' '}
                  <span className="text-[10px] font-normal text-zinc-400 font-sans">km</span>
                </span>
              </div>

              <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 hover:shadow-[0_0_12px_rgba(0,229,255,0.12)] transition-all duration-200 rounded-xl p-2.5">
                <span className="text-[8px] text-zinc-500 uppercase block tracking-wider">ORBITAL VELOCITY</span>
                <span className="text-zinc-200 font-bold text-sm tabular-nums">
                  {sat.speedKmS != null ? sat.speedKmS.toFixed(3) : '—'}{' '}
                  <span className="text-[10px] font-normal text-zinc-400 font-sans">km/s</span>
                </span>
              </div>

              <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 hover:shadow-[0_0_12px_rgba(0,229,255,0.12)] transition-all duration-200 rounded-xl p-2.5">
                <span className="text-[8px] text-zinc-500 uppercase block tracking-wider">INCLINATION</span>
                <span className="text-zinc-200 font-bold tabular-nums">
                  {orbital.inclinationDeg != null ? `${orbital.inclinationDeg.toFixed(2)}°` : '—'}
                </span>
              </div>

              <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 hover:shadow-[0_0_12px_rgba(0,229,255,0.12)] transition-all duration-200 rounded-xl p-2.5">
                <span className="text-[8px] text-zinc-500 uppercase block tracking-wider">PERIOD</span>
                <span className="text-zinc-200 font-bold tabular-nums">
                  {orbital.periodMinutes != null ? `${orbital.periodMinutes.toFixed(1)} min` : sat.periodMinutes ? `${sat.periodMinutes.toFixed(1)} min` : '—'}
                </span>
              </div>

              <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 hover:shadow-[0_0_12px_rgba(0,229,255,0.12)] transition-all duration-200 rounded-xl p-2.5">
                <span className="text-[8px] text-zinc-500 uppercase block tracking-wider">APOGEE / PERIGEE</span>
                <span className="text-zinc-300 font-medium tabular-nums text-[10px]">
                  {orbital.apogeeKm != null && orbital.perigeeKm != null
                    ? `${orbital.apogeeKm} / ${orbital.perigeeKm} km`
                    : '—'}
                </span>
              </div>

              <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 hover:shadow-[0_0_12px_rgba(0,229,255,0.12)] transition-all duration-200 rounded-xl p-2.5">
                <span className="text-[8px] text-zinc-500 uppercase block tracking-wider">SUB-SAT LOCATION</span>
                <span className="text-zinc-200 font-bold tabular-nums truncate block" title={sat.country}>
                  {sat.country || 'Over Ocean'}
                </span>
              </div>
            </div>

            {/* Coordinates */}
            <div className="bg-slate-900/60 hover:bg-slate-900/90 border border-white/5 hover:border-cyan-400/30 rounded-xl p-2.5 flex items-center justify-between text-[10px] font-mono transition-colors">
              <span className="text-zinc-400 font-medium">LIVE COORDINATES</span>
              <span className="text-cyan-300 font-bold tabular-nums">
                {sat.lat != null ? `${sat.lat.toFixed(4)}°N` : '—'}, {sat.lng != null ? `${sat.lng.toFixed(4)}°E` : '—'}
              </span>
            </div>
          </div>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}
