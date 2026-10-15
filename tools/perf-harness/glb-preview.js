// In-page helper (served by Vite) for the export experiments: re-imports an
// exported GLB with GLTFLoader and renders it alone with a neutral PBR setup.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export async function renderGlbPreview(renderer, base64, { aspect = 16 / 9, views = [1] } = {}) {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bin.buffer, '');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe6e2dc);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 1.4, 0.6);
  scene.add(sun, gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  const urls = [];
  const prevTone = renderer.toneMapping;
  const prevTarget = renderer.getRenderTarget();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  for (const k of views) {
    const cam = new THREE.PerspectiveCamera(35, aspect, size * 0.005, size * 10);
    cam.position.copy(center).add(new THREE.Vector3(0.75, 0.5, 0.9).normalize().multiplyScalar(size * 1.05 * k));
    cam.lookAt(center);
    renderer.setRenderTarget(null);
    renderer.render(scene, cam);
    urls.push(renderer.domElement.toDataURL('image/png'));
  }
  renderer.toneMapping = prevTone;
  renderer.setRenderTarget(prevTarget);
  pmrem.dispose();
  return urls;
}
