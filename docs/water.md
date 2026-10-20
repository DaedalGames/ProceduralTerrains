# Water

Separate `procedural-terrains/water` import, with package terrain or your own Three.js meshes. [Open the water playground](#/docs/playground?example=water).

## Standalone Three.js integration

```js
import { createWater } from 'procedural-terrains/water';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
const water = await createWater({ renderer,
  world: { mode: 'finite', size: 12000, seaLevel: 0, heightScale: 1000 },
  mode: 'volumetric',
  parameters: { waterMaxVisibleDepth: 1000, waterDeepDistance: 600 },
});
scene.add(water.object);
const pipeline = new TerrainRenderPipeline({ renderer, effects: [water] });
await water.prepare(camera);
function frame(dt) {
  water.update(dt, { camera });
  pipeline.render(scene, camera);
}
await water.configure({ parameters: { waterWaveStrength: 0.6 }, quality: { waterDetail: 0.8 } });
// Cleanup: pipeline.dispose(); water.dispose();
```

Keep the group and ancestors identity-transformed. Opaque meshes in the rendered scene contribute captured color/depth to Volumetric/Cinematic refraction, shoreline depth and absorption. The standalone domain has a flat fallback seabed for analytical shading; it does not infer a CPU height field from arbitrary meshes. Transparent objects are outside the opaque-depth contract.

`water.object` remains stable across `configure`/`prepare`. Internal meshes/materials can change. `dispose` removes the group and releases owned resources, leaving your renderer and meshes alive.

## Attach to terrain

```js
const water = await createWater({ terrain, mode: 'volumetric' });
const pipeline = new TerrainRenderPipeline({ renderer, terrains: [terrain] });
await terrain.prepare(camera);
// Per frame: terrain.update(dt, { camera }); pipeline.render(scene, camera);
```

Use one water layer per terrain. The terrain already adds/updates/disposes it: do not add or update it twice. Mixed pipelines accept both `terrains` and standalone `effects`.

## World and sea level

Pass `terrain`, or `renderer` and optional `world`. Mixing hosts is rejected.

| Standalone world field | Default | Meaning |
| --- | --- | --- |
| `mode` | `finite` | `finite` / camera-following `infinite` |
| `size` | 10000 | Active coverage, 1–100000 (infinite: minimum 6) world units |
| `heightScale` | 1000 | Reference height and fallback seabed depth |
| `seaLevel` | 0 | World Y of the surface |
| `sunAzimuth` | 128 | Degrees |
| `sunElevation` | 46 | Degrees |

Dimensions are fixed at construction: recreate to resize the domain. `parameters.seaLevel` moves water. Finite coverage stays at the origin; Infinite is a bounded camera-following plane. For spherical water, attach to a planet terrain.

Standalone defaults `waterHideAtZero: false` and `waterAutoDowngradeInfinite: false` support zero/negative-Y oceans. Terrain-attached defaults retain the editor convention: levels ≤0.5 hide water unless `waterHideAtZero: false` is explicit.

## Modes and safeguards

| Requested mode | Behavior |
| --- | --- |
| `off` | No visible water or underwater effect |
| `legacy` | Cheap procedural shading, no captured scene refraction |
| `realistic` | Optical water; captured refraction belongs to Volumetric/Cinematic |
| `volumetric` | Scene-color/depth absorption and refraction |
| `cinematic` | Advanced water; finite planar reflection when enabled and above the surface |
| `stylized` | Diorama surface on finite/infinite worlds |

Planets resolve advanced/stylized requests to Legacy. Infinite safeguards can reduce modes when `waterAutoDowngradeInfinite` is true. `waterLegacyOnLowFps` controls the FPS safeguard. Check `getDiagnostics()` for requested/effective modes and underwater/render costs.

## Configuration and lifecycle

`createWater(options)` returns the layer. `await water.prepare(camera)` prepares your actual camera; factory/prepare accept `signal`. `configure({ mode?, parameters?, quality? }, { signal? })` merges changes and retains live water if candidate preparation fails. `update(dt, { camera })` advances standalone time and underwater detection. `serialize()` includes settings and standalone world; recreate with `createWater({ renderer, ...saved })`. `loadTerrainDocument` restores terrain documents, not standalone effect documents. `dispose` is idempotent.

`mode` is authoritative. `parameters.waterMode` and `waterQualityPreset` are compatibility/metadata, not preset application. `waterEnabled: false` hides the layer; explicitly setting a new mode enables it unless a new false toggle is supplied. Moving water does not change terrain formation.

## Underwater and composition

Use the pipeline for Lite/High/Auto fog, distortion, caustics and optional particles/shafts. `waterUnderwaterVisibility` is a density multiplier: visibility distance = 140 / max(0.25, value), not metres. `waterUnderwaterFogDensity` controls intensity; `waterSurfaceTransition` sets the blend band. Parented cameras use world coordinates. All water layers are excluded from water-free captures. Custom Three.js materials are not automatically patched with projected terrain caustics. Dispose the pipeline separately.

## Quality budgets

`waterQuality`: integer 0–2; `waterDetail`/`waterReflection`: 0–2; `waterWaves`: 0–4. Unknown/invalid budgets fail explicitly. Change budgets through `configure({ quality: ... })`. Try `waterRenderScale: 0.5` before increasing capture cost.

| Parameter | Type | Default |
| --- | --- | --- |
| `waterQuality` | number | `2` |
| `waterDetail` | number | `1` |
| `waterReflection` | number | `1` |
| `waterWaves` | number | `2` |

## Parameter reference

Every accepted field and attached default is listed below. Standalone overrides are described above. Scalars must be finite and booleans must be booleans; not every shader uses every field. `seaLevel` (world Y, defaults to host) and `waterAnim` (host boolean setting) are also accepted. Depth, shoreline, foam, transition and caustic-depth distances use world units; directions use degrees. Diorama fields apply to Mini/Stylized.

| Parameter | Type | Default |
| --- | --- | --- |
| `waterEnabled` | boolean | `true` |
| `waterHideAtZero` | boolean | `true` |
| `waterMode` | string | `"legacy"` |
| `waterQualityPreset` | string | `"legacy"` |
| `waterAutoDowngradeInfinite` | boolean | `true` |
| `waterLegacyOnLowFps` | boolean | `true` |
| `waterOpacity` | number | `0.72` |
| `waterRoughness` | number | `0.35` |
| `waterFresnelStrength` | number | `1` |
| `waterRefractionStrength` | number | `0.45` |
| `waterSpecularStrength` | number | `1` |
| `waterBiomeColorEnabled` | boolean | `true` |
| `waterBiomeColorStrength` | number | `0.55` |
| `waterNaturalColor` | number | `0.7` |
| `waterDioramaShader` | string | `"stylized"` |
| `waterDioramaReflections` | string | `"auto"` |
| `waterDioramaReflectionStrength` | number | `1` |
| `waterDioramaReflectionBlur` | number | `0` |
| `waterDioramaReflectionDistortion` | number | `1` |
| `waterDioramaTransparency` | number | `0.5` |
| `waterDioramaTint` | number | `1` |
| `waterDioramaShoreClarity` | number | `0` |
| `waterAtmosphereInfluence` | number | `1` |
| `waterSunResponse` | number | `1` |
| `waterAmbientResponse` | number | `1` |
| `waterFoamLighting` | number | `0.65` |
| `waterDepthColorStrength` | number | `1` |
| `waterDepthOpacityStrength` | number | `1` |
| `waterMaxVisibleDepth` | number | `120` |
| `waterDepthFalloff` | number | `1` |
| `waterShallowDistance` | number | `8` |
| `waterDeepDistance` | number | `55` |
| `waterAbsorptionStrength` | number | `1` |
| `waterWaveSpeed` | number | `1` |
| `waterWaveScale` | number | `1` |
| `waterWaveStrength` | number | `1` |
| `waterSmallWaveStrength` | number | `0.65` |
| `waterLargeWaveStrength` | number | `1` |
| `waterNormalIntensity` | number | `1` |
| `waterWaveDirection` | number | `0` |
| `waterAnimSpeed` | number | `1` |
| `waterFoamEnabled` | boolean | `true` |
| `waterFoamStrength` | number | `0.75` |
| `waterFoamWidth` | number | `3.2` |
| `waterFoamSoftness` | number | `0.6` |
| `waterFoamAnimSpeed` | number | `1` |
| `waterSlopeFoam` | number | `0.25` |
| `waterCliffFoam` | number | `0.3` |
| `waterUnderwaterEnabled` | boolean | `true` |
| `waterUnderwaterMode` | string | `"auto"` |
| `waterUnderwaterFogDensity` | number | `1` |
| `waterUnderwaterVisibility` | number | `1` |
| `waterUnderwaterDistortion` | number | `0.5` |
| `waterUnderwaterCaustics` | number | `0.4` |
| `waterUnderwaterCausticsEnabled` | boolean | `true` |
| `waterUnderwaterCausticScale` | number | `1` |
| `waterUnderwaterCausticSpeed` | number | `1` |
| `waterUnderwaterCausticMinDepth` | number | `1` |
| `waterUnderwaterCausticMinDepthFalloff` | number | `1` |
| `waterUnderwaterParticles` | boolean | `false` |
| `waterUnderwaterLightShafts` | boolean | `false` |
| `waterSurfaceTransition` | number | `0.8` |
| `waterReflectionQuality` | number | `1` |
| `waterRefractionQuality` | number | `0.6` |
| `waterFoamQuality` | number | `1` |
| `waterCausticsQuality` | number | `0.5` |
| `waterNormalResolution` | number | `1` |
| `waterRenderScale` | number | `1` |
| `waterUpdateFrequency` | number | `1` |
| `waterDisableExpensiveBelowFps` | number | `42` |
| `waterDebugView` | string | `"off"` |
| `waterShowMeshBounds` | boolean | `false` |
| `waterShowPerfCost` | boolean | `false` |
