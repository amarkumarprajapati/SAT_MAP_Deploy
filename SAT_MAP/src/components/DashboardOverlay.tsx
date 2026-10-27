'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, ArrowLeft, Database, LayoutDashboard, MapPin, Plane, Radio, Search, Satellite, Ship, X } from 'lucide-react';
import ReusableTable from '@/components/ReusableTable';

interface FlightRecord {
  icao24?: string;
  callsign?: string;
  model?: string;
  lat?: number;
  lng?: number;
  alt?: number;
  speed_knots?: number;
}

interface SatelliteRecord {
  noradId?: string;
  name?: string;
  type?: string;
  category?: string;
  lat?: number;
  lng?: number;
  alt?: number;
  position?: { lat?: number; lng?: number; altKm?: number; speedKmS?: number };
}

interface MaritimeRecord {
  mmsi?: string;
  name?: string;
  type?: string;
  lat?: number;
  lng?: number;
  speed?: number;
}

interface TableRowData {
  id: string;
  name: string;
  type: string;
  lat: string;
  lng: string;
  altitude: string;
  speed: string;
}

interface DashboardOverlayProps {
  onClose: () => void;
  activeLayers: Record<string, boolean>;
  onToggleLayer: (key: string) => void;
  onTabChange: (tab: TabType) => void;
  data: {
    military_flights?: FlightRecord[];
    satellites?: SatelliteRecord[];
    maritime_ships?: MaritimeRecord[];
    [key: string]: unknown;
  };
}

type TabType = 'aviation' | 'satellites' | 'maritime';
const tabs = [
  { id: 'aviation' as const, label: 'Aviation', Icon: Plane },
  { id: 'satellites' as const, label: 'Satellites', Icon: Satellite },
  { id: 'maritime' as const, label: 'Maritime', Icon: Ship },
];
const coord = (value: number | undefined) => Number.isFinite(value) ? Number(value).toFixed(4) : '—';

export default function DashboardOverlay({ onClose, data, activeLayers, onToggleLayer, onTabChange }: DashboardOverlayProps) {
  const [activeTab, setActiveTab] = useState<TabType>('aviation');
  const [query, setQuery] = useState('');

  const tableData = useMemo<TableRowData[]>(() => {
    if (activeTab === 'aviation') {
      return (data.military_flights ?? []).map((flight, index) => ({
        id: flight.icao24 || flight.callsign || `flight-${index}`,
        name: flight.callsign?.trim() || flight.icao24?.toUpperCase() || 'Unknown aircraft',
        type: flight.model || 'Military aircraft',
        lat: coord(flight.lat),
        lng: coord(flight.lng),
        altitude: Number.isFinite(flight.alt) ? `${Math.round(flight.alt!)} ft` : '—',
        speed: Number.isFinite(flight.speed_knots) ? `${Math.round(flight.speed_knots!)} kt` : '—',
      }));
    }
    if (activeTab === 'satellites') {
      return (data.satellites ?? []).map((satellite, index) => ({
        id: satellite.noradId || `sat-${index}`,
        name: satellite.name || satellite.noradId || 'Unknown satellite',
        type: satellite.category || satellite.type || 'Satellite',
        lat: coord(satellite.position?.lat ?? satellite.lat),
        lng: coord(satellite.position?.lng ?? satellite.lng),
        altitude: Number.isFinite(satellite.position?.altKm ?? satellite.alt) ? `${Math.round((satellite.position?.altKm ?? satellite.alt)!)} km` : '—',
        speed: Number.isFinite(satellite.position?.speedKmS) ? `${satellite.position!.speedKmS!.toFixed(2)} km/s` : '—',
      }));
    }
    return (data.maritime_ships ?? []).map((ship, index) => ({
      id: ship.mmsi || `ship-${index}`,
      name: ship.name?.trim() || ship.mmsi || 'Unknown vessel',
      type: ship.type || 'Vessel',
      lat: coord(ship.lat),
      lng: coord(ship.lng),
      altitude: 'Sea level',
      speed: Number.isFinite(ship.speed) ? `${Number(ship.speed).toFixed(1)} kt` : '—',
    }));
  }, [activeTab, data]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return tableData;
    return tableData.filter(row => `${row.name} ${row.id} ${row.type} ${row.lat} ${row.lng}`.toLocaleLowerCase().includes(normalized));
  }, [tableData, query]);

  const locatedCount = tableData.filter(row => row.lat !== '—' && row.lng !== '—').length;
  const columns = useMemo(() => [
    {
      title: 'IDENTIFIER', dataIndex: 'name', key: 'name', width: 240,
      render: (_: string, row: TableRowData) => <div className="min-w-0"><div className="truncate font-semibold text-zinc-100">{row.name}</div><div className="mt-1 font-mono text-[10px] tracking-wide text-zinc-500">ID {row.id}</div></div>,
    },
    {
      title: 'CLASSIFICATION', dataIndex: 'type', key: 'type', width: 190,
      render: (value: string) => <span className="inline-flex max-w-full items-center rounded-md border border-cyan-300/15 bg-cyan-300/[0.06] px-2 py-1 text-[11px] font-medium capitalize text-cyan-200"><span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400"/><span className="truncate">{value}</span></span>,
    },
    { title: 'LATITUDE', dataIndex: 'lat', key: 'lat', width: 150, render: (value: string) => <span className="font-mono tabular-nums text-zinc-300">{value}{value !== '—' && <span className="ml-1 text-zinc-600">°</span>}</span> },
    { title: 'LONGITUDE', dataIndex: 'lng', key: 'lng', width: 160, render: (value: string) => <span className="font-mono tabular-nums text-zinc-300">{value}{value !== '—' && <span className="ml-1 text-zinc-600">°</span>}</span> },
    { title: 'ALTITUDE', dataIndex: 'altitude', key: 'altitude', width: 145, render: (value: string) => <span className="font-mono tabular-nums text-zinc-300">{value}</span> },
    { title: 'VELOCITY', dataIndex: 'speed', key: 'speed', width: 135, align: 'right' as const, render: (value: string) => <span className="font-mono font-semibold tabular-nums text-emerald-300">{value}</span> },
  ], []);

  const activeLabel = tabs.find(tab => tab.id === activeTab)?.label ?? 'Aviation';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[999] flex overflow-hidden bg-[#0a1018] text-zinc-100 pointer-events-auto"
    >
      <aside className="flex w-full shrink-0 flex-col border-b border-white/[0.08] bg-[#0d141d] md:w-[238px] md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:px-5 md:py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-300"><LayoutDashboard size={17}/></div>
            <div><div className="font-mono text-xs font-bold tracking-[0.16em] text-white">DASHBOARD</div><div className="mt-1 font-mono text-[9px] tracking-[0.18em] text-cyan-400/70">GLOBAL INTEL</div></div>
          </div>
          <button onClick={onClose} aria-label="Back to map" className="rounded-lg p-2 text-zinc-500 transition hover:bg-white/[0.06] hover:text-white md:hidden"><X size={17}/></button>
        </div>

        <nav aria-label="Dashboard data types" className="flex gap-2 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-1 md:px-3 md:pb-0">
          {tabs.map(({ id, label, Icon }) => {
            const count = id === 'aviation' ? data.military_flights?.length ?? 0 : id === 'satellites' ? data.satellites?.length ?? 0 : data.maritime_ships?.length ?? 0;
            const selected = activeTab === id;
            return <button key={id} onClick={() => { setActiveTab(id); setQuery(''); onTabChange(id); }} aria-current={selected ? 'page' : undefined} className={`flex min-w-max items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition md:w-full md:px-3 md:py-3 ${selected ? 'border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200 shadow-[inset_2px_0_0_#22d3ee]' : 'border-transparent text-zinc-400 hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-zinc-100'}`}>
              <Icon size={16} className={selected ? 'text-cyan-300' : 'text-zinc-500'}/><span className="font-mono text-[10px] font-bold tracking-[0.12em]">{label.toUpperCase()}</span><span className={`ml-auto rounded-md px-1.5 py-0.5 font-mono text-[9px] tabular-nums ${selected ? 'bg-cyan-300/10 text-cyan-200' : 'text-zinc-600'}`}>{count.toLocaleString()}</span>
            </button>;
          })}
        </nav>
        <div className="hidden border-t border-white/[0.07] px-5 py-4 md:block"><div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] text-zinc-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"/>LIVE DATA VIEW</div></div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#0d141d] px-4 sm:px-6 lg:px-8">
          <button onClick={onClose} className="group flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.13em] text-zinc-500 transition hover:text-cyan-200"><ArrowLeft size={15} className="transition group-hover:-translate-x-0.5"/> <span className="hidden sm:inline">BACK TO MAP</span><span className="sm:hidden">MAP</span></button>
          <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] text-zinc-500"><span>SYSTEM</span><span className="text-zinc-700">/</span><span className="text-emerald-300">ONLINE</span><span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.7)]"/></div>
        </header>

        <section className="shrink-0 border-b border-white/[0.07] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><div className="mb-2 flex items-center gap-2 text-[9px] font-mono tracking-[0.18em] text-zinc-500"><span>OPERATIONS</span><span className="text-zinc-700">/</span><span className="text-cyan-300/80">{activeLabel.toUpperCase()}</span></div><div className="flex flex-wrap items-center gap-3"><h1 className="font-mono text-xl font-bold tracking-[0.1em] text-white sm:text-2xl">{activeLabel.toUpperCase()} <span className="text-zinc-500">DATA</span></h1><span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-1 font-mono text-[9px] font-bold tracking-[0.1em] text-emerald-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"/>LIVE</span></div></div>
            <div className="font-mono text-[10px] tracking-[0.1em] text-zinc-500">FEED <span className="ml-1 text-zinc-300">{activeTab === 'aviation' ? 'MILITARY AIR TRACKS' : activeTab === 'satellites' ? 'ORBITAL OBJECTS' : 'AIS VESSEL TRACKS'}</span></div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#111a25] px-3.5 py-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300/[0.1] text-cyan-300"><Database size={15}/></span><div><div className="font-mono text-[9px] tracking-[0.12em] text-zinc-400">TOTAL RECORDS</div><div className="mt-1 font-mono text-lg font-semibold leading-none tabular-nums text-white">{tableData.length.toLocaleString()}</div></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#111a25] px-3.5 py-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-300/[0.1] text-emerald-300"><MapPin size={15}/></span><div><div className="font-mono text-[9px] tracking-[0.12em] text-zinc-400">WITH POSITION</div><div className="mt-1 font-mono text-lg font-semibold leading-none tabular-nums text-white">{locatedCount.toLocaleString()}</div></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#111a25] px-3.5 py-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-300/[0.1] text-violet-300"><Activity size={15}/></span><div><div className="font-mono text-[9px] tracking-[0.12em] text-zinc-400">CURRENT VIEW</div><div className="mt-1 font-mono text-lg font-semibold leading-none tabular-nums text-white">{filteredRows.length.toLocaleString()} <span className="text-xs font-normal text-zinc-400">matching</span></div></div></div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-mono text-[10px] font-bold tracking-[0.15em] text-zinc-200">TRACKED OBJECTS</h2><p className="mt-1 text-[11px] text-zinc-500">Live positions and telemetry received by this view.</p></div>
            <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-white/[0.09] bg-[#0b1018] px-3 text-zinc-500 transition focus-within:border-cyan-300/30 sm:w-[260px]"><Search size={14}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, ID, type…" aria-label="Search dashboard records" className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600"/>{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="text-zinc-500 hover:text-white"><X size={13}/></button>}</label>
          </div>
          {(activeTab === 'maritime' || activeTab === 'satellites') && <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 font-mono text-[9px] font-semibold tracking-[0.12em] text-zinc-500">FILTER</span>
            {(activeTab === 'maritime' ? [
              { key: 'ship_cargo', label: 'Cargo / container' },
              { key: 'ship_tanker', label: 'Tankers' },
              { key: 'ship_military', label: 'Military / naval' },
            ] : [
              { key: 'sat_military', label: 'Military' },
              { key: 'sat_navigation', label: 'Navigation' },
              { key: 'sat_earth', label: 'Earth observation' },
            ]).map(filter => <button key={filter.key} type="button" aria-pressed={!!activeLayers[filter.key]} onClick={() => onToggleLayer(filter.key)} className={`rounded-lg border px-2.5 py-1.5 font-mono text-[9px] tracking-wide transition ${activeLayers[filter.key] ? 'border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-200' : 'border-white/[0.08] text-zinc-500 hover:border-white/20 hover:text-zinc-200'}`}>{filter.label}</button>)}
          </div>}
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/[0.1] bg-[#101822]">
            <ReusableTable
              columns={columns}
              dataSource={filteredRows}
              rowKey="id"
              size="middle"
              tableLayout="fixed"
              scroll={{ x: 900, y: 'calc(100vh - 390px)' }}
              locale={{ emptyText: <div className="py-12 text-center"><Radio className="mx-auto mb-3 text-zinc-600" size={20}/><div className="font-mono text-[10px] tracking-[0.12em] text-zinc-400">{query ? 'NO MATCHING RECORDS' : 'NO LIVE RECORDS'}</div><div className="mt-1 text-[11px] text-zinc-600">{query ? 'Try another identifier or type.' : 'Data will appear here when the feed is available.'}</div></div> }}
              pagination={{ pageSize: 10, placement: ['bottomEnd'], showSizeChanger: true, pageSizeOptions: [10, 25, 50], showTotal: (total, range) => <span className="font-mono text-[9px] tracking-[0.1em] text-zinc-500">{range[0]}–{range[1]} OF {total}</span> }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between px-1 font-mono text-[9px] tracking-[0.1em] text-zinc-600"><span>DATA SOURCE <span className="text-zinc-400">{activeTab === 'aviation' ? 'MILITARY FLIGHTS' : activeTab === 'satellites' ? 'SATELLITE CATALOG' : 'MARITIME AIS'}</span></span><span>{filteredRows.length.toLocaleString()} SHOWN</span></div>
        </section>
      </main>
    </motion.div>
  );
}
