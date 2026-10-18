import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { withRendererState } from '../resources/RendererState.js';

const vertexShader = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const fragmentShader =
  'uniform sampler2D tColor;varying vec2 vUv;void main(){gl_FragColor=texture2D(tColor,vUv);}';

/** Owns passes/targets, borrows renderer/scene/camera. It never owns a loop. */
export class TerrainRenderPipeline {
  constructor({ renderer, terrains = [] }) {
    if (!renderer?.isWebGLRenderer) throw new TypeError('A THREE.WebGLRenderer is required');
    for (const terrain of terrains)
      if (terrain._renderer !== renderer)
        throw new TypeError('Pipeline and terrains must share the same renderer');
    this.renderer = renderer;
    this.terrains = terrains;
    this.target = null;
    this.compositeTarget = null;
    this.disposed = false;
    this.material = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null } },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
  }
  _target(width, height) {
    if (this.target?.width === width && this.target?.height === height) return;
    this.target?.dispose();
    this.compositeTarget?.dispose();
    this.compositeTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false });
    this.target = new THREE.WebGLRenderTarget(width, height, {
      depthTexture: new THREE.DepthTexture(width, height),
      depthBuffer: true,
    });
  }
  render(scene, camera, { target = null } = {}) {
    if (this.disposed) throw new Error('TerrainRenderPipeline disposed');
    const r = this.renderer;
    return withRendererState(r, () => {
      const size = target
        ? new THREE.Vector2(target.width, target.height)
        : r.getDrawingBufferSize(new THREE.Vector2());
      this._target(size.x, size.y);
      r.autoClear = true;
      r.setScissorTest(false);
      const layers = this.terrains.flatMap((t) => [...t._layers]);
      const waters = layers.filter((l) => l.system),
        clouds = layers.filter((l) => l.layer);
      const visibility = clouds.map((l) => [l.layer.mesh, l.layer.mesh.visible]);
      try {
        for (const [mesh] of visibility) mesh.visible = false;
        for (const l of waters) {
          l.system.capturePlanarReflection(r, scene, camera, size);
          l.system.captureSceneRefraction(r, scene, camera, size);
        }
        for (const t of this.terrains) for (const l of t._layers) l.beforeRender?.();
        r.setRenderTarget(this.target);
        r.clear(true, true, true);
        r.render(scene, camera);
        for (const [mesh, v] of visibility) mesh.visible = v;
        let output = this.target;
        if (clouds.length) {
          this.material.uniforms.tColor.value = this.target.texture;
          r.setRenderTarget(this.compositeTarget);
          r.render(this.scene, this.camera);
          output = this.compositeTarget;
        }
        for (const l of clouds) {
          const c = l.layer;
          c.useSceneDepth(this.target.depthTexture, camera, size);
          c.renderLowRes(r, camera, size);
          r.setRenderTarget(output);
          if (c.usesLowRes) c.compositeLowRes(r, this.target.depthTexture);
          else if (c.active) {
            r.autoClear = false;
            r.render(l.group, camera);
            r.autoClear = true;
          }
        }
        for (const l of waters)
          output = l.underwater.compositeFromTarget(r, camera, {
            width: output.width,
            height: output.height,
            texture: output.texture,
            depthTexture: this.target.depthTexture,
          });
        this.material.uniforms.tColor.value = output.texture;
        r.setRenderTarget(target);
        r.setViewport(0, 0, size.x, size.y);
        r.render(this.scene, this.camera);
      } finally {
        for (const [mesh, v] of visibility) mesh.visible = v;
      }
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.target?.dispose();
    this.compositeTarget?.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

export class TerrainPass extends Pass {
  constructor(scene, camera, options) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.pipeline = new TerrainRenderPipeline(options);
    this.needsSwap = true;
  }
  render(_renderer, writeBuffer) {
    if (_renderer !== this.pipeline.renderer)
      throw new TypeError('TerrainPass and composer must share the same renderer');
    this.pipeline.render(this.scene, this.camera, {
      target: this.renderToScreen ? null : writeBuffer,
    });
  }
  dispose() {
    this.pipeline.dispose();
  }
}
