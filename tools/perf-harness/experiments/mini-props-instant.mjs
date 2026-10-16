// Mini Terrain props: look + how fast the scatter follows a terrain edit.
// Creates a procedural diorama, captures the home view and a close view of
// the vegetation, then "drags" a slider one value per frame and reports, per
// frame, the props build cost and whether the scatter matches the terrain.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-props-instant.mjs
//   env: LABEL  PRESET=alpine  EDIT=relief|noise|water|props
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, shot, ROOT }) {
  const preset = process.env.PRESET || 'alpine';
  const edit = process.env.EDIT || 'relief';
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || `mini-props-${preset}`);
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(async (p) => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed: 3364, mini: { recipe: 'procedural', seed: 3364, preset: p } },
    });
  }, preset);
  await h.settle({ timeoutMs: 180000 });
  const state = () => page.evaluate(() => {
    const e = window.__engine;
    const d = e.propsManager.getDiagnostics();
    const field = e.mini.propField();
    return {
      gen: e._terrainGen,
      field: field?.revision ?? null,
      scatter: e.propsManager.scatterRevision,
      buildMs: Math.round(d.buildMs * 10) / 10,
      queued: d.queuedSectors,
      settled: e.propsManager.scatterSettled,
      trees: d.instances.trees,
      rocks: d.instances.rocks,
      visible: e.propsManager.group.visible,
      octaves: e.params.octaves,
      heightScale: e.params.heightScale,
    };
  });
  console.log('settled', JSON.stringify(await state()));
  await shot(path.join(dir, '0-home.png'));
  await page.evaluate(() => {
    const c = window.__engine.controls;
    const home = c.home;
    c.goToView({ theta: home.theta + 0.3, phi: 70 * Math.PI / 180, radius: home.radius * 0.3, target: home.target }, { blend: false });
  });
  await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
  await shot(path.join(dir, '1-close.png'));
  await page.evaluate(() => {
    const c = window.__engine.controls;
    c.goToView(c.home, { blend: false });
  });
  await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });

  const tick = () => page.evaluate(() => { window.__engine._needsRender = true; window.__engine._tick(); });
  const values = {
    relief: [1.1, 1.2, 1.3, 1.4, 1.5],
    noise: [30, 34, 38, 42, 46],
    water: [0.55, 0.6, 0.65, 0.7, 0.75],
    props: [1.2, 1.4, 1.6, 1.8, 2.0],
  }[edit];
  for (const v of values) {
    await page.evaluate(({ value, kind }) => {
      const e = window.__engine;
      if (kind === 'relief') e.setMiniTerrain({ relief: value });
      else if (kind === 'water') e.setMiniTerrain({ waterLevel: value });
      else if (kind === 'props') e.setMiniTerrain({ propScale: value });
      else e.setParam('noiseScale', value);
    }, { value: v, kind: edit });
    await tick();
    console.log('drag', v, JSON.stringify(await state()));
  }
  await shot(path.join(dir, '2-during.png'));
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 16));
    await tick();
    const s = await state();
    console.log('  after', i + 1, JSON.stringify(s));
    if (s.field === s.gen && s.scatter === s.gen && s.settled) {
      console.log('props current after', i + 1, 'frames,', Date.now() - t0, 'ms');
      break;
    }
  }
  await h.settle({ timeoutMs: 60000, minFrames: 10, idleFrames: 5 });
  console.log('final', JSON.stringify(await state()));
  await shot(path.join(dir, '3-settled.png'));
}
