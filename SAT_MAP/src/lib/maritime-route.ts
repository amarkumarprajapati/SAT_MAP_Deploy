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

// Global major commercial, energy, and container ports
export const GLOBAL_PORTS: PortEntry[] = [
  { name: 'Sakata', country: 'Japan', code: 'JP SAK', lat: 38.93, lng: 139.83 },
  { name: 'Tokyo', country: 'Japan', code: 'JP TYO', lat: 35.61, lng: 139.79 },
  { name: 'Yokohama', country: 'Japan', code: 'JP YOK', lat: 35.45, lng: 139.66 },
  { name: 'Kobe', country: 'Japan', code: 'JP UKB', lat: 34.67, lng: 135.21 },
  { name: 'Nagoya', country: 'Japan', code: 'JP NGO', lat: 35.08, lng: 136.87 },
  { name: 'Osaka', country: 'Japan', code: 'JP OSA', lat: 34.63, lng: 135.41 },
  { name: 'Hakata', country: 'Japan', code: 'JP HKT', lat: 33.60, lng: 130.40 },
  { name: 'Tomakomai', country: 'Japan', code: 'JP TMK', lat: 42.63, lng: 141.63 },
  { name: 'Niigata', country: 'Japan', code: 'JP KIJ', lat: 37.95, lng: 139.06 },
  { name: 'Mizushima', country: 'Japan', code: 'JP MIZ', lat: 34.50, lng: 133.72 },
  { name: 'Singapore', country: 'Singapore', code: 'SG SIN', lat: 1.26, lng: 103.84 },
  { name: 'Shanghai', country: 'China', code: 'CN SHA', lat: 31.23, lng: 121.47 },
  { name: 'Ningbo-Zhoushan', country: 'China', code: 'CN NGB', lat: 29.87, lng: 121.55 },
  { name: 'Shenzhen', country: 'China', code: 'CN SZX', lat: 22.54, lng: 114.05 },
  { name: 'Guangzhou', country: 'China', code: 'CN CAN', lat: 23.08, lng: 113.32 },
  { name: 'Qingdao', country: 'China', code: 'CN TAO', lat: 36.07, lng: 120.38 },
  { name: 'Busan', country: 'South Korea', code: 'KR PUS', lat: 35.10, lng: 129.04 },
  { name: 'Rotterdam', country: 'Netherlands', code: 'NL RTM', lat: 51.90, lng: 4.50 },
  { name: 'Antwerp', country: 'Belgium', code: 'BE ANR', lat: 51.30, lng: 4.40 },
  { name: 'Hamburg', country: 'Germany', code: 'DE HAM', lat: 53.55, lng: 9.97 },
  { name: 'Felixstowe', country: 'United Kingdom', code: 'GB FXT', lat: 51.96, lng: 1.35 },
  { name: 'Fujairah', country: 'United Arab Emirates', code: 'AE FJR', lat: 25.14, lng: 56.35 },
  { name: 'Dubai (Jebel Ali)', country: 'United Arab Emirates', code: 'AE JEA', lat: 25.01, lng: 55.06 },
  { name: 'Bandar Abbas', country: 'Iran', code: 'IR BND', lat: 27.14, lng: 56.22 },
  { name: 'Kharg Island', country: 'Iran', code: 'IR KHA', lat: 29.24, lng: 50.33 },
  { name: 'Ras Tanura', country: 'Saudi Arabia', code: 'SA RTN', lat: 26.64, lng: 50.16 },
  { name: 'Dammam', country: 'Saudi Arabia', code: 'SA DMM', lat: 26.43, lng: 50.10 },
  { name: 'Salalah', country: 'Oman', code: 'OM SLL', lat: 16.94, lng: 54.00 },
  { name: 'Doha', country: 'Qatar', code: 'QA DOH', lat: 25.29, lng: 51.55 },
  { name: 'Kuwait', country: 'Kuwait', code: 'KW KWT', lat: 29.35, lng: 47.95 },
  { name: 'Suez Canal / Port Said', country: 'Egypt', code: 'EG SUE', lat: 29.97, lng: 32.55 },
  { name: 'Colombo', country: 'Sri Lanka', code: 'LK CMB', lat: 6.94, lng: 79.84 },
  { name: 'Mumbai / Nhava Sheva', country: 'India', code: 'IN BOM', lat: 18.95, lng: 72.85 },
  { name: 'Mundra', country: 'India', code: 'IN MUN', lat: 22.75, lng: 69.70 },
  { name: 'Port Klang', country: 'Malaysia', code: 'MY PKG', lat: 2.99, lng: 101.39 },
  { name: 'Tanjung Pelepas', country: 'Malaysia', code: 'MY TPP', lat: 1.36, lng: 103.55 },
  { name: 'Houston', country: 'United States', code: 'US HOU', lat: 29.73, lng: -95.27 },
  { name: 'Los Angeles / Long Beach', country: 'United States', code: 'US LAX', lat: 33.74, lng: -118.27 },
  { name: 'Savannah', country: 'United States', code: 'US SAV', lat: 32.08, lng: -81.09 },
  { name: 'Santos', country: 'Brazil', code: 'BR SSZ', lat: -23.95, lng: -46.31 },
  { name: 'Novorossiysk', country: 'Russia', code: 'RU NVS', lat: 44.72, lng: 37.77 },
  { name: 'Primorsk', country: 'Russia', code: 'RU PRK', lat: 60.35, lng: 28.70 },
  { name: 'Gibraltar', country: 'Gibraltar', code: 'GI GIB', lat: 36.14, lng: -5.35 },
  { name: 'Panama Canal', country: 'Panama', code: 'PA PCN', lat: 8.95, lng: -79.56 },
];

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

/**
 * Searches the destination string against global ports catalog.
 */
export function resolveDestinationPort(destString?: string): PortEntry | null {
  if (!destString || typeof destString !== 'string') return null;
  const raw = destString.trim().toUpperCase();
  if (raw === 'NOT REPORTED' || raw === 'UNKNOWN' || raw === 'ARMED GUARD' || raw === 'PIRACY WARNING' || raw === 'OFFSHORE' || raw.length < 2) {
    return null;
  }

  // Exact code match or contains
  for (const p of GLOBAL_PORTS) {
    if (p.code && (raw === p.code || raw.includes(p.code) || raw.replace(/\s+/g, '') === p.code.replace(/\s+/g, ''))) {
      return p;
    }
    const cleanName = p.name.toUpperCase();
    if (raw.includes(cleanName) || cleanName.includes(raw)) {
      return p;
    }
  }

  // Word token matching (e.g. "SINGAPORE ANCH" -> Singapore)
  const tokens = raw.split(/[\s>/_-]+/);
  for (const token of tokens) {
    if (token.length >= 3) {
      for (const p of GLOBAL_PORTS) {
        if (p.name.toUpperCase().includes(token) || (p.code && p.code.toUpperCase().includes(token))) {
          return p;
        }
      }
    }
  }

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

  // Identify closest known port to start point for clean naming
  let startName = `${startLat.toFixed(2)}°N, ${startLng.toFixed(2)}°E`;
  let startCode = 'ANCH';
  let startFlag = flagEmoji;
  let minStartPortDist = 250; // km
  for (const p of GLOBAL_PORTS) {
    const d = calculateDistanceKm(startLat, startLng, p.lat, p.lng);
    if (d < minStartPortDist) {
      minStartPortDist = d;
      startName = `${p.name.toUpperCase()} ANCH`;
      startCode = p.code || p.name.substring(0, 3).toUpperCase();
      const pFlag = resolveShipFlag(undefined, p.country.substring(0, 2));
      startFlag = pFlag.flag;
    }
  }

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
