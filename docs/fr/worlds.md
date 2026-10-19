# Mondes et sources

Choisissez le monde à la création. Pour changer de mode, créez une autre instance.

## Tile

```js
import { createTerrain } from 'procedural-terrains';
const terrain = await createTerrain({ renderer, configuration: {
  layout: { chunkCount: 8, chunkSize: 128 },
  source: { kind: 'noise', seed: 1337 },
} });
```

Le runtime fini crée un plateau carré avec LOD par chunk. Les assemblages arbitraires de tuiles du studio ne font pas partie du layout public de cette alpha.

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

Le streaming suit la caméra fournie à `update`. Le bruit et les graphes 2D non bornés sont acceptés ; les sources manuelles et heightmaps nécessitent un terrain fini.

## Planet

```js
import { createPlanetTerrain } from 'procedural-terrains/planet';
const terrain = await createPlanetTerrain({ renderer, configuration: {
  layout: { radius: 16000, faceGrid: 8, bakeResolution: 256 },
  source: { kind: 'noise', seed: 1337 },
} });
```

Une planète nécessite un Noise Stack évalué en 3D. Le layout pilote les faces cube-sphere, le budget de triangles et les bakes. `sampleHeight3D(x, y, z)` donne le relief CPU suivant une direction non nulle au-dessus du rayon.

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

Mini gère sa configuration finie, son relief, sa composition, sa résolution et sa découpe. Utilisez `terrain.mini.configure` pour les modifier. Le cadrage est une suggestion ; votre application déplace sa caméra. Eau et nuages sont optionnels ; végétation et contrôles du studio ne sont pas installés.

## Sources

| Type | Données |
| --- | --- |
| `noise` | Seed et paramètres du bruit ; `stack` facultatif |
| `graph` | Document `graph` validé |
| `manual` | `document` de formes/sculpture, base plate, procédurale ou graphe ; `resolution` 16–1024 |
| `heightmap` | `data`, `width`, `height` |

```js
await terrain.configure({ source: {
  kind: 'heightmap', width: 2, height: 2,
  data: new Float32Array([0, 50, 120, 30]),
} });
```

Les heightmaps couvrent le plateau, la première ligne étant à Z négatif. Les hauteurs en unités du monde, dans ±60000, sont envoyées en half-float filtré. Le nombre d’échantillons doit correspondre aux dimensions.

## Données géographiques

`createRealWorldTerrain` reçoit un fournisseur explicite avec `loadHeightmap` et éventuellement `loadImagery`. `TerrariumProvider` nécessite vos URL de tuiles et l’attribution. Les bbox utilisent `west/east/south/north`, les limites Web Mercator et au maximum 6×6 tuiles. Découpez les régions traversant l’antiméridien. Aucun compte ou service cartographique du studio n’est utilisé implicitement.

