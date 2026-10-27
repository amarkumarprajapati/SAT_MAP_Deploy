import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { MercatorCoordinate } from 'maplibre-gl';
import { createSatelliteProgramCache } from './satellite-programs';


const KM_TO_M = 1000;
export const SAT_MAX_ZOOM = 10;

const FLOOR_KM = 620;
const CEILING_KM = 2500;
const MIN_ALT_KM = 150;    
const MAX_ALT_KM = 36000;  

export function displayElevation(altKm: number, exaggeration = 1): number {
  if (!Number.isFinite(altKm) || altKm <= 0) return 0;
  const clamped = Math.min(Math.max(altKm, MIN_ALT_KM), MAX_ALT_KM);
  const t = (Math.sqrt(clamped) - Math.sqrt(MIN_ALT_KM)) /
    (Math.sqrt(MAX_ALT_KM) - Math.sqrt(MIN_ALT_KM));
  return (FLOOR_KM + (CEILING_KM - FLOOR_KM) * t) * exaggeration * KM_TO_M;
}

export interface SatPoint {
  lng: number;
  lat: number;
  altKm: number;
  color: number;
  size: number;
}

const VERT = `
in vec2 a_corner;   // unit quad, -1..1 — one shared quad, drawn per instance
in vec3 a_pos;      // x, y = mercator [0..1]; z = display elevation (metres)
in vec3 a_color;
in float a_size;
uniform vec2 u_viewport;
uniform int u_selected;
uniform int u_focus_only;
out vec2 v_corner;
out vec3 v_color;
out float v_hot;
out float v_visible;
void main() {
  vec4 clip = projectTileFor3D(a_pos.xy, a_pos.z);
  v_hot = gl_InstanceID == u_selected ? 1.0 : 0.0;
  v_visible = u_focus_only == 0 || gl_InstanceID == u_selected ? 1.0 : 0.0;

  // Marker geometry lives in unit-quad coordinates; pixel sizing is applied once here.
  float basePx = clamp(a_size * 240.0 / max(clip.w, 0.0001), 12.0, 22.0);

  // Selection brightens the marker without changing its footprint, so picking
  // a satellite does not make its icon jump to a different size.
  float px = basePx;

  // Expand the quad in clip space
  gl_Position = clip + vec4(a_corner * px / u_viewport * 2.0 * clip.w, 0.0, 0.0);
  v_corner = a_corner;
  v_color = a_color;
}`;

const FRAG = `
precision mediump float;
in vec2 v_corner;
in vec3 v_color;
in float v_hot;
in float v_visible;
uniform float u_time;
out vec4 fragColor;

float box(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
  if (v_visible < 0.5) discard;
  float r = length(v_corner);
  if (r > 1.0) discard;
  
  // 45-degree rotation for diagonal flight attitude
  float s = 0.70710678;
  float c = 0.70710678;
  mat2 rot = mat2(c, -s, s, c);
  vec2 p = rot * v_corner;

  // 1. Central Spacecraft Bus (crisp rounded chassis)
  float chassis = box(p, vec2(0.12, 0.12)) - 0.025;
  
  // 2. Solar Array Wings (sleek aspect ratio)
  float panels = box(p, vec2(0.58, 0.10));
  // Cut out gap between central chassis and solar panels
  panels = max(panels, -(box(p, vec2(0.20, 0.20))));

  // Connecting structural boom/strut
  float boom = box(p, vec2(0.22, 0.018));

  // 3. Communications Mast & Dish (pointing along top-forward axis)
  float mast = box(p - vec2(0.0, 0.30), vec2(0.015, 0.15));
  vec2 tipPos = vec2(0.0, 0.48);
  float dTip = length(p - tipPos);
  float tipDish = box(p - vec2(0.0, 0.42), vec2(0.045, 0.014));
  float tipBulb = dTip - 0.035;

  float dSat = min(chassis, min(panels, min(boom, min(mast, min(tipDish, tipBulb)))));

  // Smooth anti-aliased edge
  float fw = max(fwidth(dSat), 0.014);
  float alpha = smoothstep(fw, -fw, dSat);

  // Solar cell grid divisions
  float panelShading = 1.0;
  if (abs(p.x) > 0.20 && abs(p.x) < 0.58 && abs(p.y) < 0.10) {
    float gx1 = abs(abs(p.x) - 0.32);
    float gx2 = abs(abs(p.x) - 0.45);
    float gy = abs(p.y);
    if (gx1 < 0.015 || gx2 < 0.015 || gy < 0.012) {
      panelShading = 0.60;
    }
  }

  vec3 satBaseCol = v_color * panelShading;

  // Chassis center core highlight (payload lens / core)
  float coreDist = length(p);
  if (coreDist < 0.065) {
    satBaseCol = mix(satBaseCol, vec3(1.0), 0.6);
  }

  // Periodic blinking strobe beacon at top tip
  float tBlink = fract(u_time * 1.6);
  float strobe = (tBlink < 0.28) ? smoothstep(0.0, 0.06, tBlink) * smoothstep(0.28, 0.16, tBlink) : 0.0;

  float beaconCore = smoothstep(0.04, 0.008, dTip);
  float beaconGlow = smoothstep(0.18, 0.015, dTip) * (0.25 + 0.75 * strobe);
  vec3 beaconColor = mix(vec3(1.0, 0.25, 0.3), vec3(1.0, 0.95, 0.9), beaconCore);

  if (v_hot > 0.5) {
    // ── SELECTED SATELLITE ──
    vec3 satCol = mix(satBaseCol, vec3(1.0), 0.20);
    float finalAlpha = alpha;
    vec3 finalCol = satCol;

    // Active beacon light
    if (dTip < 0.20) {
      float lightIntensity = clamp(beaconCore * (0.6 + 0.4 * strobe) + beaconGlow * strobe, 0.0, 1.0);
      finalCol = mix(finalCol, beaconColor, lightIntensity);
      finalAlpha = max(finalAlpha, beaconGlow * 0.95);
    }

    // ── SLEEK TACTICAL RETICLE (Crisp thin precision ring + cardinal notch ticks) ──
    float ring = smoothstep(0.85, 0.88, r) * smoothstep(0.94, 0.91, r);
    float ringAura = smoothstep(0.78, 0.88, r) * smoothstep(0.98, 0.90, r) * 0.25;

    // 4 cardinal tactical notch ticks at 0°, 90°, 180°, 270°
    float cardinalAxis = min(abs(v_corner.x), abs(v_corner.y));
    float ticks = smoothstep(0.035, 0.012, cardinalAxis) * smoothstep(0.76, 0.85, r) * smoothstep(0.98, 0.93, r);

    vec3 reticleColor = mix(v_color, vec3(0.0, 0.95, 1.0), 0.5);
    float reticle = max(ring + ringAura, ticks);

    finalCol = mix(finalCol, reticleColor, reticle);
    finalAlpha = max(finalAlpha, reticle * 0.95);

    if (finalAlpha < 0.01) discard;
    fragColor = vec4(finalCol, finalAlpha * 0.98);
    return;
  }

  // ── UNSELECTED SATELLITES ──
  if (dTip < 0.045) {
    satBaseCol = mix(satBaseCol, vec3(1.0, 0.3, 0.3), beaconCore * 0.5);
  }

  if (alpha < 0.01) discard;
  fragColor = vec4(satBaseCol, alpha * smoothstep(1.0, 0.8, r));
}`;


const PICK_VERT = `
in vec2 a_corner;
in vec3 a_pos;
in float a_size;
uniform vec2 u_viewport;
flat out vec3 v_id;
out vec2 v_corner;
void main() {
  vec4 clip = projectTileFor3D(a_pos.xy, a_pos.z);
  float px = clamp(a_size * 240.0 / max(clip.w, 0.0001), 12.0, 28.0) + 8.0;
  gl_Position = clip + vec4(a_corner * px / u_viewport * 2.0 * clip.w, 0.0, 0.0);
  int id = gl_InstanceID + 1;   // 0 is reserved for 'nothing here'
  v_id = vec3(float(id & 255), float((id >> 8) & 255), float((id >> 16) & 255)) / 255.0;
  v_corner = a_corner;
}`;

const PICK_FRAG = `
precision mediump float;
flat in vec3 v_id;
in vec2 v_corner;
out vec4 fragColor;
void main() {
  if (length(v_corner) > 1.0) discard;
  fragColor = vec4(v_id, 1.0);
}`;


const ORBIT_VERT = `
in vec3 a_pos;
void main() {
  gl_Position = projectTileFor3D(a_pos.xy, a_pos.z);
}`;

const ORBIT_FRAG = `
precision mediump float;
uniform vec3 u_color;
out vec4 fragColor;
void main() { fragColor = vec4(u_color, 0.85); }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`satellite layer shader failed: ${log}`);
  }
  return sh;
}


export function packVertices(points: SatPoint[], exaggeration = 1): Float32Array<ArrayBuffer> {
  const STRIDE = 7; // x, y, z, r, g, b, size
  const out = new Float32Array(points.length * STRIDE);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const m = MercatorCoordinate.fromLngLat({ lng: p.lng, lat: p.lat }, 0);
    const o = i * STRIDE;
    out[o] = m.x;
    out[o + 1] = m.y;
    out[o + 2] = displayElevation(p.altKm, exaggeration);
    out[o + 3] = ((p.color >> 16) & 0xff) / 255;
    out[o + 4] = ((p.color >> 8) & 0xff) / 255;
    out[o + 5] = (p.color & 0xff) / 255;
    out[o + 6] = p.size;
  }
  return out;
}


export function packOrbit(segment: { lng: number; lat: number; altKm: number }[], exaggeration = 1): Float32Array<ArrayBuffer> {
  const out = new Float32Array(segment.length * 3);
  for (let i = 0; i < segment.length; i++) {
    const p = segment[i];
    const m = MercatorCoordinate.fromLngLat({ lng: p.lng, lat: p.lat }, 0);
    out[i * 3] = m.x;
    out[i * 3 + 1] = m.y;
    out[i * 3 + 2] = displayElevation(p.altKm, exaggeration);
  }
  return out;
}


export function parseColor(hex: string | undefined, fallback = 0x00e5ff): number {
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1], 16) : fallback;
}


export function createSatelliteLayer(id: string): CustomLayerInterface & {
  setPoints(points: SatPoint[]): void;
  updatePoint(index: number, point: SatPoint): void;
  setExaggeration(value: number): void;
  pick(x: number, y: number): number | null;
  setOrbit(segments: { lng: number; lat: number; altKm: number }[][] | null, color?: number): void;
  setCone(segments: { lng: number; lat: number; altKm: number }[][] | null, color?: number): void;
  setSelected(index: number | null): void;
  setFocusOnly(enabled: boolean): void;
} {
  let gl: WebGL2RenderingContext | null = null;
  let map: MlMap | null = null;
  let program: WebGLProgram | null = null;
  let activeShader: CustomRenderMethodInput['shaderData'] | null = null;
  let buffer: WebGLBuffer | null = null;
  let quad: WebGLBuffer | null = null;
  let pickVao: WebGLVertexArrayObject | null = null;
  let pickProgram: WebGLProgram | null = null;
  let pickFbo: WebGLFramebuffer | null = null;
  let pickTex: WebGLTexture | null = null;
  let pickDepth: WebGLRenderbuffer | null = null;
  let pickSize = { w: 0, h: 0 };

  let lastProjection: CustomRenderMethodInput['defaultProjectionData'] | null = null;
  let orbitProgram: WebGLProgram | null = null;
  let orbitBuffers: { buf: WebGLBuffer; count: number }[] = [];
  let orbitSegments: { lng: number; lat: number; altKm: number }[][] | null = null;
  let orbitColor = 0x00e5ff;
  let orbitDirty = false;
  let coneBuffers: { buf: WebGLBuffer; count: number }[] = [];
  let coneSegments: { lng: number; lat: number; altKm: number }[][] | null = null;
  let coneColor = 0x00e5ff;
  let coneDirty = false;
  let selected = -1;
  let focusOnly = false;
  let vertices: Float32Array<ArrayBuffer> = new Float32Array(0);
  let count = 0;
  let exaggeration = 1;
  let points: SatPoint[] = [];
  let previousPoints: SatPoint[] = [];
  let pointTransitionStartedAt = 0;
  let transitioningPoints = false;
  let dirty = false;

  const link = (prelude: string, define: string, vert: string, frag: string): WebGLProgram => {
    const vs = compile(gl!, gl!.VERTEX_SHADER, `#version 300 es\n${prelude}\n${define}\n${vert}`);
    const fs = compile(gl!, gl!.FRAGMENT_SHADER, `#version 300 es\n${frag}`);
    const pr = gl!.createProgram()!;
    gl!.attachShader(pr, vs);
    gl!.attachShader(pr, fs);
    gl!.linkProgram(pr);
    gl!.deleteShader(vs);
    gl!.deleteShader(fs);
    if (!gl!.getProgramParameter(pr, gl!.LINK_STATUS)) {
      const log = gl!.getProgramInfoLog(pr);
      gl!.deleteProgram(pr);
      throw new Error(`satellite layer link failed: ${log}`);
    }
    return pr;
  };

  const programs = createSatelliteProgramCache<WebGLProgram>((kind, prelude, define) => {
    if (kind === 'pick') return link(prelude, define, PICK_VERT, PICK_FRAG);
    if (kind === 'orbit') return link(prelude, define, ORBIT_VERT, ORBIT_FRAG);
    return link(prelude, define, VERT, FRAG);
  }, pr => gl?.deleteProgram(pr));

  /** Lazily sized colour+depth target for the pick pass. */
  const ensurePickTargets = (w: number, h: number) => {
    if (!gl || (pickSize.w === w && pickSize.h === h && pickFbo)) return;
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const previousRenderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);
    if (pickTex) gl.deleteTexture(pickTex);
    if (pickDepth) gl.deleteRenderbuffer(pickDepth);
    if (pickFbo) gl.deleteFramebuffer(pickFbo);
    pickTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, pickTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    pickDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    pickFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, pickDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    gl.bindTexture(gl.TEXTURE_2D, previousTexture);
    gl.bindRenderbuffer(gl.RENDERBUFFER, previousRenderbuffer);
    pickSize = { w, h };
  };

  /** Binds the quad + per-instance attributes for whichever program is active. */
  const bindAttributes = (pr: WebGLProgram) => {
    const cornerLoc = gl!.getAttribLocation(pr, 'a_corner');
    gl!.bindBuffer(gl!.ARRAY_BUFFER, quad);
    gl!.enableVertexAttribArray(cornerLoc);
    gl!.vertexAttribPointer(cornerLoc, 2, gl!.FLOAT, false, 0, 0);
    gl!.vertexAttribDivisor(cornerLoc, 0);

    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    const STRIDE = 7 * 4;
    for (const [name, size, offset] of [['a_pos', 3, 0], ['a_color', 3, 12], ['a_size', 1, 24]] as const) {
      const loc = gl!.getAttribLocation(pr, name);
      if (loc < 0) continue;
      gl!.enableVertexAttribArray(loc);
      gl!.vertexAttribPointer(loc, size, gl!.FLOAT, false, STRIDE, offset);
      gl!.vertexAttribDivisor(loc, 1);
    }
    return cornerLoc;
  };

  /** Instancing divisors are global; leaving them set corrupts later layers. */
  const clearDivisors = (pr: WebGLProgram, cornerLoc: number) => {
    gl!.vertexAttribDivisor(cornerLoc, 0);
    for (const n of ['a_pos', 'a_color', 'a_size']) {
      const loc = gl!.getAttribLocation(pr, n);
      if (loc >= 0) gl!.vertexAttribDivisor(loc, 0);
    }
  };

  const setProjectionUniforms = (pr: WebGLProgram, proj: NonNullable<CustomRenderMethodInput['defaultProjectionData']>) => {
    const u = (name: string) => gl!.getUniformLocation(pr, name);
    gl!.uniformMatrix4fv(u('u_projection_matrix'), false, proj.mainMatrix);
    gl!.uniform4f(u('u_projection_tile_mercator_coords'),
      proj.tileMercatorCoords[0], proj.tileMercatorCoords[1],
      proj.tileMercatorCoords[2], proj.tileMercatorCoords[3]);
    gl!.uniform4f(u('u_projection_clipping_plane'),
      proj.clippingPlane[0], proj.clippingPlane[1],
      proj.clippingPlane[2], proj.clippingPlane[3]);
    gl!.uniform1f(u('u_projection_transition'), proj.projectionTransition);
    gl!.uniformMatrix4fv(u('u_projection_fallback_matrix'), false, proj.fallbackMatrix);
  };

  return {
    id,
    type: 'custom',
    // '3d' so MapLibre depth-tests it against the globe: a satellite behind
    // the Earth must be occluded by it, not drawn over the top.
    renderingMode: '3d',

    onAdd(m: MlMap, context: WebGL2RenderingContext) {
      map = m;
      gl = context;
      buffer = gl.createBuffer();
      // One unit quad, reused for every satellite via instancing.
      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
      ]), gl.STATIC_DRAW);
      dirty = true;
    },

    onRemove() {
      if (gl) {
        programs.clear();
        if (buffer) gl.deleteBuffer(buffer);
        if (quad) gl.deleteBuffer(quad);
      if (pickVao) gl.deleteVertexArray(pickVao);
        if (pickTex) gl.deleteTexture(pickTex);
        if (pickDepth) gl.deleteRenderbuffer(pickDepth);
        if (pickFbo) gl.deleteFramebuffer(pickFbo);
        for (const o of orbitBuffers) gl.deleteBuffer(o.buf);
      }
      program = null;
      activeShader = null;
      lastProjection = null;
      buffer = null;
      quad = null;
      pickVao = null;
      pickProgram = null;
      pickTex = null;
      pickDepth = null;
      pickFbo = null;
      pickSize = { w: 0, h: 0 };
      orbitProgram = null;
      orbitBuffers = [];
      gl = null;
      map = null;
    },

    setPoints(next: SatPoint[]) {
      previousPoints = points;
      points = next;
      pointTransitionStartedAt = performance.now();
      transitioningPoints = previousPoints.length === points.length && points.length > 0;
      dirty = true;
      map?.triggerRepaint();
    },

    updatePoint(index: number, point: SatPoint) {
      if (index < 0 || index >= points.length) return;
      points[index] = point;
      if (index < previousPoints.length) previousPoints[index] = point;
      if (dirty || !gl || !buffer || index >= count) {
        dirty = true;
      } else {
        const previous = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, index * 7 * Float32Array.BYTES_PER_ELEMENT, packVertices([point], exaggeration));
        gl.bindBuffer(gl.ARRAY_BUFFER, previous);
      }
      map?.triggerRepaint();
    },

    setExaggeration(value: number) {
      exaggeration = value;
      dirty = true;
      orbitDirty = true;
      map?.triggerRepaint();
    },

    setSelected(index: number | null) {
      selected = index ?? -1;
      map?.triggerRepaint();
    },

    setFocusOnly(enabled: boolean) {
      focusOnly = enabled;
      map?.triggerRepaint();
    },

    setOrbit(segments, color) {
      orbitSegments = segments;
      if (color !== undefined) orbitColor = color;
      orbitDirty = true;
      map?.triggerRepaint();
    },

    setCone(segments, color) {
      coneSegments = segments;
      if (color !== undefined) coneColor = color;
      coneDirty = true;
      map?.triggerRepaint();
    },

    /**
     * Renders the satellites into an offscreen buffer with each instance
     * coloured by its index, then reads back the pixels around (x, y).
     *
     * Coordinates are CSS pixels, as an event reports them; the draw buffer
     * may be larger on a scaled display, so they are converted first.
     */
    pick(x: number, y: number): number | null {
      if (!gl || !activeShader || !buffer || !lastProjection || count === 0) return null;
      if (gl.isContextLost()) return null;
      try { pickProgram = programs.get(activeShader, 'pick'); }
      catch (error) { console.warn('[L&T] Satellite picking unavailable:', error); return null; }
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      ensurePickTargets(w, h);
      if (!pickFbo) return null;

      const canvas = gl.canvas as HTMLCanvasElement;
      const ratioX = w / canvas.clientWidth;
      const ratioY = h / canvas.clientHeight;
      const px = Math.floor(x * ratioX);
      const py = h - 1 - Math.floor(y * ratioY);
      if (px < 0 || px >= w || py < 0 || py >= h) return null;

      const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;

      if (!previousViewport || previousViewport.length < 4) return null;
      const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const prevArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      const prevClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
      const prevColorMask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
      const wasBlend = gl.isEnabled(gl.BLEND);
      const wasDepth = gl.isEnabled(gl.DEPTH_TEST);
      const wasScissor = gl.isEnabled(gl.SCISSOR_TEST);
      const wasDither = gl.isEnabled(gl.DITHER);
      const wasCull = gl.isEnabled(gl.CULL_FACE);
      let best: number | null = null;
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
        if (!pickVao) pickVao = gl.createVertexArray();
        gl.bindVertexArray(pickVao);
        gl.viewport(0, 0, w, h);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.DITHER);
        gl.disable(gl.CULL_FACE);
        gl.colorMask(true, true, true, true);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.BLEND);
        // No globe in this buffer to occlude against, so depth testing here
        // would only let satellites hide each other. Nearest-to-cursor wins.
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(pickProgram);
        setProjectionUniforms(pickProgram, lastProjection);
        gl.uniform2f(gl.getUniformLocation(pickProgram, 'u_viewport'), w, h);
        const cornerLoc = bindAttributes(pickProgram);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
        clearDivisors(pickProgram, cornerLoc);

        // Read a small box, not one pixel: a click is never exact, and a marker
        // a few pixels across is otherwise unhittable.
        const R = 7;
        const x0 = Math.max(0, px - R), y0 = Math.max(0, py - R);
        const bw = Math.min(w - x0, R * 2 + 1), bh = Math.min(h - y0, R * 2 + 1);
        if (bw > 0 && bh > 0) {
          const buf = new Uint8Array(bw * bh * 4);
          gl.readPixels(x0, y0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          let bestDist = Infinity;
          for (let iy = 0; iy < bh; iy++) {
            for (let ix = 0; ix < bw; ix++) {
              const o = (iy * bw + ix) * 4;
              const id = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
              if (id === 0) continue;
              const dx = x0 + ix - px, dy = y0 + iy - py;
              const d = dx * dx + dy * dy;
              if (d < bestDist) { bestDist = d; best = id - 1; }
            }
          }
        }
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
        gl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3]);
        gl.useProgram(prevProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);
        gl.bindVertexArray(prevVao);
        gl.clearColor(prevClearColor[0], prevClearColor[1], prevClearColor[2], prevClearColor[3]);
        gl.colorMask(prevColorMask[0], prevColorMask[1], prevColorMask[2], prevColorMask[3]);
        if (wasBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
        if (wasDepth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        if (wasScissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
        if (wasDither) gl.enable(gl.DITHER); else gl.disable(gl.DITHER);
        if (wasCull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
      }
      if (focusOnly && best !== selected) return null;
      return best !== null && best >= 0 && best < count ? best : null;
    },
    render(_context: WebGL2RenderingContext | WebGLRenderingContext, args: CustomRenderMethodInput) {
      if (!gl || !buffer) return;
      // An inactive satellite layer must not compile three GPU programs on
      // startup or whenever the map switches between globe and flat views.
      if (!points.length) { count = 0; lastProjection = null; return; }
      /* Zoomed past the ceiling the layer draws nothing, and clearing the
         projection with it makes pick() answer null as well — so the click
         goes to whatever is actually on the ground there.

         `count` is left alone. It is how many satellites sit in the GPU
         buffer, and it is only set again when setPoints() marks the buffer
         dirty — so zeroing it here meant that after zooming in and back out
         the layer drew nothing until it was switched off and on again. */
      const shader = args?.shaderData;
      if (!shader?.vertexShaderPrelude) return;

      try {
        program = programs.get(shader, 'marker');
        orbitProgram = orbitSegments?.length ? programs.get(shader, 'orbit') : null;
        activeShader = shader;
      } catch (err) {
        console.error('[L&T] satellite layer:', err instanceof Error ? err.message : err);
        return;
      }
      if (!program) return;

      if (dirty) {
        vertices = packVertices(transitioningPoints ? previousPoints : points, exaggeration);
        count = points.length;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
        dirty = false;
      }
      if (transitioningPoints && count === points.length) {
        const progress = Math.min(1, Math.max(0, (performance.now() - pointTransitionStartedAt) / 100));
        const interpolated = points.map((target, index) => {
          const from = previousPoints[index] ?? target;
          return {
            lng: from.lng + (target.lng - from.lng) * progress,
            lat: from.lat + (target.lat - from.lat) * progress,
            altKm: from.altKm + (target.altKm - from.altKm) * progress,
            color: target.color,
            size: target.size,
          };
        });
        vertices = packVertices(interpolated, exaggeration);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
        if (progress >= 1) { previousPoints = points; transitioningPoints = false; }
        else map?.triggerRepaint();
      }
      if (count === 0) return;

      gl.useProgram(program);

      // MapLibre's prelude declares the projection uniforms but does not bind
      // them for a custom layer's own program — `defaultProjectionData` is
      // where the values come from, and every one has to be set. Without them
      // projectTile() reads zeroed uniforms and every vertex lands off-screen:
      // the draw succeeds, GL reports no error, and nothing appears.
      const proj = args.defaultProjectionData;
      lastProjection = proj ?? lastProjection;
      if (proj) setProjectionUniforms(program, proj);

      // The track first, so the marker draws over its own line.
      if (orbitDirty && orbitProgram) {
        for (const o of orbitBuffers) gl.deleteBuffer(o.buf);
        orbitBuffers = (orbitSegments ?? []).filter(seg => seg.length > 1).map(seg => {
          const data = packOrbit(seg, exaggeration);
          const buf = gl!.createBuffer()!;
          gl!.bindBuffer(gl!.ARRAY_BUFFER, buf);
          gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW);
          return { buf, count: seg.length };
        });
        orbitDirty = false;
      }
      if (coneDirty && orbitProgram) {
        for (const c of coneBuffers) gl.deleteBuffer(c.buf);
        coneBuffers = (coneSegments ?? []).filter(seg => seg.length > 1).map(seg => {
          const data = packOrbit(seg, exaggeration);
          const buf = gl!.createBuffer()!;
          gl!.bindBuffer(gl!.ARRAY_BUFFER, buf);
          gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW);
          return { buf, count: seg.length };
        });
        coneDirty = false;
      }
      if (orbitProgram && (orbitBuffers.length || coneBuffers.length) && proj) {
        gl.useProgram(orbitProgram);
        setProjectionUniforms(orbitProgram, proj);
        const loc = gl.getAttribLocation(orbitProgram, 'a_pos');
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        // Respect globe depth so the far-side orbit stays behind the Earth.
        const depthTestWasEnabled = gl.isEnabled(gl.DEPTH_TEST);
        if (depthTestWasEnabled) gl.enable(gl.DEPTH_TEST);
        
        if (orbitBuffers.length) {
          gl.uniform3f(gl.getUniformLocation(orbitProgram, 'u_color'),
            ((orbitColor >> 16) & 0xff) / 255, ((orbitColor >> 8) & 0xff) / 255, (orbitColor & 0xff) / 255);
          for (const o of orbitBuffers) {
            gl.bindBuffer(gl.ARRAY_BUFFER, o.buf);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(loc, 0);
            gl.drawArrays(gl.LINE_STRIP, 0, o.count);
          }
        }

        if (coneBuffers.length) {
          gl.uniform3f(gl.getUniformLocation(orbitProgram, 'u_color'),
            ((coneColor >> 16) & 0xff) / 255, ((coneColor >> 8) & 0xff) / 255, (coneColor & 0xff) / 255);
          for (const c of coneBuffers) {
            gl.bindBuffer(gl.ARRAY_BUFFER, c.buf);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(loc, 0);
            gl.drawArrays(gl.LINE_STRIP, 0, c.count);
          }
        }

        gl.depthMask(true);
        if (depthTestWasEnabled) gl.enable(gl.DEPTH_TEST);
        gl.useProgram(program);
        setProjectionUniforms(program, proj);
      }

      const cornerLoc = bindAttributes(program);
      gl.uniform2f(gl.getUniformLocation(program, 'u_viewport'), gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1i(gl.getUniformLocation(program, 'u_selected'), selected);
      gl.uniform1i(gl.getUniformLocation(program, 'u_focus_only'), focusOnly ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, 'u_time'), performance.now() / 1000.0);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      gl.depthMask(true);
      clearDivisors(program, cornerLoc);


    },
  };
}
