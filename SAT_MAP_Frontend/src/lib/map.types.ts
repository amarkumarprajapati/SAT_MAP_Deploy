import * as maplibregl from 'maplibre-gl';
import { TerrainStatus } from './map-terrain';
import type { GeoVideoFrame } from './geospatial-video';

export interface SatelliteRow {
  name: string;
  lat: number;
  lng: number;
  alt: number;
  color?: string;
  mission?: string;
  category?: string;
  noradId?: string;
  periodMinutes?: number | null;
  line1?: string;
  line2?: string;
}

export interface LTmapProps {
  data: Record<string, unknown>;
  activeLayers: Record<string, boolean>;
  homeLocation?: { lat: number; lng: number } | null;
  onEntityClick?: (entity: Record<string, unknown>) => void;
  onMouseCoords?: (coords: { lat: number; lng: number }) => void;
  onRightClick?: (coords: { lat: number; lng: number }) => void;
  onViewStateChange?: (vs: { zoom: number; latitude: number; longitude: number }) => void;
  flyToLocation?: { lat: number; lng: number; zoom?: number; duration?: number; ts: number } | null;
  onReady?: () => void;
  projection?: 'mercator' | 'globe';
  terrainEnabled?: boolean;
  terrainRetry?: number;
  terrainFocus?: number;
  onTerrainStatusChange?: (status: TerrainStatus) => void;

  mapStyle?: string;
  theme?: 'core' | 'ghost';
  arcgisLayers?: Array<{ id: string; title: string; geojson: GeoJSON.GeoJSON | Record<string, unknown>; color?: string; opacity?: number }>;
  onMapCenter?: (coords: { lat: number; lng: number; bounds?: { west: number; south: number; east: number; north: number } }) => void;
  showMapControls?: boolean;
  onTrackShip?: (mmsi: string | number | null) => void;
  onShipSelect?: (ship: Record<string, unknown> | null) => void;
  liveTrackedShip?: Record<string, unknown> | null;
  shipTypeFilter?: 'all' | 'cargo' | 'tanker' | 'military';
  onCountryClick?: (info: LocationTimeInfo) => void;
  onSatelliteSelect?: (sat: import('@/components/SatelliteCard').SatelliteDetail | null) => void;
  clearSatelliteTrigger?: number;
  intelOpenTrigger?: number;
  isIntelOpen?: boolean;
  onIntelOpenChange?: (isOpen: boolean) => void;
  onSliderOpenChange?: (isOpen: boolean) => void;
  areaDrawMode?: boolean;
  areaDrawShape?: 'circle' | 'rectangle' | 'polygon' | 'freehand';
  areaPlaybackCommand?: { id: number; action: 'play' | 'pause' | 'seek' | 'cancel'; hours: number; time?: number; windowStart?: number; rate?: number };
  selectedAnalysisArea?: { west: number; south: number; east: number; north: number; geometry?: GeoJSON.Polygon } | null;
  onAreaPlaybackUpdate?: (state: { time: number; running: boolean; passes: Array<{ name: string; category: string; firstPass: number; lastPass: number; passes: number; windows: Array<{ start: number; end: number }> }> }) => void;
  onAreaCapturedSatellites?: (satellites: SatelliteRow[]) => void;
  clearAreaTrigger?: number;
  onAreaSelected?: (area: { west: number; south: number; east: number; north: number; geometry?: GeoJSON.Polygon } | null) => void;
  geospatialVideoFrames?: GeoVideoFrame[] | null;
  geospatialVideoFrame?: GeoVideoFrame | null;
}

export interface LocationTimeInfo {
  country: string;
  countryCode: string | null;
  flag: string;
  timeZone: string;
  lat: number;
  lng: number;
}

export type LayerColor = NonNullable<Extract<Parameters<maplibregl.Map['addLayer']>[0], { type: 'circle' }>['paint']>['circle-color'];
