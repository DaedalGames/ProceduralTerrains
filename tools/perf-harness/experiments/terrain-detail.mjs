// Terrain Detail (Noise tab) on the real GPU: captures a Mini diorama and a
// classic procedural board at several detail values (live uniform, no
// recompile expected), plus a close view of the Mini.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/terrain-detail.mjs
//   env: LABEL  VALUES=1,0.5,0.2
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, shot, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || 'terrain-detail');
  fs.mkdirSync(dir, { recursive: true });
  const values = (process.env.VALUES || '1,0.5,0.2').split(',').map(Number);
  const scenes = [
    { id: 'mini', project: { projectMode: 'procedural', seed: 3364, mini: { recipe: 'procedural', seed: 3364, preset: 'highlands' } } },
    { id: 'tile', project: { projectMode: 'procedural', seed: 3364, preset: 'alpine' } },
  ];
  for (const scene of scenes) {
    await page.evaluate(async (project) => {
      await window.__engine.transitionMode({ worldMode: 'studio', projectMode: 'procedural', reason: 'project-create', project });
    }, scene.project);
    await h.settle({ timeoutMs: 180000 });
    const programs = () => page.evaluate(() => window.__engine.renderer.info.programs?.length ?? 0);
    const before = await programs();
    for (const v of values) {
      await page.evaluate((value) => window.__engine.setParam('terrainDetail', value), v);
      await h.settle({ timeoutMs: 120000, minFrames: 20, idleFrames: 10 });
      const info = await page.evaluate(() => {
        const e = window.__engine;
        return {
          cut: e.uniforms.uTerrainDetailCut.value,
          trees: e.propsManager.getDiagnostics().instances.trees,
          bad: (e.renderer.info.programs || []).filter((p) => p.diagnostics && !p.diagnostics.runnable).map((p) => p.name),
        };
      });
      console.log(scene.id, 'detail', v, JSON.stringify(info), 'programs', await programs(), '(was', before, ')');
      await shot(path.join(dir, `${scene.id}-${v}.png`));
      if (scene.id === 'mini') {
        await page.evaluate(() => {
          const c = window.__engine.controls;
          const home = c.home;
          c.goToView({ theta: home.theta + 0.3, phi: 62 * Math.PI / 180, radius: home.radius * 0.35, target: home.target }, { blend: false });
        });
        await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
        await shot(path.join(dir, `${scene.id}-${v}-close.png`));
        await page.evaluate(() => { const c = window.__engine.controls; c.goToView(c.home, { blend: false }); });
      }
    }
  }
}
