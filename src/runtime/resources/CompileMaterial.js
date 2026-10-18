import * as THREE from 'three';
import { validatePrograms, programHealthError } from '../../engine/render/ProgramHealthGate.js';

export async function compileMaterial(renderer, material, camera, probe = null) {
  const geometry = probe?.geometry ?? new THREE.PlaneGeometry(2, 2);
  const mesh = probe?.mesh ?? new THREE.Mesh(geometry, material);
  const scene = new THREE.Scene();
  scene.add(mesh);
  try {
    await renderer.compileAsync(scene, camera);
    const health = await validatePrograms({ renderer, materials: [material] });
    if (!health.ok) throw programHealthError(health);
  } finally {
    geometry.dispose();
  }
}
