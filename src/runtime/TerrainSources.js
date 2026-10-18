import * as THREE from 'three';
import { defaultLegacyStack, migrateStack } from '../engine/terrain/noise/NoiseStack.js';
import { generateStackGLSL, packStackUniforms } from '../engine/terrain/noise/noiseStackCodegen.js';
import { compileTerrainGraph } from '../engine/terrain/graph/GraphCompiler.js';
import { normalizeManualTerrainDocument } from '../manual/ManualShapeCatalog.js';
import { ManualSurfacePaintField } from '../manual/ManualSurfacePaintField.js';
import { ManualTerrainField } from '../manual/ManualTerrainField.js';

export function normalizeTerrainSource(input, base, defaults, mode = 'finite') {
  const patch = input ?? {};
  const kind = patch.kind ?? base.kind;
  if (!['noise', 'graph', 'manual', 'heightmap'].includes(kind))
    throw new TypeError('Unsupported source.kind');
  if (mode === 'planet' && kind !== 'noise')
    throw new TypeError('Planet worlds require a noise source with a 3D evaluator');
  if (mode === 'infinite' && ['manual', 'heightmap'].includes(kind))
    throw new TypeError('Bounded manual/heightmap sources require finite terrain');
  const allowed = [
    ...Object.keys(defaults),
    'stack',
    'graph',
    'document',
    'resolution',
    'data',
    'width',
    'height',
  ];
  for (const key of Object.keys(patch))
    if (!allowed.includes(key)) throw new TypeError(`Unsupported terrain option: source.${key}`);
  const next = { ...defaults, ...(kind === base.kind ? base : {}), ...patch, kind };
  if (['noise', 'manual'].includes(kind) && next.stack)
    next.stack = migrateStack(structuredClone(next.stack));
  if (kind === 'graph') {
    if (!next.graph) throw new TypeError('A terrain graph document is required');
    const compiled = compileTerrainGraph(next.graph);
    if (!compiled.ok) throw new TypeError(compiled.diagnostics.map((d) => d.message).join('; '));
    next.graph = structuredClone(next.graph);
  }
  if (kind === 'manual') {
    next.document = normalizeManualTerrainDocument(structuredClone(next.document ?? {}));
    if (next.document.baseSource === 'nodes' && !next.graph)
      throw new TypeError('Manual nodes base requires source.graph');
    if (next.graph) next.graph = structuredClone(next.graph);
    if (next.document.baseSource === 'nodes' && !compileTerrainGraph(next.graph).ok)
      throw new TypeError('Invalid manual base graph');
    next.resolution ??= 256;
    if (!Number.isInteger(next.resolution) || next.resolution < 16 || next.resolution > 1024)
      throw new RangeError('Manual resolution must be 16..1024');
  }
  if (kind === 'heightmap') {
    if (![next.width, next.height].every((v) => Number.isInteger(v) && v >= 2 && v <= 4096))
      throw new RangeError('Heightmap dimensions must be 2..4096');
    if (!next.data || next.data.length !== next.width * next.height)
      throw new TypeError('Heightmap sample count does not match its dimensions');
    next.data = Array.from(next.data);
    if (next.data.some((v) => !Number.isFinite(v) || Math.abs(v) > 60000))
      throw new RangeError('Heightmap samples must be finite world-unit heights within ±60000');
  }
  return next;
}

export function packTerrainSourceUniforms(u, packed, source = {}) {
  u.uStackNormalize.value = (packed.normalize ?? source.normalizeOutput) ? 1 : 0;
  u.uStackOutMin.value = packed.outMin ?? source.outputMin ?? 0;
  u.uStackOutMax.value = Math.max(
    u.uStackOutMin.value + 0.0001,
    packed.outMax ?? source.outputMax ?? 1.35,
  );
  for (let i = 0; i < packed.strength.length; i++) {
    u.uLayerStrength.value[i] = packed.strength[i];
    u.uLayerScale.value[i] = packed.scale[i];
    u.uLayerSeed.value[i] = packed.seed[i];
    for (const [name, values] of [
      ['uLayerParamsA', 'paramsA'],
      ['uLayerParamsB', 'paramsB'],
      ['uLayerMaskA', 'maskA'],
      ['uLayerMaskB', 'maskB'],
      ['uLayerMaskC', 'maskC'],
    ]) {
      if (u[name] && packed[values]) u[name].value[i].set(...packed[values][i]);
    }
  }
  if (packed.colorA)
    for (let i = 0; i < packed.colorA.length; i++) {
      for (const name of ['A', 'B', 'C', 'D', 'Params'])
        u[`uGraphColor${name}`].value[i].set(...packed[`color${name}`][i]);
    }
}

/** Owns source-specific CPU state/textures, never a canvas or input handler. */
export class TerrainSource {
  constructor(configuration, mode = 'finite') {
    const source = configuration.source;
    this.kind = source.kind;
    this.stack = source.stack ?? defaultLegacyStack();
    this.hasGraph =
      source.kind === 'graph' ||
      (source.kind === 'manual' && source.document.baseSource === 'nodes');
    this.hasBase = source.kind === 'manual' && source.document.baseSource !== 'flat';
    this.program = this.hasGraph
      ? compileTerrainGraph(source.graph).program
      : generateStackGLSL(this.stack);
    this.variant = ['manual', 'heightmap'].includes(source.kind) ? 'manual-empty-base' : 'base';
    if (source.kind === 'heightmap') this.variant = 'hybrid-base';
    if (this.hasBase) this.variant = 'hybrid-base';
    this.signature = `${this.variant}:${this.program.sig}:${source.octaves}`;
    this.field = null;
    this.texture = null;
    this.size = configuration.layout.chunkCount * configuration.layout.chunkSize;
    if (source.kind === 'manual') {
      const uniforms = {
        uManualHeightTexture: {},
        uManualOrigin: { value: new THREE.Vector2() },
        uManualSpan: { value: new THREE.Vector2() },
      };
      this.field = new ManualTerrainField({
        uniforms,
        resolution: source.resolution,
        getBounds: () => ({
          origin: { x: -this.size / 2, z: -this.size / 2 },
          span: { x: this.size, z: this.size },
        }),
      });
      this.field.rebuild(source.document.shapes);
      if (source.document.sculpt) this.field.loadSculpt(source.document.sculpt);
      this.texture = this.field.texture;
      if (source.document.surfacePaint) {
        this.paint = new ManualSurfacePaintField({
          resolution: source.resolution,
          getBounds: () => ({
            origin: { x: -this.size / 2, z: -this.size / 2 },
            span: { x: this.size, z: this.size },
          }),
        });
        this.paint.load(source.document.surfacePaint);
      }
    } else if (source.kind === 'heightmap') {
      this.width = source.width;
      this.height = source.height;
      this.data = source.data;
      const pixels = new Uint16Array(source.data.length * 4);
      source.data.forEach((v, i) => {
        pixels[i * 4] = THREE.DataUtils.toHalfFloat(v);
        pixels[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
      });
      this.texture = new THREE.DataTexture(
        pixels,
        source.width,
        source.height,
        THREE.RGBAFormat,
        THREE.HalfFloatType,
      );
      this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
      this.texture.needsUpdate = true;
    }
    this.minHeight = 0;
    this.maxHeight = 0;
    if (this.texture) {
      const data = this.texture.image.data;
      for (let i = 0; i < data.length; i += 4) {
        const h = THREE.DataUtils.fromHalfFloat(data[i]);
        this.minHeight = Math.min(this.minHeight, h);
        this.maxHeight = Math.max(this.maxHeight, h);
      }
    }
  }

  install(uniforms, sampler) {
    uniforms.uManualEnabled.value = this.texture ? 1 : 0;
    uniforms.uPaintBaseMult.value = this.texture && !this.hasBase ? 0 : 1;
    uniforms.uManualHeightTexture.value = this.texture;
    if (this.texture) {
      uniforms.uManualOrigin.value.set(-this.size / 2, -this.size / 2);
      uniforms.uManualSpan.value.set(this.size, this.size);
    }
    packTerrainSourceUniforms(
      uniforms,
      this.hasGraph ? this.program.packUniforms() : packStackUniforms(this.stack),
      this.stack,
    );
    if (this.paint) {
      this.paint.bind(uniforms);
      this.paint.flushUploads();
    } else {
      uniforms.uSurfacePaintEnabled.value = 0;
    }
    sampler?.setStack(this.stack);
    sampler?.setHeightProgram?.(this.hasGraph ? this.program : null);
  }

  sample(x, z, fallback) {
    if (this.field)
      return this.field.sampleHeightOffset(x, z) + (this.hasBase ? fallback(x, z) : 0);
    if (!this.data) return fallback(x, z);
    const px = Math.max(0, Math.min(this.width - 1, (x / this.size + 0.5) * this.width - 0.5));
    const py = Math.max(0, Math.min(this.height - 1, (z / this.size + 0.5) * this.height - 0.5));
    const x0 = Math.floor(px),
      y0 = Math.floor(py),
      x1 = Math.min(x0 + 1, this.width - 1),
      y1 = Math.min(y0 + 1, this.height - 1);
    const at = (a, b) =>
      THREE.DataUtils.fromHalfFloat(this.texture.image.data[(b * this.width + a) * 4]);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(at(x0, y0), at(x1, y0), px - x0),
      THREE.MathUtils.lerp(at(x0, y1), at(x1, y1), px - x0),
      py - y0,
    );
  }

  dispose() {
    this.paint?.dispose();
    if (this.field) this.field.dispose();
    else this.texture?.dispose();
  }
}
