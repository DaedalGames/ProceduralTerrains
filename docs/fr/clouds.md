# Nuages

Import séparé `procedural-terrains/clouds`. Legacy et Realistic fonctionnent avec les terrains du package ou sans terrain généré. [Playground nuages](#/docs/playground?example=clouds).

## Intégration Three.js indépendante

```js
import { createClouds } from 'procedural-terrains/clouds';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
const clouds = await createClouds({ renderer,
  world: { mode: 'infinite', size: 20000, heightScale: 2000 },
  mode: 'realistic',
  parameters: { cloudAltitude: 1800, cloudThickness: 900, cloudCoverage: 0.65, cloudSystemScale: 6, cloudNoiseSeed: 17 },
  quality: { cloudRealisticSteps: 24, cloudRenderScale: 0.5 },
});
scene.add(clouds.object);
const pipeline = new TerrainRenderPipeline({ renderer, effects: [clouds] });
await clouds.prepare(camera);
function frame(dt) {
  clouds.update(dt, { camera });
  pipeline.render(scene, camera);
}
await clouds.configure({ parameters: { cloudCoverage: 0.65 }, quality: { cloudRenderScale: 0.75 } });
// Cleanup: pipeline.dispose(); clouds.dispose();
```

Aucun maillage de terrain. La profondeur de vos maillages opaques permet l’occlusion. `clouds.object` reste stable. Gardez ses transformations identité et utilisez la caméra/domaine plutôt que déplacer ou redimensionner le groupe.

## Attacher au terrain

`createClouds({ terrain, mode: 'realistic' })` puis un pipeline avec `terrains: [terrain]`. Une couche par terrain, déjà possédée/mise à jour par celui-ci. Les ombres affectent les shaders du package ; vos matériaux Three.js ne sont pas modifiés automatiquement.

## Couverture et grands mondes

`world` accepte les options de [l’eau](water.md) : mode fini/infini, taille 1–100000 (minimum 6 en infini) (défaut 10000), hauteur de référence, mer et angles du soleil. Fini à l’origine ; infini recentré sur la caméra avec bruit logique continu. Pas d’origine flottante globale. Pour une coque sphérique, attachez à une planète ; le mode indépendant planet est rejeté.

Altitude : Y absolu en plat, hauteur au-dessus du rayon sur planète. Épaisseur : au moins 20 unités. Couverture et altitude sont distinctes ; l’augmentation du domaine ne change pas les hauteurs automatiquement. Les fréquences plus hautes font des motifs plus petits. Le vent déplace le domaine procédural, pas des mètres/seconde. Recréez pour changer la taille du domaine.

## Modes et cycle de vie

`createClouds` accepte `terrain` ou `renderer + world`, mode `legacy/realistic`, paramètres, qualité et signal. `prepare(camera)` prépare le rendu ; `configure({ mode?, parameters?, quality? }, { signal? })` remplace après succès. `cloudsEnabled: false` masque. `update` anime et suit la caméra mondiale. `getDiagnostics` indique actif/prêt/basse résolution. `serialize` conserve réglages/monde ; recréez avec `createClouds({ renderer, ...saved })`. `dispose` préserve renderer/maillages et libère les volumes partagés à la dernière référence. Pipeline à libérer séparément.

## Budgets de qualité

Entiers : steps 8–128, lightSteps 1–12, octaves 1–6, detailOctaves 0–5, realisticSteps 8–128 (spécialisation supportée). RenderScale 0.25–1 ; maxDistance 1–20 couvertures, sans culling en infini ; lightMode 0/1. Érosion/ombres/LOD booléens ; fallback `none/lite/off`. Les moteurs utilisent leurs champs de pas respectifs ; des adaptations peuvent réduire le budget. Commencez à 24 pas et 0.5 de résolution.

| Paramètre | Type | Défaut |
| --- | --- | --- |
| `cloudSteps` | number | `12` |
| `cloudLightSteps` | number | `2` |
| `cloudOctaves` | number | `3` |
| `cloudDetailOctaves` | number | `0` |
| `cloudRealisticSteps` | number | `24` |
| `cloudRenderScale` | number | `0.5` |
| `cloudMaxDistance` | number | `6` |
| `cloudUseErosion` | boolean | `true` |
| `cloudSelfShadow` | boolean | `true` |
| `cloudLightMode` | number | `0` |
| `cloudStepLOD` | boolean | `false` |
| `cloudFallback` | string | `"none"` |

## Référence des paramètres

Tous les paramètres de forme et d’éclairage acceptés sont listés ci-dessous ; ils sont distincts des budgets de qualité. Les nombres doivent être finis et les couleurs sont des triplets RGB. La factory active les nuages par défaut. Son mode sélectionne le moteur ; cloudRenderMode est conservé pour compatibilité. cloudChunksEnabled reste dans les documents, mais les nuages expérimentaux par chunks ne sont pas exposés par cette API.

| Paramètre | Type | Défaut |
| --- | --- | --- |
| `cloudsEnabled` | boolean | `true` |
| `cloudChunksEnabled` | boolean | `false` |
| `cloudCoverage` | number | `0.5` |
| `cloudDensity` | number | `1` |
| `cloudSoftness` | number | `0.16` |
| `cloudNoiseVariant` | string | `"soft"` |
| `cloudNoiseSeed` | number | `0` |
| `cloudAltitude` | number | `240` |
| `cloudThickness` | number | `620` |
| `cloudScale` | number | `2.2` |
| `cloudDetailScale` | number | `7` |
| `cloudDetailStrength` | number | `0.35` |
| `cloudErosionScale` | number | `15` |
| `cloudErosionStrength` | number | `0.3` |
| `cloudWindDir` | number | `45` |
| `cloudWindSpeed` | number | `1` |
| `cloudRotationSpeed` | number | `0.35` |
| `cloudEvolveSpeed` | number | `1` |
| `cloudLightAbsorption` | number | `3` |
| `cloudShadowStrength` | number | `0.6` |
| `cloudScatteringStrength` | number | `1` |
| `cloudAtmosphereInfluence` | number | `1` |
| `cloudSunResponse` | number | `1` |
| `cloudAmbientResponse` | number | `1` |
| `cloudSilverLining` | number | `0.25` |
| `cloudShadowsEnabled` | boolean | `false` |
| `cloudShadowOpacity` | number | `0.45` |
| `cloudColor` | tableau RGB | `[1,1,1]` |
| `cloudShadowColor` | tableau RGB | `[0.42,0.47,0.6]` |
| `cloudRenderMode` | string | `"legacy"` |
| `cloudSystemScale` | number | `3.2` |
| `cloudErosion` | number | `0.7` |
| `cloudBillowSize` | number | `1` |
| `cloudTowering` | number | `0.55` |
| `cloudShear` | number | `0.25` |
| `cloudForwardScatter` | number | `1` |
| `cloudSkyTint` | tableau RGB | `[0.78,0.84,0.95]` |
| `cloudExposure` | number | `1` |

## Composition et limites

Use TerrainRenderPipeline or TerrainPass for opaque depth, low-resolution reconstruction and cloud/water ordering. A plain renderer.render does not execute those passes. Clouds use their own sun/ambient model; Three.js lights do not replace it. No sky, atmosphere, day/night or grading stack is installed. Transparent meshes and custom receiving-material shadows need application-specific integration.

