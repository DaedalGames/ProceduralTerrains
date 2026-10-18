import * as THREE from 'three';
import { validateParameters } from '../resources/ParameterValidation.js';
import { CloudSlabLayer } from '../../engine/sky/CloudSlabLayer.js';
import { InfiniteCloudLayer } from '../../engine/sky/InfiniteCloudLayer.js';
import { PlanetCloudLayer } from '../../engine/sky/PlanetCloudLayer.js';
import {
  RealisticCloudSlabLayer,
  RealisticInfiniteCloudLayer,
  RealisticPlanetCloudLayer,
} from '../../engine/sky/realistic/RealisticCloudLayers.js';
import { CLOUD_DEFAULT_PARAMS } from '../../engine/sky/CloudSettings.js';
import { resolveCloudLightingState } from '../../engine/sky/CloudLightingState.js';
import { compileMaterial } from '../resources/CompileMaterial.js';
import { withRendererState } from '../resources/RendererState.js';
import { RevisionScope } from '../resources/RevisionScope.js';

const classes = {
  legacy: { finite: CloudSlabLayer, infinite: InfiniteCloudLayer, planet: PlanetCloudLayer },
  realistic: {
    finite: RealisticCloudSlabLayer,
    infinite: RealisticInfiniteCloudLayer,
    planet: RealisticPlanetCloudLayer,
  },
};

export class TerrainClouds {
  constructor({ terrain, mode = 'legacy', parameters = {}, quality = {} }) {
    validateParameters(parameters, CLOUD_DEFAULT_PARAMS);
    terrain._assertAlive();
    this.terrain = terrain;
    this.mode = mode;
    this.parameters = { ...CLOUD_DEFAULT_PARAMS, ...parameters, cloudsEnabled: true };
    this.quality = {
      cloudSteps: 12,
      cloudLightSteps: 2,
      cloudOctaves: 3,
      cloudDetailOctaves: 0,
      cloudRealisticSteps: 24,
      cloudRenderScale: 0.5,
      ...quality,
    };
    this.layer = null;
    this.group = null;
    this.scope = new RevisionScope();
    this._detach = terrain.addLayer(this);
  }
  _apply(layer, parameters) {
    const t = this.terrain,
      c = t.configuration;
    if (t.mode === 'planet') layer.applyParams(parameters, c.layout.radius, this.quality);
    else
      layer.applyParams(
        parameters,
        c.heightScale * 1.35,
        c.layout.chunkCount * c.layout.chunkSize,
        this.quality,
        { chunkSize: c.layout.chunkSize, viewRadius: c.layout.viewRadius, ...t._miniCloudLayout },
      );
    layer.setLighting(resolveCloudLightingState({ sunDirection: t._uniforms.uSunDir.value }));
  }
  configure(patch = {}, options = {}) {
    const mode = patch.mode ?? this.mode;
    if (!classes[mode]) throw new TypeError('Invalid cloud mode');
    const parameters = { ...this.parameters, ...patch.parameters };
    validateParameters(patch.parameters ?? {}, CLOUD_DEFAULT_PARAMS);
    return this.scope.run(async (check) => {
      const t = this.terrain,
        group = new THREE.Group();
      group.visible = false;
      t.object.add(group);
      let layer;
      let published = false;
      try {
        layer = new classes[mode][t.mode](group, {
          renderer: t._renderer,
          planetRadius: t.configuration.layout.radius,
          chunkSize: t.configuration.layout.chunkSize,
          viewRadius: t.configuration.layout.viewRadius,
          compile: async (mats) => {
            for (const mat of mats)
              await compileMaterial(
                t._renderer,
                mat,
                t._viewCamera ?? new THREE.PerspectiveCamera(),
                { geometry: layer.mesh.geometry.clone() },
              );
          },
        });
        this._apply(layer, parameters);
        // applyParams starts the exact selected specialization's warm-up.
        if (layer._pendingCompile) await layer._pendingCompile.promise;
        else await layer.warmup?.();
        await Promise.resolve();
        check();
        if (layer._targetConfig && !layer._configMatches(layer._targetConfig)) {
          const q = layer._targetConfig;
          layer._rebuildMaterial(
            q.steps,
            q.lightSteps,
            q.octaves,
            q.detailOctaves,
            q.useErosion,
            q.lightMode,
          );
          if (layer._pendingCompile) await layer._pendingCompile.promise;
          await Promise.resolve();
        }
        if (t.mode !== 'planet' && !layer._ready)
          throw new Error('Cloud shader preparation failed');
        check();
        t._assertAlive();
        this.layer?.dispose();
        this.group?.removeFromParent();
        this.layer = layer;
        this.group = group;
        this.mode = mode;
        this.parameters = parameters;
        group.visible = true;
        published = true;
      } finally {
        if (!published) {
          layer?.dispose();
          group.removeFromParent();
        }
      }
    }, options);
  }
  prepare(camera, options = {}) {
    return this.configure({}, options);
  }
  onTerrainChanged() {
    if (this.layer) this._apply(this.layer, this.parameters);
  }
  update(dt, { camera }) {
    if (!this.layer) return;
    withRendererState(this.terrain._renderer, () =>
      this.layer.update(dt, camera.position, this.terrain._uniforms.uSunDir.value),
    );
  }
  beforeRender() {
    if (!this.layer) return;
    const t = this.terrain,
      u = t._uniforms;
    const shadow = this.parameters.cloudShadowsEnabled
      ? withRendererState(t._renderer, () =>
          this.layer.renderTerrainShadow?.(u.uSunDir.value, null),
        )
      : null;
    u.uTerrainCloudShadowEnabled.value = shadow ? 1 : 0;
    u.uTerrainCloudShadowStrength.value = Math.min(
      0.85,
      Math.max(0, this.parameters.cloudShadowOpacity ?? 0.45),
    );
    u.uTerrainCloudShadowTex.value = shadow?.texture ?? null;
    if (shadow) {
      u.uTerrainCloudShadowCenter.value.copy(shadow.center);
      u.uTerrainCloudShadowExtent.value = shadow.extent;
      u.uTerrainCloudShadowAltitude.value = shadow.altitude;
      u.uTerrainCloudShadowPlanet.value = shadow.planet ? 1 : 0;
    }
  }
  serialize() {
    return {
      type: 'clouds',
      mode: this.mode,
      parameters: structuredClone(this.parameters),
      quality: { ...this.quality },
    };
  }
  getDiagnostics() {
    return {
      mode: this.mode,
      active: !!this.layer?.active,
      lowResolution: !!this.layer?.usesLowRes,
      ready: !!this.layer && (this.terrain.mode === 'planet' || !!this.layer._ready),
    };
  }
  dispose() {
    if (this.scope.disposed) return;
    this.scope.dispose();
    this._detach();
    this.layer?.dispose();
    this.group?.removeFromParent();
    this.terrain._uniforms.uTerrainCloudShadowEnabled.value = 0;
    this.layer = null;
    this.group = null;
  }
}

export async function createClouds(options) {
  const layer = new TerrainClouds(options);
  try {
    await layer.configure({}, { signal: options.signal });
    return layer;
  } catch (e) {
    layer.dispose();
    throw e;
  }
}
