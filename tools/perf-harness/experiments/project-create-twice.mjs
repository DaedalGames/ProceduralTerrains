// Regression probe: consecutive project transactions (optionally Mini) and
// whether any shader-health report fires. MINI=1 creates Mini projects.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/project-create-twice.mjs
export default async function ({ page, h }) {
  const mini = process.env.MINI === '1';
  await page.evaluate(() => {
    window.__healthReports = [];
    const original = console.error.bind(console);
    console.error = (...args) => {
      if (String(args[0]).includes('shader health')) window.__healthReports.push(args[2]?.code || 'unknown');
      original(...args);
    };
  });
  const specs = mini
    ? [{ recipe: 'cove' }, { recipe: 'islet' }, { recipe: 'lake' }]
    : [{ preset: 'archipelago' }, { preset: 'alpine' }, { preset: 'dunes' }];
  for (const spec of specs) {
    const r = await page.evaluate(async (sp) => {
      const e = window.__engine;
      const t0 = performance.now();
      await e.transitionMode({
        worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
        project: sp.recipe
          ? { projectMode: 'procedural', seed: 77, mini: { recipe: sp.recipe, seed: 77 } }
          : { projectMode: 'procedural', seed: 77, presetKey: sp.preset },
      });
      return { ms: Math.round(performance.now() - t0), reports: [...window.__healthReports] };
    }, spec);
    await h.settle({ timeoutMs: 120000 });
    const reports = await page.evaluate(() => [...window.__healthReports]);
    console.log(JSON.stringify(spec), 'create', r.ms, 'ms; health reports so far', JSON.stringify(reports));
  }
}
