import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTerrain } from 'procedural-terrains';

const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#16232b');
const camera = new THREE.PerspectiveCamera(50, 1, 1, 15000);
camera.position.set(1100, 1100, 1300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 140, 0);
controls.update();
const status = document.querySelector('#status');
const button = document.querySelector('#regenerate');
async function main() {
  let terrain;
  try {
    terrain = await createTerrain({ renderer });
    scene.add(terrain.object);
    await terrain.prepare(camera);
    button.disabled = false;
    const clock = new THREE.Clock();
    const resize = () => {
      renderer.setSize(innerWidth, innerHeight, false);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);
    renderer.setAnimationLoop(() => {
      controls.update();
      terrain.update(clock.getDelta(), { camera });
      renderer.render(scene, camera);
      const d = terrain.getDiagnostics();
      status.textContent = `Seed ${terrain.configuration.source.seed} · ${d.chunks} chunks · ${renderer.info.render.calls} draw calls`;
    });
    button.addEventListener('click', async () => {
      await terrain.configure({ source: { seed: (Math.random() * 0xffffffff) >>> 0 } });
    });
    window.addEventListener('pagehide', () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      terrain.dispose();
      controls.dispose();
      renderer.dispose();
    }, { once: true });
    return { terrain, renderer, scene, camera };
  } catch (error) {
    status.textContent = error.message;
    terrain?.dispose();
    controls.dispose();
    renderer.dispose();
    throw error;
  }
}
export const ready = main();
