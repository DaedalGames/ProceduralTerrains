// Mini Terrain round footprint: creates a Mini per recipe, switches it to the
// circle shape and captures home / top / cut-close / back views.
//
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-circle.mjs
//   env: LABEL=<run label>  RECIPES=procedural,cove  SEED=20261015
import fs from 'node:fs';
import path from 'node:path';

const DEG = Math.PI / 180;

export default async function ({ page, h, shot, ROOT }) {
  const label = process.env.LABEL || 'mini-circle';
  const recipes = (process.env.RECIPES || 'procedural,cove').split(',');
  const seed = Number(process.env.SEED || 20261015);
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', label);
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => {
    const original = console.error.bind(console);
    console.error = (...args) => {
      if (String(args[0]).includes('shader health')) {
        try { window.__miniHealth = JSON.stringify(args.slice(1), (k, v) => (k === 'diagnostics' && Array.isArray(v) ? v.map((d) => ({ ok: d.ok, role: d.role, name: d.name, log: d.programLog })) : v)).slice(0, 2500); } catch { /* ignore */ }
      }
      original(...args);
    };
  });

  for (const recipe of recipes) {
    await page.evaluate(async ({ recipe: r, seed: s, shape }) => {
      const e = window.__engine;
      await e.transitionMode({
        worldMode: 'studio',
        projectMode: 'procedural',
        project: { projectMode: 'procedural', seed: s, mini: { recipe: r, seed: s } },
        reason: 'project-create',
      });
      if (shape !== 'square') e.setMiniTerrain({ shape });
    }, { recipe, seed, shape: process.env.SHAPE || 'circle' });
    await h.settle({ timeoutMs: 180000 });
    const state = await page.evaluate(() => {
      const e = window.__engine;
      const u = e.uniforms;
      return {
        shape: e.getMiniTerrain()?.shape,
        bevel: u.uMiniTerrainBevel?.value,
        rounded: u.uMiniBevelRounded?.value,
        boardHalf: u.uBoardHalf?.value,
        walk: e.mini.walkBounds(),
      };
    });
    console.log(recipe, JSON.stringify(state));
    console.log(recipe, 'HEALTH', await page.evaluate(() => window.__miniHealth || 'none'));

    const views = [
      { id: 'home', pose: null },
      { id: 'top', pose: { phi: 1, dTheta: 0, radius: 1.0 } },
      { id: 'cut-close', pose: { phi: 70, dTheta: -0.2, radius: 0.55 } },
      { id: 'back', pose: { phi: 60, dTheta: Math.PI, radius: 1.0 } },
    ];
    for (const view of views) {
      await page.evaluate(({ pose, DEG: D }) => {
        const e = window.__engine;
        const c = e.controls;
        c.autoOrbit = false;
        c.mode = 'orbit';
        const home = c.home;
        if (!pose) { c.goToView(home, { blend: false }); return; }
        c.goToView({
          theta: home.theta + pose.dTheta,
          phi: pose.phi * D,
          radius: home.radius * pose.radius,
          target: home.target,
        }, { blend: false });
        c.minPhi = 0.5 * D;
        c.goalPhi = c.phi = pose.phi * D;
      }, { pose: view.pose, DEG });
      await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
      await shot(path.join(dir, `${recipe}--${view.id}.png`));
    }
  }
}
