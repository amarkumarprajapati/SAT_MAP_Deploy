import type { Map } from 'maplibre-gl';

const SOURCE = 'imagery-polar-caps';
const LAYER = 'imagery-polar-cap-fill';
const FADE_STEPS = 12;
const FADE_START_LAT = 84;
const FADE_END_LAT = 85.05112878;

/** Smooth display fills over the unsupported polar ends of Mercator imagery. */
export function updateImageryPolarCaps(map: Map, visible: boolean) {
  if (!visible && !map.getLayer(LAYER)) return;
  if (!map.getSource(SOURCE)) {
    const features: GeoJSON.Feature[] = [];
    for (const sign of [1, -1]) {
      let previousOpacity = 0;
      for (let step = 1; step <= FADE_STEPS; step++) {
        const t = step / FADE_STEPS;
        // Smoothstep has zero slope at both ends, avoiding a hard circular seam.
        const targetOpacity = t * t * (3 - 2 * t);
        const opacity = (targetOpacity - previousOpacity) / (1 - previousOpacity);
        previousOpacity = targetOpacity;
        const latitude = FADE_START_LAT + (FADE_END_LAT - FADE_START_LAT) * t;
        const ring: number[][] = [];
        for (let longitude = -180; longitude <= 180; longitude += 10) {
          ring.push([longitude, sign * latitude]);
        }
        ring.push(ring[0]);
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: {
            color: sign > 0 ? '#064557' : '#f1f6fc',
            // Account for alpha compositing of all the enclosing caps.
            opacity,
            order: step,
          },
        });
      }
    }
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features } });
  }
  if (!map.getLayer(LAYER)) {
    const layers = map.getStyle().layers ?? [];
    const imageryIndex = layers.findIndex(layer => layer.id === 'satellite-layer');
    map.addLayer({
      id: LAYER,
      type: 'fill',
      source: SOURCE,
      layout: { 'fill-sort-key': ['get', 'order'] },
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': ['get', 'opacity'],
        'fill-antialias': false,
      },
    }, imageryIndex >= 0 ? layers[imageryIndex + 1]?.id : undefined);
  }
  map.setLayoutProperty(LAYER, 'visibility', visible ? 'visible' : 'none');
}
