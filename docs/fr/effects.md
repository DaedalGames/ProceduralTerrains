# Eau, nuages et matériaux

Eau et nuages sont des composants Three.js indépendants ou des couches attachées au terrain. Les indépendants utilisent renderer/world et exposent un groupe stable ; les couches attachées partagent les données du terrain. Consultez [les fonctionnalités](features.md), [l’eau](water.md), [les nuages](clouds.md) et [les grands mondes](large-worlds.md), avec paramètres complets et playgrounds séparés.

## Eau et nuages

```js
import { createWater } from 'procedural-terrains/water';
import { createClouds } from 'procedural-terrains/clouds';
import { TerrainRenderPipeline } from 'procedural-terrains/render';

const water = await createWater({ terrain, mode: 'volumetric' });
const clouds = await createClouds({ terrain, mode: 'realistic' });
const pipeline = new TerrainRenderPipeline({ renderer, terrains: [terrain] });
await terrain.prepare(camera);

function frame(dt) {
  terrain.update(dt, { camera });
  pipeline.render(scene, camera);
}
```

Modes d’eau : `off`, `legacy`, `realistic`, `volumetric`, `cinematic`, `stylized`. Les adaptations au monde et à la qualité s’appliquent ; `water.getDiagnostics()` indique les modes demandé et effectif.

Modes de nuages : `legacy` et `realistic` pour tous les mondes. Réglez l’apparence avec `parameters` et le budget de rendu avec `quality`. Utilisez une couche d’eau et une couche de nuages par terrain.

## Pipeline de rendu

Le pipeline rend toute votre scène dans une cible couleur/profondeur, capture les réflexions et la réfraction si nécessaire, compose les nuages dans une cible distincte puis applique les effets sous-marins. L’état du renderer est restauré.

`TerrainPass` remplace `RenderPass` dans un EffectComposer. N’ajoutez pas un autre RenderPass de la même scène avant lui. Libérez le pipeline séparément.

## Caches de hauteur et de détail

`createHeightCache({ terrain, resolution: 512 })` et `createDetailCache({ terrain, quality: 2 })` sont facultatifs pour le terrain fini. Les adaptateurs infini, planète et Mini ont leurs caches dédiés. Les caches de hauteur utilisent un double buffer ; ceux de détail possèdent un worker et des pages GPU.

## Matériaux PBR

```js
import { TerrainSurfaceProvider, createSurfaceResources } from 'procedural-terrains/assets';

const provider = new TerrainSurfaceProvider({
  baseUrl: 'https://your-host/material-pack/',
});
const surface = await createSurfaceResources({
  provider, document: surfaceDocument,
});
await terrain.setSurface(surface);
// Détacher de tous les terrains avant destruction :
await terrain.setSurface(null);
surface.dispose();
provider.dispose();
```

Hébergez `catalog.json` et les packs `.pbr`. Hashes et budgets de matériaux sont vérifiés. Les fichiers locaux nécessitent `loadUserAsset` ; les anciennes textures nécessitent `legacyBaseUrl`. Aucun stockage ou endpoint de textures du studio n’est appelé implicitement.

## Workers et propriété des ressources

`TerrainSurfaceWorker.prepare` accepte des URL et documents sérialisables. `TerrainCompute.erode` possède un worker par tâche, conserve vos buffers et renvoie des deltas de hauteur et des cartes. Les factories de workers sont injectables pour une CSP ou un hébergement spécifique.

Les ressources partagées restent actives tant que des références existent. Le terrain ne détruit jamais un renderer, une image, une surface ou un scope emprunté.

