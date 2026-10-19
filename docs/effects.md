# Water, clouds and materials

Effects are explicit runtime layers attached to a terrain. They reuse its renderer and generation data.

## Water and clouds

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

Water modes: `off`, `legacy`, `realistic`, `volumetric`, `cinematic`, `stylized`. World and quality fallbacks apply; inspect `water.getDiagnostics()` for requested and effective modes.

Cloud modes: `legacy` and `realistic`, in every world. Configure appearance through `parameters` and rendering budgets through `quality`. Use one water layer and one cloud layer per terrain.

## Render pipeline

The pipeline renders your whole scene to a color/depth target, captures reflections and refraction when needed, composites clouds in a separate target, and applies underwater effects. It restores the host renderer state.

`TerrainPass` replaces `RenderPass` in an EffectComposer. Do not add another full-scene RenderPass before it for the same scene. Dispose the pipeline separately.

## Height and detail caches

`createHeightCache({ terrain, resolution: 512 })` and `createDetailCache({ terrain, quality: 2 })` are optional for finite terrain. Infinite, planet and Mini adapters have their own caches. Height caches use double buffering; detail caches own a worker and GPU pages.

## PBR materials

```js
import { TerrainSurfaceProvider, createSurfaceResources } from 'procedural-terrains/assets';

const provider = new TerrainSurfaceProvider({
  baseUrl: 'https://your-host/material-pack/',
});
const surface = await createSurfaceResources({
  provider, document: surfaceDocument,
});
await terrain.setSurface(surface);
// Detach from every terrain before destroying shared resources:
await terrain.setSurface(null);
surface.dispose();
provider.dispose();
```

Host `catalog.json` and `.pbr` packs yourself. Hashes and material budgets are validated. Local files require an injected `loadUserAsset`; legacy maps require an explicit `legacyBaseUrl`. No studio storage or texture endpoint is requested implicitly.

## Workers and resource ownership

`TerrainSurfaceWorker.prepare` accepts serializable pack URLs and documents. `TerrainCompute.erode` owns a worker per job, leaves caller buffers intact and returns additive height deltas and maps. Worker factories can be injected for CSP or custom hosting.

Shared resources stay alive while leases exist. A terrain never disposes a borrowed renderer, imagery texture, surface or resource scope.

