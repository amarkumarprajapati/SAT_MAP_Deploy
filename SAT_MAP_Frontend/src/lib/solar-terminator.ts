/**
 * Solar Terminator & Subsolar Point Computation
 * Calculates the solar declination, subsolar point, and night-side polygon
 * based on standard astronomical formulas (NOAA Solar Calculator).
 */

export interface SubsolarPoint {
  lat: number;
  lng: number;
}

export interface SolarTerminatorData {
  subsolar: SubsolarPoint;
  features: Array<{
    type: 'Feature';
    geometry:
      | { type: 'Polygon'; coordinates: number[][][] }
      | { type: 'LineString'; coordinates: number[][] }
      | { type: 'Point'; coordinates: number[] };
    properties: Record<string, unknown>;
  }>;
}

/**
 * Calculates the subsolar coordinates (latitude = declination, longitude = solar noon)
 * for a given UTC Date using standard NOAA astronomical formulas.
 */
export function getSubsolarPoint(date: Date = new Date()): SubsolarPoint {
  const time = date.getTime();
  const julianDay = time / 86400000 + 2440587.5;
  const julianCentury = (julianDay - 2451545) / 36525;

  const rad = Math.PI / 180;

  // Geometric mean longitude of the Sun (deg)
  const L0 = (280.46646 + julianCentury * (36000.76983 + julianCentury * 0.0003032)) % 360;

  // Mean anomaly of the Sun (deg)
  const M = 357.52911 + julianCentury * (35999.05029 - 0.0001537 * julianCentury);

  // Eccentricity of Earth orbit
  const e = 0.016708634 - julianCentury * (0.000042037 + 0.0000001267 * julianCentury);

  // Sun equation of center (deg)
  const C =
    Math.sin(M * rad) * (1.914602 - julianCentury * (0.004817 + 0.000014 * julianCentury)) +
    Math.sin(2 * M * rad) * (0.019993 - 0.000101 * julianCentury) +
    Math.sin(3 * M * rad) * 0.000289;

  // Sun true longitude (deg)
  const trueLong = L0 + C;

  // Sun apparent longitude (deg)
  const omega = 125.04 - 1934.136 * julianCentury;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);

  // Mean obliquity of ecliptic (deg)
  const eps0 =
    23 +
    (26 + (21.448 - julianCentury * (46.815 + julianCentury * (0.00059 - julianCentury * 0.001813)))) /
      60 /
      60;

  // Obliquity correction (deg)
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);

  // Sun declination (deg)
  const declination = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) / rad;

  // Equation of Time (minutes)
  const y = Math.tan((eps / 2) * rad) ** 2;
  const EoT =
    (4 / rad) *
    (y * Math.sin(2 * L0 * rad) -
      2 * e * Math.sin(M * rad) +
      4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
      0.5 * y ** 2 * Math.sin(4 * L0 * rad) -
      1.25 * e ** 2 * Math.sin(2 * M * rad));

  // UTC time in minutes
  const utMins =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60000;

  // Solar time at Greenwich meridian (minutes)
  const solarTime = utMins + EoT;

  // Longitude where the sun is currently at zenith (solar noon)
  let lng = 180 - solarTime / 4;
  lng = (((lng + 180) % 360) + 360) % 360 - 180;

  return { lat: declination, lng };
}

/**
 * Computes GeoJSON features for the Day/Night boundary:
 * 1. Night polygon (covering darkness hemisphere)
 * 2. Terminator line (the dawn/dusk boundary)
 * 3. Subsolar point (zenith Sun position)
 */
export function getSolarTerminator(date: Date = new Date()): SolarTerminatorData {
  const subsolar = getSubsolarPoint(date);
  const rad = Math.PI / 180;

  // Safeguard against division by zero at exact equinox (declination = 0)
  const delta = Math.abs(subsolar.lat) < 0.0001 ? 0.0001 : subsolar.lat;
  const tanDelta = Math.tan(delta * rad);

  // When Sun is in Southern Hemisphere (delta < 0), the North Pole is in polar night.
  // When Sun is in Northern Hemisphere (delta > 0), the South Pole is in polar night.
  const poleLat = delta < 0 ? 85 : -85;

  const terminatorLineCoords: number[][] = [];
  const STEP = 0.5; // Half-degree steps for smooth high-resolution curve

  for (let lon = -180; lon <= 180; lon += STEP) {
    const diff = (lon - subsolar.lng) * rad;
    // Great circle perpendicular to sun-earth vector:
    // sin(lat)*sin(delta) + cos(lat)*cos(delta)*cos(lon - subsolar.lng) = 0
    // tan(lat) = -cos(lon - subsolar.lng) / tan(delta)
    let lat = Math.atan(-Math.cos(diff) / tanDelta) / rad;
    lat = Math.max(-85, Math.min(85, lat));
    terminatorLineCoords.push([lon, lat]);
  }

  // Build the closed night hemisphere polygon ring:
  // Trace the terminator curve from -180 to +180, then step across the dark polar cap
  // from +180 back to -180, and close at the starting point.
  const nightPolygonRing: number[][] = [...terminatorLineCoords];
  for (let lon = 180; lon >= -180; lon -= 2) {
    nightPolygonRing.push([lon, poleLat]);
  }
  nightPolygonRing.push(nightPolygonRing[0]);

  const features: SolarTerminatorData['features'] = [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [nightPolygonRing],
      },
      properties: {
        kind: 'night',
        label: 'Night Hemisphere',
      },
    },
  ];

  return { subsolar, features };
}
