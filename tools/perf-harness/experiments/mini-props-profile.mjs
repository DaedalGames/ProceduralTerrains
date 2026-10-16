// Where a Mini props rebuild spends its time (field sampler pieces vs the
// placement loop vs the commit).
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-props-profile.mjs
export default async function ({ page, h }) {
  await page.evaluate(async () => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed: 3364, mini: { recipe: 'procedural', seed: 3364, preset: 'alpine' } },
    });
  });
  await h.settle({ timeoutMs: 180000 });
  const out = await page.evaluate(() => {
    const e = window.__engine;
    const pm = e.propsManager;
    const field = e.mini.propField();
    const s = e._getMiniPropSampler(field);
    const time = (fn, n = 3) => { let best = Infinity; for (let i = 0; i < n; i++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t); } return Math.round(best * 10) / 10; };
    const N = 30000;
    const pts = Array.from({ length: N }, (_, i) => [((i * 7919) % 1000) - 500, ((i * 104729) % 1000) - 500]);
    const r = {};
    r.sampleAt = time(() => { for (const [x, z] of pts) s.sampleAt(x, z); });
    r.heightAt5 = time(() => { for (const [x, z] of pts) { s.heightAt(x, z); s.heightAt(x + 1, z); s.heightAt(x - 1, z); s.heightAt(x, z + 1); s.heightAt(x, z - 1); } });
    r.climate = time(() => { for (const [x, z] of pts) s._climateAt(x, z); });
    r.biome = time(() => { for (const [x, z] of pts) s.cpu._biomeWeights(s._climateAt(x, z)); });
    r.paintMask = time(() => { for (const [x, z] of pts) s.getPaintMask(x, z); });
    r.paintBiome = time(() => { for (const [x, z] of pts) s.getPaintBiomeWeights(x, z); });
    r.exclusion = time(() => { for (const [x, z] of pts) s.getPropExclusion(x, z); });
    r.paintDensity = time(() => { for (const [x, z] of pts) s.paintDensityForTypeAt('grass', x, z); });
    r.contains = time(() => { for (const [x, z] of pts) e._containsPropPoint(x, z); });
    // full rebuild, then the same with the commit isolated
    const params = e.params.propsSeed >= 0 ? { ...e.params, seed: e.params.propsSeed } : e.params;
    r.sectors = pm._sectors.size;
    r.buildAll = time(() => { for (const key of pm._sectors.keys()) { const [sx, sz] = key.split(',').map(Number); pm._buildFlatSector(sx, sz, params, s); } }, 2);
    const center = pm._lastCenter.clone();
    r.commit = time(() => pm._commitFlat(center, Math.max(32, params.propsCullDistance) * pm._qualityBudget.distanceScale, params), 2);
    r.samples = pm.getDiagnostics().samples;
    return r;
  });
  console.log('profile', JSON.stringify(out));
}
