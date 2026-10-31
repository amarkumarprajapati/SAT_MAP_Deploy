/**
 * Maritime voyage calculations, port resolution, flag detection, and route projection.
 * Designed for LTmap Global Intelligence Platform.
 */

import { getFlagEmoji } from './country-time';

export interface PortEntry {
  name: string;
  country: string;
  code?: string;
  lat: number;
  lng: number;
  type?: string;
}


/**
 * Great-circle distance between two GPS coordinates in kilometers.
 */
export function calculateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/**
 * Maps MMSI Maritime Identification Digits (MID) or country strings to Flag & Country info.
 */
export function resolveShipFlag(mmsiStr?: string | number, countryHint?: string): { flag: string; country: string; code: string } {
  if (countryHint && countryHint.length === 2) {
    const code = countryHint.toUpperCase();
    return { flag: getFlagEmoji(code), country: countryHint, code };
  }

  const mmsi = String(mmsiStr || '').replace(/\D/g, '');
  if (mmsi.length >= 3) {
    const mid = parseInt(mmsi.substring(0, 3), 10);
    if (mid >= 351 && mid <= 357) return { flag: '🇵🇦', country: 'Panama', code: 'PA' };
    if (mid === 636 || mid === 637) return { flag: '🇱🇷', country: 'Liberia', code: 'LR' };
    if (mid === 538) return { flag: '🇲🇭', country: 'Marshall Islands', code: 'MH' };
    if (mid >= 431 && mid <= 432) return { flag: '🇯🇵', country: 'Japan', code: 'JP' };
    if (mid >= 563 && mid <= 566) return { flag: '🇸🇬', country: 'Singapore', code: 'SG' };
    if (mid === 477) return { flag: '🇭🇰', country: 'Hong Kong', code: 'HK' };
    if (mid >= 412 && mid <= 414) return { flag: '🇨🇳', country: 'China', code: 'CN' };
    if (mid >= 440 && mid <= 441) return { flag: '🇰🇷', country: 'South Korea', code: 'KR' };
    if (mid >= 232 && mid <= 235) return { flag: '🇬🇧', country: 'United Kingdom', code: 'GB' };
    if (mid === 211) return { flag: '🇩🇪', country: 'Germany', code: 'DE' };
    if (mid >= 244 && mid <= 246) return { flag: '🇳🇱', country: 'Netherlands', code: 'NL' };
    if (mid === 311) return { flag: '🇧🇸', country: 'Bahamas', code: 'BS' };
    if (mid === 227 || mid === 228) return { flag: '🇫🇷', country: 'France', code: 'FR' };
    if (mid === 247) return { flag: '🇮🇹', country: 'Italy', code: 'IT' };
    if (mid === 237) return { flag: '🇬🇷', country: 'Greece', code: 'GR' };
    if (mid >= 366 && mid <= 369) return { flag: '🇺🇸', country: 'United States', code: 'US' };
    if (mid === 470) return { flag: '🇦🇪', country: 'United Arab Emirates', code: 'AE' };
    if (mid === 403) return { flag: '🇸🇦', country: 'Saudi Arabia', code: 'SA' };
    if (mid === 422) return { flag: '🇮🇷', country: 'Iran', code: 'IR' };
    if (mid === 419) return { flag: '🇮🇳', country: 'India', code: 'IN' };
    if (mid === 503) return { flag: '🇦🇺', country: 'Australia', code: 'AU' };
    if (mid === 273) return { flag: '🇷🇺', country: 'Russia', code: 'RU' };
    if (mid === 304 || mid === 305) return { flag: '🇦🇬', country: 'Antigua and Barbuda', code: 'AG' };
    if (mid === 209 || mid === 210) return { flag: '🇨🇾', country: 'Cyprus', code: 'CY' };
    if (mid === 255) return { flag: '🇵🇹', country: 'Portugal', code: 'PT' };
    if (mid === 256) return { flag: '🇲🇹', country: 'Malta', code: 'MT' };
  }

  return { flag: '🌐', country: 'International Registry', code: 'INT' };
}

/** No bundled port catalog is available to resolve destination coordinates. */
export function resolveDestinationPort(destString?: string): PortEntry | null {
  void destString;
  return null;
}

export interface VoyageDetails {
  startLat: number;
  startLng: number;
  startName: string;
  startCode: string;
  startFlag: string;
  atdTime: string;

  currLat: number;
  currLng: number;

  endLat: number;
  endLng: number;
  endName: string;
  endCode: string;
  endFlag: string;
  etaTime: string;

  distanceCoveredKm: number;
  distanceRemainingKm: number;
  totalDistanceKm: number;
  progressPercent: number;

  flagEmoji: string;
  countryName: string;
  countryCode: string;
  vesselTypeName: string;
  vesselCategory: 'cargo' | 'tanker' | 'military';
  navStatus: string;
  speedKnots: number;
  headingDeg: number;
  draughtMeters: number;
  dimensionsStr: string;
  updatedAgoStr: string;
  isMoving: boolean;
  trackCoordinates: [number, number][];
}

/**
 * Computes all voyage details, route points, ATD/ETA, and progress telemetry for a selected vessel.
 */
export function calculateVoyageDetails(ship: Record<string, unknown>): VoyageDetails {
  const currLat = Number(ship.lat ?? 0);
  const currLng = Number(ship.lng ?? 0);
  const type = String(ship.type || 'cargo').toLowerCase();
  const speed = Number(ship.speed);
  const speedKnots = Number.isFinite(speed) && speed >= 0 ? Number(speed.toFixed(1)) : 0;
  const isMoving = speedKnots > 0.5;
  const heading = Number(ship.heading);
  const headingDeg = Number.isFinite(heading) && heading >= 0 ? Math.round(heading % 360) : 0;

  // Resolve vessel flag & country
  const { flag: flagEmoji, country: countryName, code: countryCode } = resolveShipFlag(
    (ship.mmsi ?? ship.id) as string | number,
    ship.flag as string
  );

  // Vessel classification label
  let vesselCategory: 'cargo' | 'tanker' | 'military' = 'cargo';
  let vesselTypeName = 'Container / Cargo Vessel';
  let draughtMeters = 11.8;
  let dimensionsStr = '294m × 32m';

  if (type === 'tanker') {
    vesselCategory = 'tanker';
    vesselTypeName = 'Crude Oil / Product Tanker';
    draughtMeters = 14.2;
    dimensionsStr = '333m × 60m';
  } else if (type === 'military') {
    vesselCategory = 'military';
    vesselTypeName = 'Naval Defence & Patrol';
    draughtMeters = 6.8;
    dimensionsStr = '154m × 20m';
  } else if (type === 'container') {
    vesselCategory = 'cargo';
    vesselTypeName = 'Ultra Large Container Vessel';
    draughtMeters = 13.5;
    dimensionsStr = '399m × 59m';
  }

  // Format Navigational status (like MarineTraffic)
  const navStatus = isMoving ? 'Underway Using Engine' : speedKnots > 0.1 ? 'Manoeuvring' : 'Stopped / Anchored';

  // Format last updated
  const ts = Number(ship.lastSeenAt ?? ship.timestamp);
  let updatedAgoStr = 'Just now';
  if (ts) {
    const elapsedSec = Math.max(0, Math.floor(Date.now() / 1000 - (ts < 1e12 ? ts : ts / 1000)));
    if (elapsedSec < 60) updatedAgoStr = `${elapsedSec}s ago`;
    else if (elapsedSec < 3600) updatedAgoStr = `${Math.floor(elapsedSec / 60)}m ago`;
    else updatedAgoStr = `${Math.floor(elapsedSec / 3600)}h ago`;
  }

  // 1. Resolve Start Point (Departure / Origin)
  let rawStartLat = Number(ship.trackStartLat ?? ship.firstSeenLat);
  let rawStartLng = Number(ship.trackStartLng ?? ship.firstSeenLng);
  const trackArr = Array.isArray(ship.track) ? (ship.track as Array<{ lat: number; lng: number }>) : [];

  if ((!Number.isFinite(rawStartLat) || !Number.isFinite(rawStartLng)) && trackArr.length > 0) {
    rawStartLat = Number(trackArr[0].lat);
    rawStartLng = Number(trackArr[0].lng);
  }

  // If start point is not recorded or identical to current position, extrapolate upstream along course
  let startLat = rawStartLat;
  let startLng = rawStartLng;
  const startDist = Number.isFinite(startLat) && Number.isFinite(startLng)
    ? calculateDistanceKm(startLat, startLng, currLat, currLng)
    : 0;

  if (!Number.isFinite(startLat) || !Number.isFinite(startLng) || startDist < 1.0) {
    // Extrapolate a departure point 60-120 km backwards along reverse heading
    const rad = ((headingDeg + 180) % 360) * (Math.PI / 180);
    const offsetKm = 80;
    const dLat = (offsetKm / 111.32) * Math.cos(rad);
    const dLng = (offsetKm / (111.32 * Math.cos((currLat * Math.PI) / 180) || 1)) * Math.sin(rad);
    startLat = Math.max(-80, Math.min(80, currLat + dLat));
    startLng = ((((currLng + dLng + 180) % 360) + 360) % 360) - 180;
  }

  // No port catalog is bundled; keep the inferred origin as coordinates.
  let startName = `${startLat.toFixed(2)}\u00b0N, ${startLng.toFixed(2)}\u00b0E`;
  let startCode = 'ANCH';
  let startFlag = flagEmoji;

  // ATD timestamp
  const atdTs = Number(ship.trackStartAt ?? ship.firstSeenAt ?? (ts ? ts - 3600 * 8 : Date.now() / 1000 - 3600 * 8));
  const atdDate = new Date(atdTs < 1e12 ? atdTs * 1000 : atdTs);
  const atdTime = atdDate.toISOString().replace('T', ' ').substring(0, 16);

  // 2. Resolve Endpoint (Destination)
  const destStr = String(ship.destination || '').trim();
  const matchedDestPort = resolveDestinationPort(destStr);

  let endLat: number;
  let endLng: number;
  let endName: string;
  let endCode: string;
  let endFlag: string;

  if (matchedDestPort) {
    endLat = matchedDestPort.lat;
    endLng = matchedDestPort.lng;
    endName = matchedDestPort.name.toUpperCase();
    endCode = matchedDestPort.code || matchedDestPort.name.substring(0, 3).toUpperCase();
    endFlag = resolveShipFlag(undefined, matchedDestPort.country.substring(0, 2)).flag;
  } else if (destStr && destStr !== 'Not reported' && destStr !== 'UNKNOWN') {
    // Clean user destination string
    endName = destStr.toUpperCase();
    endCode = destStr.split(' ')[0].toUpperCase();
    endFlag = '🏁';
    // Project forward along heading towards destination direction
    const rad = headingDeg * (Math.PI / 180);
    const offsetKm = 140;
    const dLat = (offsetKm / 111.32) * Math.cos(rad);
    const dLng = (offsetKm / (111.32 * Math.cos((currLat * Math.PI) / 180) || 1)) * Math.sin(rad);
    endLat = Math.max(-80, Math.min(80, currLat + dLat));
    endLng = ((((currLng + dLng + 180) % 360) + 360) % 360) - 180;
  } else {
    // No destination reported: project forward along heading vector
    const rad = headingDeg * (Math.PI / 180);
    const offsetKm = 120;
    const dLat = (offsetKm / 111.32) * Math.cos(rad);
    const dLng = (offsetKm / (111.32 * Math.cos((currLat * Math.PI) / 180) || 1)) * Math.sin(rad);
    endLat = Math.max(-80, Math.min(80, currLat + dLat));
    endLng = ((((currLng + dLng + 180) % 360) + 360) % 360) - 180;
    endName = isMoving ? `WAYPOINT ${headingDeg}°` : 'HARBOR ANCHORAGE';
    endCode = isMoving ? `CRS ${headingDeg}°` : 'ANCH';
    endFlag = '📍';
  }

  // 3. Distance & Voyage Progress Calculations
  const distanceCoveredKm = Math.max(
    Number(ship.trackDistanceKm || 0),
    calculateDistanceKm(startLat, startLng, currLat, currLng)
  );
  const distanceRemainingKm = calculateDistanceKm(currLat, currLng, endLat, endLng);
  const totalDistanceKm = Math.max(distanceCoveredKm + distanceRemainingKm, 1);
  const progressPercent = Math.min(100, Math.max(5, Math.round((distanceCoveredKm / totalDistanceKm) * 100)));

  // ETA Calculation
  const speedKmH = speedKnots > 0.5 ? speedKnots * 1.852 : 12 * 1.852;
  const hoursRemaining = distanceRemainingKm / speedKmH;
  const etaDate = new Date(Date.now() + hoursRemaining * 3600 * 1000);
  const etaTime = etaDate.toISOString().replace('T', ' ').substring(0, 16);

  // Track coordinates for line rendering
  const trackCoordinates: [number, number][] = [];
  if (trackArr.length > 1) {
    for (const pt of trackArr) {
      if (Number.isFinite(pt.lng) && Number.isFinite(pt.lat)) {
        trackCoordinates.push([pt.lng, pt.lat]);
      }
    }
  } else {
    trackCoordinates.push([startLng, startLat], [currLng, currLat]);
  }

  return {
    startLat,
    startLng,
    startName,
    startCode,
    startFlag,
    atdTime,
    currLat,
    currLng,
    endLat,
    endLng,
    endName,
    endCode,
    endFlag,
    etaTime,
    distanceCoveredKm,
    distanceRemainingKm,
    totalDistanceKm,
    progressPercent,
    flagEmoji,
    countryName,
    countryCode,
    vesselTypeName,
    vesselCategory,
    navStatus,
    speedKnots,
    headingDeg,
    draughtMeters,
    dimensionsStr,
    updatedAgoStr,
    isMoving,
    trackCoordinates,
  };
}
