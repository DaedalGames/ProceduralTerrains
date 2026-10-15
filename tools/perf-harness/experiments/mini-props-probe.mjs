// Diagnostic: what the prop placement sees on a Mini Terrain (climate, slope,
// height) at a grid of land points, plus the tree candidate score.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-props-probe.mjs
export default async function ({ page }) {
  const recipe = process.env.RECIPE || 'islet';
  const out = await page.evaluate(async (r) => {
    const e = window.__engine;
    await e.transitionMode({
      worldMode: 'studio', projectMode: 'procedural',
      project: { projectMode: 'procedural', seed: 20261015, mini: { recipe: r, seed: 20261015 } },
      reason: 'project-create',
    });
    const cpu = e._getCpuHeightSampler();
    const half = e.boardSize / 2;
    const rows = [];
    for (let iz = -2; iz <= 2; iz++) {
      for (let ix = -2; ix <= 2; ix++) {
        const x = ix * half * 0.35;
        const z = iz * half * 0.35;
        const h = cpu.heightAt(x, z);
        const c = cpu.climateAt(x, z);
        const n = cpu.normalAt(x, z, 2);
        rows.push({ x: Math.round(x), z: Math.round(z), h: Math.round(h), temp: +c.temp.toFixed(2), moist: +c.moist.toFixed(2), slope: +(1 - n.y).toFixed(2) });
      }
    }
    return { sea: e.params.seaLevel, rows, sampler: Object.keys(e.propsManager || {}).slice(0, 5) };
  }, recipe);
  console.log('sea', out.sea);
  for (const row of out.rows) console.log(JSON.stringify(row));
}
