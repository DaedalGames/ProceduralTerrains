// Mini Terrain visual + cost check: creates one Mini project per recipe through
// the real project transaction, then captures the home framing and the views
// the brief asks for (three-quarter, top, grazing, close to the water cut).
//
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-terrain.mjs
//   env: LABEL=<run label>  RECIPES=cove,islet,lake  SEED=20261015
import fs from 'node:fs';
import path from 'node:path';

const DEG = Math.PI / 180;

export default async function ({ page, h, shot, ROOT }) {
  const label = process.env.LABEL || 'mini-terrain';
  const recipes = (process.env.RECIPES || 'cove,islet,lake').split(',');
  const seed = Number(process.env.SEED || 20261015);
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', label);
  fs.mkdirSync(dir, { recursive: true });
  // Surface structured shader-health reports (the probe prints only text).
  await page.evaluate(() => {
    const original = console.error.bind(console);
    console.error = (...args) => {
      if (String(args[0]).includes('shader health')) {
        try { window.__miniHealth = JSON.stringify(args[2], (k, v) => (k === 'diagnostics' && Array.isArray(v) ? v.map((d) => ({ ok: d.ok, role: d.role, name: d.name, log: d.programLog })) : v)).slice(0, 1500); } catch { /* ignore */ }
      }
      original(...args);
    };
  });

  for (const recipe of recipes) {
    const created = await page.evaluate(async ({ recipe: r, seed: s }) => {
      const e = window.__engine;
      const t0 = performance.now();
      await e.transitionMode({
        worldMode: 'studio',
        projectMode: 'procedural',
        project: { projectMode: 'procedural', seed: s, mini: { recipe: r, seed: s } },
        reason: 'project-create',
      });
      return { ms: Math.round(performance.now() - t0), mini: e.getMiniTerrain(), water: e.waterSystem.getEffectiveMode() };
    }, { recipe, seed });
    console.log(recipe, 'created in', created.ms, 'ms; water', created.water, 'quality', created.mini?.quality);
    const st = await h.settle({ timeoutMs: 180000 });
    console.log(recipe, 'settled', JSON.stringify(st).slice(0, 200));
    const health = await page.evaluate(() => window.__miniHealth || null);
    if (health) console.log(recipe, 'HEALTH', health);

    const views = [
      { id: 'home', pose: null },
      { id: 'top', pose: { phi: 1, dTheta: 0, radius: 1.0 } },
      { id: 'grazing', pose: { phi: 84, dTheta: 0.9, radius: 0.75 } },
      { id: 'cut-close', pose: { phi: 70, dTheta: -0.2, radius: 0.55 } },
      { id: 'back', pose: { phi: 60, dTheta: Math.PI, radius: 1.0 } },
      { id: 'water-close', pose: { phi: 72, dTheta: 0.35, radius: 0.32 } },
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
      const m = await h.measure({ frames: 30, warmup: 6 });
      const extra = await page.evaluate(() => {
        const e = window.__engine;
        return {
          underwater: e.underwaterController.isUnderwater,
          cutVisible: e.mini?.waterCut?.mesh.visible,
          board: { chunks: e.board.chunks.length, segments: e.board.lodSegments },
          props: e.propsManager?.getDiagnostics?.()?.instances ?? null,
          mini: e.mini?.diagnostics?.(),
          badPrograms: (e.renderer.info.programs || []).filter((p) => p.diagnostics && !p.diagnostics.runnable).map((p) => p.name),
        };
      });
      console.log(`${recipe}/${view.id}`.padEnd(18), 'frame', m.frameMs?.mean, 'gpu', m.gpuMs?.mean, 'tris', m.triangles?.mean, 'draws', m.drawCalls?.mean, JSON.stringify(extra));
    }
  }
}
