export interface GeoVideoFrame {
  timeSeconds: number;
  sensor: { lat: number; lng: number; altitudeM?: number | null };
  center?: { lat: number; lng: number } | null;
  headingDeg?: number | null;
  pitchDeg?: number | null;
  footprint?: number[][][] | null;
}
