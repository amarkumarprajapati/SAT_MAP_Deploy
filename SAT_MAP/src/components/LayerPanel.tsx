'use client';

import { memo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane, Satellite, Ship, SunMoon,
} from 'lucide-react';

interface LayerPanelProps {
  data: Record<string, unknown>;
  activeLayers: Record<string, boolean>;
  setActiveLayers: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  isMobile?: boolean;
  capabilities?: Record<string, boolean>;
  revealed?: boolean;
}

interface LayerDef {
  key: string;
  label: string;
  dataKey: string;
  description?: string;
  catKey?: string;
  requires?: string;
  parent?: string;
  color?: string;
}

interface LayerGroupDef {
  label: string;
  fullLabel: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  layers: LayerDef[];
}

const LAYER_GROUPS: LayerGroupDef[] = [
  {
    label: 'AVIATION',
    fullLabel: 'AVIATION',
    icon: Plane,
    layers: [
      { key: 'military', label: 'Military', dataKey: 'military_flights' },
    ],
  },
  {
    label: 'MARITIME',
    fullLabel: 'MARITIME',
    icon: Ship,
    layers: [
      { key: 'maritime', label: 'Ports & chokepoints', dataKey: 'maritime_ports,maritime_chokepoints' },
      { key: 'ship_cargo', label: 'Container / Cargo', dataKey: 'maritime_ships', catKey: 'cargo', description: 'Container & freight vessels', color: '#00E5FF' },
      { key: 'ship_tanker', label: 'Tankers', dataKey: 'maritime_ships', catKey: 'tanker', description: 'Crude, oil & LNG carriers', color: '#FF9500' },
      { key: 'ship_military', label: 'Military & Naval', dataKey: 'maritime_ships', catKey: 'military', description: 'Naval defence & patrol', color: '#FF1744' },
    ],
  },
  {
    label: 'SPACE',
    fullLabel: 'SPACE TRACKING',
    icon: Satellite,
    layers: [
      { key: 'sat_military', label: 'Military / Intel', dataKey: 'satellites', catKey: 'military' },
      { key: 'sat_navigation', label: 'GPS / Navigation', dataKey: 'satellites', catKey: 'navigation' },
      { key: 'sat_earth', label: 'Earth Observation', dataKey: 'satellites', catKey: 'earth_obs' },
    ],
  },
  {
    label: 'ENVIRONMENT',
    fullLabel: 'EARTH & ENVIRONMENT',
    icon: SunMoon,
    layers: [
      {
        key: 'day_night',
        label: 'Day & Night',
        dataKey: '',
        description: 'Solar terminator & shadow',
        color: '#F59E0B',
      },
    ],
  },
];

function ToggleSwitch({ active, color = '#00E5FF' }: { active: boolean; color?: string }) {
  return (
    <span
      role="presentation"
      className="relative flex-shrink-0 block"
      style={{ width: 28, height: 14 }}
    >
      <div
        className="absolute inset-0 rounded-full transition-all duration-300"
        style={{
          background: active ? `${color}38` : 'transparent',
          border: active ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.16)',
          boxShadow: active ? `0 0 10px ${color}30` : 'none',
        }}
      />
      <motion.div
        className="absolute top-2px rounded-full"
        style={{
          width: 10,
          height: 10,
          background: active ? '#ffffff' : 'rgba(255,255,255,0.32)',
          boxShadow: active ? `0 0 7px ${color}` : 'none',
        }}
        animate={{ left: active ? 16 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </span>
  );
}


function SubLayerStem() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-[6px] top-0 h-1/2 w-[8px] rounded-bl-[3px] border-b border-l border-white/[0.14]"
    />
  );
}

function LayerPanel({
  data,
  activeLayers,
  setActiveLayers,
  isMobile,
  capabilities = {},
  revealed = true,
}: LayerPanelProps) {

  const [pinnedGroup, setPinnedGroup] = useState<string | null>(null);

  useEffect(() => {
    if (!pinnedGroup) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinnedGroup(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinnedGroup]);

  const toggle = (key: string) => {
    setActiveLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] };

      if (key.startsWith('sat_')) {
        next.satellites = false;
        if (!['sat_comms', 'sat_military', 'sat_navigation', 'sat_earth', 'sat_science'].some(k => next[k])) {
          next.satellites = false;
        }
      }
      return next;
    });
  };

  const toggleGroup = (layers: LayerDef[]) => {
    const anyOn = layers.some(l => activeLayers[l.key]);
    setActiveLayers((prev) => {
      const next = { ...prev };
      for (const l of layers) next[l.key] = !anyOn;
      if (layers.some(l => l.key.startsWith('sat_'))) {
        next.satellites = false;
      }
      return next;
    });
  };

  const visibleGroups = LAYER_GROUPS.map(g => ({
    ...g,
    layers: g.layers.filter(l => !l.requires || capabilities[l.requires]),
  })).filter(g => g.layers.length > 0);

  const getCount = (dk: string, catKey?: string): number | null => {
    if (!dk) return null;
    const catCounts = (data.category_counts || {}) as Record<string, number>;
    if (dk === 'maritime_ships') {
      if (catKey && typeof catCounts[catKey] === 'number') {
        return catCounts[catKey];
      }
      const ships = data.maritime_ships;
      if (Array.isArray(ships)) {
        if (!catKey) {
          return typeof data.total_ships === 'number' && data.total_ships > ships.length
            ? (data.total_ships as number)
            : ships.length;
        }
        if (catKey === 'cargo') return ships.filter((s: { type?: string }) => !s.type || s.type === 'cargo' || s.type === 'container').length;
        return ships.filter((s: { type?: string }) => s.type === catKey).length;
      }
      return null;
    }
    if (catKey && catCounts[catKey] != null) {
      return catCounts[catKey];
    }
    let total = 0;
    let found = false;
    for (const k of dk.split(',')) {
      const arr = data[k];
      if (Array.isArray(arr)) {
        total += arr.length;
        found = true;
      }
    }
    return found ? total : null;
  };

  /* ── MOBILE ── */
  if (isMobile) {
    return (
      <div className="flex flex-col gap-5 py-2">
        {visibleGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-2">
            <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/30 border-b border-white/[0.06] pb-1.5">
              {group.fullLabel}
            </div>
            <div className="flex flex-col gap-1">
              {group.layers.map((layer) => {
                const isLayerActive = activeLayers[layer.key];
                const count = getCount(layer.dataKey, layer.catKey);
                const dormant = !!layer.parent && !activeLayers[layer.parent];
                const accentColor = layer.color || '#00E5FF';
                return (
                  <button
                    key={layer.key}
                    onClick={() => toggle(layer.key)}
                    aria-pressed={!!isLayerActive}
                    aria-label={layer.label}
                    className={`relative w-full flex items-center gap-3 py-2 rounded-md text-left hover:bg-white/[0.04] transition-colors ${layer.parent ? 'pl-[22px] pr-1' : 'px-1'} ${dormant ? 'opacity-40 pointer-events-none' : ''}`}
                  >
                    {layer.parent && <SubLayerStem />}
                    <ToggleSwitch active={!!isLayerActive} color={accentColor} />
                    <span
                      className={`text-[11px] font-mono uppercase tracking-wider flex-1 transition-colors ${isLayerActive ? 'text-white/80' : 'text-white/40'}`}
                      style={{ color: isLayerActive && layer.color ? accentColor : undefined }}
                    >
                      {layer.label}
                      {layer.description && <span className="block mt-0.5 text-[9px] normal-case tracking-normal text-white/35">{layer.description}</span>}
                    </span>
                    {count !== null ? (
                      <span className="text-[10px] font-mono tabular-nums text-white/25">
                        {count.toLocaleString()}
                      </span>
                    ) : (
                      <span
                        className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all"
                        style={{
                          color: isLayerActive ? accentColor : 'rgba(255,255,255,0.5)',
                          borderColor: isLayerActive ? `${accentColor}60` : 'rgba(255,255,255,0.12)',
                          background: isLayerActive ? `${accentColor}18` : 'transparent',
                        }}
                      >
                        {isLayerActive ? 'ACTIVE' : 'SHOW'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

      </div>
    );
  }

  /* ── DESKTOP ── */
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: revealed ? 1 : 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 200, delay: 0.25 }}
      className="absolute top-28 left-3 h-fit max-h-[calc(100%-124px)] w-[54px] flex flex-col items-center pt-3 pb-3 z-50 pointer-events-auto rounded-[22px] border border-white/[0.10] shadow-[0_18px_55px_rgba(0,0,0,0.48)]"
      style={{
        background: 'linear-gradient(180deg, rgba(18,22,27,0.88) 0%, rgba(8,11,15,0.82) 100%)',
        backdropFilter: 'blur(28px) saturate(1.35)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.35)',
      }}
    >
      <div className="flex flex-col items-center gap-1.5">
        {visibleGroups.map((group) => {
          const groupActive = group.layers.some(l => activeLayers[l.key]);
          const Icon = group.icon;

          const activeCount = group.layers.filter(l => activeLayers[l.key]).length;
          const isPinned = pinnedGroup === group.label;
          const isOpen = isPinned;

          return (
            <div
              key={group.label}
              className="relative flex items-center justify-center"
            >
              <button
                onClick={() => setPinnedGroup(isPinned ? null : group.label)}
                aria-expanded={isOpen}
                aria-label={`${group.fullLabel}${activeCount ? ` — ${activeCount} active` : ''}`}
                title={group.fullLabel}
                className="relative w-10 h-10 flex items-center justify-center cursor-pointer rounded-[14px] transition-all duration-200 hover:bg-white/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                style={{
                  background: isPinned
                    ? 'linear-gradient(145deg, rgba(0,229,255,0.17), rgba(0,229,255,0.06))'
                    : 'transparent',
                  boxShadow: isPinned ? 'inset 0 0 0 1px rgba(0,229,255,0.28), 0 5px 18px rgba(0,0,0,0.2)' : 'none',
                }}
              >
                <Icon
                  className="transition-all duration-300"
                  style={{
                    width: 17,
                    height: 17,
                    strokeWidth: 1.8,
                    color: groupActive
                      ? 'rgba(226,250,255,0.96)'
                      : isOpen
                        ? 'rgba(255,255,255,0.45)'
                        : 'rgba(226,235,241,0.48)',
                    filter: groupActive ? 'drop-shadow(0 0 7px rgba(0,229,255,0.35))' : 'none',
                  }}
                />

         
                {activeCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 rounded-full flex items-center justify-center text-[10px] font-bold font-mono tabular-nums leading-none ring-2 ring-[#11171b] pointer-events-none"
                    style={{
                      minWidth: 17,
                      height: 17,
                      padding: '0 4px',
                      background: 'rgba(0,229,255,0.96)',
                      color: '#04040A',
                      boxShadow: '0 0 8px rgba(0,229,255,0.5)',
                    }}
                  >
                    {activeCount}
                  </span>
                )}
              </button>

              {/* Flyout (LEFT side popup) */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0, x: -12, scale: 0.96 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -8, scale: 0.97 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute left-[64px] top-0 w-[310px] max-h-[calc(100vh-120px)] overflow-hidden rounded-2xl z-[100] pointer-events-auto select-none"
                    style={{
                      background: 'rgba(9, 13, 19, 0.88)',
                      backdropFilter: 'blur(32px) saturate(1.8)',
                      WebkitBackdropFilter: 'blur(32px) saturate(1.8)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      boxShadow: '0 24px 64px -8px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(0, 229, 255, 0.12), inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    {/* Top ambient glow gradient */}
                    <div className="absolute top-0 inset-x-0 h-24 bg-gradient-to-b from-cyan-500/[0.08] via-cyan-500/[0.02] to-transparent pointer-events-none" />

                    {/* Header */}
                    <div className="relative px-3.5 pt-3.5 pb-3 border-b border-white/[0.07] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-cyan-500/10 border border-cyan-400/25 text-cyan-300 shadow-[0_0_15px_rgba(0,229,255,0.18)]">
                          <Icon className="w-4 h-4" />
                          {activeCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#00e5ff] animate-pulse" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-mono font-bold tracking-[0.16em] uppercase text-zinc-100 truncate">
                              {group.fullLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full transition-colors ${activeCount > 0
                                ? 'bg-cyan-400 shadow-[0_0_6px_#00e5ff]'
                                : 'bg-zinc-600'
                                }`}
                            />
                            <span className="text-[9px] font-mono tracking-wider text-zinc-400">
                              {activeCount > 0 ? `${activeCount} FEED${activeCount > 1 ? 'S' : ''} ACTIVE` : 'ALL INACTIVE'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Header Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleGroup(group.layers);
                          }}
                          className="px-2 py-1 rounded-lg text-[9px] font-mono font-medium tracking-wider text-cyan-300/80 hover:text-cyan-200 bg-cyan-500/[0.07] hover:bg-cyan-500/[0.15] border border-cyan-400/20 active:scale-95 transition-all duration-150 cursor-pointer"
                        >
                          {group.layers.length > 1
                            ? (activeCount > 0 ? 'RESET' : 'ALL ON')
                            : (activeCount > 0 ? 'HIDE' : 'SHOW')}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPinnedGroup(null);
                          }}
                          aria-label="Close"
                          className="w-6 h-6 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08] active:scale-90 transition-all duration-150 cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Layers List */}
                    <div className="p-2 space-y-1.5 max-h-[calc(100vh-210px)] overflow-y-auto styled-scrollbar">
                      {group.layers.map((layer) => {
                        const isLayerActive = activeLayers[layer.key];
                        const count = getCount(layer.dataKey, layer.catKey);
                        const dormant = !!layer.parent && !activeLayers[layer.parent];
                        const accentColor = layer.color || '#00E5FF';

                        return (
                          <button
                            key={layer.key}
                            type="button"
                            onClick={() => toggle(layer.key)}
                            aria-pressed={!!isLayerActive}
                            aria-label={layer.label}
                            title={dormant ? 'Turn the parent layer on to activate' : undefined}
                            className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 cursor-pointer text-left ${isLayerActive
                              ? 'shadow-sm'
                              : 'bg-white/0.02 hover:bg-white/[0.05] border-white/[0.05] hover:border-white/[0.1]'
                              } ${layer.parent ? 'pl-7' : ''} ${dormant ? 'opacity-35 pointer-events-none' : ''}`}
                            style={{
                              borderColor: isLayerActive ? `${accentColor}55` : undefined,
                              background: isLayerActive ? `linear-gradient(90deg, ${accentColor}18, ${accentColor}04)` : undefined,
                              boxShadow: isLayerActive ? `0 2px 14px ${accentColor}18` : undefined,
                            }}
                          >
                            {layer.parent && <SubLayerStem />}

                            {/* Custom Micro Glow Toggle */}
                            <div className="relative flex-shrink-0 w-8 h-4.5 rounded-full transition-colors duration-200 p-0.5 flex items-center"
                              style={{
                                background: isLayerActive
                                  ? `linear-gradient(90deg, ${accentColor}50, ${accentColor}80)`
                                  : 'rgba(255,255,255,0.08)',
                                border: isLayerActive
                                  ? `1px solid ${accentColor}`
                                  : '1px solid rgba(255,255,255,0.12)',
                                boxShadow: isLayerActive ? `0 0 10px ${accentColor}40` : 'none',
                              }}
                            >
                              <motion.div
                                className="w-3.5 h-3.5 rounded-full shadow-sm"
                                style={{
                                  background: isLayerActive ? '#ffffff' : 'rgba(255,255,255,0.4)',
                                  boxShadow: isLayerActive ? `0 0 8px ${accentColor}` : 'none',
                                }}
                                animate={{ x: isLayerActive ? 14 : 0 }}
                                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                              />
                            </div>

                            {/* Label & Description */}
                            <div className="flex-1 min-w-0">
                              <span
                                className={`text-[11px] font-mono font-medium tracking-wide transition-colors block truncate ${isLayerActive
                                  ? 'font-semibold'
                                  : 'text-zinc-400 group-hover:text-zinc-200'
                                  }`}
                                style={{
                                  color: isLayerActive ? (layer.color ? accentColor : '#E2F8FF') : undefined,
                                  textShadow: isLayerActive ? `0 0 10px ${accentColor}40` : 'none',
                                }}
                              >
                                {layer.label}
                              </span>
                              {layer.description && (
                                <span className="block text-[9px] font-mono tracking-normal text-zinc-500 group-hover:text-zinc-400 truncate mt-0.5">
                                  {layer.description}
                                </span>
                              )}
                            </div>

                            {/* Badge Count or Action Button */}
                            {count !== null ? (
                              <div
                                className="flex-shrink-0 px-2 py-0.5 rounded-md font-mono text-[10px] tabular-nums font-semibold transition-all border"
                                style={{
                                  backgroundColor: isLayerActive ? `${accentColor}18` : 'rgba(255,255,255,0.04)',
                                  color: isLayerActive ? accentColor : '#71717a',
                                  borderColor: isLayerActive ? `${accentColor}40` : 'rgba(255,255,255,0.04)',
                                  boxShadow: isLayerActive ? `0 0 8px ${accentColor}20` : 'none',
                                }}
                              >
                                {count.toLocaleString()}
                              </div>
                            ) : (
                              <div
                                className="flex-shrink-0 px-2.5 py-0.5 rounded-md font-mono text-[9px] font-bold tracking-wider transition-all border"
                                style={{
                                  backgroundColor: isLayerActive ? `${accentColor}25` : 'rgba(255,255,255,0.04)',
                                  color: isLayerActive ? accentColor : 'rgba(255,255,255,0.6)',
                                  borderColor: isLayerActive ? `${accentColor}55` : 'rgba(255,255,255,0.12)',
                                  boxShadow: isLayerActive ? `0 0 10px ${accentColor}30` : 'none',
                                }}
                              >
                                {isLayerActive ? 'ACTIVE' : 'SHOW'}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>


                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

    </motion.div>
  );
}

export default memo(LayerPanel);
