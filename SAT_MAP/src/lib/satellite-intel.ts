import { api } from '@/config/api';

/**
 * Satellite Intelligence & Space Dossier Service
 * Extracts orbital mechanics from TLEs, maps launch & operator intelligence,
 * and fetches verified mission descriptions from Wikipedia and orbital catalogues.
 */

export interface OrbitalParameters {
  noradId: string;
  cosparId: string;
  launchYear: string;
  launchSequence: string;
  inclinationDeg: number | null;
  eccentricity: number | null;
  periodMinutes: number | null;
  apogeeKm: number | null;
  perigeeKm: number | null;
  semiMajorAxisKm: number | null;
  epochYear: number | null;
  epochDay: number | null;
}

export interface SatelliteLaunchIntel {
  operator: string;
  country: string;
  countryCode: string;
  flag: string;
  rocket: string;
  launchSite: string;
  purpose: string;
  approxLaunchDate: string;
}

export interface WikiSatelliteSummary {
  title: string;
  description: string;
  extract: string;
  thumbnailUrl: string | null;
  wikiUrl: string;
  source: 'Wikipedia' | 'Space Catalogue';
}

export interface FullSatelliteDossier {
  name: string;
  noradId: string;
  category: string;
  mission: string;
  orbital: OrbitalParameters;
  launch: SatelliteLaunchIntel;
  wiki: WikiSatelliteSummary;
}

const WIKI_CACHE = new Map<string, WikiSatelliteSummary>();

/**
 * Extracts orbital mechanics from TLE Line 1 and Line 2
 */
export function parseOrbitalParameters(line1?: string, line2?: string, fallbackNorad?: string): OrbitalParameters {
  const noradId = line1 && line1.length >= 7 ? line1.substring(2, 7).trim() : fallbackNorad || '—';

  let cosparId = '—';
  let launchYear = '—';
  let launchSequence = '—';
  let epochYear: number | null = null;
  let epochDay: number | null = null;

  if (line1 && line1.length >= 17) {
    const rawDesignator = line1.substring(9, 17).trim();
    if (rawDesignator) {
      cosparId = rawDesignator;
      const yrPrefix = parseInt(rawDesignator.substring(0, 2), 10);
      if (!Number.isNaN(yrPrefix)) {
        launchYear = yrPrefix < 57 ? `20${String(yrPrefix).padStart(2, '0')}` : `19${String(yrPrefix).padStart(2, '0')}`;
      }
      launchSequence = rawDesignator.substring(2);
    }
    const epYear = parseInt(line1.substring(18, 20).trim(), 10);
    const epDay = parseFloat(line1.substring(20, 32).trim());
    if (!Number.isNaN(epYear)) epochYear = epYear < 57 ? 2000 + epYear : 1900 + epYear;
    if (!Number.isNaN(epDay)) epochDay = epDay;
  }

  let inclinationDeg: number | null = null;
  let eccentricity: number | null = null;
  let periodMinutes: number | null = null;
  let apogeeKm: number | null = null;
  let perigeeKm: number | null = null;
  let semiMajorAxisKm: number | null = null;

  if (line2 && line2.length >= 63) {
    const inc = parseFloat(line2.substring(8, 16).trim());
    const ecc = parseFloat(`0.${line2.substring(26, 33).trim()}`);
    const mm = parseFloat(line2.substring(52, 63).trim());

    if (!Number.isNaN(inc)) inclinationDeg = inc;
    if (!Number.isNaN(ecc)) eccentricity = ecc;

    if (!Number.isNaN(mm) && mm > 0) {
      periodMinutes = 1440 / mm;
      const mu = 398600.4418; // Earth's gravitational parameter (km^3/s^2)
      const n = (mm * 2 * Math.PI) / 86400; // mean motion in rad/s
      const a = Math.cbrt(mu / (n * n));
      semiMajorAxisKm = Math.round(a * 10) / 10;
      if (eccentricity != null) {
        apogeeKm = Math.round((a * (1 + eccentricity) - 6371) * 10) / 10;
        perigeeKm = Math.round((a * (1 - eccentricity) - 6371) * 10) / 10;
      }
    }
  }

  return {
    noradId,
    cosparId,
    launchYear,
    launchSequence,
    inclinationDeg,
    eccentricity,
    periodMinutes,
    apogeeKm,
    perigeeKm,
    semiMajorAxisKm,
    epochYear,
    epochDay,
  };
}

/**
 * Maps launch agency, vehicle, launch site, and operator based on satellite family
 */
export function getSatelliteLaunchIntel(name: string, orbital: OrbitalParameters): SatelliteLaunchIntel {
  const upper = (name || '').toUpperCase();
  const yr = orbital.launchYear !== '—' ? orbital.launchYear : 'Classified';

  if (upper.includes('DMSP')) {
    return {
      operator: 'United States Space Force / US Air Force / NOAA',
      country: 'United States',
      countryCode: 'US',
      flag: '🇺🇸',
      rocket: 'Delta IV (4,2) / Titan II / Atlas E',
      launchSite: 'Vandenberg Space Force Base, SLC-6, California',
      purpose: 'Defense Meteorological Reconnaissance & Solar-Terrestrial Monitoring',
      approxLaunchDate: `${yr} (DMSP Operational Mission)`,
    };
  }

  if (upper.includes('USA') || upper.includes('NROL')) {
    return {
      operator: 'National Reconnaissance Office (NRO) / US Space Force',
      country: 'United States',
      countryCode: 'US',
      flag: '🇺🇸',
      rocket: 'Delta IV Heavy / Atlas V 541 / Falcon 9',
      launchSite: 'Cape Canaveral SFS (SLC-41) or Vandenberg SFB (SLC-6)',
      purpose: 'Top Secret National Security Reconnaissance / SIGINT / Optical Keyhole',
      approxLaunchDate: `${yr} (NRO Classified Launch)`,
    };
  }

  if (upper.includes('GPS') || upper.includes('NAVSTAR')) {
    return {
      operator: 'United States Space Force (Space Delta 8)',
      country: 'United States',
      countryCode: 'US',
      flag: '🇺🇸',
      rocket: 'Delta IV / Falcon 9 Block 5',
      launchSite: 'Cape Canaveral Space Force Station, SLC-40',
      purpose: 'Global Positioning System (PNT) Core Constellation',
      approxLaunchDate: `${yr} (GPS Block IIF / III)`,
    };
  }

  if (upper.includes('COSMOS') || upper.includes('GLONASS')) {
    return {
      operator: 'Russian Aerospace Forces / Roscosmos',
      country: 'Russia',
      countryCode: 'RU',
      flag: '🇷🇺',
      rocket: 'Soyuz-2.1b / Fregat / Proton-M',
      launchSite: 'Plesetsk Cosmodrome Site 43 / Baikonur Cosmodrome',
      purpose: 'Military Navigation / Early Warning / Electronic Reconnaissance',
      approxLaunchDate: `${yr} (Russian Defense Deployment)`,
    };
  }

  if (upper.includes('YAOGAN') || upper.includes('BEIDOU')) {
    return {
      operator: 'People\'s Liberation Army Strategic Support Force / CNSA',
      country: 'China',
      countryCode: 'CN',
      flag: '🇨🇳',
      rocket: 'Long March 2D / Long March 3B / Long March 4C',
      launchSite: 'Jiuquan Satellite Launch Center / Xichang SLC',
      purpose: 'Electro-Optical Reconnaissance / SAR Earth Observation & Navigation',
      approxLaunchDate: `${yr} (Chinese State Space Program)`,
    };
  }

  if (upper.includes('GALILEO') || upper.includes('SENTINEL')) {
    return {
      operator: 'European Space Agency (ESA) / EUSPA (European Union)',
      country: 'European Union',
      countryCode: 'EU',
      flag: '🇪🇺',
      rocket: 'Ariane 5 ES / Soyuz ST-B / Vega-C',
      launchSite: 'Guiana Space Centre (CSG), Kourou, French Guiana',
      purpose: 'High-Precision Civilian & Security Navigation / Copernicus Earth Observation',
      approxLaunchDate: `${yr} (ESA European Space Program)`,
    };
  }

  if (upper.includes('ISS')) {
    return {
      operator: 'International Partnership (NASA, Roscosmos, ESA, JAXA, CSA)',
      country: 'International Collaboration',
      countryCode: 'UN',
      flag: '🌐',
      rocket: 'Proton-K (Zarya) / Space Shuttle Endeavour / Falcon 9',
      launchSite: 'Baikonur Cosmodrome Site 81/23 / Kennedy Space Center LC-39A',
      purpose: 'Microgravity Human Spaceflight Laboratory & Earth Orbital Research',
      approxLaunchDate: '1998 – Present (Continuous Orbital Operations)',
    };
  }

  if (upper.includes('TIANGONG')) {
    return {
      operator: 'China Manned Space Agency (CMSA)',
      country: 'China',
      countryCode: 'CN',
      flag: '🇨🇳',
      rocket: 'Long March 5B / Long March 7 / Long March 2F',
      launchSite: 'Wenchang Space Launch Site, Hainan Island',
      purpose: 'Permanent Low Earth Orbit Modular Space Station',
      approxLaunchDate: '2021 – Present (Chinese Manned Space Program)',
    };
  }

  if (upper.includes('STARLINK')) {
    return {
      operator: 'SpaceX',
      country: 'United States',
      countryCode: 'US',
      flag: '🇺🇸',
      rocket: 'Falcon 9 Block 5',
      launchSite: 'Cape Canaveral SLC-40 / Vandenberg SLC-4E',
      purpose: 'Global Commercial Broadband Megaconstellation',
      approxLaunchDate: `${yr} (SpaceX Dedicated Mission)`,
    };
  }

  if (upper.includes('ONEWEB')) {
    return {
      operator: 'Eutelsat OneWeb',
      country: 'United Kingdom / Europe',
      countryCode: 'GB',
      flag: '🇬🇧',
      rocket: 'Falcon 9 / LVM3 / Soyuz',
      launchSite: 'Cape Canaveral / Satish Dhawan Space Centre (SDSC)',
      purpose: 'Commercial Low Earth Orbit Satellite Broadband',
      approxLaunchDate: `${yr} (OneWeb Deployment)`,
    };
  }

  if (upper.includes('FENGYUN')) {
    return {
      operator: 'China Meteorological Administration (CMA) / CNSA',
      country: 'China',
      countryCode: 'CN',
      flag: '🇨🇳',
      rocket: 'Long March 3A / 3B / 4B',
      launchSite: 'Xichang Satellite Launch Center (XSLC) / Taiyuan SLC',
      purpose: 'Geostationary & Polar Meteorological / Earth Observation',
      approxLaunchDate: `${yr} (Fengyun Program)`,
    };
  }

  if (upper.includes('GAOFEN') || upper.includes('SHIYAN') || upper.includes('HAIYANG') || upper.includes('TIANZHOU') || upper.includes('CHINASAT') || upper.includes('ZHONGXING') || upper.includes('CZ-') || upper.includes('CZ ')) {
    return {
      operator: 'China National Space Administration (CNSA) / CASC',
      country: 'China',
      countryCode: 'CN',
      flag: '🇨🇳',
      rocket: 'Long March 2D / 3B / 4C / 7',
      launchSite: 'Jiuquan / Xichang / Wenchang SLC',
      purpose: 'High-Resolution Earth Observation & National Infrastructure',
      approxLaunchDate: `${yr} (Chinese Space Program)`,
    };
  }

  if (upper.includes('GOES') || upper.includes('NOAA') || upper.includes('SUOMI') || upper.includes('JPSS')) {
    return {
      operator: 'National Oceanic and Atmospheric Administration (NOAA) / NASA',
      country: 'United States',
      countryCode: 'US',
      flag: '🇺🇸',
      rocket: 'Atlas V 541 / Falcon 9 / Delta IV',
      launchSite: 'Cape Canaveral SLC-41 / Vandenberg SFB',
      purpose: 'Geostationary & Polar Environmental Weather Monitoring',
      approxLaunchDate: `${yr} (NOAA / NASA Joint Program)`,
    };
  }

  if (upper.includes('LANDSAT') || upper.includes('TERRA') || upper.includes('AQUA') || upper.includes('AURA')) {
    return {
      operator: 'NASA / United States Geological Survey (USGS)',
      country: 'United States',
      countryCode: 'US',
      flag: '🇺🇸',
      rocket: 'Atlas V 401 / Delta II 7920',
      launchSite: 'Vandenberg Space Force Base, California',
      purpose: 'Multispectral Earth Resources Observation & Earth Science',
      approxLaunchDate: `${yr} (NASA Earth Science Program)`,
    };
  }

  if (upper.includes('METEOSAT') || upper.includes('ENVISAT') || upper.includes('METOP')) {
    return {
      operator: 'EUMETSAT / European Space Agency (ESA)',
      country: 'European Union',
      countryCode: 'EU',
      flag: '🇪🇺',
      rocket: 'Ariane 5 / Soyuz ST-B / Vega',
      launchSite: 'Guiana Space Centre (CSG), Kourou, French Guiana',
      purpose: 'European Geostationary & Polar Meteorological Sentinel',
      approxLaunchDate: `${yr} (EUMETSAT Operational Program)`,
    };
  }

  if (upper.includes('CARTOSAT') || upper.includes('RISAT') || upper.includes('OCEANSAT') || upper.includes('INSAT') || upper.includes('GSAT') || upper.includes('EOS') || upper.includes('IRNSS') || upper.includes('NAVIC')) {
    return {
      operator: 'Indian Space Research Organisation (ISRO)',
      country: 'India',
      countryCode: 'IN',
      flag: '🇮🇳',
      rocket: 'PSLV-XL / GSLV Mk II / LVM3',
      launchSite: 'Satish Dhawan Space Centre (SDSC), Sriharikota',
      purpose: 'Indigenous Earth Observation, Communication & NavIC Constellation',
      approxLaunchDate: `${yr} (ISRO Space Program)`,
    };
  }

  if (upper.includes('HIMAWARI') || upper.includes('ALOS') || upper.includes('QZSS') || upper.includes('MICHIBIKI') || upper.includes('GCOM')) {
    return {
      operator: 'Japan Aerospace Exploration Agency (JAXA) / JMA',
      country: 'Japan',
      countryCode: 'JP',
      flag: '🇯🇵',
      rocket: 'H-IIA 202 / H3',
      launchSite: 'Yoshinobu Launch Complex, Tanegashima Space Center',
      purpose: 'Advanced Meteorological Observation & Quasi-Zenith Positioning',
      approxLaunchDate: `${yr} (JAXA Operational Mission)`,
    };
  }

  if (upper.includes('KOMPSAT') || upper.includes('CHEOLLIAN') || upper.includes('GEO-KOMPSAT')) {
    return {
      operator: 'Korea Aerospace Research Institute (KARI)',
      country: 'South Korea',
      countryCode: 'KR',
      flag: '🇰🇷',
      rocket: 'Falcon 9 / Ariane 5 / Nuri (KSLV-II)',
      launchSite: 'Naro Space Center / CSG Kourou',
      purpose: 'Multi-Purpose Geostationary & High-Resolution Remote Sensing',
      approxLaunchDate: `${yr} (South Korean Space Program)`,
    };
  }

  if (upper.includes('SOYUZ') || upper.includes('PROGRESS') || upper.includes('RESURS') || upper.includes('METEOR') || upper.includes('ELEKTRON') || upper.includes('LUCH')) {
    return {
      operator: 'Roscosmos / Russian Aerospace Forces',
      country: 'Russia',
      countryCode: 'RU',
      flag: '🇷🇺',
      rocket: 'Soyuz-2.1a / Soyuz-2.1b / Proton-M',
      launchSite: 'Baikonur Cosmodrome / Plesetsk Cosmodrome',
      purpose: 'Orbital Logistics, Resupply & Earth Observation',
      approxLaunchDate: `${yr} (Roscosmos Mission)`,
    };
  }

  if (upper.includes('PLANET') || upper.includes('FLOCK') || upper.includes('DOVE') || upper.includes('WORLDVIEW') || upper.includes('GEOEYE') || upper.includes('BLACKSKY') || upper.includes('CAPELLA')) {
    return {
      operator: 'Commercial Earth Imaging (Planet Labs / Maxar / BlackSky)',
      country: 'United States',
      countryCode: 'US',
      flag: '🇺🇸',
      rocket: 'Falcon 9 / Electron',
      launchSite: 'Cape Canaveral / Vandenberg SFB / Mahia LC-1',
      purpose: 'High-Cadence Commercial Optical & SAR Earth Imaging',
      approxLaunchDate: `${yr} (Commercial Constellation)`,
    };
  }

  if (upper.includes('HUBBLE') || upper.includes('JWST') || upper.includes('JAMES WEBB') || upper.includes('CHANDRA')) {
    return {
      operator: 'NASA / ESA / CSA Space Telescope Science Institute',
      country: 'United States / International',
      countryCode: 'US',
      flag: '🇺🇸',
      rocket: 'Space Shuttle Discovery (STS-31) / Ariane 5 ECA',
      launchSite: 'Kennedy Space Center LC-39A / CSG Kourou',
      purpose: 'Flagship Deep Space Astrophysics & Infrared / Optical Space Observatory',
      approxLaunchDate: `${yr} (Deep Space Observatory Mission)`,
    };
  }

  if (upper.includes('RADARSAT')) {
    return {
      operator: 'Canadian Space Agency (CSA) / MDA',
      country: 'Canada',
      countryCode: 'CA',
      flag: '🇨🇦',
      rocket: 'Falcon 9 / Delta II',
      launchSite: 'Vandenberg Space Force Base, California',
      purpose: 'C-Band Synthetic Aperture Radar (SAR) Earth Observation',
      approxLaunchDate: `${yr} (Radarsat Constellation Mission)`,
    };
  }

  return {
    operator: 'National Space Agency / Classified Military Command',
    country: 'International / Classified',
    countryCode: '',
    flag: '🛰️',
    rocket: 'Multi-Stage Orbital Launch Vehicle',
    launchSite: 'Dedicated Space Launch Complex',
    purpose: 'Orbital Reconnaissance & Earth Infrastructure Service',
    approxLaunchDate: yr !== '—' ? `${yr} Launch Event` : 'Recorded Orbital Epoch',
  };
}

export interface SatelliteQuickIntel {
  name: string;
  country: string;
  countryCode: string;
  flag: string;
  type: string;
  operator?: string;
}

/**
 * Fast synchronous extractor for satellite Name, Country, Flag and Type
 * Used for instant zero-lag map hover tooltips and cards
 */
export function getSatelliteQuickIntel(sat: {
  name: string;
  category?: string;
  mission?: string;
  line1?: string;
  line2?: string;
  noradId?: string;
}): SatelliteQuickIntel {
  const orbital = parseOrbitalParameters(sat.line1, sat.line2, sat.noradId);
  const launch = getSatelliteLaunchIntel(sat.name, orbital);

  let type = '';
  if (sat.mission && sat.mission !== 'Unknown') {
    type = sat.mission;
  } else if (sat.category) {
    const catMap: Record<string, string> = {
      earth_obs: 'Earth Observation',
      military: 'Military Recon',
      navigation: 'Navigation',
      comms: 'Commercial Comms',
      science: 'Space Science',
      weather: 'Weather',
      other: 'Orbital Payload',
    };
    type = catMap[sat.category] || sat.category.replace('_', ' ');
  } else {
    type = 'Orbital Payload';
  }

  return {
    name: sat.name,
    country: launch.country,
    countryCode: launch.countryCode,
    flag: launch.flag,
    type,
    operator: launch.operator,
  };
}

/**
 * Resolves verified Wikipedia and OSIRIS space intelligence for a satellite
 */
export async function fetchSatelliteWikiSummary(name: string): Promise<WikiSatelliteSummary> {
  const cacheKey = (name || '').trim().toUpperCase();
  if (WIKI_CACHE.has(cacheKey)) {
    return WIKI_CACHE.get(cacheKey)!;
  }

  let result: WikiSatelliteSummary;
  try {
    const response = await fetch(api.satelliteInfo(name));
    if (!response.ok) throw new Error(`Satellite info request failed: ${response.status}`);
    result = await response.json() as WikiSatelliteSummary;
  } catch {
    const clean = name.replace(/\s+F\d+|\s+DEB.*|\s+R\/B.*/i, '').trim();
    result = {
      title: name,
      description: 'Active Orbital Intelligence Asset',
      extract: `${name} is an operational spacecraft currently tracked in Earth orbit.`,
      thumbnailUrl: null,
      wikiUrl: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(clean)}`,
      source: 'Space Catalogue',
    };
  }

  WIKI_CACHE.set(cacheKey, result);
  return result;
}

