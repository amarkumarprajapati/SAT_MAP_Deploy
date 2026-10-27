import type { Map, ProjectionSpecification } from 'maplibre-gl';

/* MapLibre's own adaptive globe, which is what shipped before #330 and what
   production last ran successfully. It holds a true globe at overview zooms
   and switches to mercator internally as you zoom in, so the library owns the
   transition rather than the app. */
export const GLOBE_PROJECTION: ProjectionSpecification = { type: 'globe' };

export function applyMapProjection(
  map: Pick<Map, 'getProjection' | 'setProjection'>,
  mode: 'globe' | 'mercator',
) {
  const next: ProjectionSpecification = mode === 'mercator' ? { type: 'mercator' } : GLOBE_PROJECTION;
  // An omitted style projection is mercator, despite the library's return type.
  if (JSON.stringify(map.getProjection()?.type ?? 'mercator') === JSON.stringify(next.type)) return false;
  map.setProjection(next);
  return true;
}
