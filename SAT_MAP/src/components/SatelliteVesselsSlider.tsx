'use client';

import { useState, useMemo } from 'react';
import {
  X,
  Ship,
  Compass,
  Gauge,
  Search,
  ExternalLink,
  Radio,
  Eye,
  Navigation,
} from 'lucide-react';
import SatelliteIcon from './SatelliteIcon';
import type { SatelliteDetail } from './SatelliteCard';

interface SatelliteVesselsSliderProps {
  sat: SatelliteDetail;
  onClose: () => void;
  onSelectShip?: (ship: NonNullable<SatelliteDetail['inViewShips']>[number]) => void;
}

export default function SatelliteVesselsSlider({
  sat,
  onClose,
  onSelectShip,
}: SatelliteVesselsSliderProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | 'cargo' | 'tanker' | 'military'>('all');
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const inViewShips = sat.inViewShips;
  const ships = useMemo(() => inViewShips ?? [], [inViewShips]);

  // Reset pagination whenever search or filter changes
  const handleTypeChange = (type: 'all' | 'cargo' | 'tanker' | 'military') => {
    setSelectedType(type);
    setVisibleCount(PAGE_SIZE);
  };

  const handleSearchChange = (term: string) => {
    setSearchTerm(term);
    setVisibleCount(PAGE_SIZE);
  };

  // Filter ships by search and type
  const filteredShips = useMemo(() => {
    return ships.filter(ship => {
      const matchesSearch =
        !searchTerm ||
        ship.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ship.mmsi.includes(searchTerm) ||
        (ship.destination && ship.destination.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesType =
        selectedType === 'all' || (ship.type && ship.type.toLowerCase() === selectedType);

      return matchesSearch && matchesType;
    });
  }, [ships, searchTerm, selectedType]);

  // Paginated subset to keep DOM lightweight and 60fps
  const displayedShips = useMemo(() => {
    return filteredShips.slice(0, visibleCount);
  }, [filteredShips, visibleCount]);

  // Total detected in footprint
  const totalDetected = sat.totalInViewCount ?? ships.length;

  // Counts by type (prefer exact footprint counts if available)
  const typeCounts = useMemo(() => {
    if (sat.inViewCountsByType) return sat.inViewCountsByType;
    const counts = { all: totalDetected, cargo: 0, tanker: 0, military: 0 };
    ships.forEach(s => {
      const t = (s.type || '').toLowerCase();
      if (t === 'cargo' || t === 'container') counts.cargo++;
      else if (t === 'tanker') counts.tanker++;
      else if (t === 'military') counts.military++;
    });
    return counts;
  }, [sat.inViewCountsByType, totalDetected, ships]);

  const accent = sat.color || '#00e5ff';

  // Compute viewing radius estimate
  const earthRadiusKm = 6371;
  const altitudeKm = Math.max(0, sat.alt ?? 0);
  const viewingRadiusKm = altitudeKm > 0
    ? Math.round(earthRadiusKm * Math.acos(earthRadiusKm / (earthRadiusKm + altitudeKm)))
    : 0;

  return (
    <div
      className="pointer-events-auto fixed top-0 right-0 bottom-0 z-400 w-full sm:w-[460px] max-w-[100vw] bg-[#070b14]/95 backdrop-blur-3xl border-l border-white/10  flex flex-col text-slate-100 select-none animate-in slide-in-from-right duration-300 ease-out"
      style={{
        borderLeft: `1px solid ${accent}40`
      }}
      role="dialog"
      aria-label={`Coverage Details for ${sat.name}`}
    >
      {/* ── TOP HEADER BAR ── */}
      <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${accent}18`, border: `1px solid ${accent}50`, color: accent }}
          >
            <SatelliteIcon className="w-5 h-5" accent={accent} hasBlink={true} blinkColor="red" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold font-mono tracking-wider text-white truncate" title={sat.name}>
                {sat.name}
              </h2>
              {sat.noradId && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400">
                  #{sat.noradId}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-slate-400">
              <span className="flex items-center gap-1.5 text-cyan-300 font-semibold">
                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                ACTIVE SENSOR FOOTPRINT
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-400/40 text-zinc-300 hover:text-cyan-300 text-[10px] font-mono font-bold tracking-wider transition-all cursor-pointer shadow-sm active:scale-95 flex-shrink-0"
            title="Close Footprint & Return to Satellite Card"
          >
            <span>← CARD</span>
          </button>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors focus:outline-none flex-shrink-0"
            title="Close details (Esc)"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── SCROLLABLE BODY ── */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5 custom-scrollbar">
        {/* SATELLITE SUMMARY CARD */}
        <div className="p-5 bg-gradient-to-b from-white/[0.03] to-transparent space-y-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400 font-semibold tracking-wider flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              SATELLITE TELEMETRY
            </span>
            <span
              className="text-[10px] px-2 py-0.5 rounded font-mono uppercase tracking-wider font-bold"
              style={{ background: `${accent}20`, border: `1px solid ${accent}50`, color: accent }}
            >
              {sat.category || 'ORBITAL'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div className="bg-slate-900/80 border border-white/5 rounded-xl p-2.5">
              <span className="block text-[9px] font-mono tracking-wider text-slate-400">ALTITUDE</span>
              <span className="text-xs font-mono font-bold text-cyan-300 tabular-nums">
                {sat.alt != null ? `${sat.alt.toFixed(1)} km` : '—'}
              </span>
            </div>
            <div className="bg-slate-900/80 border border-white/5 rounded-xl p-2.5">
              <span className="block text-[9px] font-mono tracking-wider text-slate-400">VELOCITY</span>
              <span className="text-xs font-mono font-bold text-slate-200 tabular-nums">
                {sat.speedKmS != null ? `${sat.speedKmS.toFixed(2)} km/s` : '—'}
              </span>
            </div>
            <div className="bg-slate-900/80 border border-white/5 rounded-xl p-2.5">
              <span className="block text-[9px] font-mono tracking-wider text-slate-400">COVERAGE</span>
              <span className="text-xs font-mono font-bold text-amber-300 tabular-nums">
                {viewingRadiusKm > 0 ? `${viewingRadiusKm.toLocaleString()} km` : '—'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1 pt-1">
            <span>
              LAT: <span className="text-slate-200">{sat.lat != null ? `${sat.lat.toFixed(4)}°` : '—'}</span>
            </span>
            <span>
              LNG: <span className="text-slate-200">{sat.lng != null ? `${sat.lng.toFixed(4)}°` : '—'}</span>
            </span>
            {sat.noradId && (
              <a
                href={`/satellite-catalog/${encodeURIComponent(sat.noradId)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
              >
                N2YO <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>
        </div>

        {/* MARITIME VESSELS SECTION */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold font-mono tracking-wider text-white flex items-center gap-2">
                <Ship className="w-4 h-4 text-cyan-400" />
                SHIPS IN SENSOR FOOTPRINT
              </h3>
              <p className="text-[10px] font-sans text-slate-400 mt-0.5">
                Real-time vessels within satellite horizon
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 tabular-nums">
              {totalDetected} DETECTED
            </span>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by vessel name or MMSI..."
              value={searchTerm}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs font-mono rounded-xl bg-slate-900/90 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[10px] font-mono">
            <button
              onClick={() => handleTypeChange('all')}
              className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                selectedType === 'all'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold'
                  : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
              }`}
            >
              ALL ({typeCounts.all})
            </button>
            <button
              onClick={() => handleTypeChange('cargo')}
              className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                selectedType === 'cargo'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold'
                  : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
              }`}
            >
              CARGO ({typeCounts.cargo})
            </button>
            <button
              onClick={() => handleTypeChange('tanker')}
              className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                selectedType === 'tanker'
                  ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                  : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
              }`}
            >
              TANKER ({typeCounts.tanker})
            </button>
            <button
              onClick={() => handleTypeChange('military')}
              className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                selectedType === 'military'
                  ? 'bg-red-500/20 border-red-400 text-red-200 font-bold'
                  : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
              }`}
            >
              MILITARY ({typeCounts.military})
            </button>
          </div>

          {/* VESSEL CARDS LIST */}
          {filteredShips.length === 0 ? (
            <div className="text-center py-10 px-4 border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
              <Ship className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-xs font-mono text-slate-400">
                {ships.length === 0
                  ? 'No vessels currently located within this satellite footprint.'
                  : 'No vessels matched the filter criteria.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[calc(100vh-420px)] overflow-y-auto pr-1">
              {displayedShips.map(ship => {
                const isMil = (ship.type || '').toLowerCase() === 'military';
                const isTanker = (ship.type || '').toLowerCase() === 'tanker';
                const vColor = isMil ? '#FF1744' : isTanker ? '#FF9500' : '#00E5FF';

                return (
                  <div
                    key={ship.mmsi}
                    onClick={() => onSelectShip?.(ship)}
                    className="p-3.5 rounded-xl border border-white/10 bg-slate-900/60 hover:bg-slate-800/80 hover:border-cyan-400/50 transition-all duration-200 cursor-pointer group shadow-lg"
                    style={{ borderLeft: `3px solid ${vColor}` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-bold tracking-wider"
                            style={{ background: `${vColor}20`, color: vColor }}
                          >
                            {ship.type || 'CARGO'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            MMSI {ship.mmsi}
                          </span>
                        </div>
                        <h4
                          className="text-xs font-bold font-mono text-white group-hover:text-cyan-300 transition-colors mt-1 truncate"
                          title={ship.name}
                        >
                          {ship.name || 'UNIDENTIFIED VESSEL'}
                        </h4>
                      </div>

                      <button
                        type="button"
                        className="p-1.5 rounded-lg bg-white/5 group-hover:bg-cyan-500/20 text-slate-400 group-hover:text-cyan-200 transition-colors"
                        title="Locate on map"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2.5 pt-2.5 border-t border-white/5 text-[10px] font-mono">
                      <div className="flex items-center gap-1.5 text-slate-300">
                        <Gauge className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span>SPEED: </span>
                        <span className="font-bold text-white tabular-nums">
                          {Number(ship.speed || 0).toFixed(1)} kn
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-300">
                        <Compass className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span>COURSE: </span>
                        <span className="font-bold text-white tabular-nums">
                          {ship.heading != null && ship.heading >= 0
                            ? `${Number(ship.heading).toFixed(0)}°`
                            : '—'}
                        </span>
                      </div>
                    </div>

                    {ship.destination && (
                      <div className="mt-1.5 text-[9px] font-mono text-slate-400 flex items-center gap-1.5 truncate">
                        <Navigation className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                        <span className="truncate">
                          DEST: <span className="text-slate-200">{ship.destination}</span>
                        </span>
                      </div>
                    )}

                    {ship.distanceKm != null && (
                      <div className="mt-1 text-[9px] font-mono text-slate-500">
                        Distance to sat: {Math.round(ship.distanceKm)} km
                      </div>
                    )}
                    {ship.trackDistanceKm != null && (
                      <div className="mt-1 text-[9px] font-mono text-cyan-200">
                        Observed AIS travel: {Number(ship.trackDistanceKm).toFixed(1)} km
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredShips.length > visibleCount && (
                <div className="pt-2 pb-1 text-center">
                  <button
                    type="button"
                    onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                    className="w-full py-2.5 px-4 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-400/30 hover:border-cyan-400/70 text-cyan-200 text-xs font-mono font-bold tracking-wider transition-all cursor-pointer active:scale-98 shadow-[0_0_12px_rgba(0,229,255,0.15)] flex items-center justify-center gap-2"
                  >
                    <span>LOAD MORE (+{Math.min(PAGE_SIZE, filteredShips.length - visibleCount)})</span>
                    <span className="text-[10px] text-cyan-400/70 font-normal">
                      • {filteredShips.length - visibleCount} REMAINING
                    </span>
                  </button>
                  <div className="text-[10px] font-mono text-slate-400 mt-2">
                    Showing {displayedShips.length} of {filteredShips.length} vessels
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
