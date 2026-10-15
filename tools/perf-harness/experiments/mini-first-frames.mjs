// First frames after a procedural → Mini project transaction (the "first
// boot" case): nothing derived from the previous terrain may be displayed.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-first-frames.mjs
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, shot, ROOT }) {
  const recipe = process.env.RECIPE || 'islet';
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || 'mini-first');
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(async () => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed: 4242, presetKey: 'alpine' },
    });
  });
  await h.settle({ timeoutMs: 120000 });
  await page.evaluate(async (r) => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed: 777, mini: { recipe: r, seed: 777 } },
    });
  }, recipe);
  const state = () => page.evaluate(() => {
    const e = window.__engine;
    return {
      bakeCurrent: e._studioBakeCurrent(),
      light: e.mini?.waterSurface?.uniforms.uMiniLightEnabled.value,
      forestVisible: e.mini?.forest?.group.visible,
    };
  });
  console.log('frame0', JSON.stringify(await state()));
  await shot(path.join(dir, `${recipe}--frame0.png`));
  await h.settle({ timeoutMs: 120000 });
  console.log('settled', JSON.stringify(await state()));
  await shot(path.join(dir, `${recipe}--settled.png`));
}
