// Complete ESM examples using the same public API as exported terrains.
const IMPORTS = `import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
`;
const SCENE = `
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
app.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101827);
const camera = new THREE.PerspectiveCamera(50, 1, 1, 200000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
function resize() {
  renderer.setSize(app.clientWidth, app.clientHeight);
  camera.aspect = app.clientWidth / Math.max(1, app.clientHeight);
  camera.updateProjectionMatrix();
}
const observer = new ResizeObserver(resize);
observer.observe(app);
resize();
`;
const LOOP = (pipeline = false) => `
controls.update();
await terrain.prepare(camera);
console.log('Terrain ready', terrain.mode, 'seed', terrain.configuration.source.seed);

let previous = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
  previous = now;
  controls.update();
  terrain.update(dt, { camera });
  ${pipeline ? 'pipeline.render(scene, camera);' : 'renderer.render(scene, camera);'}
});
addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null);
  observer.disconnect();
  controls.dispose();
  ${pipeline ? 'pipeline.dispose();' : ''}
  terrain.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
}, { once: true });
`;
export const PLAYGROUND_TEMPLATES = [
  {
    id: 'viewer', title: 'Terrain viewer', description: 'A terrain in a few lines',
    code: `import { createTerrainViewer } from 'procedural-terrains/viewer';

// Change the seed, height and noise, then press Ctrl+Enter.
const viewer = await createTerrainViewer(document.getElementById('app'), {
  configuration: {
    layout: { chunkCount: 4, chunkSize: 128 },
    heightScale: 160,
    seaLevel: 35,
    source: { kind: 'noise', seed: 42, scale: 8, falloff: 0.8 },
  },
});
console.log('Terrain ready, seed', viewer.terrain.configuration.source.seed);
addEventListener('pagehide', () => {
  viewer.dispose();
}, { once: true });
`,
  },
  {
    id: 'scene', title: 'Terrain in your scene', description: 'Your renderer, camera and animation loop',
    code: IMPORTS + `import { createTerrain } from 'procedural-terrains';
` + SCENE + `
const terrain = await createTerrain({ renderer, configuration: {
  layout: { chunkCount: 4, chunkSize: 128 },
  heightScale: 180, seaLevel: 40,
  source: { kind: 'noise', seed: 1337, scale: 10, falloff: 0.8 },
} });
scene.add(terrain.object);
camera.position.set(520, 430, 600);
controls.target.set(0, 60, 0);
` + LOOP(),
  },
  {
    id: 'water', title: 'Water and clouds', description: 'Water, volumetric clouds and the render pipeline',
    code: IMPORTS + `import { createTerrain } from 'procedural-terrains';
import { createWater } from 'procedural-terrains/water';
import { createClouds } from 'procedural-terrains/clouds';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
` + SCENE + `
const terrain = await createTerrain({ renderer, configuration: {
  layout: { chunkCount: 4, chunkSize: 128 },
  heightScale: 180, seaLevel: 55,
  source: { kind: 'noise', seed: 7, scale: 9, falloff: 0.9 },
} });
scene.add(terrain.object);
await createWater({ terrain, mode: 'volumetric' });
await createClouds({ terrain, mode: 'realistic',
  parameters: { cloudAltitude: 180, cloudThickness: 80, cloudCoverage: 0.35 },
  quality: { cloudRealisticSteps: 16 },
});
const pipeline = new TerrainRenderPipeline({ renderer, terrains: [terrain] });
camera.position.set(550, 460, 620);
controls.target.set(0, 60, 0);
` + LOOP(true),
  },
  {
    id: 'infinite', title: 'Infinite World', description: 'Stream terrain around the camera',
    code: IMPORTS + `import { createInfiniteTerrain } from 'procedural-terrains/infinite';
` + SCENE + `
const terrain = await createInfiniteTerrain({ renderer, configuration: {
  layout: { chunkSize: 128, viewRadius: 3, cacheResolution: 128 },
  heightScale: 180,
  source: { kind: 'noise', seed: 27, scale: 10, falloff: 0 },
} });
scene.add(terrain.object);
camera.position.set(300, 330, 380);
controls.target.set(0, 80, 0);
// Pan with the right mouse button to explore the streamed world.
` + LOOP(),
  },
  {
    id: 'planet', title: 'Planet', description: 'A procedural cube-sphere planet',
    code: IMPORTS + `import { createPlanetTerrain } from 'procedural-terrains/planet';
import { createWater } from 'procedural-terrains/water';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
` + SCENE + `
const terrain = await createPlanetTerrain({ renderer, configuration: {
  layout: { radius: 2000, faceGrid: 2, bakeResolution: 128 },
  heightScale: 320, seaLevel: 90,
  source: { kind: 'noise', seed: 12, scale: 12 },
  quality: { lodSegments: [32, 16, 8, 4] },
} });
scene.add(terrain.object);
await createWater({ terrain, mode: 'legacy' });
const pipeline = new TerrainRenderPipeline({ renderer, terrains: [terrain] });
camera.position.set(4200, 2800, 4200);
controls.target.set(0, 0, 0);
` + LOOP(true),
  },
  {
    id: 'mini', title: 'Mini diorama', description: 'A cove with a layered cutaway base',
    code: IMPORTS + `import { createMiniTerrain } from 'procedural-terrains/mini';
import { createWater } from 'procedural-terrains/water';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
` + SCENE + `
const terrain = await createMiniTerrain({
  renderer,
  mini: { recipe: 'cove', seed: 42, width: 1024, quality: 'balanced', shape: 'circle' },
  backdrop: true,
});
scene.add(terrain.object);
await createWater({ terrain, mode: 'stylized' });
const pipeline = new TerrainRenderPipeline({ renderer, terrains: [terrain] });
camera.position.set(1100, 850, 1200);
controls.target.set(0, 100, 0);
// Try: await terrain.mini.configure({ waterLevel: 0.65 });
` + LOOP(true),
  },
];
export const DEFAULT_TEMPLATE = PLAYGROUND_TEMPLATES[0];

