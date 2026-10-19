# Studio et export de code

Le studio peut exporter du JavaScript utilisable avec les meshes et les cartes. Le code généré utilise l’API publique du package npm.

## Exporter depuis le studio

Ouvrez le panneau Export et activez **Inclure le code du terrain (npm)**. L’archive ZIP contient un dossier `code/` :

| Fichier | Rôle |
| --- | --- |
| `terrain.js` | Document du terrain et factory `createExportedTerrain({ renderer, signal })` |
| `terrain.json` | Le même document runtime versionné en JSON |
| `main.js` | Scène Three.js, caméra, contrôles, rendu et nettoyage |
| `index.html` | Page d’exemple autonome |
| `package.json` | Scripts Vite de développement et de production |
| `studio-project.ptrterrain` | Projet modifiable conservant l’état original du studio |
| `README.md` | Installation et limites éventuelles de conversion |

Le code inclut la seed, les sources bruit, graphe ou manuelles prises en charge, la palette, le layout, l’éclairage, l’état Mini et les couches d’eau/nuages actives.

## Exécuter le code exporté

Compilez ce dépôt avec `npm run build`, extrayez le ZIP puis ouvrez un terminal dans son dossier `code/` :

```sh
npm install
npm install /chemin/vers/dist/npm/procedural-terrains-0.1.0-alpha.0.tgz
npm run dev
```

Le package est une alpha locale. Installez l’archive générée ; l’exemple ne suppose pas une publication sur le registre public npm.

## Intégrer dans votre scène

```js
import { createExportedTerrain } from './terrain.js';

const terrain = await createExportedTerrain({ renderer });
scene.add(terrain.object);
await terrain.prepare(camera);
```

Appelez `terrain.update(dt, { camera })` dans votre boucle. Avec des effets, utilisez `TerrainRenderPipeline`, comme dans l’exemple exporté.

## Périmètre de conversion

Le runtime public couvre une partie des réglages du studio. Le README généré liste les différences détectées. Packs PBR personnalisés, imagerie importée, peinture, deltas d’érosion/destruction, splines, props, décors et assemblages arbitraires peuvent nécessiter une intégration manuelle. Le projet modifiable conserve le document du studio ; meshes et cartes restent le format d’échange visuel.

Mini utilise son état de présentation, sans la végétation du studio. Les hauteurs importées nécessitent une heightmap ou un fournisseur géographique explicite dans votre application.

## Documents runtime

```js
import { loadTerrainDocument } from 'procedural-terrains/documents';

const document = terrain.serialize();
const restored = await loadTerrainDocument(document, { renderer });
scene.add(restored.object);
await restored.prepare(camera);
```

JSON runtime, projets modifiables et exports Unity/Blender `.ptrterrain` utilisent des schémas distincts. `loadTerrainDocument` accepte le format `procedural-terrains`, pas les presets bruts ou documents destinés aux moteurs.

## Exporter meshes et cartes

```js
import { exportTerrain, zipTerrainExport } from 'procedural-terrains/export';

const result = await exportTerrain(terrain, {
  format: 'glb', meshRes: 128, texRes: 512,
  bakeColor: true, exportHeightmap: true,
});
const zipBytes = zipTerrainExport(result);
```

Les fichiers sont renvoyés sous forme d’octets, sans téléchargement automatique. Pour les mondes infinis, ajoutez `region: { cx: 0, cz: 0, size: 1024 }`. L’export planète couvre les six faces. Attendez la fin des opérations avant de réutiliser les ressources GPU ou de libérer le terrain.

