// New built-in props in a classic (non-Mini) Tile project: close and mid shots.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/props-classic.mjs
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, shot, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || 'props-classic');
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(async ({ seed, preset }) => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed, presetKey: preset },
    });
  }, { seed: Number(process.env.SEED || 8), preset: process.env.PRESET || 'highlands' });
  await h.setParams({ propsEnabled: true, propsTreeDensity: 1.2 });
  await h.settle({ timeoutMs: 120000 });
  // aim at an existing grove: the first instance of a tree batch
  const focus = await page.evaluate(() => {
    const e = window.__engine;
    const mesh = e.propsManager.meshes.find((m) => /broadleaf|conifer/.test(m.name) && m.count > 0);
    if (!mesh) return null;
    const m = new e.camera.matrix.constructor();
    mesh.getMatrixAt(Math.floor(mesh.count / 2), m);
    return { x: m.elements[12], y: m.elements[13], z: m.elements[14], size: e.boardSize };
  });
  console.log('focus', JSON.stringify(focus));
  const t = focus ? [focus.x / focus.size, focus.y + 6, focus.z / focus.size] : [0, 90, 0];
  for (const [id, pose] of [
    ['mid', { radiusFactor: 0.06, phi: 70, theta: 30, target: t }],
    ['close', { radiusFactor: 0.025, phi: 80, theta: 60, target: t }],
  ]) {
    await h.setPose(pose);
    await h.settle({ timeoutMs: 60000, minFrames: 30, idleFrames: 10 });
    await h.setPose(pose);
    await shot(path.join(dir, `${id}.png`));
    const d = await page.evaluate(() => window.__engine.propsManager.getDiagnostics());
    console.log(id, JSON.stringify(d.instances), 'tris', d.triangles, 'draws', d.drawCalls);
  }
}
