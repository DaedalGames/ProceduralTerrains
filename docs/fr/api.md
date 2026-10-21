# Référence API

Le package exporte des modules ESM et des déclarations TypeScript. Three.js `~0.185.1` est une dépendance pair. L’import du cœur ne crée aucun élément DOM.

## Points d’entrée

| Import | API publique |
| --- | --- |
| `procedural-terrains` | `createTerrain`, `FiniteTerrain` |
| `procedural-terrains/infinite` | `createInfiniteTerrain` |
| `procedural-terrains/planet` | `createPlanetTerrain` |
| `procedural-terrains/mini` | `createMiniTerrain`, état, disposition et cadrage Mini |
| `procedural-terrains/generation` | Outils Noise Stack, graphes et documents manuels |
| `procedural-terrains/water` | `createWater`, `TerrainWater`, modes et valeurs par défaut |
| `procedural-terrains/clouds` | `createClouds`, `TerrainClouds`, valeurs par défaut |
| `procedural-terrains/render` | `TerrainRenderPipeline`, `TerrainPass`, caches de hauteur et de détail |
| `procedural-terrains/assets` | Ressources partagées, fournisseurs PBR, workers |
| `procedural-terrains/real-world` | `TerrariumProvider`, `createRealWorldTerrain` |
| `procedural-terrains/documents` | `loadTerrainDocument` |
| `procedural-terrains/export` | `exportTerrain`, `zipTerrainExport` |
| `procedural-terrains/viewer` | `createTerrainViewer` |

## createTerrain(options)

Renvoie `Promise<FiniteTerrain>`. Ajoutez `terrain.object` à votre scène puis attendez `terrain.prepare(camera)` avant de l’afficher.

| Option | Description |
| --- | --- |
| `renderer` | `THREE.WebGLRenderer` requis, appartenant à votre application |
| `configuration` | Configuration partielle facultative |
| `signal` | `AbortSignal` facultatif |
| `resources` | Ressources `TerrainResources` partagées avec le même renderer |

`createInfiniteTerrain` et `createPlanetTerrain` acceptent les mêmes options avec un layout propre au monde. `createMiniTerrain` accepte aussi `mini` et `backdrop`.

## Configuration

Dimensions et hauteurs sont en unités du monde. Les champs sont imbriqués ; `configure` fusionne et valide les modifications.

| Champ | Défaut | Description |
| --- | --- | --- |
| `layout.chunkCount` | `8` | Nombre de chunks par côté, entier 1–32 |
| `layout.chunkSize` | `128` | Taille d’un chunk, 1–100000 |
| `heightScale` | Défaut du studio | Multiplicateur du relief, 1–100000 |
| `seaLevel` | Défaut du studio | Niveau de mer, −100000–100000 ; l’eau est une couche séparée |
| `source.kind` | `'noise'` | `noise`, `graph`, `manual` ou `heightmap` |
| `source.seed` | Défaut du studio | Entier −2147483648–4294967295 |
| `source.octaves` | Défaut du studio | Entier 1–12 |
| `source.scale` | Défaut du studio | Échelle du bruit, 0.01–1000 |
| `source.strength` | Défaut du studio | Amplitude du bruit, 0–4 |
| `source.stack` | Stack classique | Noise Stack sérialisé facultatif |
| `quality.lodSegments` | `[64,32,16,8]` | Quatre résolutions paires divisées par deux à chaque niveau, maximum 256 |
| `quality.lodDistanceScale` | `1` | Multiplicateur des distances LOD, 0.1–10 |
| `quality.morphEnabled` | `true` | Transitions LOD progressives |
| `quality.mergeEnabled` | `true` | Fusion des chunks |
| `quality.cullingEnabled` | `true` | Élimination hors champ |
| `lighting.sunAzimuth` | Défaut du studio | Degrés, −360–360 |
| `lighting.sunElevation` | Défaut du studio | Degrés, −90–90 |
| `lighting.fogDensity` | `0` | Densité du brouillard, 0–10 |
| `palette` | Terre | Triplets RGB linéaires dans [0,1], par biome |

Autres réglages de source : `smoothing` et `detail` (0–1), `persistence` (0.01–1), `lacunarity` (1–4), `ridge` (0–2), `warp` (0–4), `falloff` (0–1), `edgeFalloffMode` (`island` ou `mountains`). Les options inconnues sont rejetées.

### Matières du terrain et éclairage

Le runtime utilise le shader procédural du studio et prépare automatiquement ses pages de détail dans un worker pendant `update`. Aucun pack de textures externe n’est nécessaire. `material.terrainDetailQuality: 0` désactive ce détail. Un `createDetailCache` explicite prend la main sur ce cache jusqu’à sa destruction.

La configuration `material` conserve les réglages de biomes, pente, normales et occlusion du studio (`biomeScale`, `moistScale`, `moistBias`, `tempBias`, `snowLine`, `normalStrength`, `aoStrength`, seuils de pente), les réglages de qualité et distance `terrainDetail*`, les détails triplanaires, micro/macro, roche, sol, sable et rivage. `style` contient saturation/contraste/teinte de palette, couleur/intensité du soleil, lumière ambiante et rebond du sol. Les couleurs sont en RGB linéaire.

`terrainFormationSeaLevel` est une entrée de génération distincte : déplacer `seaLevel` ne change pas ce niveau de formation. Ces champs sont sérialisés dans le document et les nouveaux exports de code du studio.

Le document Mini contrôle la présentation et son emprise. Son chargement conserve la source, la hauteur et la palette enregistrées. Ses matériaux d’eau reçoivent les captures de couleur et de profondeur avant la première image, y compris après une reconfiguration de l’eau. Utilisez `TerrainRenderPipeline` pour exécuter ces passes.

Les anciens snippets ne contenaient pas les réglages personnalisés de matière et de style. Réexportez le terrain depuis le studio pour les conserver ; ces valeurs absentes ne peuvent pas être récupérées depuis un ancien snippet.

## Propriétés et méthodes

| Membre | Description |
| --- | --- |
| `object` | `THREE.Group` à ajouter à votre scène |
| `mode` | `finite`, `infinite` ou `planet` ; fixé à la création |
| `configuration` | Configuration normalisée, détachée et immuable |
| `prepare(camera, { signal? })` | Compile les shaders et prépare les caches GPU ; renvoie une promesse |
| `configure(patch, { signal? })` | Applique les réglages et prépare les ressources modifiées |
| `update(deltaSeconds, { camera })` | Met à jour LOD, streaming et effets |
| `sampleHeight(x, z)` | Approximation CPU ; null hors du terrain fini |
| `sampleHeight3D(x, y, z)` | Relief d’une planète au-dessus du rayon ; direction (x,y,z) non nulle |
| `setSurface(surfaceOrNull)` | Attache ou détache les ressources PBR de l’application |
| `serialize()` | Document détaché et versionné, avec extensions d’effets |
| `getDiagnostics()` | État, révisions, chunks et mesures propres au monde |
| `dispose()` | Libération idempotente des ressources et retrait du groupe |

Gardez une transformation identité sur le terrain et ses parents. Les hauteurs CPU sont approximatives et ne constituent pas des collisions exactes avec les triangles. Le terrain utilise son propre éclairage.

## Documents et exports

```js
import { loadTerrainDocument } from 'procedural-terrains/documents';
import { exportTerrain, zipTerrainExport } from 'procedural-terrains/export';

const restored = await loadTerrainDocument(savedDocument, { renderer });
scene.add(restored.object);
await restored.prepare(camera);

const result = await exportTerrain(restored, {
  format: 'glb', meshRes: 128, texRes: 512,
  bakeColor: true, exportHeightmap: true,
});
const zipBytes = zipTerrainExport(result);
```

`loadTerrainDocument(document, options)` accepte un objet JSON avec `format: 'procedural-terrains'`, `schemaVersion: 1`, `kind`, `configuration` et des `extensions` facultatives. Les effets sont restaurés avant résolution. Réattachez vous-même les matériaux et images externes.

`exportTerrain` renvoie les fichiers sous forme d’octets, les diagnostics et un nom d’archive. Aucun téléchargement n’est déclenché. Un monde infini nécessite `region: { cx, cz, size }` en unités du monde ; une planète exporte ses six faces. Attendez la fin des opérations GPU avant un autre export ou une destruction.

## Cycle de vie et erreurs

| Code | Signification |
| --- | --- |
| `TERRAIN_CANCELLED` | Opération annulée par le signal |
| `TERRAIN_SUPERSEDED` | Une nouvelle configuration remplace le travail en cours |
| `TERRAIN_DISPOSED` | Le terrain a été détruit |

La compilation GPU ne peut pas être interrompue. Les shaders sont validés avant publication. Si le préchauffage des caches ou effets échoue après validation de la configuration, elle reste active : réessayez `prepare(camera)`.

Libérez les effets avec leur terrain ou individuellement, et les pipelines séparément. Renderer, textures, surfaces et ressources partagées empruntées restent à la charge de l’application.


## Effets indépendants

createWater et createClouds acceptent terrain, ou renderer avec world (mode fini/infini, size, heightScale, seaLevel, sunAzimuth, sunElevation). Leur groupe object est stable ; configure accepte mode/parameters/quality. Passez les effets indépendants au pipeline dans effects, puis mettez-les à jour/libérez-les explicitement. Les couches attachées sont gérées par le terrain. Références : [eau](water.md), [nuages](clouds.md), [fonctionnalités](features.md), [grands mondes](large-worlds.md).
