// Mini water under every water mode / performance preset combination the user
// can reach from the Water and Performance panels: a close, low view of the
// lagoon per combination plus which material actually draws the surface.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-water-modes.mjs
//   env: LABEL=<run label>  COMBOS=volumetric:high,volumetric:balanced,realistic:high
import fs from 'node:fs';
import path from 'node:path';

const DEG = Math.PI / 180;

export default async function ({ page, h, shot, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || 'mini-water-modes');
  fs.mkdirSync(dir, { recursive: true });
  const combos = (process.env.COMBOS || 'volumetric:high,volumetric:balanced,realistic:high,legacy:high,cinematic:high')
    .split(',').map((c) => c.split(':'));
  await page.evaluate(async () => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed: 3364, mini: { recipe: 'procedural', seed: 3364, preset: 'archipelago' } },
    });
  });
  await h.settle({ timeoutMs: 120000 });
  for (const [mode, perf] of combos) {
    await page.evaluate(({ mode: m, perf: p }) => {
      const e = window.__engine;
      e.setPerfPreset(p);
      e.setParam('waterMode', m);
    }, { mode, perf });
    await h.settle({ timeoutMs: 120000, minFrames: 20, idleFrames: 10 });
    await page.evaluate(({ D }) => {
      const c = window.__engine.controls;
      const home = c.home;
      c.minPhi = 0.5 * D;
      c.goToView({ theta: home.theta + 0.3, phi: 76 * D, radius: home.radius * 0.42, target: home.target }, { blend: false });
    }, { D: DEG });
    await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
    await shot(path.join(dir, `${mode}-${perf}.png`));
    const info = await page.evaluate(() => {
      const e = window.__engine;
      const mat = e.water?.material;
      return {
        effective: e.waterSystem.getEffectiveMode(),
        surface: mat?.name || mat?.type,
        override: !!e.waterSystem.studioOverride,
        scene: mat?.uniforms?.uSceneRefractionEnabled?.value,
        light: mat?.uniforms?.uMiniLightEnabled?.value,
        cutVisible: e.mini?.waterCut?.group?.visible ?? e.mini?.waterCut?.visible,
      };
    });
    console.log(mode, perf, JSON.stringify(info));
  }
}
