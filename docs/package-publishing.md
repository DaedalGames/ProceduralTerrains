# Publication du package

Le package public s’installe avec `npm install procedural-terrains`. La première
publication est `0.1.0-alpha.0`, disponible sous le tag npm `latest` pour permettre
cette installation directe. Il s’agit toujours d’une version alpha.

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

Sources : [Trusted publishing npm](https://docs.npmjs.com/trusted-publishers/),
[GitHub Packages npm](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

## Publication manuelle

```sh
npm run check:lib
npm run pack:lib
npm publish dist/npm/procedural-terrains-0.1.0-alpha.0.tgz --access public --tag latest --registry=https://registry.npmjs.org
```

Avant les publications suivantes, augmentez la version du workspace. L’archive
contient uniquement le runtime, ses types, son README et la licence MIT.
