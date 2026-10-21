# Publication du package

Le candidat 2.0.0 construit `procedural-terrains@2.0.0`. Les exports du studio
épinglent cette version exacte : publiez le package avant de déployer le site
ou de distribuer le desktop correspondant. Le registre public ne change pas
lors du build local. Les archives alpha antérieures restent immuables.

Le workflow de déploiement vérifie que cette version exacte existe sur npm
avant de transférer le site. Pour la 2.0.0, publier le runtime est donc une
étape préalable au déploiement, pas une opération effectuée par le build local.
Les archives Unity et Blender sont vérifiées contre les sources pendant
`npm run build:app` (Python 3.11 ou supérieur requis). Pour les régénérer :
`npm run plugins:build`, puis `npm run plugins:verify`.

## Releases automatiques

Le workflow `.github/workflows/publish-package.yml` se lance à la publication
d’une release GitHub. Le tag doit être une version SemVer, par exemple `v2.0.0`
ou `v2.1.0-alpha.1`. Le workflow utilise exactement le code de ce tag et attribue
cette version au package pendant le build, sans créer de commit ni modifier le tag.

Après les tests de l’application, du runtime, des types et de l’installation de
l’archive, trois jobs indépendants :

- publient `procedural-terrains` sur npm avec provenance ;
- publient `@zyfou/procedural-terrains` sur GitHub Packages ;
- joignent les deux archives `.tgz` à la release GitHub.

Une release stable utilise `latest`. Une release marquée comme préversion sur
GitHub, ou dont la version contient un suffixe de préversion, utilise `next`.
Les versions déjà présentes sur un registre sont ignorées lors d’une relance.
Une version publiée est immuable : utilisez un nouveau tag pour un autre contenu.
Le lancement manuel permet de reprendre une release existante avec son tag.

Le commit ciblé par la release doit contenir le package et le workflow. Pour que
le lancement manuel soit disponible, intégrez également le workflow à la branche
par défaut. Ce workflow ne déclenche pas le déploiement du site.

## Autorisation npm sans secret

Le job npm utilise un Trusted Publisher OIDC. Dans les paramètres npm du package,
configurez GitHub Actions avec :

| Champ | Valeur |
| --- | --- |
| Organization or user | `ZyFou` |
| Repository | `ProceduralTerrains` |
| Workflow filename | `publish-package.yml` |
| Environment | laisser vide |
| Allowed actions | autoriser `npm publish` |

Cette autorisation peut aussi être configurée avec npm 11.15 ou supérieur,
depuis le compte propriétaire connecté avec 2FA :

```sh
npm trust github procedural-terrains --repo ZyFou/ProceduralTerrains --file publish-package.yml --allow-publish --yes
```

Le workflow utilise Node 24 et `id-token: write`. Il n’a pas besoin de secret
`NPM_TOKEN`. GitHub Packages utilise le `GITHUB_TOKEN` fourni automatiquement,
avec la permission `packages: write`. GitHub impose un nom avec scope ; le nom
sur le registre public npm reste `procedural-terrains`.

Une nouvelle autorisation Trusted Publisher doit réussir sa première publication
sous 48 heures pour être validée. Configurez-la juste avant la première release
automatique ; si elle expire, recréez-la avant de relancer la publication.

Sources : [Trusted publishing npm](https://docs.npmjs.com/trusted-publishers/),
[GitHub Packages npm](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

## Publication manuelle

```sh
npm run check:lib
npm run pack:lib
npm publish dist/npm/procedural-terrains-2.0.0.tgz --access public --tag latest --registry=https://registry.npmjs.org
```

Avant les publications suivantes, augmentez la version du workspace. L’archive
contient uniquement le runtime, ses types, son README et la licence MIT.

## Vérification locale du desktop

Le build Windows conserve le renderer uniquement dans `resources/dist`.
L’exécutable accepte `--user-data-dir=C:\chemin\profil-qa` pour isoler ses
données et `--no-file-associations` pour tester une archive portable sans
réenregistrer l’association Windows `.ptrterrain`. Le démarrage ordinaire
conserve l’enregistrement de cette association.

Après `npm run desktop:package`, `npm run test:desktop` vérifie l’ouverture à
froid d’un projet, son rendu, Enregistrer sous et sa réouverture. Les chemins
d’exécutable et de preuves peuvent être choisis avec
`TERRAIN_DESKTOP_EXECUTABLE` et `TERRAIN_DESKTOP_QA_OUTPUT`.
