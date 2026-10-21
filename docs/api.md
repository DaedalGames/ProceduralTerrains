# API reference

The package exports ESM modules and TypeScript declarations. Three.js `~0.185.1` is a peer dependency. Core imports have no DOM side effects.

## Entry points

| Import | Public API |
| --- | --- |
| `procedural-terrains` | `createTerrain`, `FiniteTerrain` |
| `procedural-terrains/infinite` | `createInfiniteTerrain` |
| `procedural-terrains/planet` | `createPlanetTerrain` |
| `procedural-terrains/mini` | `createMiniTerrain`, Mini state/layout/framing helpers |
| `procedural-terrains/generation` | Noise Stack, graph and manual document helpers |
| `procedural-terrains/water` | `createWater`, `TerrainWater`, defaults and modes |
| `procedural-terrains/clouds` | `createClouds`, `TerrainClouds`, defaults |
| `procedural-terrains/render` | `TerrainRenderPipeline`, `TerrainPass`, height/detail caches |
| `procedural-terrains/assets` | Resource scopes, PBR providers, compute workers |
| `procedural-terrains/real-world` | `TerrariumProvider`, `createRealWorldTerrain` |
| `procedural-terrains/documents` | `loadTerrainDocument` |
| `procedural-terrains/export` | `exportTerrain`, `zipTerrainExport` |
| `procedural-terrains/viewer` | `createTerrainViewer` |

## createTerrain(options)

Returns `Promise<FiniteTerrain>`. Add `terrain.object` to your scene, then await `terrain.prepare(camera)` before presenting it.

| Option | Description |
| --- | --- |
| `renderer` | Required caller-owned `THREE.WebGLRenderer` |
| `configuration` | Optional partial terrain configuration |
| `signal` | Optional `AbortSignal` |
| `resources` | Optional shared `TerrainResources` scope using the same renderer |

`createInfiniteTerrain` and `createPlanetTerrain` take the same options, with additional world-specific layout fields. `createMiniTerrain` also takes `mini` and `backdrop`.

## Configuration

All dimensions and heights use world units. Fields are nested; `configure` merges patches and validates values.

| Field | Default | Description |
| --- | --- | --- |
| `layout.chunkCount` | `8` | Finite board chunks per side, integer 1–32 |
| `layout.chunkSize` | `128` | World units per chunk, 1–100000 |
| `heightScale` | Studio default | Relief multiplier, 1–100000 |
| `seaLevel` | Studio default | Shoreline height, −100000–100000; water is a separate layer |
| `source.kind` | `'noise'` | `noise`, `graph`, `manual`, or `heightmap` |
| `source.seed` | Studio default | Integer −2147483648–4294967295 |
| `source.octaves` | Studio default | Integer 1–12 |
| `source.scale` | Studio default | Noise scale, 0.01–1000 |
| `source.strength` | Studio default | Noise amplitude, 0–4 |
| `source.stack` | Legacy stack | Optional serialized Noise Stack |
| `quality.lodSegments` | `[64,32,16,8]` | Four even resolutions, halving at each level, maximum 256 |
| `quality.lodDistanceScale` | `1` | LOD distance multiplier, 0.1–10 |
| `quality.morphEnabled` | `true` | Smooth LOD transitions |
| `quality.mergeEnabled` | `true` | Chunk merging |
| `quality.cullingEnabled` | `true` | Frustum culling |
| `lighting.sunAzimuth` | Studio default | Degrees, −360–360 |
| `lighting.sunElevation` | Studio default | Degrees, −90–90 |
| `lighting.fogDensity` | `0` | Fog density, 0–10 |
| `palette` | Earth | Linear RGB triples in [0,1], keyed by biome |

Other source knobs: `smoothing` and `detail` (0–1), `persistence` (0.01–1), `lacunarity` (1–4), `ridge` (0–2), `warp` (0–4), `falloff` (0–1), and `edgeFalloffMode` (`island` or `mountains`). Unknown options fail explicitly.

### Terrain materials and lighting style

The runtime uses the studio's procedural terrain shader and automatically prepares camera-local detail pages in a worker during `update`. No external texture pack is required. Set `material.terrainDetailQuality: 0` to disable detail. An explicit `createDetailCache` takes ownership of detail until disposed.

The `material` configuration preserves the studio's biome, slope, normal and AO inputs (`biomeScale`, `moistScale`, `moistBias`, `tempBias`, `snowLine`, `normalStrength`, `aoStrength`, slope gates), `terrainDetail*` quality and distance controls, triplanar/shore/micro/macro detail, and terrain color variation, rock, soil, sand and wet-shore shader settings. `style` stores palette saturation/contrast/tint, sun color/intensity, sky ambient and ground bounce. Colors use linear RGB.

`terrainFormationSeaLevel` is a separate generation input. Changing the live `seaLevel` does not change that baseline. These fields serialize in terrain documents and are included in new studio code exports.

Mini's document controls its footprint and presentation. Loading it preserves the saved terrain source, height and palette. Mini materials receive water scene color and depth captures before their first rendered frame, including after a water reconfiguration. Use `TerrainRenderPipeline` to render those passes.

Older code exports did not contain custom material/style values. Re-export from the studio to retain those values; they cannot be recovered from an old snippet.

## Runtime properties and methods

| Member | Description |
| --- | --- |
| `object` | The `THREE.Group` to add to your scene |
| `mode` | `finite`, `infinite` or `planet`; fixed at construction |
| `configuration` | Detached, immutable normalized configuration |
| `prepare(camera, { signal? })` | Compile shaders and prepare GPU caches; returns a promise |
| `configure(patch, { signal? })` | Apply a validated patch and prepare changed resources |
| `update(deltaSeconds, { camera })` | Update LOD, streaming and attached effects |
| `sampleHeight(x, z)` | CPU height approximation; null outside finite boards |
| `sampleHeight3D(x, y, z)` | Planet relief above its radius; the direction (x,y,z) must be nonzero |
| `setSurface(surfaceOrNull)` | Attach or detach caller-owned PBR resources |
| `serialize()` | Detached versioned document, including effect extensions |
| `getDiagnostics()` | Runtime state, revisions, chunks and world-specific metrics |
| `dispose()` | Idempotent resource cleanup and group removal |

Keep an identity transform on the terrain group and its ancestors. Height sampling approximates the GPU field and is not exact triangle collision. Scene lights and tone mapping do not replace the terrain's built-in lighting.

## Documents and exports

```js
import { loadTerrainDocument } from 'procedural-terrains/documents';
import { exportTerrain, zipTerrainExport } from 'procedural-terrains/export';

const restored = await loadTerrainDocument(savedDocument, { renderer });
scene.add(restored.object);
await restored.prepare(camera);

const result = await exportTerrain(restored, {
  format: 'glb', meshRes: 128, texRes: 512,
  bakeColor: true, exportHeightmap: true,
});
const zipBytes = zipTerrainExport(result);
```

`loadTerrainDocument(document, options)` accepts a parsed JSON object with `format: 'procedural-terrains'`, `schemaVersion: 1`, `kind`, `configuration` and optional `extensions`. Effects are restored before the promise resolves. Reattach borrowed material and imagery assets yourself.

`exportTerrain` returns named byte arrays, diagnostics and a filename. It never downloads a file. Infinite worlds require `region: { cx, cz, size }` in world units; planets export all six faces. Await GPU work before another export or disposal.

## Lifecycle and errors

| Code | Meaning |
| --- | --- |
| `TERRAIN_CANCELLED` | The abort signal canceled the operation |
| `TERRAIN_SUPERSEDED` | A newer configuration replaced pending work |
| `TERRAIN_DISPOSED` | The terrain was disposed |

GPU compilation itself cannot be interrupted. Shader candidates are validated before publication. If cache or effect warm-up fails after configuration commits, the new configuration stays active: retry `prepare(camera)`.

Dispose effects through their terrain or individually, and dispose render pipelines separately. Borrowed renderers, textures, surface resources and shared scopes remain owned by the caller.


## Independent effects

createWater and createClouds accept either terrain, or renderer with an optional world (finite/infinite mode, size, heightScale, seaLevel, sunAzimuth, sunElevation). They expose a stable object group and support configure({ mode, parameters, quality }). Pass standalone effects to TerrainRenderPipeline({ renderer, effects }); update/dispose them explicitly. Terrain-attached layers are updated/disposed by their terrain. Full references: [water](water.md), [clouds](clouds.md), [feature coverage](features.md), [larger worlds](large-worlds.md).
