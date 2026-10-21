import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTerrain } from '../FiniteTerrain.js';

/** Explicit DOM convenience adapter. Core imports never create DOM or a loop. */
export async function createTerrainViewer(container, { configuration, signal } = {}) {
  if (!container?.appendChild) throw new TypeError('A DOM container is required');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(50, 1, 1, 1e6);
  const controls = new OrbitControls(camera, renderer.domElement);
  let terrain, observer;
  try {
    terrain = await createTerrain({ renderer, configuration, signal });
    scene.add(terrain.object);
    const size = terrain.configuration.layout.chunkCount * terrain.configuration.layout.chunkSize;
    camera.position.set(size * 0.7, size * 0.7, size * 0.8);
    controls.target.y = terrain.configuration.heightScale * 0.3;
    controls.update();
    observer = new ResizeObserver(() => {
      const w = Math.max(1, container.clientWidth),
        h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    observer.observe(container);
    await terrain.prepare(camera, { signal });
    let last = performance.now(),
      disposed = false;
    renderer.setAnimationLoop((now) => {
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      controls.update();
      terrain.update(dt, { camera });
      renderer.render(scene, camera);
    });
    return {
      renderer,
      scene,
      camera,
      controls,
      terrain,
      dispose() {
        if (disposed) return;
        disposed = true;
        renderer.setAnimationLoop(null);
        observer.disconnect();
        controls.dispose();
        terrain.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      },
    };
  } catch (error) {
    observer?.disconnect();
    controls.dispose();
    terrain?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }
}
