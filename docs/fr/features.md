# Fonctionnalités du package

Le package est un runtime Three.js WebGL2, pas toute l’application Terrain Studio. Cette référence décrit le build du dépôt ; une alpha npm déjà publiée peut contenir moins de fonctionnalités.

| Fonctionnalité | Support et limites |
| --- | --- |
| Tile, Infini, Planète, Mini | Géométrie, génération, shaders, LOD et caches partagés |
| Noise Stack et graphes | Stacks selon le monde ; graphes 2D en fini/infini, pas sur planète |
| Sources manuelles | Formes/sculpture/peinture sur terrain fini, sans UI ou historique d’édition |
| Matières procédurales | Biomes, pentes, normales, AO et détails automatiques |
| PBR et graphes de surface | Fournisseurs et ressources explicites ; packs à héberger vous-même |
| Eau et nuages séparés | Oui : `renderer + world` sans terrain généré, ou `terrain` |
| Effets sphériques | Attachés à une planète ; modes d’eau avancés ramenés à Legacy |
| Sous l’eau | Lite/High/Auto, brouillard, distorsion, caustiques, particules/rayons facultatifs |
| Ombres de nuages | Shaders du terrain ; aucun ajout automatique aux matériaux Three.js personnalisés |
| Ciel, atmosphère, grading, jour/nuit | À gérer dans l’application hôte |
| Végétation et objets | Scattering et bibliothèque de l’éditeur non exposés |
| Splines, routes, rivières, destruction | Pas de rejeu automatique du projet éditeur ; exporter ou intégrer manuellement |
| Érosion | Worker `TerrainCompute.erode` ; appliquer/stocker les deltas explicitement |
| Données réelles | Fournisseurs d’élévation/images ; aucune carte UI, compte ou service de bâtiments inclus |
| Exports | Code supporté, GLB/OBJ/cartes ; nuages/eau procéduraux ne sont pas des effets glTF portables |
| Précision | Origine locale, streaming borné ; pas de gestionnaire global d’origine flottante |
| Dépendances | Pas de React/Electron/backend ; seul `/viewer` crée un canvas et une boucle |
| Renderer | Three.js `~0.185.1` WebGL2 ; pas de WebGPU |

## Choisir son intégration

Consultez [le démarrage](getting-started.md), [l’eau](water.md), [les nuages](clouds.md), [le pipeline](effects.md) et [les grands mondes](large-worlds.md). Le terrain possède ses effets attachés. Chaque effet indépendant possède son domaine léger sans géométrie de terrain. Votre application conserve renderer, scène, caméra, redimensionnement et boucle. Pipeline à libérer séparément.
