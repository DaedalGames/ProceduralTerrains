// Mini Terrain export: runs a real GLB export of a diorama, unpacks the zip,
// lists the glTF nodes / materials / extensions, then re-imports the GLB in
// the page (GLTFLoader) and renders it alone to check the water block.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-export.mjs
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

export default async function ({ page, h, shot, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || 'mini-export');
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(async () => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed: 3364, mini: { recipe: 'procedural', seed: 3364, preset: 'archipelago' } },
    });
  });
  await h.settle({ timeoutMs: 120000 });
  const b64 = await page.evaluate(async () => {
    let captured = null;
    globalThis.__terrainSaveBlob = async (blob) => { captured = blob; return { canceled: false }; };
    await window.__engine.export3DTerrain({
      format: 'glb', meshRes: '256', includeMesh: true, includeSkirts: true, includeBase: true,
      bakeColor: true, texRes: '512', bakeNormal: false, exportWater: true, exportPreset: false,
    });
    const bytes = new Uint8Array(await captured.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const zip = unzipSync(Buffer.from(b64, 'base64'));
  console.log('ZIP', Object.keys(zip).join(', '));
  const glbName = Object.keys(zip).find((n) => n.endsWith('.glb'));
  const glb = Buffer.from(zip[glbName]);
  fs.writeFileSync(path.join(dir, 'mini.glb'), glb);
  for (const name of Object.keys(zip)) if (name.endsWith('.png')) fs.writeFileSync(path.join(dir, path.basename(name)), zip[name]);
  const jsonLen = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  console.log('EXT', JSON.stringify(gltf.extensionsUsed ?? []));
  console.log('NODES', JSON.stringify(gltf.nodes.map((n) => n.name)));
  console.log('MATERIALS', JSON.stringify(gltf.materials.map((m) => ({ name: m.name, alpha: m.alphaMode, ext: Object.keys(m.extensions ?? {}) }))));
  console.log('PRIMS', JSON.stringify(gltf.meshes.map((m) => ({ name: m.name, attrs: m.primitives.map((p) => Object.keys(p.attributes)) }))));

  // re-import and render the exported piece alone
  const urls = await page.evaluate(async (data) => {
    const { renderGlbPreview } = await import('/tools/perf-harness/glb-preview.js');
    const e = window.__engine;
    return renderGlbPreview(e.renderer, data, { aspect: e.camera.aspect, views: [1, 0.55] });
  }, glb.toString('base64'));
  urls.forEach((url, i) => fs.writeFileSync(path.join(dir, `export-glb-${i}.png`), Buffer.from(url.split(',')[1], 'base64')));
}
