import * as THREE from 'three';
import { createMiniWaterCutMaterial } from './MiniWaterMaterial.js';

// ============================================================================
// MiniWaterCut — the four vertical faces that make the diorama's water read as
// a cleanly cut volume.
//
// Geometry: four quads just inside the footprint (inset by `inset`), from the
// section base up to the water level, facing outward (FrontSide). Below the
// local terrain edge the opaque section wall is in front of them (the wall is
// the terrain's own perimeter skirt at exactly ±half), so they only show where
// the terrain edge sits under the water line — the vertical domain starts at
// the visible sediment and ends at the water level. Dry edges stay opaque.
//
// Shading (MiniWaterMaterial, single pass, same colour model as the surface):
//   * the optical path L is the distance from the entry point on the face to
//     the first of: the volume's exit (top / far side / base) or the terrain
//     behind (scene depth). Side views therefore never reuse the top view's
//     vertical-depth opacity.
//   * with the Volumetric/Cinematic water-free scene capture bound, the face
//     composes the background itself (bg·T + inscatter·(1−T)) and is written
//     opaque — no double alpha blending with the surface behind it;
//   * without a capture (Realistic/Legacy), it outputs premultiplied
//     inscatter with alpha 1−T over the already-drawn terrain, using the box
//     exit as the path (the section base caps it).
//
// Pass order (documented contract):
//   opaque terrain/props/backdrop → [capture: scene colour+depth without any
//   water] → water surface (transparent, renderOrder 10) → cut faces
//   (transparent, renderOrder 11). From any outside camera the convex volume is
//   entered exactly once, so the cut face is always the nearest water layer of
//   its pixel; drawing it after the surface is therefore correct by
//   construction, not by a global renderOrder tweak. depthTest on, depthWrite
//   off; the opaque section wall depth-occludes the faces below the terrain.
// ============================================================================

export function buildMiniWaterCutGeometry(half, bottom, top, inset = 0.5) {
  const h = Math.max(1, half - inset);
  const y0 = bottom;
  const y1 = Math.max(top, bottom + 0.01);
  // Each face: 4 vertices, CCW when seen from outside (outward normal).
  const faces = [
    { n: [0, 0, 1], v: [[-h, y0, h], [h, y0, h], [h, y1, h], [-h, y1, h]] },
    { n: [1, 0, 0], v: [[h, y0, h], [h, y0, -h], [h, y1, -h], [h, y1, h]] },
    { n: [0, 0, -1], v: [[h, y0, -h], [-h, y0, -h], [-h, y1, -h], [h, y1, -h]] },
    { n: [-1, 0, 0], v: [[-h, y0, -h], [-h, y0, h], [-h, y1, h], [-h, y1, -h]] },
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((face, i) => {
    for (const v of face.v) {
      positions.push(...v);
      normals.push(...face.n);
    }
    const o = i * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

export class MiniWaterCut {
  constructor(sharedUniforms) {
    this.material = createMiniWaterCutMaterial(sharedUniforms);
    this.mesh = new THREE.Mesh(buildMiniWaterCutGeometry(512, -70, 70), this.material);
    this.mesh.name = 'mini-water-cut';
    this.mesh.renderOrder = 11;   // after the water surface (renderOrder 10)
    this.mesh.frustumCulled = true;
    this.mesh.visible = false;
    this._key = '';
  }

  /** Update the box (half-width, section base, water level). */
  setBounds({ half, bottom, top, inset }) {
    const key = `${half}:${bottom}:${top}:${inset}`;
    this.material.uniforms.uCutHalf.value = half - inset;
    this.material.uniforms.uCutBottom.value = bottom;
    if (key === this._key) return;
    this._key = key;
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildMiniWaterCutGeometry(half, bottom, top, inset);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
