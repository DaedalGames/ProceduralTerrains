# Bien démarrer

Le package `procedural-terrains` permet d’utiliser le moteur de terrain du studio dans votre application Three.js. Cette alpha ESM inclut les déclarations TypeScript. Le rendu nécessite WebGL2 dans un navigateur.

## Installer

Installez la version alpha depuis npm :

```sh
npm install procedural-terrains
```

Three.js `~0.185.1` est une dépendance pair, installée automatiquement par npm si nécessaire. Pour compiler les sources, lancez `npm ci` puis `npm run build` dans le dépôt. Cette commande compile la bibliothèque et le studio, puis crée une archive installable dans `dist/npm/`. Vous pouvez installer cette archive dans votre application :

```sh
npm install /chemin/vers/procedural-terrains-0.1.0-alpha.0.tgz three@~0.185.1
```

Pour la bibliothèque seule : `npm run build:lib`, puis `npm pack --workspace=procedural-terrains`. Pour le studio seul : `npm run build:app`.

## Votre premier terrain

Vous pouvez modifier et exécuter les exemples directement dans **Documentation → Playground**. La page propose un aperçu, une console, des liens de partage et le téléchargement d’une page HTML autonome.

Utilisez vos propres renderer, scène et caméra :

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

Appelez `frame` depuis votre boucle d’animation. Le temps est exprimé en secondes.

## Modifier et libérer

```js
await terrain.configure({ source: { seed: 42 } });
const height = terrain.sampleHeight(0, 0);
const document = terrain.serialize();
terrain.dispose();
```

Les modifications sont fusionnées avec la configuration courante. Ne modifiez pas directement `terrain.configuration`. Libérez le terrain à la fermeture de sa scène ; votre renderer reste disponible.

## Viewer optionnel

Le viewer gère un renderer, une caméra, les contrôles orbitaux et la boucle d’animation. Il crée actuellement des terrains finis uniquement :

```js
import { createTerrainViewer } from 'procedural-terrains/viewer';

const viewer = await createTerrainViewer(
  document.querySelector('#terrain'),
  { configuration: { source: { seed: 42 } } },
);
// Le conteneur doit avoir une hauteur non nulle.
// À la fermeture :
viewer.dispose();
```

Pour les mondes infinis, planètes, Mini et effets avancés, utilisez votre scène. Consultez les [mondes et sources](worlds.md) ou la [référence API](api.md).

