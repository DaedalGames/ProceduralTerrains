import { describe, expect, it, vi } from 'vitest';
import { validateAuthFields } from '../src/auth/authValidation.js';
import { Engine } from '../src/engine/Engine.js';

const fields = {username:'terrain_creator',email:'user@example.com',identifier:'user@example.com',password:'a-valid-passphrase',confirmPassword:'a-valid-passphrase'};
describe('release regressions', () => {
  it('rejects missing sign-in fields before any server request', () => {
    expect(validateAuthFields({...fields,identifier:'  ',password:''})).toEqual({identifier:expect.any(String),password:expect.any(String)});
    expect(validateAuthFields(fields)).toEqual({});
    // Existing accounts can still sign in with a shorter password.
    expect(validateAuthFields({...fields,password:'old-pass'})).toEqual({});
  });
  it('validates registration format, length and password confirmation locally', () => {
    expect(validateAuthFields(fields,true)).toEqual({});
    expect(validateAuthFields({...fields,username:'a!',email:'invalid',password:'short',confirmPassword:'different'},true)).toEqual({username:expect.any(String),email:expect.any(String),password:expect.any(String),confirmPassword:expect.any(String)});
    expect(validateAuthFields({...fields,password:'x'.repeat(129)}).password).toBeTruthy();
  });
  it('stops a superseded GPU readiness wait without reading retired materials', async () => {
    const engine=Object.create(Engine.prototype);
    const get=vi.fn();
    engine.renderer={properties:{get}};
    const result=await engine._waitForMaterialsReady(new Set([{}]),{isCurrent:()=>false});
    expect(result).toMatchObject({aborted:true,ready:false,timedOut:false});
    expect(get).not.toHaveBeenCalled();
  });
  it('serializes water compilation and swaps only the latest requested mode', async () => {
    const engine=Object.create(Engine.prototype);
    let generation=0;
    let active=0;
    let maxActive=0;
    const starts=[];
    let started, finishFirst;
    const firstStarted = new Promise(resolve => { started=resolve; });
    const firstFinished = new Promise(resolve => { finishFirst=resolve; });
    engine.cb={onStatus:vi.fn()};
    engine._recordWaterShaderCompile=vi.fn();
    engine._compileCameraTargetMaterials=vi.fn(async (materials,{isCurrent})=>{
      starts.push(materials[0]);
      active++;maxActive=Math.max(maxActive,active);
      if (materials[0] === 'first') { started(); await firstFinished; }
      active--;
      return {ready:isCurrent(),aborted:!isCurrent()};
    });
    const firstSwap=vi.fn(),lastSwap=vi.fn();
    const first=engine.compileWaterMaterialsAsync(['first'],firstSwap,{isCurrent:()=>generation===0});
    await firstStarted;
    generation=1;
    const skipped=engine.compileWaterMaterialsAsync(['skipped'],vi.fn(),{isCurrent:()=>generation===1});
    generation=2;
    const last=engine.compileWaterMaterialsAsync(['last'],lastSwap,{isCurrent:()=>generation===2});
    finishFirst();
    expect(await Promise.all([first,skipped,last])).toEqual([false,false,true]);
    expect(starts).toEqual(['first','last']);
    expect(maxActive).toBe(1);
    expect(firstSwap).not.toHaveBeenCalled();
    expect(lastSwap).toHaveBeenCalledOnce();
    expect(engine.cb.onStatus.mock.calls.filter(([status])=>status==='Ready')).toHaveLength(1);
  });
});
