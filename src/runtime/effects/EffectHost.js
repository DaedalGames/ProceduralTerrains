import * as THREE from 'three';
import { createTerrainUniforms } from '../../engine/terrain/TerrainMaterial.js';
import { normalizeConfiguration, configurationParameters } from '../FiniteTerrainConfiguration.js';
import { applyTerrainShapeUniforms, applyTerrainShadingUniforms } from '../TerrainParameters.js';
import { TerrainSource } from '../TerrainSources.js';

/** A lightweight effect domain: no terrain mesh, controls, DOM or render loop. */
class EffectHost {
  constructor(renderer, world = {}) {
    if (!renderer?.isWebGLRenderer) throw new TypeError('A caller-owned THREE.WebGLRenderer is required');
    const allowed = ['mode','size','heightScale','seaLevel','sunAzimuth','sunElevation'];
    if (!world || typeof world !== 'object' || Array.isArray(world)) throw new TypeError('world must be an object');
    for (const key of Object.keys(world)) if (!allowed.includes(key)) throw new TypeError('Unknown effect world option '+key);
    this.mode = world.mode ?? 'finite';
    if (!['finite','infinite'].includes(this.mode)) throw new TypeError('Standalone effects support finite or infinite worlds; attach to a planet terrain for spherical effects');
    const size = world.size ?? 10000;
    if (!Number.isFinite(size) || size < (this.mode==='infinite'?6:1) || size > 100000) throw new RangeError('world.size must be 1..100000 world units (at least 6 for infinite coverage)');
    this.world = Object.freeze({mode:this.mode,size,heightScale:world.heightScale??1000,seaLevel:world.seaLevel??0,
      sunAzimuth:world.sunAzimuth??128,sunElevation:world.sunElevation??46});
    const bed = Math.max(-60000, Math.min(60000, this.world.seaLevel-this.world.heightScale));
    this.configuration = normalizeConfiguration({
      layout:{chunkCount:1,chunkSize:this.mode==='infinite'?size/6:size},
      heightScale:this.world.heightScale,seaLevel:this.world.seaLevel,
      lighting:{sunAzimuth:this.world.sunAzimuth,sunElevation:this.world.sunElevation},
      source:{kind:'heightmap',data:[bed,bed,bed,bed],width:2,height:2,octaves:3,strength:0},
    });
    this.configuration = Object.freeze({...this.configuration,layout:Object.freeze({...this.configuration.layout,viewRadius:2})});
    this._renderer=renderer;
    this._params=configurationParameters(this.configuration);
    this._uniforms=createTerrainUniforms();
    this._textures=new Set(Object.values(this._uniforms).map(u=>u.value).filter(v=>v?.isTexture));
    this._source=new TerrainSource(this.configuration,'finite');
    this._stackGLSL=this._source.program;
    applyTerrainShapeUniforms(this._uniforms,this._params,size);
    applyTerrainShadingUniforms(this._uniforms,this._params,{size,skirtDepth:0,wallThickness:0});
    this._source.install(this._uniforms);
    const az=THREE.MathUtils.degToRad(this.world.sunAzimuth), el=THREE.MathUtils.degToRad(this.world.sunElevation);
    this._uniforms.uSunDir.value.set(Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az));
    this.object=new THREE.Group();this.object.name='standalone-effect-domain';
    this._layers=new Set();this._revision=0;this._disposed=false;
  }
  _assertAlive(){if(this._disposed)throw new Error('Effect disposed');}
  addLayer(layer){this._assertAlive();this._layers.add(layer);return()=>this._layers.delete(layer);}
  sampleHeight(){return this._source.minHeight;}
  frame(dt,camera){
    this._assertAlive();
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('deltaSeconds must be nonnegative');
    if(!camera?.isCamera)throw new TypeError('A THREE.Camera is required');
    camera.updateWorldMatrix(true,false);
    let view=camera;
    if(camera.parent){
      if(this._worldCamera?.type!==camera.type)this._worldCamera=camera.clone(false);
      view=this._worldCamera;view.projectionMatrix.copy(camera.projectionMatrix);view.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      camera.matrixWorld.decompose(view.position,view.quaternion,view.scale);view.updateMatrixWorld(true);
    }
    this._viewCamera=view;this._uniforms.uTime.value+=Math.min(dt,.1);return view;
  }
  dispose(){if(this._disposed)return;this._disposed=true;this._layers.clear();this._source.dispose();for(const t of this._textures)t.dispose();this._textures.clear();this.object.removeFromParent();}
}

export function resolveEffectHost({terrain,renderer,world}) {
  if(terrain){
    if(renderer || world)throw new TypeError('Pass terrain, or renderer and world; do not mix effect hosts');
    terrain._assertAlive();return {terrain,ownsHost:false};
  }
  return {terrain:new EffectHost(renderer,world),ownsHost:true};
}
