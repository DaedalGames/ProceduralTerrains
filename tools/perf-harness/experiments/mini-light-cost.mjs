// Mini light map during edits: is it current on every DRAWN frame of a slider
// drag, how close is its vertex-height grid to the CPU height field, and what
// does a refresh cost per edit (GPU timer queries).
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-light-cost.mjs
//   env: PARAM=noiseScale VALUES=42,47,52,57 QUALITY=balanced|high|capture
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || 'mini-light-cost');
  fs.mkdirSync(dir, { recursive: true });
  const param = process.env.PARAM || 'noiseScale';
  const values = (process.env.VALUES || '42,47,52,57').split(',').map(Number);
  await page.evaluate(async (quality) => {
    const e = window.__engine;
    await e.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed: 3364, mini: { recipe: 'procedural', seed: 3364, preset: 'archipelago' } },
    });
    if (quality) e.setMiniTerrain({ quality });
  }, process.env.QUALITY || null);
  await h.settle({ timeoutMs: 120000 });
  await h.freeze();

  // In-page helpers: paced tick (yields a task so the engine's GPU fence can
  // signal, like the harness measure loop) and GPU timer queries.
  await page.evaluate(() => {
    const e = window.__engine;
    const gl = e.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const ch = new MessageChannel();
    const pending = [];
    ch.port1.onmessage = () => pending.shift()?.();
    const yieldTask = () => new Promise((r) => { pending.push(r); ch.port2.postMessage(0); });
    const px = new Uint8Array(4);
    const sync = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const timed = (fn) => {
      const query = ext ? gl.createQuery() : null;
      if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      const t0 = performance.now();
      fn();
      if (query) gl.endQuery(ext.TIME_ELAPSED_EXT);
      sync();
      return { query, wall: performance.now() - t0 };
    };
    const collect = async (records) => {
      for (let i = 0; i < 30 && records.some((r) => r.query && !gl.getQueryParameter(r.query, gl.QUERY_RESULT_AVAILABLE)); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      const gpu = [];
      for (const r of records) {
        if (!r.query) continue;
        if (gl.getQueryParameter(r.query, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(r.query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(r.query);
      }
      const pick = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.floor((s.length - 1) * f)].toFixed(3) : null; };
      const wall = records.map((r) => r.wall);
      return { gpuMedian: pick(gpu, 0.5), gpuP90: pick(gpu, 0.9), wallMedian: pick(wall, 0.5), n: records.length };
    };
    const tick = async () => {
      const serial = e._mainRenderSerial;
      e._needsRender = true;
      e._lastUserActivityAt = performance.now();
      e._tick();
      sync();
      await yieldTask();
      return e._mainRenderSerial !== serial;
    };
    window.__lc = { timed, collect, tick, yieldTask };
  });

  const state = () => page.evaluate(() => {
    const e = window.__engine;
    const lm = e.mini.lightMap;
    return {
      gen: e._terrainGen,
      lightGen: Number(String(lm._key).split(':')[0]),
      fullBake: e._studioBakeCurrent(),
      waterLight: e.mini.waterSurface.uniforms.uMiniLightEnabled.value,
      decal: lm.decal.visible,
      propsLight: e.propsManager?._miniLight.enabled.value ?? null,
    };
  });

  // A drag: one slider value per frame.
  const steps = [];
  for (let i = 0; i < 12; i++) {
    const v = values[i % values.length] + i * 0.3;
    const drawn = await page.evaluate(async ({ p, value }) => {
      window.__engine.setParam(p, value);
      return window.__lc.tick();
    }, { p: param, value: v });
    steps.push({ drawn, ...(await state()) });
  }
  const drawnSteps = steps.filter((s) => s.drawn);
  console.log('drag steps [drawn gen lightGen source decal water props]',
    JSON.stringify(steps.map((s) => [s.drawn ? 'D' : '-', s.gen, s.lightGen, s.fullBake ? 'bake' : 'live', s.decal, s.waterLight, s.propsLight].join(' '))));
  console.log('LIVE: drawn frames', drawnSteps.length, '/', steps.length,
    '| light map current on every drawn frame:',
    drawnSteps.every((s) => s.lightGen === s.gen && s.decal && s.waterLight > 0.5 && s.propsLight > 0.5),
    '| full bake current on any drag frame:', steps.some((s) => s.fullBake));

  const coherence = (label) => page.evaluate((lbl) => {
    const e = window.__engine;
    const lm = e.mini.lightMap;
    const grid = lm.grid;
    const n = grid.width;
    const buf = new Uint16Array(n * n * 4);
    e.renderer.readRenderTargetPixels(grid, 0, 0, n, n, buf);
    const half = (b) => {
      const s = b & 0x8000 ? -1 : 1;
      const ex = (b >> 10) & 0x1f;
      const m = b & 0x3ff;
      return ex === 0 ? s * 2 ** -14 * (m / 1024) : s * 2 ** (ex - 15) * (1 + m / 1024);
    };
    const cpu = e._getCpuHeightSampler();
    const H = lm._heightUniforms.uHalf.value;
    const seg = n - 1;
    const hs = e.uniforms.uHeightScale.value;
    const stride = Math.max(1, seg >> 4);
    let maxErr = 0, sumErr = 0, count = 0, worst = null;
    for (let iz = 0; iz <= seg; iz += stride) {
      for (let ix = 0; ix <= seg; ix += stride) {
        const x = -H + (ix / seg) * 2 * H;
        const z = -H + (iz / seg) * 2 * H;
        const ref = cpu.heightAt(x, z);
        const g = half(buf[(iz * n + ix) * 4 + 3]) * hs;
        const err = Math.abs(g - ref);
        if (err > maxErr) { maxErr = err; worst = { x: Math.round(x), z: Math.round(z), grid: +g.toFixed(2), cpu: +ref.toFixed(2) }; }
        sumErr += err; count++;
      }
    }
    return {
      when: lbl, fullBake: e._studioBakeCurrent(), gen: e._terrainGen, grid: n, heightScale: hs,
      maxErr: +maxErr.toFixed(3), meanErr: +(sumErr / count).toFixed(3), samples: count, worst,
    };
  }, label);

  await page.evaluate(async ({ p, value }) => {
    window.__engine.setParam(p, value);
    await window.__lc.tick();
    await window.__lc.tick();
  }, { p: param, value: values[0] });
  console.log('COHERENCE', JSON.stringify(await coherence('just after edit')));
  for (let i = 0; i < 600 && !(await page.evaluate(() => window.__engine._studioBakeCurrent())); i++) {
    await page.evaluate(() => window.__lc.tick());
  }
  console.log('COHERENCE', JSON.stringify(await coherence('full bake current')));

  // Cost of one light-map refresh (vertex grid + light bake), GPU timer.
  const cost = await page.evaluate(async () => {
    const e = window.__engine;
    const lm = e.mini.lightMap;
    const run = async (invalidate) => {
      const recs = [];
      for (let i = 0; i < 40; i++) {
        recs.push(window.__lc.timed(() => { if (invalidate) lm.invalidate(); e.mini.beforeRender(); }));
        await window.__lc.yieldTask();
      }
      return window.__lc.collect(recs.slice(5));
    };
    await run(true);
    return { refresh: await run(true), noRefresh: await run(false), grid: lm.grid.width, map: lm.size };
  });
  console.log('COST light map refresh per edit (ms)', JSON.stringify(cost));

  // Whole frames: idle vs a continuous drag (one edit per frame).
  const frames = await page.evaluate(async ({ p, vals }) => {
    const e = window.__engine;
    const run = async (edit) => {
      const recs = [];
      for (let i = 0; i < 40; i++) {
        if (edit) e.setParam(p, vals[i % vals.length] + (i % 7) * 0.25);
        recs.push(window.__lc.timed(() => { e._needsRender = true; e._lastUserActivityAt = performance.now(); e._tick(); }));
        await window.__lc.yieldTask();
      }
      return window.__lc.collect(recs.slice(5));
    };
    return { idle: await run(false), drag: await run(true) };
  }, { p: param, vals: values });
  console.log('COST frames (ms)', JSON.stringify(frames));
}
