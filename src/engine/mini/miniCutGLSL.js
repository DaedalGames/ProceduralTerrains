// ============================================================================
// Mini Terrain section walls — stylised strata for the opaque cut.
//
// The cut wall IS the terrain's own outer perimeter skirt (see TerrainMaterial
// vertex: outer skirt vertices drop to uPlinthBaseY), so its top edge follows
// the rendered surface exactly at every resolution. This block only colours
// it: a dark topsoil band under the local surface (sandy sediment where the
// surface is submerged), soft undulating strata by height, a deep base, and a
// face-normal key light. No per-stratum geometry, no textures, no loops.
//
// uMiniCut = 0 keeps the legacy flat plinth colour for every other mode.
// ============================================================================

export const MINI_CUT_GLSL = /* glsl */ `
uniform float uMiniCut;
uniform vec3  uMiniCutTopsoil;
uniform vec3  uMiniCutBandA;
uniform vec3  uMiniCutBandB;
uniform vec3  uMiniCutDeep;
uniform vec3  uMiniCutSediment;
uniform vec4  uMiniCutParams;   // bands, base Y, topsoil depth, relief height

float miniCutHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float miniCutNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = miniCutHash(i);
  float b = miniCutHash(i + vec2(1.0, 0.0));
  float c = miniCutHash(i + vec2(0.0, 1.0));
  float d = miniCutHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Linear colour of the cut at world position wp under a surface of height rimH.
vec3 miniCutAlbedo(vec3 wp, float rimH, float seaLevel) {
  bool xFace = abs(wp.x) > abs(wp.z);
  float along = xFace ? wp.z : wp.x;
  float baseY = uMiniCutParams.y;
  float reliefH = max(uMiniCutParams.w, 1.0);
  float t = clamp((wp.y - baseY) / (reliefH * 1.15), 0.0, 1.0);

  // gently undulating strata: low-frequency warp along the face
  float warp = (miniCutNoise(vec2(along * 0.010, 3.7)) - 0.5) * 0.9
             + sin(along * 0.0055 + 1.3) * 0.30;
  float band = fract(t * uMiniCutParams.x + warp * 0.22);
  float stripe = smoothstep(0.30, 0.46, band) - smoothstep(0.80, 0.97, band);
  vec3 col = mix(uMiniCutBandA, uMiniCutBandB, stripe);
  // thin darker seams between layers
  col *= 1.0 - 0.10 * (smoothstep(0.92, 1.0, band) + smoothstep(0.08, 0.0, band));
  col = mix(uMiniCutDeep, col, smoothstep(0.02, 0.32, t));

  // topsoil under land, sandy sediment under water
  float below = rimH - wp.y;
  float submerged = smoothstep(seaLevel + 1.5, seaLevel - 3.0, rimH);
  vec3 top = mix(uMiniCutTopsoil, uMiniCutSediment, submerged);
  float topDepth = uMiniCutParams.z * (0.75 + 0.5 * miniCutNoise(vec2(along * 0.03, 9.1)));
  col = mix(col, top, 1.0 - smoothstep(topDepth * 0.55, topDepth, below));

  // fine grain so large faces never read as flat plastic
  col *= 0.93 + 0.12 * miniCutNoise(vec2(along * 0.22, wp.y * 0.30));
  return col;
}

// Final display colour (manual gamma, matching the terrain output).
vec3 miniCutShade(vec3 wp, float rimH, float seaLevel, vec3 sunDir) {
  vec3 albedo = miniCutAlbedo(wp, rimH, seaLevel);
  vec3 n = abs(wp.x) > abs(wp.z) ? vec3(sign(wp.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(wp.z));
  float ndl = max(dot(n, normalize(sunDir)), 0.0);
  // soft ambient with a slight sky/ground split + key light
  float ambient = 0.46 + 0.08 * clamp((wp.y - uMiniCutParams.y) / max(uMiniCutParams.w, 1.0), 0.0, 1.0);
  vec3 lit = albedo * (ambient + 0.72 * ndl);
  return pow(max(lit, vec3(0.0)), vec3(1.0 / 2.2));
}
`;

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Linear RGB triplet for a stored sRGB [0..1] colour. */
export function miniCutColor(rgb) {
  return rgb.map((c) => srgbToLinear(Math.max(0, Math.min(1, c))));
}
