// Live terrain edits on a Mini diorama: capture right after a slider change,
// a few frames later and once settled; report how long until the derived
// data (height bake → Mini light map) is current again, and the mean frame
// brightness at each step (a lighting drop shows up as a dip).
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-live-edit.mjs
//   env: EDIT=noise|relief
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, shot, ROOT }) {
  const edit = process.env.EDIT || 'noise';
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || `mini-live-${edit}`);
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(async () => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed: 3364, mini: { recipe: 'procedural', seed: 3364, preset: 'archipelago' } },
    });
  });
  await h.settle({ timeoutMs: 120000 });
  if (process.env.CLOSE) {
    await page.evaluate(() => {
      const c = window.__engine.controls;
      const home = c.home;
      c.goToView({ theta: home.theta + 0.3, phi: 72 * Math.PI / 180, radius: home.radius * 0.38, target: home.target }, { blend: false });
    });
    await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
  }
  const state = () => page.evaluate(() => {
    const e = window.__engine;
    // mean luminance of the presented frame (drawing buffer is preserved by
    // the harness, so read it back through a 2D canvas)
    const src = e.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 36;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return {
      gen: e._terrainGen,
      bake: e._studioBakeCurrent(),
      useTex: e.uniforms.uUseTerrainHeightTex?.value,
      waterLight: e.mini.waterSurface.uniforms.uMiniLightEnabled.value,
      decal: e.mini.lightMap.decal.visible,
      heightScale: e.params.heightScale,
      sea: e.params.seaLevel,
      luma: Math.round(sum / (64 * 36) * 10) / 10,
      trees: e.propsManager.getDiagnostics().instances.trees,
      staleDraws: e.propsManager.meshes.filter((m) => m.name.endsWith('-stale') && m.count > 0).length,
      groundShift: e.propsManager._groundShiftActive?.(),
    };
  });
  const tick = () => page.evaluate(() => { window.__engine._needsRender = true; window.__engine._tick(); });
  console.log('before', JSON.stringify(await state()));
  await shot(path.join(dir, '0-before.png'));
  // a "drag": several consecutive slider values, one per frame
  const values = edit === 'relief' ? [1.1, 1.2, 1.3, 1.4] : [42, 47, 52, 57];
  for (const v of values) {
    await page.evaluate(({ value, kind }) => {
      const e = window.__engine;
      if (kind === 'relief') e.setMiniTerrain({ relief: value });
      else e.setParam('noiseScale', value);
    }, { value: v, kind: edit });
    await tick();
  }
  console.log('after drag', JSON.stringify(await state()));
  await shot(path.join(dir, '1-during.png'));
  const t0 = Date.now();
  let frames = 0;
  while (!(await page.evaluate(() => window.__engine._studioBakeCurrent())) && frames < 2000) {
    await tick();
    frames++;
    if (frames % 4 === 0) console.log('  frame', frames, JSON.stringify(await state()));
  }
  console.log('bake current after', frames, 'ticks,', Date.now() - t0, 'ms', JSON.stringify(await state()));
  await h.settle({ timeoutMs: 60000, minFrames: 10, idleFrames: 5 });
  console.log('settled', JSON.stringify(await state()));
  await shot(path.join(dir, '2-settled.png'));
}
