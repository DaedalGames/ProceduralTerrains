import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTerrain } from 'procedural-terrains';

const query = new URLSearchParams(location.search);
const mode = query.get('mode') ?? 'finite';

const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#16232b');
const camera = new THREE.PerspectiveCamera(50, 1, 1, 15000);
camera.position.set(1100, 1100, 1300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 140, 0);
controls.update();
const status = document.querySelector('#status');
const button = document.querySelector('#regenerate');
async function main() {
  let terrain, pipeline;
  try {
    if(mode === 'infinite') terrain = await (await import('procedural-terrains/infinite')).createInfiniteTerrain({renderer});
    else if(mode === 'planet') {
      terrain = await (await import('procedural-terrains/planet')).createPlanetTerrain({renderer,configuration:{layout:{bakeResolution:128}}});
      camera.far=1e6;camera.position.set(24000,24000,30000);controls.target.set(0,0,0);camera.updateProjectionMatrix();controls.update();
    } else if(mode === 'mini') {
      terrain = await (await import('procedural-terrains/mini')).createMiniTerrain({renderer,mini:{recipe:'cove',quality:'balanced'}});
      const framing=terrain.mini.framing();controls.target.fromArray(framing.target);
      camera.position.setFromSphericalCoords(framing.radius,framing.phi,framing.theta).add(controls.target);controls.update();
    } else terrain = await createTerrain({renderer});
    if(query.has('water'))await (await import('procedural-terrains/water')).createWater({terrain,mode:query.get('water')});
    if(query.has('clouds'))await (await import('procedural-terrains/clouds')).createClouds({terrain,mode:query.get('clouds')});
    if(query.has('water')||query.has('clouds')||mode==='mini') pipeline=new (await import('procedural-terrains/render')).TerrainRenderPipeline({renderer,terrains:[terrain]});
    scene.add(terrain.object);
    await terrain.prepare(camera);
    button.disabled = false;
    const clock = new THREE.Clock();
    const resize = () => {
      renderer.setSize(innerWidth, innerHeight, false);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);
    renderer.setAnimationLoop(() => {
      controls.update();
      terrain.update(clock.getDelta(), { camera });
      if(pipeline)pipeline.render(scene,camera);else renderer.render(scene, camera);
      const d = terrain.getDiagnostics();
      status.textContent = `Seed ${terrain.configuration.source.seed} · ${d.chunks} chunks · ${renderer.info.render.calls} draw calls`;
    });
    button.addEventListener('click', async () => {
      const seed=(Math.random()*0xffffffff)>>>0;
      try { if(terrain.mini)await terrain.mini.configure({seed});else await terrain.configure({source:{seed}}); } catch(error) {status.textContent=error.message;}
    });
    window.addEventListener('pagehide', () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      pipeline?.dispose();
      terrain.dispose();
      controls.dispose();
      renderer.dispose();
    }, { once: true });
    return { terrain, renderer, scene, camera };
  } catch (error) {
    status.textContent = error.message;
    pipeline?.dispose();
    terrain?.dispose();
    controls.dispose();
    renderer.dispose();
    throw error;
  }
}
export const ready = main();
