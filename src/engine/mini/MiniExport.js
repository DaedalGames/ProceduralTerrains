import * as THREE from 'three';
import { miniFootprint, sampleMiniHeight } from './MiniBevel.js';

// ============================================================================
// Mini Terrain export geometry — what a diorama looks like outside the app.
//
//   * section walls: the cut-away sides from the surface rim down to the
//     section base, with the live strata (miniCutGLSL) baked as vertex colours
//     on a vertically subdivided strip, plus the bottom face;
//   * water volume : the water BLOCK, not a plane — the surface at the water
//     level plus the four cut faces, each limited to the real water column
//     (rim → water level), so it never overlaps the opaque walls. Physical
//     material with glTF transmission / volume (KHR_materials_transmission,
//     _volume, _ior) tinted with the diorama water colours;
//   * socle        : the pedestal under the section base.
//
// `at(i, j)` is the exporter's height grid ((res + 1)^2 vertices over the
// footprint, i along +x, j along +z, centred on the origin).
// ============================================================================

// --- CPU twin of miniCutAlbedo (colours are linear RGB triplets) ----------

function cutHash(x, y) {
  let p3x = (x * 0.1031) % 1; let p3y = (y * 0.1031) % 1; let p3z = (x * 0.1031) % 1;
  if (p3x < 0) p3x += 1; if (p3y < 0) p3y += 1; if (p3z < 0) p3z += 1;
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d; p3y += d; p3z += d;
  const v = ((p3x + p3y) * p3z) % 1;
  return v < 0 ? v + 1 : v;
}

function cutNoise(x, y) {
  const ix = Math.floor(x); const iy = Math.floor(y);
  const fx = x - ix; const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx); const uy = fy * fy * (3 - 2 * fy);
  const a = cutHash(ix, iy); const b = cutHash(ix + 1, iy);
  const c = cutHash(ix, iy + 1); const d = cutHash(ix + 1, iy + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Linear albedo of the section wall at (along, y) under a rim of height rimH.
 * cut: { topsoil, bandA, bandB, deep, sediment, bands, baseY, topsoilDepth, reliefHeight }.
 */
export function miniCutAlbedoCPU(along, y, rimH, seaLevel, cut) {
  const reliefH = Math.max(cut.reliefHeight, 1);
  const t = Math.min(1, Math.max(0, (y - cut.baseY) / (reliefH * 1.15)));
  const warp = (cutNoise(along * 0.010, 3.7) - 0.5) * 0.9 + Math.sin(along * 0.0055 + 1.3) * 0.30;
  let band = (t * cut.bands + warp * 0.22) % 1;
  if (band < 0) band += 1;
  const stripe = smooth(0.30, 0.46, band) - smooth(0.80, 0.97, band);
  let col = mix3(cut.bandA, cut.bandB, stripe);
  const seam = 1 - 0.10 * (smooth(0.92, 1.0, band) + (1 - smooth(0.0, 0.08, band)));
  col = col.map((c) => c * seam);
  col = mix3(cut.deep, col, smooth(0.02, 0.32, t));
  const below = rimH - y;
  const submerged = 1 - smooth(seaLevel - 3.0, seaLevel + 1.5, rimH);
  const top = mix3(cut.topsoil, cut.sediment, submerged);
  const topDepth = cut.topsoilDepth * (0.75 + 0.5 * cutNoise(along * 0.03, 9.1));
  col = mix3(col, top, 1 - smooth(topDepth * 0.55, topDepth, below));
  const grain = 0.93 + 0.12 * cutNoise(along * 0.22, y * 0.30);
  return col.map((c) => c * grain);
}

// --- shared edge walk ------------------------------------------------------

// The four footprint edges as (vertex index -> grid i, j), the world position
// of a sample, the outward normal and the coordinate that runs along the face.
function footprintEdges(res, half, bevel = 0, rounded = false) {
  if (bevel > 0) {
    const ring = miniFootprint(half, bevel, rounded);
    return ring.map(([x, z], index) => {
      const [nx, nz] = ring[(index + 1) % ring.length];
      const normal = new THREE.Vector3(z - nz, 0, nx - x).normalize().toArray();
      const steps = Math.max(1, Math.ceil(Math.hypot(nx - x, nz - z) / (2 * half) * res));
      return { normal, steps, sample: (k) => {
        const px = x + (nx - x) * k / steps;
        const pz = z + (nz - z) * k / steps;
        return { i: (px / (2 * half) + 0.5) * res, j: (pz / (2 * half) + 0.5) * res,
          x: px, z: pz, along: Math.abs(normal[0]) > Math.abs(normal[2]) ? pz : px };
      } };
    });
  }
  const step = (2 * half) / res;
  const pos = (k) => -half + k * step;
  return [
    { normal: [0, 0, -1], sample: (k) => ({ i: k, j: 0, x: pos(k), z: -half, along: pos(k) }) },
    { normal: [0, 0, 1], sample: (k) => ({ i: res - k, j: res, x: pos(res - k), z: half, along: pos(res - k) }) },
    { normal: [-1, 0, 0], sample: (k) => ({ i: 0, j: res - k, x: -half, z: pos(res - k), along: pos(res - k) }) },
    { normal: [1, 0, 0], sample: (k) => ({ i: res, j: k, x: half, z: pos(k), along: pos(k) }) },
  ];
}

// Quad (a, b, c, d) as two triangles whose winding faces `normal`.
function pushQuad(indices, positions, a, b, c, d, normal) {
  const p = (n) => [positions[n * 3], positions[n * 3 + 1], positions[n * 3 + 2]];
  const [pa, pb, pc] = [p(a), p(b), p(c)];
  const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
  const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const facing = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2];
  if (facing >= 0) indices.push(a, b, c, a, c, d);
  else indices.push(a, c, b, a, d, c);
}

/**
 * Section walls + bottom with baked strata vertex colours.
 * @returns {THREE.BufferGeometry}
 */
export function buildMiniSectionWalls({ at, res, half, baseY, seaLevel, cut, rows = 40, bevel = 0, rounded = false }) {
  const positions = []; const normals = []; const colors = []; const indices = [];
  const cutSpec = { ...cut, baseY };
  for (const edge of footprintEdges(res, half, bevel, rounded)) {
    const steps = edge.steps ?? res;
    const first = positions.length / 3;
    for (let k = 0; k <= steps; k++) {
      const s = edge.sample(k);
      const rim = sampleMiniHeight(at, res, half, s.x, s.z);
      const top = Math.max(rim, baseY + 0.01);
      for (let r = 0; r <= rows; r++) {
        // denser rows under the rim, where the topsoil band and fine strata sit
        const f = (r / rows) ** 1.6;
        const y = top + (baseY - top) * f;
        positions.push(s.x, y, s.z);
        normals.push(...edge.normal);
        colors.push(...miniCutAlbedoCPU(s.along, y, rim, seaLevel, cutSpec));
      }
    }
    for (let k = 0; k < steps; k++) {
      for (let r = 0; r < rows; r++) {
        const a = first + k * (rows + 1) + r;
        const b = first + (k + 1) * (rows + 1) + r;
        pushQuad(indices, positions, a, b, b + 1, a + 1, edge.normal);
      }
    }
  }
  // bottom face (deep colour), facing down
  const b0 = positions.length / 3;
  const bottom = miniFootprint(half, bevel, rounded);
  for (const [x, z] of bottom) {
    positions.push(x, baseY, z);
    normals.push(0, -1, 0);
    colors.push(...cut.deep);
  }
  // The clockwise XZ ring faces up; reverse the bottom fan to face down.
  for (let i = 1; i < bottom.length - 1; i++) indices.push(b0, b0 + i + 1, b0 + i);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

export function createMiniWallMaterial() {
  return new THREE.MeshStandardMaterial({
    name: 'Mini_Section_Material', vertexColors: true, roughness: 0.92, metalness: 0,
  });
}

/**
 * The water block: surface + the four cut faces over the real water column.
 * @returns {THREE.BufferGeometry}
 */
export function buildMiniWaterVolume({ at, res, half, seaLevel, baseY, bevel = 0, rounded = false }) {
  const positions = []; const normals = []; const indices = [];
  // surface: one quad over the whole footprint (the opaque terrain hides it
  // wherever the land rises above the water)
  const s0 = 0;
  const ring = miniFootprint(half, bevel, rounded);
  for (const [x, z] of ring) {
    positions.push(x, seaLevel, z);
    normals.push(0, 1, 0);
  }
  for (let i = 1; i < ring.length - 1; i++) indices.push(s0, s0 + i, s0 + i + 1);
  // cut faces: from the rim (or the base) up to the water level, clamped so
  // dry stretches collapse to nothing and are dropped
  for (const edge of footprintEdges(res, half, bevel, rounded)) {
    const steps = edge.steps ?? res;
    const first = positions.length / 3;
    const bottoms = [];
    for (let k = 0; k <= steps; k++) {
      const s = edge.sample(k);
      const bottom = Math.min(seaLevel, Math.max(sampleMiniHeight(at, res, half, s.x, s.z), baseY));
      bottoms.push(bottom);
      positions.push(s.x, seaLevel, s.z, s.x, bottom, s.z);
      normals.push(...edge.normal, ...edge.normal);
    }
    for (let k = 0; k < steps; k++) {
      if (bottoms[k] >= seaLevel - 1e-4 && bottoms[k + 1] >= seaLevel - 1e-4) continue;
      const top0 = first + k * 2; const bot0 = top0 + 1;
      const top1 = first + (k + 1) * 2; const bot1 = top1 + 1;
      pushQuad(indices, positions, top0, top1, bot1, bot0, edge.normal);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Glass-like water for DCC tools and glTF viewers: transmission + volume
 * attenuation with the diorama colours (linear triplets), plus a plain
 * transparency fallback for formats without transmission (OBJ / MTL).
 */
export function createMiniWaterMaterial({ shallow, mid, deep, depthRange = 80 }) {
  const color = new THREE.Color().setRGB(...mix3(shallow, [1, 1, 1], 0.35));
  const attenuation = new THREE.Color().setRGB(...mix3(mid, deep, 0.35));
  return new THREE.MeshPhysicalMaterial({
    name: 'Water_Material',
    color,
    roughness: 0.04,
    metalness: 0,
    ior: 1.333,
    transmission: 0.95,
    thickness: Math.max(1, depthRange * 0.5),
    attenuationColor: attenuation,
    attenuationDistance: Math.max(1, depthRange * 0.8),
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
  });
}

/** Pedestal under the section base. color: linear triplet. */
export function buildMiniSocle({ half, margin, height, topY, color, circle = false }) {
  const size = 2 * (half + margin);
  const geo = circle
    ? new THREE.CylinderGeometry(size / 2, size / 2, height, 128, 1)
    : new THREE.BoxGeometry(size, height, size);
  geo.translate(0, topY - height / 2, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    name: 'Mini_Socle_Material', color: new THREE.Color().setRGB(...color), roughness: 0.8, metalness: 0,
  }));
  mesh.name = 'Mini_Socle';
  return mesh;
}
