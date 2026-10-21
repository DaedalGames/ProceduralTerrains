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
const EFFECT_LOOP = (names) => `
controls.update();
await Promise.all([${names.map(name => name+'.prepare(camera)').join(', ')}]);
console.log('Effects ready');
let previous = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
  previous = now;
  controls.update();
  ${names.map(name => name+'.update(dt, { camera });').join('\n  ')}
  pipeline.render(scene, camera);
});
addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null);
  observer.disconnect(); controls.dispose(); pipeline.dispose();
  ${names.map(name => name+'.dispose();').join(' ')}
  scene.traverse(object => { object.geometry?.dispose();
    for (const material of [object.material].flat().filter(Boolean)) material.dispose(); });
  renderer.dispose(); renderer.forceContextLoss();
}, { once: true });
`;
const LIGHTS = `
scene.background = new THREE.Color(0xaac9df);
scene.add(new THREE.HemisphereLight(0xcce4ff, 0x655448, 2));
const sun = new THREE.DirectionalLight(0xfff0ce, 3);
sun.position.set(2000, 5000, 1000); scene.add(sun);
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
    id: 'terrain-effects', title: 'Water and clouds', description: 'Water, volumetric clouds and the render pipeline',
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
    id: 'water', title: 'Standalone water', description: 'An ocean around your own Three.js meshes; no generated terrain',
    code: IMPORTS + `import { createWater } from 'procedural-terrains/water';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
` + SCENE + LIGHTS + `
// Coverage, camera and depth distances use the same world units as your meshes.
const world = { mode: 'finite', size: 12000, seaLevel: 0, heightScale: 1000 };
const water = await createWater({ renderer, world, mode: 'volumetric',
  parameters: { waterMaxVisibleDepth: 1000, waterShallowDistance: 100, waterDeepDistance: 600 },
});
scene.add(water.object);
const island = new THREE.Mesh(new THREE.IcosahedronGeometry(1400, 3),
  new THREE.MeshStandardMaterial({ color: 0x887d55, roughness: 1 }));
island.position.y = -900; scene.add(island);
const bed = new THREE.Mesh(new THREE.PlaneGeometry(12000,12000),
  new THREE.MeshStandardMaterial({ color: 0x9b9870 }));
bed.rotation.x = -Math.PI/2; bed.position.y = -400; scene.add(bed);
const pipeline = new TerrainRenderPipeline({ renderer, effects: [water] });
camera.near = 5; camera.far = 80000; camera.updateProjectionMatrix();
camera.position.set(4300,2100,5100); controls.target.set(0,0,0);
// Try: await water.configure({ mode: 'cinematic', quality: { waterReflection: 1.5 } });
` + EFFECT_LOOP(['water']),
  },
  {
    id: 'clouds', title: 'Standalone clouds', description: 'A 12 km cloud field over a custom Three.js scene',
    code: IMPORTS + `import { createClouds } from 'procedural-terrains/clouds';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
` + SCENE + LIGHTS + `
// Use mode: 'infinite' for coverage that follows a moving camera.
const clouds = await createClouds({ renderer,
  world: { mode: 'finite', size: 12000, heightScale: 2000 },
  mode: 'realistic',
  parameters: { cloudAltitude: 1600, cloudThickness: 900, cloudCoverage: 0.65, cloudSystemScale: 6,
    cloudDensity: 1.2, cloudNoiseSeed: 17, cloudWindSpeed: 0.35 },
  quality: { cloudRealisticSteps: 24, cloudRenderScale: 0.5 },
});
scene.add(clouds.object);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000,12000),
  new THREE.MeshStandardMaterial({ color: 0x718265 }));
ground.rotation.x = -Math.PI/2; scene.add(ground);
for (let i=0; i<5; i++) {
  const peak = new THREE.Mesh(new THREE.ConeGeometry(700,1600,7),
    new THREE.MeshStandardMaterial({ color: 0x858477, flatShading: true }));
  peak.position.set((i-2)*1400,800,-1000); scene.add(peak);
}
const pipeline = new TerrainRenderPipeline({ renderer, effects: [clouds] });
camera.near = 5; camera.far = 80000; camera.updateProjectionMatrix();
camera.position.set(4300,2900,5800); controls.target.set(0,1300,0);
// Try: await clouds.configure({ mode: 'legacy', parameters: { cloudCoverage: 0.65 } });
` + EFFECT_LOOP(['clouds']),
  },
  {
    id: 'large-world', title: 'Large world with effects', description: 'Streaming terrain, ocean and clouds at kilometre scale',
    code: IMPORTS + `import { createInfiniteTerrain } from 'procedural-terrains/infinite';
import { createWater } from 'procedural-terrains/water';
import { createClouds } from 'procedural-terrains/clouds';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
` + SCENE + `
scene.background = new THREE.Color(0xaac9df);
const terrain = await createInfiniteTerrain({ renderer, configuration: {
  layout: { chunkSize: 1024, viewRadius: 6, cacheResolution: 128, triangleBudget: 300000 },
  heightScale: 2000, seaLevel: 850, terrainFormationSeaLevel: 850,
  source: { kind: 'noise', seed: 27, scale: 30, falloff: 0 },
  quality: { lodSegments: [64,32,16,8], mergeEnabled: false },
} });
scene.add(terrain.object);
await createWater({ terrain, mode: 'volumetric', parameters: {
  waterAutoDowngradeInfinite: false, waterMaxVisibleDepth: 1000,
  waterShallowDistance: 100, waterDeepDistance: 600, waterRenderScale: 0.5,
} });
await createClouds({ terrain, mode: 'realistic',
  parameters: { cloudAltitude: 2200, cloudThickness: 1000, cloudCoverage: 0.65, cloudSystemScale: 6, cloudNoiseSeed: 17 },
  quality: { cloudRealisticSteps: 24, cloudRenderScale: 0.5 },
});
const pipeline = new TerrainRenderPipeline({ renderer, terrains: [terrain] });
camera.near = 5; camera.far = 120000; camera.updateProjectionMatrix();
camera.position.set(1600,4200,1800); controls.target.set(0,600,0);
// Right-drag to pan: terrain, water and cloud coverage follow the camera.
// Keep near/far practical; this does not provide a global floating origin.
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
export function templateFromHash(hash = globalThis.location?.hash ?? '') {
  const id = new URLSearchParams(hash.split('?')[1] ?? '').get('example');
  return PLAYGROUND_TEMPLATES.find(template => template.id === id) ?? null;
}
export const DEFAULT_TEMPLATE = PLAYGROUND_TEMPLATES[0];

