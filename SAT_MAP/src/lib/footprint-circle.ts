/**
 * Satellite Footprint Circle Geometry
 *
 * Generates GeoJSON-compatible geometries (Polygon fill + LineString boundary)
 * representing a satellite's visible ground footprint.
 *
 * Correctly handles:
 *   1. Mid-latitude / equatorial footprints (standard geodesic circles).
 *   2. North Pole enclosing footprints (smooth, seamless 360° circle boundary
 *      with counter-clockwise polar cap fill obeying GeoJSON RFC 7946).
 *   3. South Pole enclosing footprints (smooth, seamless 360° circle boundary
 *      with counter-clockwise Antarctic cap fill obeying GeoJSON RFC 7946).
 *   4. Zero spoke lines, zero wedge cuts, and zero pole singularity pinwheels.
 */

const EARTH_RADIUS_KM = 6371;

export interface FootprintInput {
  lng: number;
  lat: number;
  alt: number;
  color?: string;
}

export interface FootprintOutput {
  /** Feature collection containing the polygon fill and boundary linestring */
  features: Array<{
    type: 'Feature';
    geometry:
      | { type: 'Polygon'; coordinates: number[][][] }
      | { type: 'LineString'; coordinates: number[][] };
    properties: Record<string, unknown>;
  }>;
  /** True when the footprint encloses the North Pole */
  enclosesNorthPole: boolean;
  /** True when the footprint encloses the South Pole */
  enclosesSouthPole: boolean;
  /** Footprint angular radius in radians */
  angularRadiusRad: number;
  /** Footprint ground radius in kilometres */
  radiusKm: number;
}

/**
 * Calculates the exact boundary latitude for a given longitude on a circle
 * that encloses a geographic pole.
 */
function getPolarBoundaryLat(
  lat0Rad: number,
  lon0Rad: number,
  alphaRad: number,
  lonRad: number,
  isNorth: boolean,
): number {
  const A = Math.sin(lat0Rad);
  const B = Math.cos(lat0Rad) * Math.cos(lonRad - lon0Rad);
  const R = Math.hypot(A, B);

  if (R < 1e-12) {
    return isNorth ? Math.PI / 2 - alphaRad : -Math.PI / 2 + alphaRad;
  }

  const val = Math.max(-1, Math.min(1, Math.cos(alphaRad) / R));
  const phi = Math.atan2(B, A);
  const sol1 = Math.asin(val) - phi;
  const sol2 = Math.PI - Math.asin(val) - phi;

  // Normalize both solutions to [-PI, PI]
  const n1 = ((((sol1 + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const n2 = ((((sol2 + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

  const valid1 = n1 >= -Math.PI / 2 - 1e-6 && n1 <= Math.PI / 2 + 1e-6;
  const valid2 = n2 >= -Math.PI / 2 - 1e-6 && n2 <= Math.PI / 2 + 1e-6;

  if (isNorth) {
    // Equator-facing boundary for North Pole cap (minimum valid latitude)
    if (valid1 && valid2) return Math.min(n1, n2);
    if (valid1) return n1;
    if (valid2) return n2;
  } else {
    // Equator-facing boundary for South Pole cap (maximum valid latitude)
    if (valid1 && valid2) return Math.max(n1, n2);
    if (valid1) return n1;
    if (valid2) return n2;
  }
  return n1;
}

/**
 * Generates GeoJSON features for the satellite's ground footprint:
 * 1. Polygon for the filled interior
 * 2. LineString for the boundary outline
 */
export function generateFootprintFeatures(
  input: FootprintInput,
  points = 180,
): FootprintOutput {
  const { lng, lat, alt, color } = input;
  const altitudeKm = Math.max(1, alt);
  const cosAngle = EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm);
  const angularRadiusRad = Math.acos(Math.min(1, Math.max(0, cosAngle)));
  const radiusKm = EARTH_RADIUS_KM * angularRadiusRad;

  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lng * Math.PI) / 180;

  const enclosesNorthPole = latRad + angularRadiusRad >= Math.PI / 2 - 0.001;
  const enclosesSouthPole = latRad - angularRadiusRad <= -Math.PI / 2 + 0.001;

  const features: FootprintOutput['features'] = [];

  if (enclosesNorthPole) {
    // ── North Pole Enclosing Footprint ──
    const STEP_DEG = 1;
    const boundaryLine: number[][] = [];

    // Step 1: Trace the horizon boundary curve from lon -180 to +180
    for (let lonDeg = -180; lonDeg <= 180; lonDeg += STEP_DEG) {
      const bLatRad = getPolarBoundaryLat(latRad, lonRad, angularRadiusRad, (lonDeg * Math.PI) / 180, true);
      const bLatDeg = (bLatRad * 180) / Math.PI;
      boundaryLine.push([lonDeg, bLatDeg]);
    }

    // Step 2: Build closed counter-clockwise polygon for the polar cap
    // Boundary line goes from -180 to +180 (increasing X).
    // Sweep along pole edge from +180 to -180 (decreasing X) at 89.999°.
    const POLE_LAT = 89.999;
    const polygonRing: number[][] = [...boundaryLine];
    for (let lonDeg = 180; lonDeg >= -180; lonDeg -= 2) {
      polygonRing.push([lonDeg, POLE_LAT]);
    }
    polygonRing.push(polygonRing[0]); // close polygon

    features.push(
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [polygonRing] },
        properties: { color, kind: 'footprint-fill' },
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: boundaryLine },
        properties: { color, kind: 'footprint-line' },
      },
    );
  } else if (enclosesSouthPole) {
    // ── South Pole Enclosing Footprint ──
    const STEP_DEG = 1;
    const boundaryLine: number[][] = [];

    // Step 1: Trace the horizon boundary curve from lon -180 to +180
    for (let lonDeg = -180; lonDeg <= 180; lonDeg += STEP_DEG) {
      const bLatRad = getPolarBoundaryLat(latRad, lonRad, angularRadiusRad, (lonDeg * Math.PI) / 180, false);
      const bLatDeg = (bLatRad * 180) / Math.PI;
      boundaryLine.push([lonDeg, bLatDeg]);
    }

    // Step 2: Build closed counter-clockwise polygon for the Antarctic cap
    // Top boundary goes from +180 down to -180 (decreasing X).
    // Bottom boundary sweeps along -89.999° from -180 to +180 (increasing X).
    const POLE_LAT = -89.999;
    const polygonRing: number[][] = [];
    for (let i = boundaryLine.length - 1; i >= 0; i--) {
      polygonRing.push(boundaryLine[i]);
    }
    for (let lonDeg = -180; lonDeg <= 180; lonDeg += 2) {
      polygonRing.push([lonDeg, POLE_LAT]);
    }
    polygonRing.push(polygonRing[0]); // close polygon

    features.push(
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [polygonRing] },
        properties: { color, kind: 'footprint-fill' },
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: boundaryLine },
        properties: { color, kind: 'footprint-line' },
      },
    );
  } else {
    // ── Standard Non-Polar Disc ──
    const discCoords: number[][] = [];
    for (let i = 0; i < points; i++) {
      // Counter-clockwise parameterization
      const theta = -(i / points) * 2 * Math.PI;
      const edgeLat = Math.asin(
        Math.sin(latRad) * Math.cos(angularRadiusRad) +
          Math.cos(latRad) * Math.sin(angularRadiusRad) * Math.cos(theta),
      );
      const edgeLng =
        lonRad +
        Math.atan2(
          Math.sin(theta) * Math.sin(angularRadiusRad) * Math.cos(latRad),
          Math.cos(angularRadiusRad) - Math.sin(latRad) * Math.sin(edgeLat),
        );

      let edgeLngDeg = (edgeLng * 180) / Math.PI;
      // Keep longitude continuous relative to satellite centre
      while (edgeLngDeg - lng > 180) edgeLngDeg -= 360;
      while (edgeLngDeg - lng < -180) edgeLngDeg += 360;

      const edgeLatDeg = Math.max(-85, Math.min(85, (edgeLat * 180) / Math.PI));
      discCoords.push([edgeLngDeg, edgeLatDeg]);
    }
    discCoords.push(discCoords[0]); // close loop

    features.push(
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [discCoords] },
        properties: { color, kind: 'footprint-fill' },
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: discCoords },
        properties: { color, kind: 'footprint-line' },
      },
    );
  }

  return {
    features,
    enclosesNorthPole,
    enclosesSouthPole,
    angularRadiusRad,
    radiusKm,
  };
}
