# Larger worlds and performance

[Open the large-world playground](#/docs/playground?example=large-world).

## Choose a coverage strategy

| Use case | Strategy |
| --- | --- |
| Island, lake or diorama | Finite terrain/effects centered at the origin |
| Flight, ocean or open world | Infinite terrain plus camera-following water/cloud volumes |
| Whole globe | Planet terrain with attached spherical effects |
| Existing Three.js environment | Independent effects with a finite/infinite world |

Standalone `world.size` is bounded active coverage, up to 100000 world units. It allocates no terrain geometry. Infinite effects move this window with the camera; they do not draw infinite-sized geometry. Use matching domain dimensions and sun angles for independent water/clouds that should line up.

## Scale dimensions together

Choose a consistent convention, for example one unit = one metre, for meshes, heightScale, seaLevel, cloudAltitude/thickness, optical depths and camera clipping. A 12 km scene might use water depth distances of 100–1000, clouds at 1800 with thickness 900, and near/far 5–80000. These are example values, not physically calibrated weather/ocean units.

Cloud frequencies remain relative controls: higher cloudScale/cloudSystemScale gives smaller formations. Wave scales and underwater visibility are shader controls, not automatic coverage scaling. Reconfigure appearance explicitly when changing scene scale.

## Bound work instead of enlarging geometry

Terrain: chunkSize/viewRadius, triangleBudget, maxCreatesPerFrame, streamBudgetMs, cacheResolution, LOD. More chunks/view radius can increase geometry and cache cost. Water: render scale and reflection/refraction budgets; captures can draw opaque meshes again. Infinite water reduces expensive modes unless explicitly opted out.

Clouds: start at 24 Realistic steps and 0.5 render scale. Cost depends on viewport, pixel ratio, screen coverage and ray samples, not just square kilometres. A large screen-filling volume can still be expensive. Use one pipeline and avoid another full-scene RenderPass before TerrainPass. The pipeline restores renderer state and owns only its passes/targets.

## Camera and coordinate precision

Choose practical near/far clipping, then update the projection matrix. Package worlds require identity transforms and use world coordinates. Infinite cloud-domain rebasing preserves noise while following the camera; it is not a global floating-origin manager. Very large absolute coordinates lose float precision. Keep active scenes near a local origin or rebase the entire application consistently. No Earth-scale precision guarantee is made.

## Update and dispose once

Attached layers: call only `terrain.update(dt, { camera })`. Standalone layers: call each effect's `update` once. Then call `pipeline.render(scene, camera)` once. Pass standalone layers in `effects` and terrains in `terrains`; repeated layer references are deduplicated. Effects never resize/destroy your renderer. Dispose pipelines, standalone effects and terrains explicitly. Inspect effective water modes and cloud readiness through diagnostics.
