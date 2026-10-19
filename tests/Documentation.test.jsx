import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOCS_PAGES, docsHref, getPage, pageSource, parseDocsHash, createLinkContext } from '../src/docs/docsPages.js';
import Markdown, { parseMarkdown } from '../src/docs/Markdown.jsx';
import { highlight } from '../src/docs/highlight.js';

describe('package documentation', () => {
  it('keeps English anchors stable in the French guides', () => {
    for (const page of DOCS_PAGES.filter((item) => item.fr)) {
      const french = pageSource(page, 'fr');
      const en = parseMarkdown(page.source);
      const fr = parseMarkdown(french.source, french.reference);
      expect(fr.aligned, page.id).toBe(true);
      expect(fr.headings.map((heading) => heading.id)).toEqual(en.headings.map((heading) => heading.id));
    }
  });
  it('routes pages, encoded anchors and malformed links safely', () => {
    expect(parseDocsHash(docsHref('api', 'configure(patch)'))).toEqual({ page: 'api', anchor: 'configure(patch)' });
    expect(parseDocsHash('#/docs/api/%E0%A4%A')).toEqual({ page: 'api', anchor: '' });
    expect(parseDocsHash('#/docs/missing')).toEqual({ page: 'overview', anchor: '' });
    expect(createLinkContext('api').resolveHref('worlds.md#mini')).toEqual({ href: '#/docs/worlds/mini', internal: true });
    expect(createLinkContext('api').resolveHref('#configuration').href).toBe('#/docs/api/configuration');
  });
  it('renders the API tables and every documented entry point', () => {
    const page = getPage('api');
    const html = renderToStaticMarkup(<Markdown source={page.source} ctx={createLinkContext('api')} />);
    expect(html).toContain('<table>');
    expect(html).toContain('id="configuration"');
    expect(html).toContain('procedural-terrains/documents');
    expect(html).toContain('createTerrain');
    expect(highlight("import { createTerrain } from 'procedural-terrains';", 'js').map((token) => token.text).join('')).toContain('createTerrain');
  });
});
