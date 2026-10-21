// Mini clouds: enable them and check they sit above the diorama.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-clouds.mjs
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, shot, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || 'mini-clouds');
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(async () => {
    const e = window.__engine;
    await e.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed: 12, mini: { recipe: 'procedural', seed: 12, preset: 'highlands' } },
    });
    e.setMiniTerrain({ clouds: 0.6 });
  });
  await h.settle({ timeoutMs: 120000 });
  const DEG = Math.PI / 180;
  for (const [id, dTheta, phi, radius] of [['home', 0, null, 1], ['side', Math.PI / 2, 84, 1.05], ['top', 0, 2, 1.1]]) {
    await page.evaluate(({ dTheta: dt, phi: ph, radius: r, D }) => {
      const c = window.__engine.controls;
      const home = c.home;
      c.minPhi = 0.5 * D;
      c.goToView({ theta: home.theta + dt, phi: ph == null ? home.phi : ph * D, radius: home.radius * r, target: home.target }, { blend: false });
    }, { dTheta, phi, radius, D: DEG });
    await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
    await shot(path.join(dir, `${id}.png`));
  }
  const cloud = await page.evaluate(() => {
    const s = window.__engine.studioCloud;
    return { pos: s.mesh.position.toArray().map(Math.round), scale: s.mesh.scale.toArray().map(Math.round), enabled: s._enabled };
  });
  console.log('CLOUD', JSON.stringify(cloud));
}
