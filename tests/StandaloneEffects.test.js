import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {createWater} from '../src/runtime/effects/TerrainWater.js';
import {resolveEffectHost} from '../src/runtime/effects/EffectHost.js';
import {effectQuality,CLOUD_QUALITY_DEFAULTS} from '../src/runtime/effects/EffectQuality.js';
import {createInfiniteTerrain} from '../src/runtime/worlds/InfiniteTerrain.js';
import {createTerrain} from '../src/runtime/FiniteTerrain.js';
import {WaterPlanarReflectionPass} from '../src/engine/water/WaterPlanarReflectionPass.js';
import {WaterSurfacePass} from '../src/engine/water/WaterSurfacePass.js';
import {resolveUnderwaterMode,resolveEffectiveWaterMode} from '../src/engine/water/WaterSettings.js';
vi.mock('../src/engine/render/ProgramHealthGate.js',()=>({validatePrograms:vi.fn(async()=>({ok:true})),programHealthError:()=>new Error('shader')}));
const renderer=()=>({isWebGLRenderer:true,compileAsync:vi.fn(async()=>{}),dispose:vi.fn()});
describe('independent effect domains',()=>{
 it('allocates no terrain meshes and supports parented camera world coordinates',()=>{
  const r=renderer(),{terrain:t}=resolveEffectHost({renderer:r,world:{mode:'infinite',size:24000}});
  expect(t.object.children).toHaveLength(0);expect(t._runtime).toBeUndefined();
  expect(t.configuration.layout.chunkSize*6).toBe(24000);
  const parent=new THREE.Group(),cam=new THREE.PerspectiveCamera();parent.position.set(2000,3000,4000);parent.add(cam);cam.position.set(10,20,30);
  expect(t.frame(.05,cam).position.toArray()).toEqual([2010,3020,4030]);expect(t._uniforms.uTime.value).toBeCloseTo(.05);
  t.dispose();t.dispose();expect(r.dispose).not.toHaveBeenCalled();
 });
 it('creates an ocean at zero and below, preserving its public group across reconfiguration',async()=>{
  const r=renderer(),water=await createWater({renderer:r,world:{size:20000},mode:'volumetric'});
  const object=water.object,scene=new THREE.Scene();scene.add(object);
  expect(water.system.getEffectiveMode()).toBe('volumetric');expect(water.context.mesh.visible).toBe(true);
  const camera=new THREE.PerspectiveCamera();camera.position.set(100,200,300);water.update(.05,{camera});
  expect(water.terrain._uniforms.uTime.value).toBeCloseTo(.05);
  await water.configure({parameters:{seaLevel:-20},quality:{waterDetail:.6}});
  expect(water.object).toBe(object);expect(water.object.parent).toBe(scene);expect(object.children).toHaveLength(1);
  expect(water.context.mesh.position.y).toBe(-20);expect(water.context.mesh.visible).toBe(true);
  expect(water.quality.waterDetail).toBe(.6);
  const source=water.system;r.compileAsync.mockRejectedValueOnce(new Error('candidate failed'));
  await expect(water.configure({quality:{waterDetail:1.2}})).rejects.toThrow('candidate failed');
  expect(water.system).toBe(source);expect(water.quality.waterDetail).toBe(.6);
  water.dispose();water.dispose();expect(object.parent).toBe(null);expect(r.dispose).not.toHaveBeenCalled();
 });
 it('keeps zero-level editor water disabled unless explicitly opted in',()=>{
  const p={seaLevel:0,waterEnabled:true,waterMode:'volumetric'};
  expect(resolveEffectiveWaterMode(p,'studio')).toBe('off');
  expect(resolveEffectiveWaterMode({...p,waterHideAtZero:false},'studio')).toBe('volumetric');
  const pass=new WaterSurfacePass();
  expect(pass.shouldCapture(p,'volumetric','studio')).toBe(false);
  expect(pass.shouldCapture({...p,waterHideAtZero:false},'volumetric','studio')).toBe(true);pass.dispose();
  expect(resolveUnderwaterMode({...p,waterHideAtZero:false},'volumetric')).toBe('high');
  const reflection=new WaterPlanarReflectionPass(),parent=new THREE.Group(),camera=new THREE.PerspectiveCamera();
  parent.position.y=100;camera.position.y=-10;parent.add(camera);
  expect(reflection.shouldCapture({...p,waterHideAtZero:false,waterReflectionQuality:2},'cinematic','studio',camera)).toBe(true);
  parent.position.y=-100;camera.position.y=10;
  expect(reflection.shouldCapture({...p,waterHideAtZero:false,waterReflectionQuality:2},'cinematic','studio',camera)).toBe(false);reflection.dispose();
 });
 it('applies underwater tuning and optional components instead of silently dropping them',async()=>{
  const water=await createWater({renderer:renderer(),mode:'volumetric',parameters:{
    waterUnderwaterFogDensity:.7,waterUnderwaterVisibility:2,waterUnderwaterDistortion:.2,
    waterUnderwaterCaustics:.8,waterUnderwaterParticles:true,waterUnderwaterLightShafts:true,
  }});
  const camera=new THREE.PerspectiveCamera();camera.position.y=-100;
  for(let i=0;i<10;i++)water.update(.05,{camera});
  expect(water.controller.active).toBe(true);expect(water.controller.quality).toBe('high');
  expect(water.underwater.intensity).toBe(.7);expect(water.underwater.visibility).toBe(70);
  const u=water.underwater._material.uniforms;
  expect(u.uDistortion.value).toBe(.2);expect(u.uCausticStr.value).toBe(.8);
  expect(u.uParticles.value).toBeGreaterThan(0);expect(u.uLightShafts.value).toBeGreaterThan(0);water.dispose();
 });
 it('prepares streaming caches at a parented camera world position',async()=>{
  const terrain=await createInfiniteTerrain({renderer:renderer(),configuration:{layout:{chunkSize:1024,viewRadius:3,cacheResolution:64}}});
  const parent=new THREE.Group(),camera=new THREE.PerspectiveCamera();parent.position.set(12000,1000,-9000);parent.add(camera);camera.position.set(10,20,30);
  const prepare=vi.spyOn(terrain._world,'prepare').mockImplementation(async t=>expect(t._cameraPosition.toArray()).toEqual([12010,1020,-8970]));
  try{await terrain.prepare(camera);}finally{prepare.mockRestore();terrain.dispose();}
 });
 it('rejects ambiguous ownership and invalid world dimensions before allocating an effect',async()=>{
  const r=renderer(),t=await createTerrain({renderer:r,configuration:{layout:{chunkCount:1,chunkSize:64}}});
  expect(()=>resolveEffectHost({terrain:t,renderer:r})).toThrow('do not mix');
  expect(()=>resolveEffectHost({renderer:r,world:{size:Infinity}})).toThrow();
  expect(()=>resolveEffectHost({renderer:r,world:{mode:'planet'}})).toThrow('attach to a planet');t.dispose();
 });
 it('validates quality budgets and preserves omitted values',()=>{
  expect(effectQuality({cloudRenderScale:.25},CLOUD_QUALITY_DEFAULTS).cloudRealisticSteps).toBe(24);
  expect(()=>effectQuality({cloudSteps:NaN},CLOUD_QUALITY_DEFAULTS)).toThrow();
  expect(()=>effectQuality({cloudRenderScale:9},CLOUD_QUALITY_DEFAULTS)).toThrow();
  expect(()=>effectQuality({typo:1},CLOUD_QUALITY_DEFAULTS)).toThrow();
 });
});
