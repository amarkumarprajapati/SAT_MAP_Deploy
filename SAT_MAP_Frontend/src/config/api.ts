import axios from 'axios';


export const getApiBaseUrl = (): string => {
  if (process.env.NEXT_PUBLIC_FASTAPI_URL) {
    return process.env.NEXT_PUBLIC_FASTAPI_URL.replace(/\/+$/, '');
  }
  return '';
};

export const API_BASE_URL: string = getApiBaseUrl();
export const API_PREFIX = '/api';

export const API_ENDPOINTS = {
  HEALTH: `${API_PREFIX}/health`,
  FLIGHTS: `${API_PREFIX}/flights`,
  MARITIME: `${API_PREFIX}/maritime`,
  SATELLITES: `${API_PREFIX}/satellites`,
  SATELLITES_ORBIT: `${API_PREFIX}/satellites/orbit`,
  REGION_DOSSIER: `${API_PREFIX}/region-dossier`,
  STATS: `${API_PREFIX}/stats`,
  SATELLITE_INFO: `${API_PREFIX}/satellite-info`,
  REVERSE_GEOCODE: `${API_PREFIX}/geocode/reverse`,
  MAP_STYLE: `${API_PREFIX}/map/style`,
  MAP_IMAGERY: `${API_PREFIX}/map/imagery`,
  MAP_TERRAIN: `${API_PREFIX}/map/terrain`,
  GEOSPATIAL_VIDEO_METADATA: `${API_PREFIX}/geospatial-video/metadata`,
} as const;

export type ApiEndpointKey = keyof typeof API_ENDPOINTS;

export const apiClient = axios.create({
  timeout: 20000,
  headers: {
    'Accept': 'application/json',
  },
});


apiClient.interceptors.request.use((config) => {
  const base = getApiBaseUrl();
  if (base && !config.baseURL && !config.url?.startsWith('http')) {
    config.baseURL = base;
  }
  return config;
});

// Deduplicate concurrent identical GET requests across components
const rawGet = apiClient.get.bind(apiClient);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pendingGetMap = new Map<string, Promise<any>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
apiClient.get = ((url: string, config?: any): Promise<any> => {
  const key = `${url}_${JSON.stringify(config?.params || {})}`;
  if (pendingGetMap.has(key)) {
    return pendingGetMap.get(key)!;
  }
  const promise = rawGet(url, config).finally(() => {
    pendingGetMap.delete(key);
  });
  pendingGetMap.set(key, promise);
  return promise;
}) as typeof apiClient.get;

export function getApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const base = getApiBaseUrl();
  return base ? `${base}${cleanEndpoint}` : cleanEndpoint;
}

export const api = {
  health: () => getApiUrl(API_ENDPOINTS.HEALTH),
  flights: () => getApiUrl(API_ENDPOINTS.FLIGHTS),
  maritime: (types?: string[], bounds?: { west: number; south: number; east: number; north: number }, includePorts = true, includeShips = Boolean(types?.length)) => {
    const params = new URLSearchParams();
    if (types?.length) params.set('types', types.join(','));
    params.set('include_ports', String(includePorts));
    params.set('include_ships', String(includeShips));
    if (bounds) {
      params.set('west', String(bounds.west));
      params.set('south', String(bounds.south));
      params.set('east', String(bounds.east));
      params.set('north', String(bounds.north));
    }
    const query = params.toString();
    return getApiUrl(`${API_ENDPOINTS.MARITIME}${query ? `?${query}` : ''}`);
  },
  satellites: (options?: { categories?: string[]; bounds?: { west: number; south: number; east: number; north: number } }) => {
    const params = new URLSearchParams();
    if (options?.categories?.length) params.set('categories', options.categories.join(','));
    if (options?.bounds) {
      params.set('west', String(options.bounds.west));
      params.set('south', String(options.bounds.south));
      params.set('east', String(options.bounds.east));
      params.set('north', String(options.bounds.north));
    }
    const query = params.toString();
    return getApiUrl(`${API_ENDPOINTS.SATELLITES}${query ? `?${query}` : ''}`);
  },
  satelliteOrbit: (id: string, options?: { at?: number; live?: boolean }) => {
    const params = new URLSearchParams({ id: id.trim() });
    if (options?.live) params.set('live', '1');
    else if (options?.at) params.set('t', String(options.at));
    return getApiUrl(`${API_ENDPOINTS.SATELLITES_ORBIT}?${params.toString()}`);
  },
  satellitePositionStream: (id: string) =>
    getApiUrl(`${API_ENDPOINTS.SATELLITES}/stream?id=${encodeURIComponent(id.trim())}`),
  regionDossier: (lat: number, lng: number) =>
    getApiUrl(`${API_ENDPOINTS.REGION_DOSSIER}?lat=${lat}&lng=${lng}`),
  stats: () => getApiUrl(API_ENDPOINTS.STATS),
  newsStream: () => getApiUrl(`${API_PREFIX}/osint/news/stream`),
  satelliteInfo: (name: string) =>
    getApiUrl(`${API_ENDPOINTS.SATELLITE_INFO}?name=${encodeURIComponent(name)}`),
  reverseGeocode: (lat: number, lng: number) =>
    getApiUrl(`${API_ENDPOINTS.REVERSE_GEOCODE}?latitude=${lat}&longitude=${lng}`),
  mapCartoAsset: (url: string) =>
    getApiUrl(`${API_PREFIX}/map/carto?url=${encodeURIComponent(url)}`),
  geospatialVideoMetadata: () => getApiUrl(API_ENDPOINTS.GEOSPATIAL_VIDEO_METADATA),
};


export const styleUrl = '/dark-matter-style.json';
export const mapImageryTileUrl =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
