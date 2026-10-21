# Package feature coverage

This is a Three.js WebGL2 runtime, not the complete Terrain Studio application. This table describes the current repository build. A published npm alpha can have fewer features; install the local tarball to test unreleased changes.

| Feature | Runtime support and limits |
| --- | --- |
| Finite Tile terrain | Shared generation, shaders, LOD, culling, merging, sampling and serialization |
| Infinite terrain | Camera-following streaming, clipmaps and bounded GPU caches |
| Planet terrain | Cube-sphere geometry and 3D Noise Stacks; no 2D graph/manual heightmap sources |
| Mini Terrain | Composition, clipping, strata, bevels, optional backdrop and suggested framing |
| Noise Stacks and graphs | Stacks in supported worlds; 2D graphs on finite/infinite worlds |
| Manual shapes/sculpt/paint documents | Finite sources; no editing UI, undo history or interactive tools |
| Procedural terrain materials | Biome/slope/color/normal/AO/detail controls; automatic detail pages |
| PBR and surface graphs | Explicit providers/resources; host packs and user assets yourself |
| Independent water | `createWater({ renderer, world, ... })` around your meshes, or attach via `{ terrain }` |
| Independent clouds | `createClouds({ renderer, world, ... })`, Legacy/Realistic; no terrain geometry needed |
| Spherical effects | Attach to a planet terrain; advanced flat-water modes fall back to Legacy |
| Underwater | Lite/High/Auto, optical fog, distortion, caustics, optional particles/shafts via the pipeline |
| Cloud shadows | Package terrain shaders; custom Three.js materials are not automatically patched |
| Sky and post-processing | Host-owned; no automatic studio atmosphere, grading, bloom or day/night system |
| Vegetation and props | Editor scattering and asset libraries are not public runtime components |
| Splines/roads/rivers/destruction | No automatic editor-project replay; bake meshes/maps or integrate application logic |
| Erosion | `TerrainCompute.erode` returns deltas/maps; apply and store explicitly |
| Real-world data | Explicit elevation/imagery providers; no map UI, account, building or marker service |
| Code export | Supported configuration/effects; conversion notes identify editor-only data |
| GLB/OBJ/maps | Supported artifacts; live clouds and procedural water are not portable glTF effects |
| Precision | Local coordinates and bounded streaming, not an Earth-scale floating-origin manager |
| Dependencies | No React/Electron/backend; only `/viewer` creates a convenience canvas and loop |
| Renderer | Caller-owned Three.js `~0.185.1` WebGL2; no WebGPU backend |

## Choose your integration

See [getting started](getting-started.md), [water](water.md), [clouds](clouds.md), [composition](effects.md) and [larger worlds](large-worlds.md).

A terrain owns its attached layers. Standalone effects own lightweight domains and GPU resources without terrain meshes. Your application owns the scene, renderer, camera, resize policy and loop. Dispose pipelines separately.
