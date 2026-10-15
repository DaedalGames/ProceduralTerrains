// "Stylized / Diorama" water mode (the Mini Terrain water) in the classic
// worlds: Tile views, then Infinite World views, compared with Volumetric.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/stylized-water.mjs
//   env: LABEL=<run label>  MODES=stylized,volumetric  SEED=8  PRESET=archipelago
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, shot, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || 'stylized-water');
  fs.mkdirSync(dir, { recursive: true });
  const modes = (process.env.MODES || 'stylized,volumetric').split(',');
  await page.evaluate(async ({ seed, preset }) => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed, presetKey: preset },
    });
  }, { seed: Number(process.env.SEED || 8), preset: process.env.PRESET || 'archipelago' });
  await h.settle({ timeoutMs: 120000 });
  const info = () => page.evaluate(() => {
    const e = window.__engine;
    const surf = e.worldMode === 'infinite' ? e.infiniteWorld?.waterPlane : e.water;
    const m = surf?.material;
    return {
      world: e.worldMode,
      effective: e.waterSystem.getEffectiveMode(),
      material: m?.name || m?.type,
      scene: m?.uniforms?.uSceneRefractionEnabled?.value,
      bakeDepth: m?.uniforms?.uMiniBakeDepth?.value,
    };
  });
  const tilePoses = [
    ['tile-wide', { radiusFactor: 1.2, phi: 58, theta: 40 }],
    ['tile-low', { radiusFactor: 0.35, phi: 76, theta: 120, target: [0.0, 40, 0.1] }],
  ];
  for (const mode of modes) {
    await h.setParams({ waterMode: mode, waterEnabled: true });
    for (const [id, pose] of tilePoses) {
      await h.setPose(pose);
      await h.settle({ timeoutMs: 90000, minFrames: 20, idleFrames: 10 });
      await shot(path.join(dir, `${mode}-${id}.png`));
    }
    console.log(mode, 'tile', JSON.stringify(await info()));
  }
  console.log('to infinite', JSON.stringify(await page.evaluate(() => window.__h.transition('infinite'))));
  for (const mode of modes) {
    await h.setParams({ waterMode: mode, waterEnabled: true });
    for (const [id, pose] of [
      ['inf-horizon', { position: [0, 520, 0], yaw: 35, pitch: -8 }],
      ['inf-low', { position: [900, 260, -700], yaw: 140, pitch: -14 }],
    ]) {
      await h.setPose(pose);
      await h.settle({ timeoutMs: 90000, minFrames: 30, idleFrames: 10 });
      await shot(path.join(dir, `${mode}-${id}.png`));
    }
    console.log(mode, 'infinite', JSON.stringify(await info()));
  }
}
