import { twoline2satrec } from '../../node_modules/satellite.js/dist/io.js';
import { propagate } from '../../node_modules/satellite.js/dist/propagation/propagate.js';
import { gstime } from '../../node_modules/satellite.js/dist/propagation/gstime.js';
import { eciToGeodetic, degreesLat, degreesLong } from '../../node_modules/satellite.js/dist/transforms.js';

type Satrec = ReturnType<typeof twoline2satrec>;
const SATREC_CACHE_LIMIT = 4096;
const satrecCache = new Map<string, Satrec>();

function cachedSatrec(line1: string, line2: string): Satrec | null {
  const key = `${line1}\n${line2}`;
  const cached = satrecCache.get(key);
  if (cached) {
    // Refresh insertion order so the cache behaves as a small LRU.
    satrecCache.delete(key);
    satrecCache.set(key, cached);
    return cached;
  }

  try {
    const satrec = twoline2satrec(line1, line2);
    if (satrecCache.size >= SATREC_CACHE_LIMIT) {
      const oldest = satrecCache.keys().next().value;
      if (oldest !== undefined) satrecCache.delete(oldest);
    }
    satrecCache.set(key, satrec);
    return satrec;
  } catch {
    return null;
  }
}




export interface SatPosition {
  lat: number;
  lng: number;
  altKm: number;
}

export interface SatTelemetry extends SatPosition {
  speedKmS: number;
  headingDeg: number;
}


export function wrapLongitude(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}


export function propagateTLE(line1: string, line2: string, when: Date = new Date()): SatPosition | null {
  const satrec = cachedSatrec(line1, line2);
  if (!satrec || (satrec as { error?: number }).error) return null;

  let eci;
  try {
    eci = propagate(satrec, when);
  } catch {
    return null;
  }
  const position = eci?.position;
  if (!position || typeof position === 'boolean') return null;

  const geodetic = eciToGeodetic(position, gstime(when));
  const lat = degreesLat(geodetic.latitude);
  const lng = wrapLongitude(degreesLong(geodetic.longitude));
  const altKm = geodetic.height;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(altKm)) return null;
  if (altKm < 80 || altKm > 60000) return null;
  return { lat, lng, altKm };
}

/** Current satellite position, inertial speed, and direction over the ground. */
export function propagateTelemetry(line1: string, line2: string, when: Date = new Date()): SatTelemetry | null {
  const position = propagateTLE(line1, line2, when);
  if (!position) return null;

  const satrec = cachedSatrec(line1, line2);
  if (!satrec) return null;
  let state;
  try {
    state = propagate(satrec, when);
  } catch {
    state = null;
  }
  const velocity = state?.velocity;
  let speedKmS = velocity && typeof velocity !== 'boolean'
    ? Math.hypot(velocity.x, velocity.y, velocity.z)
    : NaN;
  const periodMinutes = orbitalPeriodMinutes(line2);
  if (!Number.isFinite(speedKmS) && periodMinutes) {
    // Retain useful live telemetry if SGP4 produced a position but omitted its
    // velocity vector. This circular estimate is especially accurate for GEO.
    speedKmS = (2 * Math.PI * (6371 + position.altKm)) / (periodMinutes * 60);
  }

  // A short forward propagation gives the direction of motion across the map.
  const next = propagateTLE(line1, line2, new Date(when.getTime() + 30000));
  if (!next || !Number.isFinite(speedKmS)) return null;
  const lat1 = position.lat * Math.PI / 180;
  const lat2 = next.lat * Math.PI / 180;
  const dLng = (next.lng - position.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const angularChange = Math.hypot(next.lat - position.lat, (next.lng - position.lng) * Math.cos(lat1));
  // A geostationary satellite has virtually no ground-track direction because
  // it stays above the same longitude. Show its eastward orbital direction.
  const headingDeg = angularChange < 0.001 && periodMinutes && periodMinutes > 1000
    ? 90
    : (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return { ...position, speedKmS, headingDeg };
}

/** Orbital period in minutes, from the TLE's mean motion (revolutions/day). */
export function orbitalPeriodMinutes(line2: string): number | null {
  const meanMotion = parseFloat(line2.substring(52, 63));
  if (!Number.isFinite(meanMotion) || meanMotion <= 0) return null;
  return 1440 / meanMotion;
}

/**
 * Samples one full revolution, centred on `from`. Invalid propagation samples
 * terminate a segment so no line is fabricated across a failed interval.
 *
 * Sampled in time rather than in true anomaly so the spacing is even along the
 * path for any eccentricity. Each position is converted to Earth-fixed
 * coordinates at its own propagation time, exactly like the live marker.
 */
export function orbitPath(
  line1: string,
  line2: string,
  steps = 240,
  from: Date = new Date(),
): SatPosition[] {
  const period = orbitalPeriodMinutes(line2);
  if (!period) return [];
  let satrec;
  try {
    satrec = twoline2satrec(line1, line2);
  } catch {
    return [];
  }
  if (!satrec || (satrec as { error?: number }).error) return [];

  const out: SatPosition[] = [];
  let lastWasValid = false;
  for (let i = 0; i <= steps; i++) {
    const when = new Date(from.getTime() + (period * 60_000 * (i / steps - 0.5)));
    let p: SatPosition | null = null;
    try {
      const eci = propagate(satrec, when);
      const position = eci?.position;
      if (position && typeof position !== 'boolean') {
        const geodetic = eciToGeodetic(position, gstime(when));
        const lat = degreesLat(geodetic.latitude);
        const lng = wrapLongitude(degreesLong(geodetic.longitude));
        const altKm = geodetic.height;
        if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(altKm) && altKm >= 80 && altKm <= 60000) {
          p = { lat, lng, altKm };
        }
      }
    } catch {
      p = null;
    }
    if (p) {
      if (!lastWasValid && out.length > 0) out.push({ lat: NaN, lng: NaN, altKm: NaN });
      out.push(p);
      lastWasValid = true;
    } else {
      lastWasValid = false;
    }
  }
  return out;
}

/**
 * Splits a path wherever it crosses the antimeridian, interpolating cleanly to ±180°
 * so adjacent segments meet seamlessly without visual gaps.
 */
export function splitAtAntimeridian(path: SatPosition[]): SatPosition[][] {
  if (path.length === 0) return [];
  const runs: SatPosition[][] = [];
  let run: SatPosition[] = [path[0]];

  for (let i = 1; i < path.length; i++) {
    const prev = run[run.length - 1];
    const curr = path[i];

    if (!Number.isFinite(curr.lat) || !Number.isFinite(curr.lng) || !Number.isFinite(curr.altKm)) {
      if (run.length > 1) runs.push(run);
      run = [];
      continue;
    }
    if (!run.length || !prev) {
      run.push(curr);
      continue;
    }

    const dLng = curr.lng - prev.lng;
    if (Math.abs(dLng) > 180) {
      // Crossing the antimeridian. Interpolate cleanly to the ±180° boundary.
      let t = 0;
      let eastBoundaryLat = prev.lat;
      let eastBoundaryAlt = prev.altKm;
      if (prev.lng > 0 && curr.lng < 0) {
        // Going East to West (+179 to -179): unwrapped curr is (curr.lng + 360)
        t = (180 - prev.lng) / ((curr.lng + 360) - prev.lng);
        eastBoundaryLat = prev.lat + t * (curr.lat - prev.lat);
        eastBoundaryAlt = prev.altKm + t * (curr.altKm - prev.altKm);
        run.push({ lat: eastBoundaryLat, lng: 180, altKm: eastBoundaryAlt });
        runs.push(run);
        run = [{ lat: eastBoundaryLat, lng: -180, altKm: eastBoundaryAlt }, curr];
      } else if (prev.lng < 0 && curr.lng > 0) {
        // Going West to East (-179 to +179): unwrapped curr is (curr.lng - 360)
        t = (-180 - prev.lng) / ((curr.lng - 360) - prev.lng);
        eastBoundaryLat = prev.lat + t * (curr.lat - prev.lat);
        eastBoundaryAlt = prev.altKm + t * (curr.altKm - prev.altKm);
        run.push({ lat: eastBoundaryLat, lng: -180, altKm: eastBoundaryAlt });
        runs.push(run);
        run = [{ lat: eastBoundaryLat, lng: 180, altKm: eastBoundaryAlt }, curr];
      } else {
        runs.push(run);
        run = [curr];
      }
      continue;
    }
    run.push(curr);
  }
  if (run.length > 1) runs.push(run);
  return runs.filter(r => r.length > 1);
}
