# Procedural Terrains — Three.js runtime

An ESM library extracted from Terrain Studio 2.0.0. Finite, infinite, planetary
and Mini worlds reuse the studio's terrain geometry, noise, shaders and caches.
The package has no React, Electron, account, stylesheet or backend dependency.
Three.js `~0.185.1` is a peer dependency; `fflate` handles packed materials,
paint documents and ZIP exports. The current version is an alpha.

## Feature coverage and independent effects

The runtime does not contain every editor tool. See the [feature matrix](https://github.com/ZyFou/ProceduralTerrains/blob/develop/docs/features.md), [water API](https://github.com/ZyFou/ProceduralTerrains/blob/develop/docs/water.md), [cloud API](https://github.com/ZyFou/ProceduralTerrains/blob/develop/docs/clouds.md), and [larger-world guide](https://github.com/ZyFou/ProceduralTerrains/blob/develop/docs/large-worlds.md).

Water and clouds can be used around custom Three.js meshes without generating a terrain. Call createWater/createClouds with renderer and world, add each effect.object, pass effects to TerrainRenderPipeline and update them once per frame. Pass terrain instead to attach a layer managed by that terrain. Separate water/cloud/large-world playground templates are available in the studio documentation.

## Install

```sh
npm install procedural-terrains
```

Use `three@~0.185.1` in your application (npm also installs this peer automatically). The package
contains ESM entry points, declarations, bundled Workers and the MIT license.
No studio files or material packs are copied into the package.

To build from source: `npm ci && npm run build` in the repository. An installable
archive is also produced in `dist/npm/`. See [release publishing](https://github.com/ZyFou/ProceduralTerrains/blob/develop/docs/package-publishing.md).

## Use your own renderer and loop

```js
import { createTerrain } from 'procedural-terrains';

const terrain = await createTerrain({ renderer, configuration: {
  layout: { chunkCount: 8, chunkSize: 128 },
  source: { kind: 'noise', seed: 1337, octaves: 7 },
  heightScale: 560,
} });
scene.add(terrain.object);
await terrain.prepare(camera);

function frame(deltaSeconds) {
  terrain.update(deltaSeconds, { camera });
  renderer.render(scene, camera);
}
await terrain.configure({ source: { seed: 42 } });
const height = terrain.sampleHeight(0, 0);
const document = terrain.serialize();
terrain.dispose();
```

The host owns the renderer, camera, scene, resize policy and animation loop.
Use an identity world transform for each terrain and its ancestors. Rendering
requires browser WebGL2; importing the modules and using data models does not
require DOM globals. CPU height samples approximate the GPU field and are not
exact triangle collision queries. Heights and dimensions are in world units.
The built-in shaders use their own sun/ambient lighting and display-encoded
colour; arbitrary scene lights and renderer tone mapping are not adopted.

## Entry points

| Import | Public components |
| --- | --- |
| `procedural-terrains` | `createTerrain`, `FiniteTerrain` |
| `/infinite` | `createInfiniteTerrain` with camera-centred streaming and clipmaps |
| `/planet` | `createPlanetTerrain` with cube-sphere patches and height/climate bakes |
| `/mini` | `createMiniTerrain`, Mini state/layout/framing helpers |
| `/generation` | Noise Stack builders, graph compiler/document builders, manual document normalization |
| `/water` | `createWater`, `TerrainWater`, defaults/modes |
| `/clouds` | `createClouds`, `TerrainClouds`, defaults |
| `/render` | `TerrainRenderPipeline`, `TerrainPass`, optional height/detail caches |
| `/assets` | Explicit resource scopes, material providers, erosion/surface Workers |
| `/real-world` | `TerrariumProvider`, `createRealWorldTerrain` |
| `/export` | `exportTerrain`, `zipTerrainExport` |
| `/documents` | `loadTerrainDocument` |
| `/viewer` | Explicit DOM viewer with its own renderer, controls and loop |

All runtime instances implement `prepare`, `configure`, `update`, `serialize`,
`getDiagnostics` and idempotent `dispose`. Destruction releases owned resources
and detaches the group. It never destroys a borrowed renderer, imagery texture,
surface resource or `TerrainResources` scope. Shared resources remain alive
until their last lease is released. Dispose effects individually or with their
terrain; dispose pipelines separately.

## World modes and sources

```js
import { createInfiniteTerrain } from 'procedural-terrains/infinite';
import { createPlanetTerrain } from 'procedural-terrains/planet';
import { createMiniTerrain } from 'procedural-terrains/mini';

const infinite = await createInfiniteTerrain({ renderer, configuration: {
  layout: { chunkSize: 128, viewRadius: 8, cacheResolution: 256 },
} });
const planet = await createPlanetTerrain({ renderer, configuration: {
  layout: { radius: 16000, faceGrid: 8, bakeResolution: 256 },
} });
const mini = await createMiniTerrain({ renderer,
  mini: { recipe: 'cove', seed: 1337, width: 1024, quality: 'balanced' },
  backdrop: false,
});
await mini.mini.configure({ waterLevel: 0.6 });
const framing = mini.mini.framing(); // suggestion; does not move your camera
```

Choose a world at construction. Create another instance when switching world
modes. Mini is a finite presentation: configure its managed relief, composition,
resolution and footprint through `terrain.mini.configure`. Water/cloud layers
are explicit opt-ins. Mini does not install editor controls, vegetation or a
studio background; `backdrop: true` enables its background.

Finite sources support `noise` (optional Noise Stack), `graph` (validated graph
document), `manual` (shapes/sculpt with flat, procedural or graph base) and
`heightmap` (`data`, `width`, `height`). Heightmaps cover the board, row zero at
negative Z, contain world-unit heights, and are uploaded as filtered half floats.
Infinite worlds support unbounded noise/2D graphs; planets require a Noise Stack
with 3D evaluation. Unsupported combinations fail explicitly. Source documents
are detached and frozen with the normalized configuration.

```js
await terrain.configure({ source: {
  kind: 'heightmap', width: 2, height: 2,
  data: new Float32Array([0, 50, 120, 30]),
} });
```

`sampleHeight` returns null outside finite boards; use `sampleHeight3D` with a
nonzero direction for planets. Planet samples return relief above the radius.
LOD resolutions must be four even values halving at each step. Mini uses the
studio's fixed 128/256/512 segment profiles instead. World-specific layout
options control streaming/triangle budgets and bake resolutions.

## Water, clouds and scene composition

```js
import { createWater } from 'procedural-terrains/water';
import { createClouds } from 'procedural-terrains/clouds';
import { TerrainRenderPipeline } from 'procedural-terrains/render';

const water = await createWater({ terrain, mode: 'volumetric' });
const clouds = await createClouds({ terrain, mode: 'realistic' });
const pipeline = new TerrainRenderPipeline({ renderer, terrains: [terrain] });
await terrain.prepare(camera);
function frame(dt) {
  terrain.update(dt, { camera });
  pipeline.render(scene, camera);
}
```

The pipeline renders the **whole host scene** into its own colour/depth target,
captures water reflection/refraction when needed, composites clouds against
opaque depth in a distinct target, then applies underwater effects. This avoids
sampling an attached depth texture. It restores target, viewport, scissor,
clear state and XR/shadow flags. `TerrainPass` replaces `RenderPass` in an
EffectComposer; it is not an extra full-scene overlay after another RenderPass.

Water modes: `off`, `legacy`, `realistic`, `volumetric`, `cinematic`, `stylized`.
The existing world/quality fallback rules apply: inspect requested/effective
modes with `water.getDiagnostics()`. Clouds support `legacy` and `realistic` in
all world modes. Each terrain should have one water and one cloud layer.

Finite terrain rendering can run directly with `renderer.render`. Add
`createHeightCache({ terrain, resolution: 512 })` or
`createDetailCache({ terrain, quality: 2 })` when needed. Height caches retain
the studio's double buffering; detail caches own their worker and GPU pages.
Mini, planet and infinite adapters retain their existing specialized caches.

## Materials and external data

```js
import { TerrainSurfaceProvider, createSurfaceResources } from 'procedural-terrains/assets';
const provider = new TerrainSurfaceProvider({ baseUrl: 'https://your-host/material-pack/' });
const surface = await createSurfaceResources({ provider, document: surfaceDocument });
await terrain.setSurface(surface);
// After detaching from every terrain:
await terrain.setSurface(null);
surface.dispose();
provider.dispose();
```

Host `catalog.json` and its `.pbr` files yourself. Catalog hashes and material
budgets are checked. Local assets use an injected `loadUserAsset`; historical
maps require an explicit `legacyBaseUrl`. `TerrainSurfaceWorker.prepare` accepts
serializable pack URLs/documents; `TerrainCompute.erode` uses a dedicated worker
per job, preserves caller buffers and returns additive `delta` plus erosion
maps. Inject worker factories for CSP/custom hosting. There is no implicit
request to the studio's `/textures`, storage, account or API.

`createRealWorldTerrain` accepts your provider's `loadHeightmap` and optional
`loadImagery`. The `TerrariumProvider` adapter requires explicit tile URL
functions, optionally injected fetch, and attribution. Its ordered bbox uses
`west/east/south/north`, Web Mercator latitude limits and at most 6×6 tiles.
Antimeridian bboxes must be split by the caller. No Leaflet or Overpass service
is loaded. City/building queries remain application/provider responsibilities.

## Documents and exports

```js
import { loadTerrainDocument } from 'procedural-terrains/documents';
import { exportTerrain, zipTerrainExport } from 'procedural-terrains/export';
const restored = await loadTerrainDocument(terrain.serialize(), { renderer });
const result = await exportTerrain(terrain, {
  format: 'glb', meshRes: 128, texRes: 512,
  bakeColor: true, exportHeightmap: true,
});
const zipBytes = zipTerrainExport(result); // caller chooses how/where to save
```

Exports return named byte arrays, filename and diagnostics without a download
or filesystem side effect. GLB/OBJ and map baking share the studio's builders.
Infinite exports require a bounded square `region: { cx, cz, size }` in world
units. Planet exports cover all six faces. A detached terrain document is
included; Mini presentation, water and clouds serialize as extensions. Borrowed
GPU material/imagery assets must be reattached by the application after loading.
Await GPU operations before starting another export or disposing borrowed assets.

Configuration revisions supersede pending work. Cancellation rejects with
`TERRAIN_CANCELLED`, replacement with `TERRAIN_SUPERSEDED`, destruction with
`TERRAIN_DISPOSED`. GPU driver compilation itself cannot be interrupted; its
retired candidates are disposed when it settles. Shader candidates publish only
after validation. Cache/effect warm-up follows the synchronous configuration
commit; if it fails, the committed configuration remains available and
`prepare(camera)` can be retried. Do not assume a rejected warm-up rolls back
a configuration already committed. `configuration` is immutable.

## Validation

```sh
npm run check:lib
npm test
node --test tests/*.node.mjs
npm run build
npm ci --prefix examples/three-finite-terrain
npm run build --prefix examples/three-finite-terrain
npx playwright install chromium
npm run test:lib:browser
npm run test:lib:worlds
```

The checks install the actual npm tarball in a clean consumer, import every ESM
entry without DOM, compile strict TypeScript consumers, and exercise actual
WebGL shaders, worlds, sources, effects, workers, PBR resources and exports.
Browser checks can use `TERRAIN_BROWSER_PATH` for an installed Chromium binary.
See `docs/npm-runtime-migration.md` in the repository for boundaries and migration.
