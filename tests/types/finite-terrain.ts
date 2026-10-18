import { createTerrain, FiniteTerrain, type TerrainDocument } from 'procedural-terrains';
import { WebGLRenderer, PerspectiveCamera, Scene } from 'three';

async function consumer(renderer: WebGLRenderer) {
  const camera = new PerspectiveCamera();
  const terrain: FiniteTerrain = await createTerrain({ renderer, configuration: {
    source: { kind: 'noise', seed: 123 }, quality: { lodSegments: [64, 32, 16, 8] },
    palette: { grass: [0.1, 0.2, 0.1] },
  } });
  new Scene().add(terrain.object);
  await terrain.prepare(camera);
  await terrain.configure({ heightScale: 300 });
  terrain.update(0.016, { camera });
  const height: number | null = terrain.sampleHeight(0, 0);
  const document: TerrainDocument = terrain.serialize();
  await createTerrain({ renderer, configuration: document.configuration });
  // @ts-expect-error Graph sources have not been released.
  await terrain.configure({ source: { kind: 'graph' } });
  // @ts-expect-error Configuration is immutable.
  terrain.configuration.source.seed = 1;
  // @ts-expect-error LOD requires four levels.
  await terrain.configure({ quality: { lodSegments: [64, 32] } });
  terrain.dispose();
  return height;
}
void consumer;

import {createInfiniteTerrain} from 'procedural-terrains/infinite';
import {createPlanetTerrain} from 'procedural-terrains/planet';
import {createMiniTerrain} from 'procedural-terrains/mini';
import {createWater} from 'procedural-terrains/water';
import {createClouds} from 'procedural-terrains/clouds';
import {TerrainRenderPipeline,TerrainPass,createHeightCache} from 'procedural-terrains/render';
import {TerrainCompute,TerrainResources,TerrainSurfaceWorker,TerrainSurfaceProvider,createSurfaceResources} from 'procedural-terrains/assets';
import {exportTerrain,zipTerrainExport} from 'procedural-terrains/export';
import {loadTerrainDocument} from 'procedural-terrains/documents';
import {createBlankGraph} from 'procedural-terrains/generation';
import {TerrariumProvider,createRealWorldTerrain} from 'procedural-terrains/real-world';
import {createTerrainViewer} from 'procedural-terrains/viewer';
async function allModules(renderer:WebGLRenderer){
  const camera=new PerspectiveCamera(),scene=new Scene();
  const infinite=await createInfiniteTerrain({renderer,configuration:{layout:{viewRadius:4,cacheResolution:128}}});
  const planet=await createPlanetTerrain({renderer,configuration:{layout:{radius:16000,faceGrid:4}}});
  const mini=await createMiniTerrain({renderer,mini:{recipe:'cove',quality:'balanced'}});mini.mini?.framing();
  await mini.configure({source:{kind:'graph',graph:createBlankGraph()}});
  await createTerrain({renderer,configuration:{source:{kind:'heightmap',data:new Float32Array(4),width:2,height:2}}});
  const water=await createWater({terrain:mini,mode:'volumetric',parameters:{waterFoamWidth:2,waterAnim:true}});
  await createClouds({terrain:mini,mode:'realistic',parameters:{cloudCoverage:.5}});
  const pipeline=new TerrainRenderPipeline({renderer,terrains:[mini]});pipeline.render(scene,camera);new TerrainPass(scene,camera,{renderer,terrains:[mini]});createHeightCache({terrain:mini});
  const resources=new TerrainResources();const lease=resources.acquire('example',()=>({dispose(){}}));lease.release();resources.dispose();
  const provider=new TerrainSurfaceProvider({baseUrl:'https://assets.example/pack/'});const surface=await createSurfaceResources({provider});await mini.setSurface(surface);await mini.setSurface(null);surface.dispose();provider.dispose();
  const compute=new TerrainCompute();const result=await compute.erode({heightmap:new Float32Array(4),width:2,height:2});result.delta.byteLength;compute.dispose();new TerrainSurfaceWorker().dispose();
  const artifacts=await exportTerrain(infinite,{format:'glb',region:{cx:0,cz:0,size:512}});zipTerrainExport(artifacts);
  await loadTerrainDocument(planet.serialize(),{renderer});
  await createRealWorldTerrain({renderer,provider:new TerrariumProvider({elevationTileUrl:(z,x,y)=>`https://tiles.example/${z}/${x}/${y}.png`}),request:{bbox:{west:0,east:1,south:0,north:1},zoom:0}});
  // @ts-expect-error Water modes form a closed union.
  await water.configure({mode:'unknown'});
  // @ts-expect-error Heightmaps require dimensions.
  await mini.configure({source:{kind:'heightmap',data:[1,2]}});
  void createTerrainViewer;
}
void allModules;
