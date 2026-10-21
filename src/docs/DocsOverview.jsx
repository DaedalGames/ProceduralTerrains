import { ArrowRight, Box, Globe2, Layers3, Orbit } from 'lucide-react';
import { translateText as t, useLanguage } from '../i18n/LanguageContext.jsx';
import packageInfo from '../../packages/procedural-terrains/package.json';
import CodeBlock from './CodeBlock.jsx';
import { docsHref } from './docsPages.js';

const quickStart = `import { createTerrain } from 'procedural-terrains';

const terrain = await createTerrain({
  renderer,
  configuration: {
    layout: { chunkCount: 8, chunkSize: 128 },
    source: { kind: 'noise', seed: 1337 },
    heightScale: 560,
  },
});
scene.add(terrain.object);
await terrain.prepare(camera);

function frame(deltaSeconds) {
  terrain.update(deltaSeconds, { camera });
  renderer.render(scene, camera);
}
// When your scene closes:
terrain.dispose();`;

export default function DocsOverview() {
  const { language } = useLanguage();
  const fr = language === 'fr';
  return (
    <div className="docs-overview docs-markdown">
      <header className="docs-hero">
        <span className="docs-package-badge">procedural-terrains · v{packageInfo.version}</span>
        <h1>{fr ? 'Vos terrains. Votre scène Three.js.' : 'Your terrain. Your Three.js scene.'}</h1>
        <p>{fr ? 'Le moteur du studio dans un package ESM typé : terrains finis, mondes infinis, planètes et dioramas Mini, avec eau et nuages à la demande.' : 'The studio runtime in a typed ESM package: finite terrain, infinite worlds, planets and Mini dioramas, with optional water and clouds.'}</p>
        <a className="docs-cta" href={docsHref('getting-started')}>{t('Getting started')} <ArrowRight size={15} /></a>
        <a className="docs-cta" href={docsHref('playground')}>{t('Open playground')} <ArrowRight size={15} /></a>
      </header>
      <figure className="docs-terrain-preview"><img src={new URL('../../docs/images/mini-terrain.png', import.meta.url).href} alt={fr ? 'Diorama Mini Terrain avec eau et nuages' : 'Mini Terrain diorama with water and clouds'} /></figure>
      <div className="docs-world-cards">
        {[[Box, 'Tile', 'Finite terrain'], [Globe2, 'Infinite World', 'Camera-centred streaming'], [Orbit, 'Planet', 'Cube-sphere terrain'], [Layers3, 'Mini', 'Cutaway dioramas']].map(([Icon, name, description]) => (
          <a href={docsHref('worlds')} key={name}><Icon size={21} /><strong>{name}</strong><small>{t(description)}</small></a>
        ))}
      </div>
      <h2>{fr ? 'Un moteur qui s’intègre à votre application' : 'A runtime that fits your application'}</h2>
      <p>{fr ? 'Vous gardez la scène, la caméra, le renderer et la boucle d’animation. Le package fournit la géométrie, le bruit procédural, les shaders et le LOD. React et le backend du studio ne sont pas nécessaires.' : 'You own the scene, camera, renderer and animation loop. The package provides geometry, procedural noise, shaders and LOD. React and the studio backend are not required.'}</p>
      <CodeBlock code={quickStart} lang="js" />
      <CodeBlock code="npm install procedural-terrains" lang="sh" />
      <blockquote><p>{fr ? 'Three.js ~0.185.1 est une dépendance pair ; npm l’installe automatiquement si nécessaire.' : 'Three.js ~0.185.1 is a peer dependency; npm installs it automatically when needed.'}</p></blockquote>
      <p><a href={docsHref('code-export')}>{t('Studio and code export')} <ArrowRight size={13} /></a></p>
    </div>
  );
}
