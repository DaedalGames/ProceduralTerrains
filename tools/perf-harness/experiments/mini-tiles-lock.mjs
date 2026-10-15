// Mini Terrain must stay a single footprint while classic projects keep tile
// growth. Runs through the real project transactions.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-tiles-lock.mjs
export default async function ({ page, h }) {
  const create = (project) => page.evaluate(async (p) => {
    await window.__engine.transitionMode({ worldMode: 'studio', projectMode: 'procedural', project: p, reason: 'project-create' });
  }, project);
  const probe = () => page.evaluate(() => {
    const e = window.__engine;
    const added = e.addTile(1, 0);
    const expanded = e.expandCircle();
    e.setTileAssemblyShape('circle');
    return { added, expanded, tiles: e.tiles.length, shape: e.tileAssemblyShape, interaction: e._tileInteractionActive() };
  });

  await create({ projectMode: 'procedural', seed: 3, mini: { recipe: 'cove', seed: 3 } });
  await h.settle({ timeoutMs: 120000 });
  console.log('MINI', JSON.stringify(await probe()));

  await create({ projectMode: 'procedural', seed: 3, presetKey: 'archipelago' });
  await h.settle({ timeoutMs: 120000 });
  const classic = await page.evaluate(() => {
    const e = window.__engine;
    const added = e.addTile(1, 0);
    return { added, tiles: e.tiles.length, interaction: e._tileInteractionActive() };
  });
  console.log('CLASSIC', JSON.stringify(classic));
}
