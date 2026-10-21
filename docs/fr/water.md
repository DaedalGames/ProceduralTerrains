# Eau

Import séparé `procedural-terrains/water`, avec terrain du package ou maillages Three.js existants. [Playground eau](#/docs/playground?example=water).

## Intégration Three.js indépendante

```js
import { createWater } from 'procedural-terrains/water';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
const water = await createWater({ renderer,
  world: { mode: 'finite', size: 12000, seaLevel: 0, heightScale: 1000 },
  mode: 'volumetric',
  parameters: { waterMaxVisibleDepth: 1000, waterDeepDistance: 600 },
});
scene.add(water.object);
const pipeline = new TerrainRenderPipeline({ renderer, effects: [water] });
await water.prepare(camera);
function frame(dt) {
  water.update(dt, { camera });
  pipeline.render(scene, camera);
}
await water.configure({ parameters: { waterWaveStrength: 0.6 }, quality: { waterDetail: 0.8 } });
// Cleanup: pipeline.dispose(); water.dispose();
```

Conservez les transformations identité du groupe et de ses ancêtres. Les maillages opaques de la scène contribuent aux captures couleur/profondeur des modes Volumetric/Cinematic. Un fond plat sert de repli analytique : aucun champ CPU n’est déduit automatiquement de vos maillages. Les objets transparents sont hors du contrat de profondeur opaque. `water.object` reste stable après configuration ; sa destruction préserve vos maillages et le renderer.

## Attacher au terrain

`createWater({ terrain, mode: 'volumetric' })` puis `TerrainRenderPipeline({ renderer, terrains: [terrain] })`. Le terrain ajoute/met à jour/détruit déjà sa couche : ne le faites pas deux fois. Une couche d’eau par terrain. Le pipeline accepte aussi des effets indépendants dans `effects`.

## Monde et niveau d’eau

Choisissez `terrain` ou `renderer + world`. Monde indépendant : `mode` fini/infini, `size` 1–100000 (minimum 6 en infini) unités (défaut 10000), `heightScale` de référence 1000, `seaLevel` 0, `sunAzimuth` 128°, `sunElevation` 46°. Recréez pour redimensionner. `parameters.seaLevel` déplace la surface. Le fini reste à l’origine ; l’infini suit la caméra avec un plan borné. Pour une sphère, attachez l’effet à une planète.

En indépendant, `waterHideAtZero: false` et `waterAutoDowngradeInfinite: false` autorisent l’eau à Y=0 ou négatif. Attachée, elle conserve le comportement de l’éditeur : niveau ≤0.5 masqué sauf option explicite.

## Modes et adaptations

`off` masque ; `legacy` est économique sans réfraction capturée ; `realistic` fournit l’optique de base ; `volumetric` ajoute les captures couleur/profondeur ; `cinematic` permet la réflexion plane en monde fini et au-dessus de l’eau ; `stylized` fournit l’aspect diorama. Sur planète, les modes avancés/stylisés reviennent à Legacy. `waterAutoDowngradeInfinite` et `waterLegacyOnLowFps` contrôlent les replis. Les diagnostics montrent les modes demandé/effectif et le sous-marin.

## Configuration et cycle de vie

`prepare(camera, { signal? })` prépare la caméra. `configure({ mode?, parameters?, quality? }, { signal? })` fusionne et conserve la version courante si le candidat échoue. `update(dt, { camera })` anime l’indépendant. `serialize` conserve réglages et monde ; recréez avec `createWater({ renderer, ...saved })`. Le chargeur de terrain ne charge pas ces documents d’effets indépendants. `dispose` est idempotent. Le pipeline est libéré séparément.

`mode` est prioritaire ; `waterMode` et `waterQualityPreset` sont des métadonnées/compatibilité, pas une application automatique de preset. `waterEnabled: false` masque l’effet ; changer explicitement de mode le réactive sauf nouvelle valeur false. Déplacer l’eau ne modifie pas la formation du terrain.

## Sous l’eau et composition

Lite/High/Auto, brouillard, distorsion, caustiques, particules/rayons facultatifs via le pipeline. `waterUnderwaterVisibility` est un multiplicateur de densité : distance 140 / max(0.25, valeur). `waterUnderwaterFogDensity` règle l’intensité ; `waterSurfaceTransition` la transition. Caméras parentes en coordonnées mondiales. Toutes les couches d’eau sont exclues des captures opaques. Aucun ajout automatique de caustiques à vos matériaux Three.js.

## Budgets de qualité

`waterQuality` entier 0–2 ; détail/réflexion 0–2 ; vagues 0–4. Champs inconnus/invalides rejetés. Utilisez `configure({ quality })` et essayez `waterRenderScale: 0.5` sur grande couverture.

| Paramètre | Type | Défaut |
| --- | --- | --- |
| `waterQuality` | number | `2` |
| `waterDetail` | number | `1` |
| `waterReflection` | number | `1` |
| `waterWaves` | number | `2` |

## Référence des paramètres

Tous les champs acceptés et les défauts attachés sont listés ci-dessous. Les surcharges indépendantes sont décrites plus haut. Nombres finis et booléens sont vérifiés ; chaque mode utilise ses propres réglages. `seaLevel` (Y mondial, hérité du domaine par défaut) et `waterAnim` (animation booléenne) sont aussi acceptés. Les profondeurs, rivages, écumes, transitions et distances des caustiques utilisent les unités du monde ; les directions sont en degrés. Les champs diorama concernent Mini/Stylized.

| Paramètre | Type | Défaut |
| --- | --- | --- |
| `waterEnabled` | boolean | `true` |
| `waterHideAtZero` | boolean | `true` |
| `waterMode` | string | `"legacy"` |
| `waterQualityPreset` | string | `"legacy"` |
| `waterAutoDowngradeInfinite` | boolean | `true` |
| `waterLegacyOnLowFps` | boolean | `true` |
| `waterOpacity` | number | `0.72` |
| `waterRoughness` | number | `0.35` |
| `waterFresnelStrength` | number | `1` |
| `waterRefractionStrength` | number | `0.45` |
| `waterSpecularStrength` | number | `1` |
| `waterBiomeColorEnabled` | boolean | `true` |
| `waterBiomeColorStrength` | number | `0.55` |
| `waterNaturalColor` | number | `0.7` |
| `waterDioramaShader` | string | `"stylized"` |
| `waterDioramaReflections` | string | `"auto"` |
| `waterDioramaReflectionStrength` | number | `1` |
| `waterDioramaReflectionBlur` | number | `0` |
| `waterDioramaReflectionDistortion` | number | `1` |
| `waterDioramaTransparency` | number | `0.5` |
| `waterDioramaTint` | number | `1` |
| `waterDioramaShoreClarity` | number | `0` |
| `waterAtmosphereInfluence` | number | `1` |
| `waterSunResponse` | number | `1` |
| `waterAmbientResponse` | number | `1` |
| `waterFoamLighting` | number | `0.65` |
| `waterDepthColorStrength` | number | `1` |
| `waterDepthOpacityStrength` | number | `1` |
| `waterMaxVisibleDepth` | number | `120` |
| `waterDepthFalloff` | number | `1` |
| `waterShallowDistance` | number | `8` |
| `waterDeepDistance` | number | `55` |
| `waterAbsorptionStrength` | number | `1` |
| `waterWaveSpeed` | number | `1` |
| `waterWaveScale` | number | `1` |
| `waterWaveStrength` | number | `1` |
| `waterSmallWaveStrength` | number | `0.65` |
| `waterLargeWaveStrength` | number | `1` |
| `waterNormalIntensity` | number | `1` |
| `waterWaveDirection` | number | `0` |
| `waterAnimSpeed` | number | `1` |
| `waterFoamEnabled` | boolean | `true` |
| `waterFoamStrength` | number | `0.75` |
| `waterFoamWidth` | number | `3.2` |
| `waterFoamSoftness` | number | `0.6` |
| `waterFoamAnimSpeed` | number | `1` |
| `waterSlopeFoam` | number | `0.25` |
| `waterCliffFoam` | number | `0.3` |
| `waterUnderwaterEnabled` | boolean | `true` |
| `waterUnderwaterMode` | string | `"auto"` |
| `waterUnderwaterFogDensity` | number | `1` |
| `waterUnderwaterVisibility` | number | `1` |
| `waterUnderwaterDistortion` | number | `0.5` |
| `waterUnderwaterCaustics` | number | `0.4` |
| `waterUnderwaterCausticsEnabled` | boolean | `true` |
| `waterUnderwaterCausticScale` | number | `1` |
| `waterUnderwaterCausticSpeed` | number | `1` |
| `waterUnderwaterCausticMinDepth` | number | `1` |
| `waterUnderwaterCausticMinDepthFalloff` | number | `1` |
| `waterUnderwaterParticles` | boolean | `false` |
| `waterUnderwaterLightShafts` | boolean | `false` |
| `waterSurfaceTransition` | number | `0.8` |
| `waterReflectionQuality` | number | `1` |
| `waterRefractionQuality` | number | `0.6` |
| `waterFoamQuality` | number | `1` |
| `waterCausticsQuality` | number | `0.5` |
| `waterNormalResolution` | number | `1` |
| `waterRenderScale` | number | `1` |
| `waterUpdateFrequency` | number | `1` |
| `waterDisableExpensiveBelowFps` | number | `42` |
| `waterDebugView` | string | `"off"` |
| `waterShowMeshBounds` | boolean | `false` |
| `waterShowPerfCost` | boolean | `false` |

