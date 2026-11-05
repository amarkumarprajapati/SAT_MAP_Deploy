/**
 * Shared Maritime & Vessel Interfaces and Types
 */

export interface VesselWikiInfo {
  found: boolean;
  available?: boolean;
  title?: string;
  description?: string;
  extract?: string;
  thumbnailUrl?: string | null;
  wikiUrl?: string;
}

export interface ShipGeneralInfo {
  shipId?: number | string;
  name?: string;
  aisName?: string;
  imo?: number | string | null;
  mmsi?: number | string;
  length?: number;
  width?: number;
  callsign?: string;
  country?: string;
  countryCode?: string;
  type?: string;
  subtype?: string;
  departurePort?: string;
  destinationPort?: string;
  atd?: number | string;
  eta?: number | string;
  photoUrl?: string;
  photoAuthor?: string;
}

export interface ShipDetailPanelProps {
  ship: Record<string, unknown>;
  onClose: () => void;
  position: { x: number; y: number };
  onOpenRouteTelemetry?: (ship: Record<string, unknown>) => void;
  onOpenFullDetails?: (ship: Record<string, unknown>) => void;
}

export interface TrackPoint {
  lat: number;
  lng: number;
  timestamp?: number | string;
  speed?: number;
  heading?: number;
}

export interface ShipRoutePlaybackBarProps {
  ship: Record<string, unknown>;
  onClose: () => void;
  onToggleDetails?: () => void;
  detailsOpen?: boolean;
}

export type VesselRecord = Record<string, unknown> & {
  track?: Array<Record<string, unknown>>;
};

export interface VesselFullDetailsPanelProps {
  ship: Record<string, unknown>;
  onClose: () => void;
}

