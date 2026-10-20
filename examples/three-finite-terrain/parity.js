import * as THREE from 'three';
import { loadTerrainDocument } from 'procedural-terrains/documents';
import { TerrainRenderPipeline } from 'procedural-terrains/render';
import { createTerrainCodeDocument } from '../../src/export/TerrainCodeExporter.js';
import { DEFAULT_PARAMS } from '../../src/engine/presets.js';
import { miniStylePatch } from '../../src/engine/mini/MiniLook.js';
import { TerrainHeightSampler } from '../../src/engine/terrain/TerrainHeightSampler.js';
import { createTerrainUniforms } from '../../src/engine/terrain/TerrainMaterial.js';
import { applyTerrainShapeUniforms, applyTerrainShadingUniforms } from '../../src/runtime/TerrainParameters.js';
import { applyTerrainDetailUniforms, applyTerrainVisualUniforms } from '../../src/runtime/TerrainAppearance.js';

window.runParity = async function() {
  const renderer = new THREE.WebGLRenderer({canvas: document.querySelector('canvas'), antialias: true});
  renderer.setSize(640,480);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#ccd0dd');
  const camera = new THREE.PerspectiveCamera(50,640/480,.5,20000);
  camera.position.set(716.8,614.4,819.2); camera.lookAt(0,92.5,0);
  const params = { ...DEFAULT_PARAMS, seed: 1936579376, chunkCount: 1, chunkSize: 1024,
    heightScale: 370, seaLevel: 104, octaves: 5, terrainFormationSeaLevel: 81, noiseScale: 80.5, noiseStrength: 2,
    terrainSmoothing: 1, persistence: .54, lacunarity: 2.05, ridge: 0, warp: .95, falloff: .35,
    waterMode: 'volumetric', cloudsEnabled: false, biomeScale: .6, snowLine: .95,
    normalStrength: 1.15, aoStrength: .8, planetStyle: miniStylePatch('procedural','dunes') };
  const quality = { terrainDetailQuality: 3, terrainDetailFar: 420, terrainDetailStrength: 1.1 };
  const {document: saved} = createTerrainCodeDocument({worldMode: 'studio',params,
    miniTerrain: { recipe: 'procedural', preset: 'dunes', seed: 1885913737, width: 1024,
      quality: 'high', relief: 1.6, shape: 'circle' }}, {quality});
  const t = await loadTerrainDocument(saved,{renderer}); scene.add(t.object);
  const pipeline = new TerrainRenderPipeline({renderer,terrains:[t]});
  window.parityTerrain = { terrain:t,pipeline,renderer,scene,camera };
  await t.prepare(camera);
  t.update(.016,{camera}); pipeline.render(scene,camera);
  const water = [...t._layers].find(l=>l.system);
  const capture = () => [t.mini.controller.waterSurface, t.mini.controller.waterCut.material].map(m=>({
    enabled:m.uniforms.uSceneRefractionEnabled.value,
    color:!!m.uniforms.uSceneColor.value, depth:!!m.uniforms.uSceneDepth.value}));
  const firstWater = capture();
  const editorUniforms = createTerrainUniforms();
  applyTerrainShapeUniforms(editorUniforms, params, 1024);
  applyTerrainShadingUniforms(editorUniforms, params, {size:1024,skirtDepth:1,wallThickness:0});
  applyTerrainDetailUniforms(editorUniforms, quality); applyTerrainVisualUniforms(editorUniforms,params);
  t.mini.controller.applyUniforms(editorUniforms);
  const sampler = new TerrainHeightSampler(editorUniforms,()=>({octaves:params.octaves,infinite:false}));
  const samples = [];
  for (let x=-400;x<=400;x+=100) for (let z=-400;z<=400;z+=100)
    samples.push({x,z,editor:sampler.heightAt(x,z),runtime:t.sampleHeight(x,z)});
  // Allow worker responses without repeatedly rendering the expensive water passes.
  for (let i=0;i<200 && !t._detailPageCache?.hasReadyPage;i++) {
    t.update(.016,{camera}); await new Promise(r=>setTimeout(r,10));
  }
  for(let i=0;i<20;i++) t.update(.016,{camera});
  const detailReady = t._detailPageCache?.hasReadyPage;
  // Rebuilding the water system must rebind both Mini materials on its first frame.
  await water.configure({ parameters: { waterRefractionStrength: .6 } });
  t.update(.016,{camera}); pipeline.render(scene,camera);
  const replacedWater = capture();
  const checkKeys = ['uHeightScale','uTerrainFormationSeaLevel','uFrequency','uAmplitude','uWarp','uBiomeScale','uSnowLine','uNormalStrength','uTerrainDetailQuality','uTerrainDetailStrength'];
  const uniforms = Object.fromEntries(checkKeys.map(k=>[k,{editor:editorUniforms[k].value,runtime:t._uniforms[k].value}]));
  // Put the camera over a loaded page to measure the visible procedural detail contribution.
  camera.position.set(40,220,250); camera.lookAt(0,140,0); camera.updateMatrixWorld();
  for(let i=0;i<200;i++) { t.update(.016,{camera}); if(t._detailPageCache.globalBlend>=1 && t._detailPageCache.pending.size===0 && t._detailPageCache.readyQueue.length===0)break; await new Promise(r=>setTimeout(r,10)); }
  const pixels=()=>{ pipeline.render(scene,camera); const bytes=new Uint8Array(640*480*4);renderer.readRenderTargetPixels(pipeline.target,0,0,640,480,bytes);return bytes; };
  const detailed=pixels();t._uniforms.uTerrainDetailQuality.value=0;const plain=pixels();
  t._uniforms.uTerrainDetailQuality.value=quality.terrainDetailQuality;
  let detailPixelDelta=0;for(let i=0;i<plain.length;i+=4)if(Math.abs(plain[i]-detailed[i])+Math.abs(plain[i+1]-detailed[i+1])+Math.abs(plain[i+2]-detailed[i+2])>2)detailPixelDelta++;
  camera.position.set(716.8,614.4,819.2);camera.lookAt(0,92.5,0);t.update(.016,{camera});pipeline.render(scene,camera);
  return {samples,uniforms,firstWater,replacedWater,detailReady,detailPixelDelta,glError:renderer.getContext().getError()};
};
