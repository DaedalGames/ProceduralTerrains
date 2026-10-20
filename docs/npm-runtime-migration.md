# npm runtime migration

The runtime is extracted around the existing algorithms and rendering classes,
without copying a second terrain engine or exposing EngineProxy as a public API.
The private Electron/Vite studio remains the repository's application; the public
workspace package has its own ESM build, declarations and dependency boundary.

| Milestone | Delivered |
| --- | --- |
| Finite runtime | Caller-owned renderer/scene/camera/loop; shared TerrainBoard and parameter application; configuration, sampling, disposal |
| Sources/resources | Noise Stack, 2D graph, manual/sculpt/paint and heightmap sources; explicit material providers; owned caches and cancellable workers |
| Worlds | InfiniteWorld + clipmaps; PlanetWorld + cubemap height/climate baker; Mini controller/stage through a narrow context |
| Environment | Existing WaterSystem and both cloud engines behind explicit layers; whole-scene render pipeline and composer pass |
| Interchange | Detached JSON documents; GLB/OBJ/map artifacts; ZIP helper; explicit real-world height/imagery providers |
| Distribution | Typed ESM subpaths, external Three.js peer, portable bundled workers, npm tarball consumer, browser matrix, studio regression CI |

## Current feature reference

See [feature coverage](features.md), [water](water.md), [clouds](clouds.md) and [larger worlds](large-worlds.md) for current independent-effect support, lifecycle and limitations. Historical validation counts below describe the initial extraction.

## Ownership and boundaries

- `src/runtime/FiniteTerrain.js` orchestrates terrain resources; world adapters
  supply geometry streaming, probes, bakes and samplers. It does not instantiate
  Engine, EngineProxy, controls, DOM listeners, storage or a render loop.
- `src/runtime/TerrainSources.js` owns CPU documents, manual fields and uploaded
  height textures. Source-kind restrictions match existing evaluator capabilities;
  the 2D graph compiler is not silently used on a spherical world.
- `src/runtime/effects` borrows narrow terrain state and reuses WaterSystem,
  cloud layers, TerrainHeightBaker and DetailPageCache. Optional passes use
  exception-safe renderer state restoration. Compositing reads opaque depth from
  a target distinct from the output colour target.
- `src/runtime/resources` supplies explicit resource scopes, providers, workers,
  shader validation and state restoration. Caller buffers are copied before
  transfer. Cancellation/destruction is scoped to the owner or individual job.
- The studio's SurfacePreparationClient now has an engine-owned worker scope.
  Two studios cannot cancel each other's material work. A legacy default scope
  remains for callers that do not provide an owner.
- `TerrainExportBuilder`, `PlanetExportBuilder` and `WaterMaskArtifacts` return
  data. Existing studio exporter files remain compatibility adapters that ZIP
  and invoke DesktopBridge. The npm entry graph cannot import that bridge.
- GPU cloud noise volumes remain shared per renderer, with explicit layer leases
  so destroying one cloud layer does not invalidate another or leak the last one.
- SurfaceResources receives catalog/fetch/user-asset providers. The studio injects
  SurfaceAssetStore from its adapter; the library never imports project storage.
- Real-world fetch helpers accept URL/fetch injection while their studio defaults
  stay compatible. The npm provider requires explicit endpoints and attribution.
- Only `/viewer` creates a DOM canvas, OrbitControls, ResizeObserver and a loop,
  and only when its factory is called. It is a convenience application adapter.

## Performance and maintenance decisions

This is a layered extraction, not an EngineProxy wrapper or a full rewrite.
Instancing, LOD, merging rules, streaming budgets, shader generation and GPU
bakers retain their existing implementations. Continuous edits retain geometry;
only structural/program/surface changes require a new terrain material.
Uniform-only lighting/palette edits do not rebuild world caches. Finite height caches are explicit; procedural detail pages now prepare lazily during update and can be disabled with material.terrainDetailQuality: 0. Specialized world caches remain available.

Workers perform CPU erosion, detail and material preparation. Rendering stays on
the host renderer, avoiding a second WebGL context, scene serialization or transfer
of live Three.js objects. No blanket offscreen-renderer abstraction or backend
rewrite is introduced. Three.js stays a narrow, tested peer range because shaders
and compressed array uploads depend on r185 behavior.

Public documents are independent of the editor's projects and proxy RPC. They
record supported generation/configuration/effect state, not editor history,
selection, account metadata or owned UI. Applications reattach borrowed surface
and imagery resources through explicit APIs. Geographic acquisition is optional;
building/city/marker services and maps remain provider/application concerns.

## Compatibility and release

The studio still imports Engine and its compatibility exporters. The finite
terrain path continues to use the shared runtime from milestone 1; optional
systems reuse the same lower-level classes rather than forcing the studio to
adopt the public API in one large rewrite. Existing tests and the studio build
remain required checks alongside package tests.

The alpha supports identity-transformed worlds and a caller-managed WebGL2
renderer. It does not promise arbitrary Three.js material conventions or exact
CPU/GPU collision equality. Mini's footprint/composition is configured via its
presentation API. A configuration's optional GPU cache/effect warm-up may fail
after the configuration commit; consumers can retry prepare and inspect state.

Package builds are local and reproducible. This migration does not merge its PR
or publish to npm. Publishing can follow review with a chosen package namespace,
version and registry credentials, using the prepared prepublish checks.

## Validation recorded for this extraction

- 880 Vitest tests across 110 files, including 32 public runtime/studio contract tests.
- 52 renderer Node tests.
- Strict TypeScript consumers covering all public subpaths.
- Actual npm tarball installation and import of every entry point without DOM;
  one shared Three.js instance in the consumer.
- Studio production build, including verification of 22 local PBR materials and
  nine recipes; independent example production build.
- 27 production WebGL scenarios: all world/source families, water modes,
  legacy/realistic clouds, combined world effects, underwater composition,
  erosion/detail/material Workers, PBR arrays, finite/infinite/planet exports.
  Every scenario returned GL error zero and a nonuniform rendered image.
- Separate finite integration verifies visible seed changes, octave replacement,
  renderer reuse after disposal and GL error zero.

Browser validation ran in Chromium with ANGLE/SwiftShader. It establishes shader
and lifecycle integration, not hardware performance parity or a GPU benchmark.
