# Procedural Terrains — finite runtime preview

An ESM library for adding a procedural finite terrain to your own Three.js
scene. This is the first extraction milestone (`0.1.0-alpha.0`), developed
alongside Terrain Studio 2.0.0. It has not been published to npm by this change.

## Try it from this repository

```sh
npm ci
npm run build:lib
npm pack --workspace=procedural-terrains
```

Install the generated `.tgz` in your application along with `three@~0.185.1`.
The package includes its ESM build and TypeScript declarations. There are no
React, Electron, account, API, network-asset or stylesheet dependencies.

```js
import * as THREE from 'three';
import { createTerrain } from 'procedural-terrains';

// Use your existing renderer, scene and camera.
const terrain = await createTerrain({
  renderer,
  configuration: {
    layout: { chunkCount: 8, chunkSize: 128 },
    source: { kind: 'noise', seed: 1337, octaves: 7 },
    heightScale: 560,
    palette: { grass: [0.13, 0.26, 0.085] },
  },
});
scene.add(terrain.object);
await terrain.prepare(camera);

// Call from your existing loop. The terrain never starts a loop or renders.
function frame(deltaSeconds) {
  terrain.update(deltaSeconds, { camera });
  renderer.render(scene, camera);
}

await terrain.configure({ source: { seed: 42 } });
const height = terrain.sampleHeight(0, 0);
const document = terrain.serialize();
terrain.dispose();
```

Run the plain Three.js example:

```sh
npm run build:lib
cd examples/three-finite-terrain
npm install
npm run dev
```

## Contract

- The caller owns the renderer, scene, camera, resize policy and animation loop.
- `prepare(camera, { signal })` warms and validates shaders before the first
  render. Check its rejection before displaying the terrain.
- `configure(patch, { signal })` accepts a validated partial configuration.
  Seed, height and palette edits preserve geometry. Octave changes compile a
  candidate material before publishing it; the previous terrain stays usable.
- New configurations supersede pending operations. Cancellation rejects with
  `TERRAIN_CANCELLED`, replacement with `TERRAIN_SUPERSEDED`, and destruction
  with `TERRAIN_DISPOSED`. A superseded/aborted job cannot publish later.
  An in-progress GPU driver compile cannot be interrupted; its candidate is
  disposed when compilation settles. Catch operation rejections in your UI.
- `configuration` is deeply frozen. `serialize()` returns a detached document;
  reconstruct with `createTerrain({ renderer, configuration: doc.configuration })`
  after validating the document's format/schema in your application.
- `sampleHeight(x, z)` returns the CPU height approximation, or `null` outside
  the board. Floating-point GPU results can differ; this is not an exact mesh
  collision or baked-height API.
- `dispose()` is idempotent, detaches the group and frees its geometries,
  materials and fallback textures. It never disposes the caller's renderer.
- Use an identity world transform for the terrain and its ancestors. Translation,
  rotation and scaling are rejected by `update`, `prepare` and `sampleHeight`.
- The built-in terrain shader uses its own sun/ambient shading and encoded
  colour output. It does not automatically adopt arbitrary scene lights,
  clipping, custom shader modifications or post-processing conventions.

The declared configuration types list the supported settings and ranges are
validated at runtime. `seaLevel` affects terrain colouring; the classic terrain
formation baseline stays at the studio's default 100 units when sea level moves.
This preview does not create water, clouds, a diorama bottom, props, imports,
graph/manual sources, tiles beyond the initial board, infinite/planet worlds,
or exports. Those systems remain available in Terrain Studio.

## Maintainer checks

```sh
npm run check:lib
npm test
npm run build
```

After installing the example's dependencies, `npm run test:lib:browser` checks
the real WebGL2 shader, seed/octave updates, pixels and renderer reuse with
Playwright Chromium. Run `npx playwright install chromium` first, or set
`TERRAIN_BROWSER_PATH` to an existing Chromium executable. The default headless
check uses SwiftShader; it does not measure hardware GPU performance.

The library build follows shared sources in `src/runtime` and `src/engine` and
bundles them into this package's `dist`. This avoids copying engine algorithms
during migration. The built JavaScript has no runtime imports of repository
source files outside the tarball; sourcemaps retain source locations for debugging.
Studio keeps its renderer, Worker path, shader warm-up policy and progressive
build cadence, while sharing finite geometry, LOD/culling and parameter mapping.
