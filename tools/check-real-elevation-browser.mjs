import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${server.resolvedUrls.local[0]}tools/surface-qa.html`);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { Engine } = await import('/src/engine/Engine.js');
    const { createTerrainUniforms, createTerrainMaterial, createBootTerrainMaterial } = await import('/src/engine/terrain/TerrainMaterial.js');
    const { COMMON_UNIFORMS_GLSL, NOISE_GLSL, buildHeightGLSL } = await import('/src/engine/terrain/terrainGLSL.js');
    const { BIOME_GLSL } = await import('/src/engine/terrain/biomeGLSL.js');
    const { generateStackGLSL } = await import('/src/engine/terrain/noise/noiseStackCodegen.js');
    const { defaultLegacyStack } = await import('/src/engine/terrain/noise/NoiseStack.js');
    const { buildTerrainBakeFragment } = await import('/src/engine/terrain/TerrainExportBuilder.js');
    const { heightExportRange } = await import('/src/engine/terrain/RealWorldElevation.js');
    const { installSurfaceMaterialBackend } = await import('/src/engine/terrain/surface/SurfaceArrayGLSL.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas') });
    const shaderErrors = [];
    let phase = 'height probe';
    renderer.debug.onShaderError = (gl, program) => shaderErrors.push(`${phase}: ${gl.getProgramInfoLog(program)}`);
    const uniforms = createTerrainUniforms();
    const engine = Object.assign(Object.create(Engine.prototype), {
      uniforms, params: { heightScale: 420, chunkCount: 1, chunkSize: 100 }, worldMode: 'studio',
      importedMaps: {}, _setImportState() {},
    });
    const stack = generateStackGLSL(defaultLegacyStack());
    const heightGLSL = buildHeightGLSL(stack.body2d);
    const vertexShader = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
    const material = new THREE.ShaderMaterial({ uniforms, defines: { OCTAVES: 4 }, vertexShader,
      fragmentShader: `precision highp float; ${COMMON_UNIFORMS_GLSL}\n${NOISE_GLSL}\n${BIOME_GLSL}\n${heightGLSL}\nvoid main(){gl_FragColor=vec4(heightAt(vec2(25.0,-25.0)),0.0,0.0,1.0);}` });
    const exportUniforms = { ...uniforms, uBoardSize: { value: 100 }, uBoardSizeXZ: { value: new THREE.Vector2(100, 100) },
      uCellOffset: { value: new THREE.Vector2(25, -25) }, uBakeMode: { value: 0 }, uBakeLighting: { value: false },
      uHeightVertexGrid: { value: 0 }, uExportHeightRange: { value: new THREE.Vector2() } };
    const exportMaterial = new THREE.ShaderMaterial({ uniforms: exportUniforms, defines: { OCTAVES: 4 },
      vertexShader, fragmentShader: buildTerrainBakeFragment(heightGLSL) });
    installSurfaceMaterialBackend(exportMaterial);
    const scene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);
    const camera = new THREE.Camera();
    const floatTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });
    const exportTarget = new THREE.WebGLRenderTarget(1, 1);
    const cases = [];
    for (const test of [
      { name: 'mountain', min: 1200, max: 8850, value: 1, expected: 8850 },
      { name: 'negative', min: -430, max: 800, value: 0, expected: -430 },
      { name: 'flat', min: 2740, max: 2740, value: 0, expected: 2740 },
      { name: 'precision', min: -430, max: 8850, value: 0.123456, expected: -430 + Math.fround(0.123456) * 9280 },
    ]) {
      engine.importedMaps.height?.texture.dispose();
      engine.importedMaps.height = { geoRef: {}, meta: { minElev: test.min, maxElev: test.max },
        settings: { elevationMode: 'meters', mode: 'replace', heightStrength: 1, heightOffset: 0 },
        width: 2, height: 2, floatData: new Float32Array(4).fill(test.value) };
      engine._rebuildImportedTexture('height');
      for (const noiseHeight of [20, 420, 1000]) {
        uniforms.uHeightScale.value = noiseHeight;
        quad.material = material;
        phase = 'height probe';
        renderer.setRenderTarget(floatTarget);
        renderer.render(scene, camera);
        const pixels = new Float32Array(4);
        renderer.readRenderTargetPixels(floatTarget, 0, 0, 1, 1, pixels);
        const range = heightExportRange(uniforms, noiseHeight);
        exportUniforms.uExportHeightRange.value.set(range.min, range.max - range.min);
        quad.material = exportMaterial;
        phase = 'export bake';
        renderer.setRenderTarget(exportTarget);
        renderer.render(scene, camera);
        const packed = new Uint8Array(4);
        renderer.readRenderTargetPixels(exportTarget, 0, 0, 1, 1, packed);
        const normalized = (packed[0] * 65536 + packed[1] * 256 + packed[2]) / 16777215;
        const exported = range.min + normalized * (range.max - range.min);
        cases.push({ name: test.name, noiseHeight, expected: test.expected, rendered: pixels[0], exported });
      }
    }
    // Also compile the two viewport programs that encode collision readbacks.
    // The production PBR surface uses texture arrays (and its 16-unit shader).
    uniforms.uSurfaceArrayMode.value = 1;
    const surfaceTextures = [];
    for (const key of ['uSurfDiffuse', 'uSurfProps']) {
      const texture = new THREE.DataArrayTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, 1);
      texture.needsUpdate = true;
      uniforms[key].value = texture;
      surfaceTextures.push(texture);
    }
    const viewport = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(100, 100, 2, 2);
    geometry.rotateX(-Math.PI / 2);
    for (const key of ['aSkirt', 'aLod', 'aWall']) geometry.setAttribute(key, new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
    const mesh = new THREE.Mesh(geometry);
    mesh.frustumCulled = false;
    viewport.add(mesh);
    const viewCamera = new THREE.PerspectiveCamera(50, 1, 1, 30000);
    viewCamera.position.set(2000, 10000, 2000);
    viewCamera.lookAt(0, 2000, 0);
    for (const factory of [createTerrainMaterial, createBootTerrainMaterial]) {
      phase = factory.name;
      mesh.material = factory(uniforms, 4, stack, { worldMode: 'studio' });
      await renderer.compileAsync(viewport, viewCamera);
      renderer.render(viewport, viewCamera);
      mesh.material.dispose();
    }
    const glError = renderer.getContext().getError();
    engine.importedMaps.height.texture.dispose();
    material.dispose(); exportMaterial.dispose(); quad.geometry.dispose(); geometry.dispose();
    surfaceTextures.forEach((texture) => texture.dispose());
    floatTarget.dispose(); exportTarget.dispose(); renderer.dispose();
    return { cases, shaderErrors, glError };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(result.shaderErrors, []);
  assert.equal(result.glError, 0);
  for (const test of result.cases) {
    assert.ok(Math.abs(test.rendered - test.expected) < 0.01, `GPU height mismatch: ${JSON.stringify(test)}`);
    assert.ok(Math.abs(test.exported - test.expected) < 0.01, `Export height mismatch: ${JSON.stringify(test)}`);
  }
} finally {
  await browser?.close();
  await server.close();
}
