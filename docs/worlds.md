# Worlds and sources

Choose a world when creating the terrain. Switching worlds requires another runtime instance.

## Tile

```js
import { createTerrain } from 'procedural-terrains';
const terrain = await createTerrain({ renderer, configuration: {
  layout: { chunkCount: 8, chunkSize: 128 },
  source: { kind: 'noise', seed: 1337 },
} });
```

The finite runtime creates one square board with chunk LOD. Arbitrary studio tile assemblies are not part of this alpha's public layout API.

## Infinite World

```js
import { createInfiniteTerrain } from 'procedural-terrains/infinite';
const terrain = await createInfiniteTerrain({ renderer, configuration: {
  layout: {
    chunkSize: 128, viewRadius: 8, cacheResolution: 256,
    triangleBudget: 1000000, maxCreatesPerFrame: 16, streamBudgetMs: 1.5,
  },
} });
```

Streaming follows the camera supplied to `update`. Noise and unbounded 2D graphs are supported; bounded manual and heightmap sources require finite terrain.

## Planet

```js
import { createPlanetTerrain } from 'procedural-terrains/planet';
const terrain = await createPlanetTerrain({ renderer, configuration: {
  layout: { radius: 16000, faceGrid: 8, bakeResolution: 256 },
  source: { kind: 'noise', seed: 1337 },
} });
```

Planets require a Noise Stack with 3D evaluation. Layout fields control cube-sphere patches, triangle budgets and bake resolution. Use `sampleHeight3D(x, y, z)` for CPU relief along a nonzero direction above the planet radius.

## Mini

```js
import { createMiniTerrain } from 'procedural-terrains/mini';
const terrain = await createMiniTerrain({
  renderer, mini: { recipe: 'cove', seed: 1337, width: 1024 },
  backdrop: true,
});
await terrain.mini.configure({ waterLevel: 0.6 });
const framing = terrain.mini.framing();
```

Mini manages its finite configuration, relief, composition, resolution and footprint. Apply changes through `terrain.mini.configure`. Framing is a suggestion; your application moves its own camera. Water and clouds are optional layers; vegetation and editor controls are not installed.

## Sources

| Kind | Data |
| --- | --- |
| `noise` | Seed and noise parameters; optional `stack` |
| `graph` | Validated `graph` document |
| `manual` | `document` with shapes/sculpt and flat, procedural or graph base; optional `resolution` 16–1024 |
| `heightmap` | `data`, `width`, `height` |

```js
await terrain.configure({ source: {
  kind: 'heightmap', width: 2, height: 2,
  data: new Float32Array([0, 50, 120, 30]),
} });
```

Heightmaps span the finite board, with row zero at negative Z. Values are world-unit heights within ±60000, uploaded as filtered half floats. Data and dimensions must match.

## Real-world data

`createRealWorldTerrain` uses an explicit provider with `loadHeightmap` and optional `loadImagery`. `TerrariumProvider` requires tile URLs and attribution supplied by your application. Bounding boxes use `west/east/south/north`, Web Mercator latitude limits, and at most 6×6 tiles. Split antimeridian-crossing regions yourself. No account or studio map service is used implicitly.

