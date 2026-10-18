# npm runtime extraction — milestone 1

## Delivered boundary

The root `terrain-studio` application remains private with its Electron entry
point and existing studio build. A separately versioned workspace,
`packages/procedural-terrains`, contains the package manifest, public entry,
types and generated library output. Its build uses the existing source graph,
with Three.js external, and rejects React, Electron, Leaflet and studio project,
platform/auth/component imports. No public directory is copied into the package.

`src/runtime/FiniteTerrainRuntime.js` owns the existing `TerrainBoard` without
owning its material or renderer. Both `Engine` and the public `FiniteTerrain`
use it. The studio retains its board alias for existing tools and transitions.
`TerrainParameters.js` contains the original shape/shading uniform mapping,
including the deterministic seed offset. The studio retains its original order
around Mini, tile occupancy, destruction, graph uniforms and lighting updates.

The public facade owns its uniforms, one classic-noise material and geometries,
has explicit frame updates, and cannot start a canvas loop or access storage.
Uniform edits reuse geometry. Octave edits compile isolated materials and use
revision checks before publication. Destruction and AbortSignal cancellation
invalidate pending work. Per-instance fallback textures avoid cross-instance
GPU lifetime coupling.

The legacy EngineProxy and its render Worker remain studio-only. Their DOM/input,
save-dialog and performance-persistence behavior is not part of the npm API.

## Scope and validation

Milestone 1 covers one finite square board, classic noise, palette, four-level
LOD/geomorphing, merging/culling, CPU height queries, serialization and disposal.
It deliberately retains the existing geometry/shader algorithms. Public root
transforms must be identity until every shader, sampler and culling path uses
the same local/world-space contract.

Contract tests cover renderer ownership, live edits, immutable/invalid input,
independent instances, superseded shader work, abort, failed compilation and
late completion after destruction. Studio tests cover shared LOD/culling and
seed/uniform semantics. `test:package` installs the actual tarball into a
temporary consumer and checks ESM import without DOM, one Three.js instance,
sampling, configuration and disposal. The example has no React/Electron imports.

## Subsequent migrations

1. Extract a targeted water context from `WaterSystem(engine)`, then expose
   optional reflection/refraction passes with renderer-state preservation.
2. Expose cloud layers and renderer-scoped resource leases. Keep quality
   adaptations observable rather than persisting studio preferences.
3. Add infinite and planet factories with their existing batching, baking,
   streaming budgets and mode-specific water limitations.
4. Split Mini geometry/composition from studio stage/camera framing.
5. Add graph/manual/heightmap sources as validated discriminated documents;
   keep pointer-driven authoring managers in studio/browser adapters.
6. Inject asset and geographic providers. Replace absolute asset URLs,
   SurfaceAssetStore imports and globally cancelled preparation Workers.
7. Separate export bytes/artifacts from DesktopBridge downloads and dialogs.

Each feature gets a typed subpath export only when its lifecycle and dependency
boundary are implemented and tested. No placeholder subpath exports are shipped.
Extend Three.js compatibility beyond r185 only after testing its shader and
texture-array paths. Publishing to npm and merging into develop are separate
release actions.
