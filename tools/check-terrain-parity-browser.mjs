import {buildStandalone} from '../src/docs/playground/runner.js';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../examples/three-finite-terrain/',import.meta.url));
const server=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'warn'});
await server.listen();
let browser;
try {
  browser=await chromium.launch({...(process.env.TERRAIN_BROWSER_CHANNEL ? {channel:process.env.TERRAIN_BROWSER_CHANNEL} : process.platform==='win32' ? {channel:'msedge'} : {}),headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  const workerId='terrain-runtime:/package/assets/fixture-worker.js';
  const fixture=new URL('../.cache/standalone-worker-check.html',import.meta.url);
  await writeFile(fixture,buildStandalone(
    "const worker=new Worker('"+workerId+"',{type:'module'}); worker.onmessage=({data})=>window.workerResult=data; worker.postMessage(21);",
    {modules:{[workerId]:'self.onmessage=({data})=>self.postMessage(data*2);'},imports:{},classicWorkers:[workerId]}));
  const offline=await browser.newContext({offline:true});
  const workerPage=await offline.newPage();await workerPage.goto(fixture.href);
  await workerPage.waitForFunction(()=>window.workerResult===42);
  await offline.close();
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+m.location().url);});
  await page.goto(new URL('parity.html',server.resolvedUrls.local[0]).href);
  await page.waitForFunction(()=>!!window.runParity);
  const result=await page.evaluate(()=>window.runParity());
  console.log(JSON.stringify({ maxHeightError: Math.max(...result.samples.map(p=>Math.abs(p.editor-p.runtime))), detailReady: result.detailReady, detailPixelDelta: result.detailPixelDelta, errors }));
  assert.deepEqual(errors,[]);
  assert.equal(result.glError,0);
  for(const [key,v] of Object.entries(result.uniforms))assert.equal(v.runtime,v.editor,key);
  const maxError=Math.max(...result.samples.map(p=>Math.abs(p.editor-p.runtime)));
  assert(maxError<.001,'Editor and runtime height mismatch: '+maxError);
  assert(result.firstWater.every(w=>w.enabled===1&&w.color&&w.depth),'First frame water capture missing');
  assert(result.replacedWater.every(w=>w.enabled===1&&w.color&&w.depth),'Recreated water capture missing');
  assert(result.detailReady,'Automatic detail worker produced no pages');
  assert(result.detailPixelDelta>100,'Procedural detail has no visible contribution');
  const out=new URL('../output/terrain-parity/',import.meta.url);await mkdir(out,{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('corrected.png',out))});
  await writeFile(new URL('verification.json',out),JSON.stringify({...result,maxHeightError:maxError},null,2));
  console.log(JSON.stringify({samples:result.samples.length,maxHeightError:maxError,detailPixelDelta:result.detailPixelDelta,firstWater:result.firstWater,replacedWater:result.replacedWater,errors}));
  await page.evaluate(()=>{const p=window.parityTerrain;p.pipeline.dispose();p.terrain.dispose();p.renderer.dispose();});
}finally{await browser?.close();await server.close();}
