import { GITHUB_REPO_URL } from '../constants/app.js';
import runtime from '../../packages/procedural-terrains/README.md?raw';
import gettingStarted from '../../docs/getting-started.md?raw';
import api from '../../docs/api.md?raw';
import worlds from '../../docs/worlds.md?raw';
import effects from '../../docs/effects.md?raw';
import exports from '../../docs/code-export.md?raw';
import gettingStartedFr from '../../docs/fr/getting-started.md?raw';
import apiFr from '../../docs/fr/api.md?raw';
import worldsFr from '../../docs/fr/worlds.md?raw';
import effectsFr from '../../docs/fr/effects.md?raw';
import exportsFr from '../../docs/fr/code-export.md?raw';

export const DOCS_GROUPS = [
  { id: 'start', title: 'Get started' },
  { id: 'guides', title: 'Guides' },
  { id: 'reference', title: 'Reference' },
];
export const DOCS_PAGES = [
  { id: 'overview', group: 'start', title: 'Overview', component: 'overview', summary: 'The Three.js terrain package' },
  { id: 'playground', group: 'start', title: 'Playground', component: 'playground', summary: 'Edit and run terrain code with a live preview, templates and console' },
  { id: 'getting-started', group: 'start', title: 'Getting started', file: 'getting-started', source: gettingStarted, fr: gettingStartedFr, summary: 'Install the package and create your first terrain' },
  { id: 'worlds', group: 'guides', title: 'Worlds and sources', file: 'worlds', source: worlds, fr: worldsFr, summary: 'Tile, Infinite World, Planet, Mini, Noise Stack, graphs and heightmaps' },
  { id: 'effects', group: 'guides', title: 'Water, clouds and materials', file: 'effects', source: effects, fr: effectsFr, summary: 'Compose effects, pipelines, PBR assets and workers' },
  { id: 'code-export', group: 'guides', title: 'Studio and code export', file: 'code-export', source: exports, fr: exportsFr, summary: 'Export JavaScript, restore documents, bake meshes and maps' },
  { id: 'api', group: 'reference', title: 'API reference', file: 'api', source: api, fr: apiFr, summary: 'Factories, configuration, methods, lifecycle and entry points' },
  { id: 'package', group: 'reference', title: 'Package README', source: runtime, sourcePath: 'packages/procedural-terrains/README.md', summary: 'The complete package integration guide and validation commands' },
];
export const DEFAULT_PAGE = 'overview';
export const getPage = (id) => DOCS_PAGES.find((page) => page.id === id) ?? null;
export function docsHref(page = DEFAULT_PAGE, anchor = '') {
  return '#/docs/' + page + (anchor ? '/' + encodeURIComponent(anchor) : '');
}
export function parseDocsHash(hash = globalThis.location?.hash ?? '') {
  const [, page = '', rawAnchor = ''] = hash.replace(/^#\/?/, '').split('?')[0].split('/');
  let anchor = '';
  try { anchor = decodeURIComponent(rawAnchor); } catch { /* malformed deep link */ }
  return { page: getPage(page) ? page : DEFAULT_PAGE, anchor };
}
export function pageSource(page, locale) {
  const translated = locale === 'fr' && !!page.fr;
  return {
    source: translated ? page.fr : page.source ?? '',
    reference: translated ? page.source : null,
    file: translated ? 'fr/' + page.file : page.file,
    translated: translated || locale === 'en',
  };
}
export const githubSourceUrl = (file) => GITHUB_REPO_URL + '/blob/main/docs/' + file + '.md';
export function createLinkContext(pageId) {
  return {
    resolveHref(href = '') {
      if (/^(https?:|mailto:)/i.test(href)) return { href, internal: false };
      if (href.startsWith('#')) return { href: docsHref(pageId, href.slice(1)), internal: true };
      const path = href.replace(/^(\.\.?\/)+/, '');
      const match = /^([\w-]+)\.md(?:#(.*))?$/.exec(path);
      const target = match && DOCS_PAGES.find((page) => page.file === match[1]);
      if (target) return { href: docsHref(target.id, match[2]), internal: true };
      return { href: GITHUB_REPO_URL + '/blob/main/' + (match ? 'docs/' : '') + path, internal: false };
    },
    resolveImage(src = '') {
      const name = src.replace(/^(\.\.?\/)+/, '');
      const images = import.meta.glob('../../docs/images/*', { eager: true, query: '?url', import: 'default' });
      return images['../../docs/' + name] ?? src;
    },
  };
}
