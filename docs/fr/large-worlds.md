# Grands mondes et performances

[Playground grand monde](#/docs/playground?example=large-world).

## Choisir la couverture

Fini pour île/lac/diorama à l’origine ; Infini pour vol/océan avec volumes suivant la caméra ; Planète pour globe ; effets indépendants pour maillages Three.js existants. `world.size` borne la couverture active (maximum 100000 unités), sans géométrie de terrain. L’infini déplace une fenêtre bornée. Utilisez les mêmes dimensions/angles solaires pour des effets indépendants correspondants.

## Adapter ensemble les dimensions

Choisissez une convention d’unités cohérente pour maillages, relief, eau, nuages, profondeurs optiques et clipping caméra. Exemple 12 km : profondeurs d’eau 100–1000, nuages à 1800 avec épaisseur 900, near/far 5–80000. Ce n’est pas une calibration physique. Fréquences, vagues et visibilité sous-marine restent des contrôles de shader à adapter explicitement.

## Borner le travail plutôt que grossir la géométrie

Terrain : chunkSize/viewRadius, triangleBudget, maxCreatesPerFrame, streamBudgetMs, cacheResolution, LOD. Eau : résolution et budgets de captures ; l’infini réduit les modes chers sauf désactivation explicite. Nuages : 24 pas et 0.5 de résolution pour commencer. Le coût dépend du viewport, pixel ratio, couverture écran et pas, pas seulement des kilomètres carrés. Un seul pipeline ; pas de RenderPass de la même scène avant TerrainPass. L’état du renderer est restauré.

## Caméra et précision des coordonnées

Clipping near/far pratique puis actualisation de la projection. Transformations identité. Le recentrage des nuages conserve le bruit mais ne remplace pas un gestionnaire global d’origine flottante. Les coordonnées absolues géantes perdent en précision : gardez une origine locale ou recentrez toute l’application de façon cohérente. Aucune garantie de précision à l’échelle terrestre.

## Mettre à jour et libérer une seule fois

Effets attachés : `terrain.update` seulement. Indépendants : chaque `update` une fois. Puis un `pipeline.render`. `terrains` et `effects` sont dédupliqués. Les effets ne redimensionnent ni ne détruisent votre renderer. Libérez pipeline, effets indépendants et terrains. Consultez les diagnostics.
