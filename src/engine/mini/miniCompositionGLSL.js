// ============================================================================
// Mini Terrain composition — the analytic macro silhouette of a diorama.
//
// Injected into shapeHeight() right after the stack is finalized (h01 space),
// so the procedural noise stack becomes the DETAIL layer laid over a composed
// dominant shape (cove / islet / mountain lake). Pure function of world XZ and
// uniforms: no textures, no loops, no camera dependence — FXC-friendly and
// deterministic for a seed.
//
// miniComposeCPU() is its JS twin (same expressions, f32-rounded like
// TerrainHeightSampler) so picking, shoreline data and prop placement land on
// the very surface the GPU draws.
//
// uMiniShape: 0 = off (every other mode/projects: no effect), 1 = cove,
// 2 = islet, 3 = mountain lake.
// ============================================================================

export const MINI_COMPOSITION_UNIFORMS_GLSL = /* glsl */ `
uniform float uMiniShape;
uniform vec4  uMiniFrame;     // front dir (x,z), centre (x,z) in footprint units
uniform vec4  uMiniGeometry;  // recipe radii / widths / angles
uniform vec4  uMiniHeights;   // land, depth, beach, peak (h01)
uniform vec4  uMiniWobble;    // harmonic phases (xyz), amplitude (w)
uniform vec4  uMiniDetail;    // detail land, detail sea, terrace steps, terrace strength
`;

export const MINI_COMPOSITION_GLSL = /* glsl */ `
// Local frame: x = lateral, y = toward the front (opening / initial camera).
vec2 miniLocal(vec2 xz) {
  vec2 p = xz / max(uBoardHalf, 1.0) - uMiniFrame.zw;
  vec2 f = uMiniFrame.xy;
  return vec2(p.x * f.y - p.y * f.x, p.x * f.x + p.y * f.y);
}

float miniWobble(float a) {
  return 1.0 + uMiniWobble.w * (0.55 * sin(a + uMiniWobble.x)
    + 0.30 * sin(2.0 * a + uMiniWobble.y)
    + 0.15 * sin(3.0 * a + uMiniWobble.z));
}

float miniTerrace(float h, float steps) {
  float t = h * steps;
  float s = smoothstep(0.18, 0.82, fract(t));
  return (floor(t) + s) / steps;
}

// Cove: sheltered bowl inside a horseshoe of cliffs that opens toward the front.
// jag (from the detail stack) roughens every boundary so cliffs never read as
// lathe-turned cylinders.
float miniCove(vec2 q, float sea, float jag) {
  float r = length(q);
  float a = atan(q.x, q.y);
  float R = uMiniGeometry.x * miniWobble(a) + jag;
  float T = uMiniGeometry.y;
  float cw = uMiniGeometry.w;
  float bowl = 1.0 - smoothstep(R - cw, R + cw, r);
  float ring = 1.0 - smoothstep(R + T - cw * 2.0, R + T + cw * 2.0, r);
  float back = 1.0 - smoothstep(-0.35, 0.25, q.y);
  float land = max(ring, back);
  float open = 1.0 - smoothstep(uMiniGeometry.z - 0.10, uMiniGeometry.z + 0.10, abs(a));
  open *= smoothstep(-0.05, 0.25, q.y);
  land *= (1.0 - open) * (1.0 - bowl);

  float floorH = sea - uMiniHeights.y * (0.55 + 0.45 * smoothstep(-0.2, 1.1, q.y));
  float bowlH = mix(sea + uMiniHeights.z, sea - uMiniHeights.y * 0.6,
                    smoothstep(-R * 0.9, R * 0.75, q.y));
  // arms taper toward the opening so the horseshoe reads, highest at the back
  float taper = mix(1.0, 0.58, smoothstep(-0.1, 0.9, q.y));
  float landH = sea + uMiniHeights.x * (0.86 + 0.14 * (1.0 - smoothstep(-1.0, 0.0, q.y))) * taper
              + uMiniHeights.w * (1.0 - smoothstep(-1.1, -0.2, q.y)) * (0.6 + 0.4 * abs(q.x));
  float wet = mix(floorH, bowlH, bowl);
  return mix(wet, landH, land);
}

// Islet: one readable land mass with a beach ring, a shallow shelf and a
// secondary summit behind the focal side.
float miniIslet(vec2 q, float sea, float jag) {
  float r = length(q);
  float a = atan(q.x, q.y);
  float R = uMiniGeometry.x * miniWobble(a) + jag;
  float s = R - r;
  float cw = uMiniGeometry.w;
  // convex dome: steep wooded flanks, rounded summit (not a cone)
  float inner = smoothstep(0.0, R * 0.8, s);
  float dome = 1.0 - (1.0 - inner) * (1.0 - inner);
  float hLand = sea + uMiniHeights.z + uMiniHeights.x * dome;
  float hSea = sea - 0.02 - uMiniHeights.y * smoothstep(0.0, uMiniGeometry.y * 0.6, -s);
  float h = mix(hSea, hLand, smoothstep(-cw, cw, s));
  vec2 c2 = vec2(-0.45, -0.89) * (uMiniGeometry.z * R);
  vec2 d2 = q - c2;
  h += uMiniHeights.w * exp(-dot(d2, d2) / max(R * R * 0.10, 1e-4)) * smoothstep(0.0, cw * 2.0, s);
  return h;
}

// Mountain lake: a basin below the water line, framed by a range that rises
// toward the back and the sides.
float miniLake(vec2 q, float sea, float jag) {
  float r = length(q);
  float a = atan(q.x, q.y);
  float R = uMiniGeometry.x * miniWobble(a) + jag;
  float s = R - r;
  float cw = uMiniGeometry.w;
  float basin = smoothstep(-cw, cw, s);
  float hLake = sea - 0.015 - uMiniHeights.y * smoothstep(0.0, R * 0.7, s);
  float rise = smoothstep(0.0, uMiniGeometry.y, -s);
  float range = (1.0 - smoothstep(-uMiniGeometry.z, -0.05, q.y)) * (0.55 + 0.45 * smoothstep(0.2, 0.9, abs(q.x)))
              + 0.35 * smoothstep(0.55, 1.0, abs(q.x));
  float front = mix(1.0, 0.3, smoothstep(0.15, 0.95, q.y));
  float hLand = sea + uMiniHeights.z + (uMiniHeights.x * front + uMiniHeights.w * range) * rise;
  return mix(hLand, hLake, basin);
}

// Compose the Mini macro shape with the finalized stack height (h01).
float miniCompose(vec2 xz, float stackH01) {
  float sea = uTerrainFormationSeaLevel / max(uHeightScale, 1.0);
  vec2 q = miniLocal(xz);
  float jag = (stackH01 - 0.25) * 0.5;
  float m;
  if (uMiniShape < 1.5) m = miniCove(q, sea, jag);
  else if (uMiniShape < 2.5) m = miniIslet(q, sea, jag);
  else m = miniLake(q, sea, jag);
  // the stack is the detail layer: calm under water, livelier on land
  float H = max(uMiniHeights.x, 1e-4);
  float landMask = smoothstep(sea, sea + 0.12 * H, m);
  m += (stackH01 - 0.25) * mix(uMiniDetail.y, uMiniDetail.x, landMask);
  if (uMiniDetail.w > 0.0 && uMiniDetail.z > 0.5) {
    float cliff = smoothstep(sea + 0.08 * H, sea + 0.3 * H, m);
    m = mix(m, miniTerrace(m, uMiniDetail.z), uMiniDetail.w * cliff);
  }
  return max(m, 0.0);
}
`;

// ----------------------------------------------------------------------------
// CPU twin
// ----------------------------------------------------------------------------

const f = Math.fround;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function smoothstep(e0, e1, x) {
  const t = clamp(f(f(x - e0) / f(e1 - e0)), 0, 1);
  return f(f(t * t) * f(3 - f(2 * t)));
}
const mix = (a, b, t) => f(a + f(f(b - a) * t));
const fract = (v) => f(v - Math.floor(v));

function vec4Of(uniform) {
  const v = uniform?.value;
  if (!v) return [0, 0, 0, 0];
  if (Array.isArray(v)) return v;
  return [v.x ?? 0, v.y ?? 0, v.z ?? 0, v.w ?? 0];
}

function readMini(u) {
  return {
    shape: Number(u.uMiniShape?.value ?? 0),
    frame: vec4Of(u.uMiniFrame),
    geometry: vec4Of(u.uMiniGeometry),
    heights: vec4Of(u.uMiniHeights),
    wobble: vec4Of(u.uMiniWobble),
    detail: vec4Of(u.uMiniDetail),
  };
}

function wobble(M, a) {
  const [p1, p2, p3, amp] = M.wobble;
  return f(1 + f(amp * f(f(0.55 * Math.sin(a + p1)) + f(0.30 * Math.sin(2 * a + p2)) + f(0.15 * Math.sin(3 * a + p3)))));
}

function terraceMini(h, steps) {
  const t = f(h * steps);
  const s = smoothstep(0.18, 0.82, fract(t));
  return f(f(Math.floor(t) + s) / steps);
}

function cove(M, qx, qy, sea, jag) {
  const r = f(Math.hypot(qx, qy));
  const a = Math.atan2(qx, qy);
  const [g0, g1, g2, cw] = M.geometry;
  const [hl, hd, hb, hp] = M.heights;
  const R = f(f(g0 * wobble(M, a)) + jag);
  const T = g1;
  const bowl = f(1 - smoothstep(R - cw, R + cw, r));
  const ring = f(1 - smoothstep(R + T - cw * 2, R + T + cw * 2, r));
  const back = smoothstep(0.25, -0.35, qy);
  let land = Math.max(ring, back);
  let open = f(1 - smoothstep(g2 - 0.10, g2 + 0.10, Math.abs(a)));
  open = f(open * smoothstep(-0.05, 0.25, qy));
  land = f(f(land * f(1 - open)) * f(1 - bowl));
  const floorH = f(sea - f(hd * f(0.55 + f(0.45 * smoothstep(-0.2, 1.1, qy)))));
  const bowlH = mix(f(sea + hb), f(sea - f(hd * 0.6)), smoothstep(f(-R * 0.9), f(R * 0.75), qy));
  const taper = mix(1.0, 0.58, smoothstep(-0.1, 0.9, qy));
  const landH = f(f(sea + f(f(hl * f(0.86 + f(0.14 * smoothstep(0, -1, qy)))) * taper))
    + f(f(hp * smoothstep(-0.2, -1.1, qy)) * f(0.6 + f(0.4 * Math.abs(qx)))));
  const wet = mix(floorH, bowlH, bowl);
  return mix(wet, landH, land);
}

function islet(M, qx, qy, sea, jag) {
  const r = f(Math.hypot(qx, qy));
  const a = Math.atan2(qx, qy);
  const [g0, g1, g2, cw] = M.geometry;
  const [hl, hd, hb, hp] = M.heights;
  const R = f(f(g0 * wobble(M, a)) + jag);
  const s = f(R - r);
  const inner = smoothstep(0, f(R * 0.8), s);
  const dome = f(1 - f(f(1 - inner) * f(1 - inner)));
  const hLand = f(f(sea + hb) + f(hl * dome));
  const hSea = f(f(sea - 0.02) - f(hd * smoothstep(0, f(g1 * 0.6), -s)));
  let h = mix(hSea, hLand, smoothstep(-cw, cw, s));
  const c2x = f(-0.45 * f(g2 * R));
  const c2y = f(-0.89 * f(g2 * R));
  const dx = f(qx - c2x);
  const dy = f(qy - c2y);
  const d2 = f(f(dx * dx) + f(dy * dy));
  h = f(h + f(f(hp * f(Math.exp(-d2 / Math.max(f(f(R * R) * 0.10), 1e-4)))) * smoothstep(0, f(cw * 2), s)));
  return h;
}

function lake(M, qx, qy, sea, jag) {
  const r = f(Math.hypot(qx, qy));
  const a = Math.atan2(qx, qy);
  const [g0, g1, g2, cw] = M.geometry;
  const [hl, hd, hb, hp] = M.heights;
  const R = f(f(g0 * wobble(M, a)) + jag);
  const s = f(R - r);
  const basin = smoothstep(-cw, cw, s);
  const hLake = f(f(sea - 0.015) - f(hd * smoothstep(0, f(R * 0.7), s)));
  const rise = smoothstep(0, g1, -s);
  const range = f(f(smoothstep(-0.05, -g2, qy) * f(0.55 + f(0.45 * smoothstep(0.2, 0.9, Math.abs(qx)))))
    + f(0.35 * smoothstep(0.55, 1.0, Math.abs(qx))));
  const front = mix(1.0, 0.3, smoothstep(0.15, 0.95, qy));
  const hLand = f(f(sea + hb) + f(f(f(hl * front) + f(hp * range)) * rise));
  return mix(hLand, hLake, basin);
}

/**
 * JS twin of miniCompose(). `u` is the live shared uniforms object.
 * Returns the composed h01 (or stackH01 untouched when Mini is off).
 */
export function miniComposeCPU(u, x, z, stackH01) {
  const M = readMini(u);
  if (!(M.shape > 0.5)) return stackH01;
  if ((u.uInfiniteMode?.value ?? 0) > 0.5) return stackH01;
  const half = Math.max(f(u.uBoardHalf?.value ?? 1), 1);
  const sea = f(f(u.uTerrainFormationSeaLevel?.value ?? 0) / Math.max(f(u.uHeightScale?.value ?? 1), 1));
  const px = f(f(f(x) / half) - M.frame[2]);
  const py = f(f(f(z) / half) - M.frame[3]);
  const fx = M.frame[0];
  const fy = M.frame[1];
  const qx = f(f(px * fy) - f(py * fx));
  const qy = f(f(px * fx) + f(py * fy));
  const jag = f(f(stackH01 - 0.25) * 0.5);
  let m = M.shape < 1.5 ? cove(M, qx, qy, sea, jag)
    : M.shape < 2.5 ? islet(M, qx, qy, sea, jag)
      : lake(M, qx, qy, sea, jag);
  const [dLand, dSea, steps, strength] = M.detail;
  const H = Math.max(M.heights[0], 1e-4);
  const landMask = smoothstep(sea, f(sea + f(0.12 * H)), m);
  m = f(m + f(f(stackH01 - 0.25) * mix(dSea, dLand, landMask)));
  if (strength > 0 && steps > 0.5) {
    const cliff = smoothstep(f(sea + f(0.08 * H)), f(sea + f(0.3 * H)), m);
    m = mix(m, terraceMini(m, steps), f(strength * cliff));
  }
  return Math.max(m, 0);
}
