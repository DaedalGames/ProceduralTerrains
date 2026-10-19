import { DEFAULT_PARAMS } from '../engine/presets.js';
import { normalizeConfiguration } from '../runtime/FiniteTerrainConfiguration.js';
import { infiniteAdapter } from '../runtime/worlds/InfiniteTerrain.js';
import { planetAdapter } from '../runtime/worlds/PlanetTerrain.js';
import { WATER_DEFAULT_PARAMS } from '../engine/water/WaterSettings.js';
import { CLOUD_DEFAULT_PARAMS, resolveCloudRenderMode } from '../engine/sky/CloudSettings.js';
import { createEditableProjectDocument } from '../project/ProjectDocument.js';
import packageInfo from '../../packages/procedural-terrains/package.json';

const json = (value) => JSON.stringify(value, null, 2);
const pick = (value, model) => Object.fromEntries(
  Object.keys(model).filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
);

/** Convert public runtime options; retain the complete studio project separately. */
export function createTerrainCodeDocument(project, { quality = {} } = {}) {
  const p = { ...DEFAULT_PARAMS, ...project.params };
  const kind = project.worldMode === 'planet' ? 'planet' : project.worldMode === 'infinite' ? 'infinite' : 'finite';
  const warnings = [];
  const source = {
    kind: 'noise', seed: p.seed, octaves: Math.round(p.octaves),
    scale: p.noiseScale, strength: p.noiseStrength,
    smoothing: p.terrainSmoothing, detail: p.terrainDetail,
    persistence: p.persistence, lacunarity: p.lacunarity,
    ridge: p.ridge, warp: p.warp, falloff: p.falloff, edgeFalloffMode: p.edgeFalloffMode,
    ...(p.noiseStack ? { stack: structuredClone(p.noiseStack) } : {}),
  };
  if (project.editorMode === 'manual' && kind === 'finite') {
    source.kind = 'manual';
    source.document = structuredClone(project.manualTerrain ?? {});
    if (project.graph) source.graph = structuredClone(project.graph);
  } else if (project.generationSource === 'graph' && kind !== 'planet' && project.graph) {
    source.kind = 'graph';
    source.graph = structuredClone(project.graph);
  } else if (kind === 'planet' && project.generationSource === 'graph') {
    warnings.push('Planet runtime requires a 3D Noise Stack; the saved noise source is used instead of the editor graph.');
  }
  const layout = { chunkCount: p.chunkCount, chunkSize: p.chunkSize };
  if (kind === 'planet') Object.assign(layout, { radius: p.planetRadius, faceGrid: p.planetFaceGrid });
  if (kind === 'infinite') Object.assign(layout, { viewRadius: quality.viewRadius ?? 8 });
  const configuration = normalizeConfiguration({
    layout, source, heightScale: p.heightScale, seaLevel: p.seaLevel,
    lighting: { sunAzimuth: p.sunAzimuth, sunElevation: p.sunElevation, fogDensity: p.fogDensity },
    ...(p.planetStyle?.palette ? { palette: p.planetStyle.palette } : {}),
  }, undefined, kind === 'planet' ? planetAdapter : kind === 'infinite' ? infiniteAdapter : {});
  const extensions = [];
  if (project.miniTerrain && kind === 'finite')
    extensions.push({ type: 'mini', state: structuredClone(project.miniTerrain), backdrop: true });
  if (p.waterMode !== 'off' && p.waterEnabled !== false) {
    extensions.push({
      type: 'water', mode: p.waterMode,
      parameters: { ...pick(p, WATER_DEFAULT_PARAMS), seaLevel: p.seaLevel, waterAnim: p.waterAnim },
      quality: pick(quality, { waterQuality: 0, waterDetail: 0, waterReflection: 0, waterWaves: 0 }),
    });
  }
  if (p.cloudsEnabled) {
    extensions.push({
      type: 'clouds', mode: resolveCloudRenderMode(p),
      parameters: pick(p, CLOUD_DEFAULT_PARAMS),
      quality: pick(quality, {
        cloudSteps: 0, cloudLightSteps: 0, cloudOctaves: 0, cloudDetailOctaves: 0,
        cloudRealisticSteps: 0, cloudRenderScale: 0,
      }),
    });
  }
  if ((project.tiles?.length ?? 1) > 1 || (project.tiles?.[0]?.cx ?? 0) !== 0 || (project.tiles?.[0]?.cz ?? 0) !== 0)
    warnings.push('The npm alpha creates one centred square board; the studio tile assembly is preserved in studio-project.ptrterrain.');
  if (project.tileAssemblyShape === 'circle' && !project.miniTerrain)
    warnings.push('Circular Tile clipping is not exposed by the npm alpha; the procedural board is square.');
  if (project.paint || project.erosion || project.destruction)
    warnings.push('Studio paint, erosion and destruction deltas are preserved in the editable project, not applied by the procedural example.');
  if (project.creatorTools?.splines?.length)
    warnings.push('Studio splines require manual integration; their masks remain available through the baked export.');
  if (project.realWorldSource)
    warnings.push('Imported elevation and imagery need an explicit real-world provider; the example uses the saved generation source.');
  if (p.surfaceTextureMode || p.surfaceTextureSource === 'customTextures')
    warnings.push('Custom surface textures require explicit TerrainSurfaceProvider resources in your application.');
  warnings.push('Studio props, sky/background, post-processing and additional style controls are not installed by the npm runtime.');
  if (project.miniTerrain)
    warnings.push('Mini presentation uses its saved state; studio vegetation and overrides outside Mini are not included.');
  return {
    document: {
      format: 'procedural-terrains', schemaVersion: 1, kind,
      configuration: JSON.parse(json(configuration)), extensions,
    },
    warnings,
  };
}

export function createTerrainCodeFiles(project, context = {}) {
  const { document, warnings } = createTerrainCodeDocument(project, context);
  const terrainCode = `import { loadTerrainDocument } from 'procedural-terrains/documents';

// Generated from the studio. Adjust this document to change the terrain.
export const terrainDocument = ${json(document)};

export function createExportedTerrain({ renderer, signal } = {}) {
  return loadTerrainDocument(terrainDocument, { renderer, signal });
}
`;
  const size = document.kind === 'planet'
    ? document.configuration.layout.radius * 3
    : document.configuration.layout.chunkCount * document.configuration.layout.chunkSize;
  const target = document.kind === 'planet' ? [0, 0, 0] : [0, document.configuration.heightScale * 0.25, 0];
  const distance = Math.max(size, document.configuration.heightScale * 2);
  const main = `import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
import { createExportedTerrain } from './terrain.js';

async function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101827);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, ${Math.max(100000, size * 12)});
  camera.position.fromArray(${json(context.camera?.position ?? [distance * 0.7, distance * 0.6, distance * 0.8])});
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.fromArray(${json(context.camera?.target ?? target)});
  controls.enableDamping = true;
  controls.update();
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);
  let terrain, pipeline;
  const dispose = () => {
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', dispose);
    controls.dispose();
    pipeline?.dispose();
    terrain?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  try {
    terrain = await createExportedTerrain({ renderer });
    scene.add(terrain.object);
    pipeline = new TerrainRenderPipeline({ renderer, terrains: [terrain] });
    await terrain.prepare(camera);
    document.querySelector('#status').remove();
    let last = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      controls.update();
      terrain.update(dt, { camera });
      pipeline.render(scene, camera);
    });
    window.addEventListener('pagehide', dispose, { once: true });
  } catch (error) {
    dispose();
    throw error;
  }
}
start().catch((error) => {
  document.querySelector('#status').textContent = error.message;
  console.error(error);
});
`;
  const readme = `# Exported Procedural Terrain

This example uses procedural-terrains ${packageInfo.version} and Three.js ${packageInfo.peerDependencies.three}.
The runtime package is an alpha available on npm.

## Run

1. Extract this ZIP and open a terminal in this code folder.
2. Run: npm install
3. Run: npm run dev
4. For a production build: npm run build

For a locally modified runtime, build the studio repository and override the dependency:
npm install /path/to/dist/npm/procedural-terrains-${packageInfo.version}.tgz

Serve the application through a web server, not file://.

## Use in your scene

Import createExportedTerrain from terrain.js, call it with your renderer,
add terrain.object to your scene and await terrain.prepare(camera).
Each frame: terrain.update(deltaSeconds, { camera }), then pipeline.render(scene, camera).
Dispose the terrain and pipeline separately on cleanup.

terrain.json is the runtime document; terrain.js embeds the same document.
studio-project.ptrterrain is the editable studio project, using a different schema.

## Conversion notes

${warnings.map((message) => '- ' + message).join('\n')}

Use the baked meshes and maps for the studio's exported appearance.
`;
  const files = {
    'terrain.js': terrainCode,
    'terrain.json': json(document) + '\n',
    'main.js': main,
    'index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exported terrain</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101827;color:#fff;font:14px system-ui}canvas{display:block}#status{position:fixed;top:16px;left:16px;max-width:80vw}</style></head><body><p id="status" role="status">Preparing terrain…</p><script type="module" src="./main.js"></script></body></html>\n',
    'package.json': json({
      name: 'exported-procedural-terrain', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { 'procedural-terrains': packageInfo.version, three: packageInfo.peerDependencies.three },
      devDependencies: { vite: '^5.4.11' },
    }) + '\n',
    'studio-project.ptrterrain': json(createEditableProjectDocument({ terrain: project })) + '\n',
    'README.md': readme,
  };
  return Object.fromEntries(Object.entries(files).map(([path, value]) => ['code/' + path, new TextEncoder().encode(value)]));
}

