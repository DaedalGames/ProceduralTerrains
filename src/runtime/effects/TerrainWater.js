import * as THREE from 'three';
import { validateParameters } from '../resources/ParameterValidation.js';
import { WaterSystem } from '../../engine/water/WaterSystem.js';
import {
  WATER_DEFAULT_PARAMS,
  WATER_MODES,
  resolveUnderwaterMode,
} from '../../engine/water/WaterSettings.js';
import { createWaterMaterialForMode } from '../../engine/water/WaterMaterialFactory.js';
import { compileMaterial } from '../resources/CompileMaterial.js';
import { RevisionScope } from '../resources/RevisionScope.js';
import { UnderwaterController } from '../../engine/render/UnderwaterController.js';
import { UnderwaterEffect } from '../../engine/render/UnderwaterEffect.js';

export class TerrainWater {
  constructor({ terrain, mode = 'legacy', parameters = {}, quality = {} }) {
    validateParameters(parameters, WATER_DEFAULT_PARAMS, { seaLevel: 0, waterAnim: true });
    terrain._assertAlive();
    this.terrain = terrain;
    this.mode = mode;
    this.parameters = {
      ...WATER_DEFAULT_PARAMS,
      ...parameters,
      waterMode: mode,
      waterEnabled: mode !== 'off',
    };
    this.quality = {
      waterQuality: 2,
      waterDetail: 1,
      waterReflection: 1,
      waterWaves: 2,
      ...quality,
    };
    this.scope = new RevisionScope();
    this.context = null;
    this.system = null;
    this.controller = new UnderwaterController();
    this.underwater = new UnderwaterEffect();
    this._detach = terrain.addLayer(this);
  }
  _createContext(params) {
    const t = this.terrain,
      u = t._uniforms,
      wm = t.mode === 'finite' ? 'studio' : t.mode;
    const group = new THREE.Group();
    group.name = 'terrain-water';
    group.visible = false;
    t.object.add(group);
    const base = createWaterMaterialForMode({
      mode: 'legacy',
      sharedUniforms: u,
      octaves: t.configuration.source.octaves,
      stackGLSL: t._stackGLSL,
      planet: wm === 'planet',
      infinite: wm === 'infinite',
    });
    const geometry =
      wm === 'planet'
        ? new THREE.SphereGeometry(1, 64, 48)
        : new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, base);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    group.add(mesh);
    const layer = this;
    const context = {
      group,
      mesh,
      base,
      geometry,
      scene: group,
      uniforms: u,
      perf: this.quality,
      worldMode: wm,
      params,
      camera: t._viewCamera ?? new THREE.PerspectiveCamera(),
      _fps: 60,
      _needsRender: false,
      _waterDeferred: true,
      _stackGLSL: t._stackGLSL,
      boardSize: t.configuration.layout.chunkCount * t.configuration.layout.chunkSize,
      heightSampler: { heightAt: (x, z) => t.sampleHeight(x, z) ?? 0 },
      _getMinimapSampler: () => ({ heightAt: (x, z) => t.sampleHeight(x, z) ?? 0 }),
      water: wm === 'studio' ? mesh : null,
      waterMaterial: wm === 'studio' ? base : null,
      planetWater: wm === 'planet' ? mesh : null,
      planetWaterMat: wm === 'planet' ? base : null,
      _infiniteWaterMat: wm === 'infinite' ? base : null,
      infiniteWorld:
        wm === 'infinite'
          ? {
              waterPlane: mesh,
              waterMaterial: base,
              updateSettings: ({ seaLevel }) => {
                if (seaLevel !== undefined) mesh.position.y = seaLevel;
              },
            }
          : null,
      compileWaterMaterialsAsync: async (mats, done) => {
        for (const m of mats) await compileMaterial(t._renderer, m, context.camera);
        if (layer.scope.disposed) return false;
        done?.();
        return true;
      },
      _updatePlanetWater: () =>
        mesh.scale.setScalar(t.configuration.layout.radius + params.seaLevel),
    };
    const size =
      wm === 'infinite'
        ? t.configuration.layout.chunkSize * (t.configuration.layout.viewRadius * 2 + 2)
        : context.boardSize;
    if (wm === 'planet') context._updatePlanetWater();
    else mesh.scale.set(size, 1, size);
    return context;
  }
  async configure(patch = {}, options = {}) {
    const mode = patch.mode ?? this.mode;
    if (!WATER_MODES.some((m) => m.value === mode)) throw new TypeError('Invalid water mode');
    const parameters = {
      ...this.parameters,
      ...patch.parameters,
      waterMode: mode,
      waterEnabled: mode !== 'off',
    };
    validateParameters(patch.parameters ?? {}, WATER_DEFAULT_PARAMS, {
      seaLevel: 0,
      waterAnim: true,
    });
    return this.scope.run(async (check) => {
      const context = this._createContext({
        ...this.terrain._params,
        ...parameters,
        seaLevel: parameters.seaLevel ?? this.terrain.configuration.seaLevel,
      });
      const system = new WaterSystem(context);
      let published = false;
      try {
        const mats = system.prepareInitialMaterials(context.params, context.worldMode);
        for (const m of new Set([...mats, ...system.getCompileMaterials()]))
          await compileMaterial(this.terrain._renderer, m, context.camera, {
            geometry: context.geometry.clone(),
          });
        check();
        this.terrain._assertAlive();
        context._waterDeferred = false;
        system.activateInitialMaterials(context.params, context.worldMode);
        this._disposeActive();
        this.context = context;
        this.system = system;
        this.mode = mode;
        this.parameters = parameters;
        context.group.visible = true;
        published = true;
      } finally {
        if (!published) {
          system.dispose();
          context.group.removeFromParent();
          context.geometry.dispose();
          context.base.dispose();
        }
      }
    }, options);
  }
  prepare(camera, options = {}) {
    if (this.context) this.context.camera = camera;
    return this.configure({}, options);
  }
  onTerrainChanged({ signal, sourceChanged, programChanged } = {}) {
    if (!this.context || programChanged || sourceChanged) return this.configure({}, { signal });
    this.context.params = {
      ...this.terrain._params,
      ...this.parameters,
      seaLevel: this.parameters.seaLevel ?? this.terrain.configuration.seaLevel,
    };
    this.system.sync(this.context.params, this.context.worldMode);
  }
  update(dt, { camera }) {
    if (!this.system) return;
    const c = this.context,
      t = this.terrain;
    c.camera = camera;
    if (t.mode === 'infinite') {
      c.mesh.position.x = camera.position.x;
      c.mesh.position.z = camera.position.z;
    }
    this.system.update(dt > 0 ? 1 / dt : 60);
    const waterMode = this.system.getEffectiveMode();
    const quality = resolveUnderwaterMode(c.params, waterMode, true);
    this.controller.update(dt, {
      worldMode: c.worldMode,
      cameraPos: camera.position,
      seaLevel: c.params.seaLevel,
      planetRadius: t.configuration.layout.radius,
      waterActive: this.system.isEnabled(),
      waterMode,
      quality,
      causticsEnabled: c.params.waterCausticsEnabled,
      volume: t._miniVolume ?? null,
    });
    this.underwater.update(this.controller, t._uniforms.uTime.value, t._uniforms, { camera });
  }
  serialize() {
    return {
      type: 'water',
      mode: this.mode,
      parameters: structuredClone(this.parameters),
      quality: { ...this.quality },
    };
  }
  getDiagnostics() {
    return {
      requestedMode: this.mode,
      effectiveMode: this.system?.getEffectiveMode() ?? 'off',
      underwater: {
        active: this.controller.active,
        quality: this.controller.quality,
        blend: this.controller.underwaterBlend,
      },
      ...this.system?.getPerformanceDiagnostics(),
    };
  }
  _disposeActive() {
    if (!this.context) return;
    this.system?.dispose();
    this.context.group.removeFromParent();
    this.context.geometry.dispose();
    this.context.base.dispose();
    this.context = null;
    this.system = null;
  }
  dispose() {
    if (this.scope.disposed) return;
    this.scope.dispose();
    this._detach();
    this._disposeActive();
    this.underwater.dispose();
  }
}

export async function createWater(options) {
  const layer = new TerrainWater(options);
  try {
    await layer.configure({}, { signal: options.signal });
    return layer;
  } catch (e) {
    layer.dispose();
    throw e;
  }
}
