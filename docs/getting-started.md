# Getting started

The `procedural-terrains` package brings the studio's terrain runtime into your own Three.js application. It is an ESM alpha with TypeScript declarations. Rendering requires browser WebGL2.

## Install

Install the alpha from npm:

```sh
npm install procedural-terrains
```

Three.js `~0.185.1` is a peer dependency, installed automatically by npm when needed. To build from source, run `npm ci` then `npm run build` in the repository. This builds the library and studio, and writes an installable archive to `dist/npm/`. You can install that archive in your application instead:

```sh
npm install /path/to/procedural-terrains-0.1.0-alpha.0.tgz three@~0.185.1
```

For just the library, use `npm run build:lib`, followed by `npm pack --workspace=procedural-terrains`. For just the studio, use `npm run build:app`.

## Your first terrain

You can edit and run the examples directly in the studio's **Docs → Playground** page. It includes live preview, console output, shared links and a standalone HTML download.

Use an existing renderer, scene and camera:

```js
import { createTerrain } from 'procedural-terrains';

const terrain = await createTerrain({
  renderer,
  configuration: {
    layout: { chunkCount: 8, chunkSize: 128 },
    heightScale: 560,
    source: { kind: 'noise', seed: 1337 },
  },
});
scene.add(terrain.object);
camera.position.set(900, 700, 900);
camera.lookAt(0, 150, 0);
await terrain.prepare(camera);

function frame(deltaSeconds) {
  terrain.update(deltaSeconds, { camera });
  renderer.render(scene, camera);
}
```

Call `frame` from your animation loop, with seconds rather than milliseconds.

## Update and dispose

```js
await terrain.configure({ source: { seed: 42 } });
const height = terrain.sampleHeight(0, 0);
const document = terrain.serialize();
terrain.dispose();
```

Configuration patches merge into the current configuration. Do not mutate `terrain.configuration`. Dispose the terrain when removing its scene; its renderer remains yours.

## Optional viewer

The viewer owns a renderer, camera, orbit controls and animation loop. It currently creates finite terrain only:

```js
import { createTerrainViewer } from 'procedural-terrains/viewer';

const viewer = await createTerrainViewer(
  document.querySelector('#terrain'),
  { configuration: { source: { seed: 42 } } },
);
// The container needs a nonzero height.
// When closing:
viewer.dispose();
```

For infinite worlds, planets, Mini, or advanced effects, use your own scene. Continue with [worlds and sources](worlds.md) or the [API reference](api.md).

