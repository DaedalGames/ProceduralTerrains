import { beforeAll, describe, expect, it } from 'vitest';
import { init } from 'es-module-lexer';
import { transform } from 'esbuild';
import { buildDocument, buildStandalone, codeFromHash, decodeCode, encodeCode, playgroundHref } from '../src/docs/playground/runner.js';
import { PLAYGROUND_TEMPLATES, templateFromHash } from '../src/docs/playground/templates.js';
import { dependencyId, moduleId, rewriteModule } from '../tools/playground-runtime.mjs';

beforeAll(async () => { await init; });
describe('terrain playground', () => {
  it('rewrites static, dynamic and re-export imports without altering strings or comments', () => {
    const source = [
      "import * as THREE from 'three';",
      "export { value } from './other.js';",
      "const module = await import('../extra.js');",
      "const worker = new URL('./worker.js', import.meta.url);",
      "const text = \"import.meta.url and import('./untouched.js')\";",
      "// import './also-untouched.js'",
    ].join('\n');
    const result = rewriteModule(source, 'package/chunks/main.js');
    expect(result.dependencies).toEqual(['three/three.module.js', 'package/chunks/other.js', 'package/extra.js']);
    expect(result.source).toContain("from 'terrain-runtime:/three/three.module.js'");
    expect(result.source).toContain('import("terrain-runtime:/package/extra.js")');
    expect(result.source).toContain('"terrain-runtime:/package/chunks/main.js"');
    expect(result.source).toContain("import('./untouched.js')");
    expect(result.source).toContain("// import './also-untouched.js'");
    expect(() => rewriteModule("import x from 'missing';", 'package/a.js')).toThrow('Unsupported playground dependency');
    expect(dependencyId('three/examples/jsm/controls/OrbitControls.js', 'package/a.js')).toBe('three/addons/controls/OrbitControls.js');
  });
  it('identifies self-contained workers without treating ESM imports or exports as classic scripts', () => {
    expect(rewriteModule('self.onmessage = e => self.postMessage(e.data);', 'package/assets/worker.js').classicWorker).toBe(true);
    expect(rewriteModule("import './dependency.js'; self.onmessage = () => {};", 'package/assets/worker.js').classicWorker).toBe(false);
    expect(rewriteModule('export const value = 1;', 'package/assets/worker.js').classicWorker).toBe(false);
  });
  it('selects independent examples through documentation deep links',()=>{
    expect(templateFromHash('#/docs/playground?example=clouds').id).toBe('clouds');
    expect(templateFromHash('#/docs/playground?example=water').code).not.toContain('createTerrain(');
    expect(templateFromHash('#/docs/playground?example=missing')).toBe(null);
  });
  it('round-trips Unicode code and rejects invalid or oversized share links', () => {
    const code = "console.log('Terrain émeraude 🌍');";
    expect(decodeCode(encodeCode(code))).toBe(code);
    expect(codeFromHash(playgroundHref(code))).toBe(code);
    expect(decodeCode('%%%')).toBeNull();
    expect(codeFromHash('#/docs/playground')).toBeNull();
    expect(decodeCode('a'.repeat(140000))).toBeNull();
    expect(() => encodeCode('a'.repeat(100001))).toThrow('too long');
  });
  it('escapes embedded code and runtime sources in HTML and preserves ready signaling after top-level await', () => {
    const code = "await Promise.resolve(); console.log('</script>');";
    const runtime = { modules: { [moduleId('a.js')]: "export const text = '</script>';" }, imports: {} };
    const html = buildDocument(code, 'token');
    expect((html.match(/<\/script>/g) ?? [])).toHaveLength(1);
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('globalThis.__playgroundReady()');
    expect(html).not.toContain('allow-same-origin');
    const standalone = buildStandalone(code, runtime);
    expect((standalone.match(/<\/script>/g) ?? [])).toHaveLength(1);
    expect(standalone).toContain('terrain-runtime:/a.js');
    expect(standalone).not.toContain('cdn.jsdelivr');
  });
  it.each(PLAYGROUND_TEMPLATES)('parses the complete $id example as ESM', async ({ code }) => {
    await expect(transform(code, { loader: 'js', format: 'esm', target: 'esnext' })).resolves.toBeDefined();
    expect(code).toContain('procedural-terrains');
  });
});
