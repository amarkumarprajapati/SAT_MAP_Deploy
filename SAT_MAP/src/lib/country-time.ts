import tzLookup from 'tz-lookup';
import * as countryCoder from '@rapideditor/country-coder';

export interface LocationTimeInfo {
  country: string;
  countryCode: string | null;
  flag: string;
  timeZone: string;
  lat: number;
  lng: number;
}

/**
 * Returns flag emoji for a given 2-letter ISO country code.
 */
export function getFlagEmoji(code?: string | null): string {
  if (!code || code.length !== 2) return '🌐';
  try {
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 127397 + c.charCodeAt(0)));
  } catch {
    return '🌐';
  }
}

/**
 * Resolves country name, ISO code, and IANA timezone for coordinates
 * purely offline using @rapideditor/country-coder and tz-lookup packages.
 */
export function getLocationTimeInfo(lat: number, lng: number): LocationTimeInfo {
  // Normalize coordinates
  const wrappedLng = ((((lng + 180) % 360) + 360) % 360) - 180;
  const clampedLat = Math.max(-85, Math.min(85, lat));

  // Determine IANA time zone via tz-lookup package
  let timeZone = 'UTC';
  try {
    timeZone = tzLookup(clampedLat, wrappedLng) || 'UTC';
  } catch {
    timeZone = 'UTC';
  }

  // Determine country via @rapideditor/country-coder package
  let country = 'Ocean / International Waters';
  let countryCode: string | null = null;
  try {
    const feat = countryCoder.feature([wrappedLng, clampedLat]);
    if (feat?.properties) {
      const props = feat.properties as unknown as { nameEn?: string; name?: string };
      country = props.nameEn || props.name || 'Unknown Country';
      countryCode = feat.properties.iso1A2 || countryCoder.iso1A2Code([wrappedLng, clampedLat]) || null;
    }
  } catch {
    // Graceful fallback
  }

  const flag = getFlagEmoji(countryCode);

  return {
    country,
    countryCode,
    flag,
    timeZone,
    lat,
    lng,
  };
}

/**
 * Formats live time in a given timezone using standard Intl API.
 */
export function formatTimeInZone(timeZone: string, date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toLocaleTimeString('en-US', { hour12: false }) + ' UTC';
  }
}
