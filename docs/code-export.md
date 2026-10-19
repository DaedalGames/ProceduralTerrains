# Studio and code export

The studio can export runnable JavaScript alongside meshes and maps. The generated code uses the public npm runtime.

## Export from the studio

Open the Export panel and enable **Include Terrain Code (npm)**. The ZIP gains a `code/` folder with:

| File | Purpose |
| --- | --- |
| `terrain.js` | The terrain document and `createExportedTerrain({ renderer, signal })` factory |
| `terrain.json` | The same versioned runtime document as JSON |
| `main.js` | Three.js scene, camera, controls, rendering loop and cleanup |
| `index.html` | Standalone example page |
| `package.json` | Vite development and production scripts |
| `studio-project.ptrterrain` | Editable studio project, preserving the original editor state |
| `README.md` | Installation steps and any conversion limitations |

The code includes seed, supported noise or graph/manual source, palette, layout, lighting, Mini state, and enabled water/cloud layers.

## Run the exported code

Compile this repository with `npm run build`, extract the ZIP and open a terminal in its `code/` folder:

```sh
npm install
npm install /path/to/dist/npm/procedural-terrains-0.1.0-alpha.0.tgz
npm run dev
```

The package is still a local alpha. Install the generated archive; an install from the public npm registry is not assumed.

## Integrate into your own scene

```js
import { createExportedTerrain } from './terrain.js';

const terrain = await createExportedTerrain({ renderer });
scene.add(terrain.object);
await terrain.prepare(camera);
```

Call `terrain.update(dt, { camera })` in your loop. When effects are present, render the scene through `TerrainRenderPipeline`, as in the exported example.

## Conversion scope

The public runtime supports a subset of studio settings. The generated README lists detected differences. Custom PBR packs, imported imagery, painted layers, erosion/destruction deltas, splines, props, backgrounds and arbitrary tile assemblies may need manual integration. The editable project preserves the studio document; baked meshes/maps remain the visual interchange format.

Mini uses its presentation state and does not include studio vegetation. Imported elevation requires an explicit heightmap or real-world provider in your application.

## Runtime documents

```js
import { loadTerrainDocument } from 'procedural-terrains/documents';

const document = terrain.serialize();
const restored = await loadTerrainDocument(document, { renderer });
scene.add(restored.object);
await restored.prepare(camera);
```

Runtime JSON, editable studio projects, and Unity/Blender `.ptrterrain` exports have different schemas. `loadTerrainDocument` accepts the `procedural-terrains` schema, not raw studio presets or engine documents.

## Mesh and map exports

```js
import { exportTerrain, zipTerrainExport } from 'procedural-terrains/export';

const result = await exportTerrain(terrain, {
  format: 'glb', meshRes: 128, texRes: 512,
  bakeColor: true, exportHeightmap: true,
});
const zipBytes = zipTerrainExport(result);
```

Files are returned as byte arrays, without automatic download. For infinite worlds, add `region: { cx: 0, cz: 0, size: 1024 }`. Planet export covers six faces. Await operations before reusing GPU resources or disposing the terrain.

