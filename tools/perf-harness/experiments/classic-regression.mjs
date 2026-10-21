// Non-regression capture for classic (non-Mini) projects: renders a fixed
// procedural project at fixed poses. With ROUNDTRIP=1 (and a build that has
// Mini Terrain) it first opens a Mini project, then returns to the classic one,
// so leaked Mini state would show up as a pixel difference.
//   OUT=<dir> node tools/perf-harness/probe.mjs <this file>
import fs from 'node:fs';
import path from 'node:path';

const POSES = [
  { id: 'angled', pose: { radiusFactor: 1.4, phi: 55, theta: 45 } },
  { id: 'low', pose: { radiusFactor: 0.9, phi: 78, theta: 120 } },
];

export default async function ({ page, h, shot }) {
  const out = process.env.OUT;
  fs.mkdirSync(out, { recursive: true });
  const roundtrip = process.env.ROUNDTRIP === '1';
  const classic = { projectMode: 'procedural', seed: 77, presetKey: 'archipelago' };
  const create = (project) => page.evaluate(async (p) => {
    await window.__engine.transitionMode({ worldMode: 'studio', projectMode: 'procedural', project: p, reason: 'project-create' });
  }, project);
  await create(classic);
  await h.settle({ timeoutMs: 120000 });
  if (roundtrip) {
    const hasMini = await page.evaluate(() => typeof window.__engine.getMiniTerrain === 'function');
    if (!hasMini) throw new Error('ROUNDTRIP requires a Mini Terrain build');
    await create({ projectMode: 'procedural', seed: 5, mini: { recipe: 'cove', seed: 5 } });
    await h.settle({ timeoutMs: 120000 });
    await create(classic);
    await h.settle({ timeoutMs: 120000 });
  }
  for (const view of POSES) {
    await h.setPose(view.pose);
    await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
    await h.setPose(view.pose);
    await shot(path.join(out, `${view.id}.png`));
  }
  const state = await page.evaluate(() => {
    const e = window.__engine;
    const u = e.uniforms;
    return {
      miniShape: u.uMiniShape?.value ?? null,
      miniCut: u.uMiniCut?.value ?? null,
      wall: u.uWallThickness.value,
      plinthVisible: e.plinth.visible,
      home: !!e.controls.home,
      chunkCount: e.params.chunkCount,
      lodSegments: e.board.lodSegments,
    };
  });
  console.log('STATE', JSON.stringify(state));
}
