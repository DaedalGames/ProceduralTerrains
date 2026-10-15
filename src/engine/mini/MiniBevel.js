// Project square corners onto a 45-degree chamfer. The height field stays in
// world coordinates; only the presentation mesh's footprint changes.
export function miniBevelPoint(x, z, half, bevel = 0, rounded = false) {
  if (rounded && bevel > 0) {
    const center = half - bevel;
    const qx = Math.max(Math.abs(x) - center, 0);
    const qz = Math.max(Math.abs(z) - center, 0);
    const length = Math.hypot(qx, qz);
    if (length > bevel) return [
      Math.sign(x) * (Math.min(Math.abs(x), center) + qx * bevel / length),
      Math.sign(z) * (Math.min(Math.abs(z), center) + qz * bevel / length),
    ];
    return [x, z];
  }
  const cut = Math.max(0, Math.abs(x) + Math.abs(z) - (2 * half - bevel)) * 0.5;
  return [x - Math.sign(x) * cut, z - Math.sign(z) * cut];
}

export function miniFootprint(half, bevel = 0, rounded = false) {
  const b = Math.min(half, Math.max(0, bevel));
  if (b === 0) return [[-half, half], [half, half], [half, -half], [-half, -half]];
  if (rounded) {
    const c = half - b;
    const centers = [[c, c], [c, -c], [-c, -c], [-c, c]];
    return centers.flatMap(([x, z], corner) => Array.from({ length: 17 }, (_, step) => {
      const angle = Math.PI * 0.5 - corner * Math.PI * 0.5 - step * Math.PI / 32;
      return [x + Math.cos(angle) * b, z + Math.sin(angle) * b];
    }));
  }
  return [
    [-half + b, half], [half - b, half], [half, half - b], [half, -half + b],
    [half - b, -half], [-half + b, -half], [-half, -half + b], [-half, half - b],
  ];
}

export function sampleMiniHeight(at, res, half, x, z) {
  const i = Math.max(0, Math.min(res, (x / (2 * half) + 0.5) * res));
  const j = Math.max(0, Math.min(res, (z / (2 * half) + 0.5) * res));
  const i0 = Math.floor(i); const j0 = Math.floor(j);
  const i1 = Math.min(res, i0 + 1); const j1 = Math.min(res, j0 + 1);
  const a = at(i0, j0) * (1 - (i - i0)) + at(i1, j0) * (i - i0);
  const b = at(i0, j1) * (1 - (i - i0)) + at(i1, j1) * (i - i0);
  return a * (1 - (j - j0)) + b * (j - j0);
}

export const MINI_BEVEL_GLSL = /* glsl */ `
float miniBevelDistance(vec2 p, float halfWidth, float bevel, float rounded) {
  if (rounded > 0.5 && bevel > 0.0) {
    vec2 q = abs(p) - (halfWidth - bevel);
    return bevel - length(max(q, 0.0)) - min(max(q.x, q.y), 0.0);
  }
  return min(halfWidth - max(abs(p.x), abs(p.y)),
    (2.0 * halfWidth - bevel - abs(p.x) - abs(p.y)) * 0.70710678);
}
vec2 miniBevelPoint(vec2 p, float halfWidth, float bevel, float rounded) {
  if (rounded > 0.5 && bevel > 0.0) {
    vec2 center = vec2(halfWidth - bevel);
    vec2 q = max(abs(p) - center, 0.0);
    float len = length(q);
    if (len > bevel) return sign(p) * (min(abs(p), center) + q * (bevel / len));
    return p;
  }
  float cut = max(0.0, abs(p.x) + abs(p.y) - (2.0 * halfWidth - bevel)) * 0.5;
  return p - sign(p) * cut;
}
`;
