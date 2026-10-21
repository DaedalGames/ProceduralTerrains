import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createPlaygroundRuntime} from '../tools/playground-runtime.mjs';
import {buildStandalone} from '../src/docs/playground/runner.js';
import {PLAYGROUND_TEMPLATES} from '../src/docs/playground/templates.js';
import assert from 'node:assert/strict';
const out=new URL('../output/effects-qa/',import.meta.url);await mkdir(out,{recursive:true});
const runtime=await createPlaygroundRuntime();
const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
 for(const id of (process.argv.length>2?process.argv.slice(2):['water','clouds','large-world'])){
  const template=PLAYGROUND_TEMPLATES.find(t=>t.id===id);
  let code=template.code.replace('renderer.setAnimationLoop((now) => {',`window.__effectProbe={THREE,renderer,scene,camera,pipeline,
    water:typeof water==='undefined'?undefined:water,clouds:typeof clouds==='undefined'?undefined:clouds,
    terrain:typeof terrain==='undefined'?undefined:terrain};
renderer.setAnimationLoop((now) => {`);
  code=code.replace('  pipeline.render(scene, camera);','  pipeline.render(scene, camera); window.__effectFrame=true;renderer.setAnimationLoop(null);');
  await writeFile(new URL(id+'.html',out),buildStandalone(code,runtime));
  const context=await browser.newContext({offline:true,viewport:{width:640,height:480}});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(new URL(id+'.html',out).href);await page.waitForFunction(()=>!!window.__effectFrame,null,{timeout:180000});
  await page.evaluate(async()=>{const p=window.__effectProbe;for(let i=0;i<8;i++){if(p.terrain)p.terrain.update(.05,{camera:p.camera});else{p.water?.update(.05,{camera:p.camera});p.clouds?.update(.05,{camera:p.camera});}p.pipeline.render(p.scene,p.camera);await new Promise(r=>setTimeout(r,10));}});
  const result=await page.evaluate(()=>{const p=window.__effectProbe;const layers=p.terrain?[...p.terrain._layers]:[p.water,p.clouds].filter(Boolean);
    const water=layers.find(l=>l.system),clouds=layers.find(l=>l.layer);const target=new p.THREE.WebGLRenderTarget(640,480);p.pipeline.render(p.scene,p.camera,{target});const pixels=new Uint8Array(target.width*target.height*4);p.renderer.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);
    const colors=new Set();for(let i=0;i<pixels.length;i+=16)colors.add(pixels.slice(i,i+3).join(','));
    let cloudPixels=0;
    if(clouds){clouds.object.visible=false;p.pipeline.render(p.scene,p.camera,{target});const plain=new Uint8Array(pixels.length);p.renderer.readRenderTargetPixels(target,0,0,target.width,target.height,plain);for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-plain[i])+Math.abs(pixels[i+1]-plain[i+1])+Math.abs(pixels[i+2]-plain[i+2])>2)cloudPixels++;clouds.object.visible=true;}
    target.dispose();p.pipeline.render(p.scene,p.camera);
    return {cloudPixels,glError:p.renderer.getContext().getError(),colors:colors.size,water:water?{mode:water.system.getEffectiveMode(),visible:water.context.mesh.visible,level:water.context.mesh.position.y,capture:water.system.getRefractionDiagnostics().active}:null,clouds:clouds?.getDiagnostics()};});
  console.log(JSON.stringify({id,result,errors}));assert.deepEqual(errors,[]);assert.equal(result.glError,0);assert(result.colors>20);
  if(id==='water'){assert.equal(result.water.level,0);assert.equal(result.water.visible,true);assert.equal(result.water.capture,true);}
  if(result.clouds){assert.equal(result.clouds.active,true);assert(result.cloudPixels>100,'Clouds must visibly change the composited image');}
  await page.screenshot({path:fileURLToPath(new URL(id+'.png',out))});await context.close();
 }
}finally{await browser.close();}
