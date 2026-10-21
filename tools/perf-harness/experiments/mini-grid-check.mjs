// Diagnostic: Mini light-map vertex grid vs the full GPU height bake vs the
// CPU height twin at a few footprint points (settled diorama).
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/mini-grid-check.mjs
export default async function ({ page, h }) {
  await page.evaluate(async () => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed: 3364, mini: { recipe: 'procedural', seed: 3364, preset: 'archipelago' } },
    });
  });
  await h.settle({ timeoutMs: 120000 });
  const out = await page.evaluate(() => {
    const e = window.__engine;
    const half = (b) => {
      const s = b & 0x8000 ? -1 : 1;
      const ex = (b >> 10) & 0x1f;
      const m = b & 0x3ff;
      return ex === 0 ? s * 2 ** -14 * (m / 1024) : s * 2 ** (ex - 15) * (1 + m / 1024);
    };
    const read = (target, x, y) => {
      const b = new Uint16Array(4);
      e.renderer.readRenderTargetPixels(target, x, y, 1, 1, b);
      return half(b[3]);
    };
    const lm = e.mini.lightMap;
    const H = lm._heightUniforms.uHalf.value;
    const seg = lm.grid.width - 1;
    const hs = e.uniforms.uHeightScale.value;
    const baker = e.terrainHeightBaker;
    const o = e.uniforms.uBakeOrigin.value;
    const span = e.uniforms.uBakeSpan.value;
    const bt = baker.target;
    const rows = [];
    for (const [x, z] of [[0, -192], [0, 0], [128, 128], [-256, 64], [300, -300]]) {
      const ix = Math.round((x + H) / (2 * H) * seg);
      const iz = Math.round((z + H) / (2 * H) * seg);
      const gx = -H + ix / seg * 2 * H;
      const gz = -H + iz / seg * 2 * H;
      const bu = (gx - o.x) / Math.max(span.x, 1);
      const bv = (gz - o.y) / Math.max(span.y, 1);
      rows.push({
        x: +gx.toFixed(1), z: +gz.toFixed(1),
        grid: +(read(lm.grid, ix, iz) * hs).toFixed(2),
        fullBake: +(read(bt, Math.floor(bu * bt.width), Math.floor(bv * bt.height)) * hs).toFixed(2),
        cpu: +e._getCpuHeightSampler().heightAt(gx, gz).toFixed(2),
        engineHeight: +(e.getHeightAt?.(gx, gz) ?? NaN).toFixed?.(2),
      });
    }
    return {
      H, seg, hs, origin: [o.x, o.y], span: [span.x, span.y], bake: [bt.width, bt.height],
      useTex: e.uniforms.uUseTerrainHeightTex.value, rows,
    };
  });
  console.log('GRIDCHECK', JSON.stringify(out, null, 1));
}
