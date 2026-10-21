# Clouds

Separate `procedural-terrains/clouds` import. Legacy and Realistic work with package terrain worlds and standalone finite/infinite Three.js scenes. [Open the clouds playground](#/docs/playground?example=clouds).

## Standalone Three.js integration

```js
import { createClouds } from 'procedural-terrains/clouds';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
const clouds = await createClouds({ renderer,
  world: { mode: 'infinite', size: 20000, heightScale: 2000 },
  mode: 'realistic',
  parameters: { cloudAltitude: 1800, cloudThickness: 900, cloudCoverage: 0.65, cloudSystemScale: 6, cloudNoiseSeed: 17 },
  quality: { cloudRealisticSteps: 24, cloudRenderScale: 0.5 },
});
scene.add(clouds.object);
const pipeline = new TerrainRenderPipeline({ renderer, effects: [clouds] });
await clouds.prepare(camera);
function frame(dt) {
  clouds.update(dt, { camera });
  pipeline.render(scene, camera);
}
await clouds.configure({ parameters: { cloudCoverage: 0.65 }, quality: { cloudRenderScale: 0.75 } });
// Cleanup: pipeline.dispose(); clouds.dispose();
```

No terrain geometry is allocated. Opaque scene meshes contribute depth so clouds are occluded correctly. `clouds.object` is stable across configuration changes. Keep the group/ancestors identity-transformed; move the camera or choose a camera-following domain instead of moving/scaling the effect.

## Attach to terrain

```js
const clouds = await createClouds({ terrain, mode: 'realistic',
  parameters: { cloudAltitude: 1800, cloudThickness: 900 },
});
const pipeline = new TerrainRenderPipeline({ renderer, terrains: [terrain] });
await terrain.prepare(camera);
// Per frame: terrain.update(dt, { camera }); pipeline.render(scene, camera);
```

Use one cloud layer per terrain. The terrain already owns/updates it. Terrain shaders can receive cloud shadows. Standalone clouds do not automatically patch custom Three.js materials to receive those shadows; opaque depth occlusion still works.

## Coverage and larger worlds

Standalone `world` accepts the finite/infinite, size (1–100000 (infinite: minimum 6)), reference-height, sea-level and sun-angle fields described in [water](water.md#world-and-sea-level). Default coverage: 10000 units. Finite stays at the origin; Infinite snaps its bounded cloud volume around the camera while preserving the logical noise field. This is not a global floating origin. Attach to `createPlanetTerrain` for a spherical shell; standalone `world.mode: 'planet'` is rejected.

`cloudAltitude` is absolute world Y on flat worlds, height above the radius on planets. `cloudThickness` is a world-unit depth, minimum 20. Coverage, altitude and feature frequency are separate: increasing coverage does not scale altitude automatically. Noise controls are relative frequencies: higher means smaller formations. Wind controls domain drift rather than metres/second. Recreate the effect to change standalone domain dimensions.

## Modes and lifecycle

`createClouds(options)` takes `terrain`, or `renderer + world`, plus `mode`, `parameters`, `quality`, optional `signal`. Modes: `legacy` / `realistic`. `await clouds.prepare(camera)` prepares the renderer for your camera. `configure({ mode?, parameters?, quality? }, { signal? })` merges changes and replaces the layer only after successful preparation. `cloudsEnabled: false` hides clouds. `update(dt, { camera })` advances standalone time and follows parented cameras in world coordinates. `getDiagnostics()` reports active, ready and low-resolution state.

`serialize()` returns effect settings and standalone world, when present; recreate with `createClouds({ renderer, ...saved })`. Terrain-document loading restores attached effects. `dispose()` is idempotent, leaving the renderer/custom meshes alive. Shared noise volumes keep renderer-scoped leases until the last layer is released. Dispose the pipeline separately.

## Quality budgets

Integer ranges: `cloudSteps` 8–128; `cloudLightSteps` 1–12; `cloudOctaves` 1–6; `cloudDetailOctaves` 0–5; `cloudRealisticSteps` 8–128 (supported specialization selected). `cloudRenderScale`: 0.25–1; `cloudMaxDistance`: 1–20 coverage multipliers, ignored for infinite distance culling; `cloudLightMode`: 0/1. Erosion/self-shadow/step-LOD fields are booleans; `cloudFallback`: `none`, `lite`, `off`. Legacy/Realistic use their own step fields. Fallback guards can reduce the effective budget. Unknown/invalid values fail explicitly.

Start larger scenes at 24 Realistic steps and 0.5 render scale. Increase pixels/ray samples after measuring GPU time, independently of world size. See [large worlds](large-worlds.md).

| Parameter | Type | Default |
| --- | --- | --- |
| `cloudSteps` | number | `12` |
| `cloudLightSteps` | number | `2` |
| `cloudOctaves` | number | `3` |
| `cloudDetailOctaves` | number | `0` |
| `cloudRealisticSteps` | number | `24` |
| `cloudRenderScale` | number | `0.5` |
| `cloudMaxDistance` | number | `6` |
| `cloudUseErosion` | boolean | `true` |
| `cloudSelfShadow` | boolean | `true` |
| `cloudLightMode` | number | `0` |
| `cloudStepLOD` | boolean | `false` |
| `cloudFallback` | string | `"none"` |

## Parameter reference

Every accepted shape/lighting field is listed below; these are not quality budgets. The factory enables clouds by default. Scalars must be finite and colors are RGB triples. The factory mode selects the renderer; cloudRenderMode is retained for compatibility. cloudChunksEnabled is retained in documents, but experimental chunked clouds are not exposed by this API.

| Parameter | Type | Default |
| --- | --- | --- |
| `cloudsEnabled` | boolean | `true` |
| `cloudChunksEnabled` | boolean | `false` |
| `cloudCoverage` | number | `0.5` |
| `cloudDensity` | number | `1` |
| `cloudSoftness` | number | `0.16` |
| `cloudNoiseVariant` | string | `"soft"` |
| `cloudNoiseSeed` | number | `0` |
| `cloudAltitude` | number | `240` |
| `cloudThickness` | number | `620` |
| `cloudScale` | number | `2.2` |
| `cloudDetailScale` | number | `7` |
| `cloudDetailStrength` | number | `0.35` |
| `cloudErosionScale` | number | `15` |
| `cloudErosionStrength` | number | `0.3` |
| `cloudWindDir` | number | `45` |
| `cloudWindSpeed` | number | `1` |
| `cloudRotationSpeed` | number | `0.35` |
| `cloudEvolveSpeed` | number | `1` |
| `cloudLightAbsorption` | number | `3` |
| `cloudShadowStrength` | number | `0.6` |
| `cloudScatteringStrength` | number | `1` |
| `cloudAtmosphereInfluence` | number | `1` |
| `cloudSunResponse` | number | `1` |
| `cloudAmbientResponse` | number | `1` |
| `cloudSilverLining` | number | `0.25` |
| `cloudShadowsEnabled` | boolean | `false` |
| `cloudShadowOpacity` | number | `0.45` |
| `cloudColor` | RGB array | `[1,1,1]` |
| `cloudShadowColor` | RGB array | `[0.42,0.47,0.6]` |
| `cloudRenderMode` | string | `"legacy"` |
| `cloudSystemScale` | number | `3.2` |
| `cloudErosion` | number | `0.7` |
| `cloudBillowSize` | number | `1` |
| `cloudTowering` | number | `0.55` |
| `cloudShear` | number | `0.25` |
| `cloudForwardScatter` | number | `1` |
| `cloudSkyTint` | RGB array | `[0.78,0.84,0.95]` |
| `cloudExposure` | number | `1` |

## Composition and limits

Use TerrainRenderPipeline or TerrainPass for opaque depth, low-resolution reconstruction and cloud/water ordering. A plain renderer.render does not execute those passes. Clouds use their own sun/ambient model; Three.js lights do not replace it. No sky, atmosphere, day/night or grading stack is installed. Transparent meshes and custom receiving-material shadows need application-specific integration.
