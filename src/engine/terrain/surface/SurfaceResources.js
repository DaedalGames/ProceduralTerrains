import { prepareSurfaceMaps } from './SurfaceMapPreparation.js';
import { compileSurfaceGraph } from './SurfaceGraph.js';
import * as THREE from 'three';
import { unzlibSync } from 'fflate';
import { SURFACE_TEXTURE_ROLES, SURFACE_TEXTURE_ROWS } from './SurfaceTextureRoles.js';
import { createSurfaceDocument, collectSurfaceAssets, resolveSurfaceReference, surfaceResourceBudget } from './SurfaceDocument.js';

export const SURFACE_PACK_URL='/textures/terrain/pbr/';
let catalogPromise;
const preparedChains = new Map();
const MAX_PREPARED_CHAINS = 8;
function cachedChain(key, prepare, cache = preparedChains) {
  // Provider scopes share completed assets, not cancellable in-flight requests.
  // A signal from one consumer must not reject another consumer's request.
  if(cache !== preparedChains){
    if(cache.has(key))return Promise.resolve(cache.get(key));
    return Promise.resolve().then(prepare).then(chain=>{cache.set(key,chain);while(cache.size>MAX_PREPARED_CHAINS)cache.delete(cache.keys().next().value);return chain;});
  }
  if (cache.has(key)) {
    const chain = cache.get(key);
    cache.delete(key);
    cache.set(key, chain);
    return chain;
  }
  const chain = Promise.resolve().then(prepare).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, chain);
  while (cache.size > MAX_PREPARED_CHAINS) cache.delete(cache.keys().next().value);
  return chain;
}
export function loadSurfaceCatalog(provider, signal) {
  if (provider?.loadCatalog) return provider.loadCatalog({ signal });
  return catalogPromise ||= fetch(`${SURFACE_PACK_URL}catalog.json`).then(r=>{if(!r.ok)throw new Error(`Material pack unavailable (${r.status})`);return r.json();}).catch(e=>{catalogPromise=null;throw e;});
}
export function decodeSurfaceMipChain(bytes,resolution) {
  const raw=unzlibSync(bytes), levels=[];let offset=0;
  for(let size=resolution;size>=1;size/=2){const count=size*size*4;levels.push({size,color:raw.subarray(offset,offset+count),props:raw.subarray(offset+count,offset+count*2)});offset+=count*2;}
  if(offset!==raw.length)throw new Error('Invalid PBR mip chain');
  return levels;
}
// Three r185's RGBA branch of CompressedArrayTexture uploads explicit mip
// levels through its own WebGL state cache. Storage is RGBA8, not GPU-compressed.
export function createMipArray(chains,key,colorSpace=THREE.NoColorSpace) {
  const mipmaps=chains[0].map((level,index)=>{
    const data=new Uint8Array(level.size**2*4*chains.length);
    chains.forEach((chain,layer)=>data.set(chain[index][key],layer*level.size**2*4));
    return {width:level.size,height:level.size,data};
  });
  const texture=new THREE.CompressedArrayTexture(mipmaps,mipmaps[0].width,mipmaps[0].height,chains.length,THREE.RGBAFormat,THREE.UnsignedByteType);
  texture.colorSpace=colorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
}
export async function buildSurfaceResources({document:input,signal,references,extraReferences=[],graph,paint,provider}={}) {
  const document=createSurfaceDocument({...input,...(paint?{layers:paint.layers}:{})}),catalog=await loadSurfaceCatalog(provider, signal);
  extraReferences=[...extraReferences,...(paint?.layers||[]).map(l=>l.materialInstanceId)];
  const graphPlan=compileSurfaceGraph(graph,document);
  if(graphPlan)extraReferences=[...extraReferences,...graphPlan.assets];
  const ids=collectSurfaceAssets(document,[...(references||Object.values(document.roles)),...extraReferences]);
  const budget=surfaceResourceBudget(ids.length,document.settings.profile,paint?.layers?.length ? 36*1024**2 : 0);
  const chains=[];
  for(const id of ids) {
    signal?.throwIfAborted();const asset=catalog.assets.find(a=>a.id===id);
    if(id.startsWith('legacy:')) {
      const name=id.slice(7),base=`${provider?.legacyBaseUrl ?? "/textures/terrain"}/${name}/base/${name}`;
      chains.push(await cachedChain(`${id}:${budget.resolution}`, () =>
        prepareSurfaceMaps({albedo:base+'_diffuse.jpg',normal:base+'_normal_dx.jpg',roughness:base+'_roughness.jpg',ao:base+'_ao.jpg'},budget.resolution,{normalConvention:'DX'}), provider?.cache));continue;
    }
    if(id.startsWith('user:')) {
      const local=document.assets[id];if(!local)throw new Error(`Missing local material ${id}`);
      const contentKey=JSON.stringify([budget.resolution,local.normalConvention,Object.entries(local.maps).map(([slot,ref])=>[slot,ref.hash]).sort()]);
      chains.push(await cachedChain(`user:${contentKey}`, async () => {
        if (!provider?.loadUserAsset) throw new Error('Provide loadUserAsset for local surface maps'); const urls={};
        try {for(const [slot,ref] of Object.entries(local.maps)){const blob=await provider.loadUserAsset(ref.hash, {signal});if(!blob)throw new Error(`Missing local map ${local.name}: ${slot}`);urls[slot]=URL.createObjectURL(blob);}return await prepareSurfaceMaps(urls,budget.resolution,{normalConvention:local.normalConvention});}
        finally{Object.values(urls).forEach(url=>URL.revokeObjectURL(url));}
      }, provider?.cache));continue;
    }
    if(!asset)throw new Error(`Material files unavailable: ${id}`);
    const file=asset.resolutions[budget.resolution];
    chains.push(await cachedChain(`${file.sha256}:${budget.resolution}`, async () => {
      const response=await (provider?.fetch ?? fetch)(provider?.resolveUrl ? provider.resolveUrl(file.path) : `${SURFACE_PACK_URL}${file.path}`,{signal});
      if(!response.ok)throw new Error(`${asset.name}: HTTP ${response.status}`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(digest!==file.sha256)throw new Error(`${asset.name}: pack hash mismatch`);
      return decodeSurfaceMipChain(bytes,budget.resolution);
    }, provider?.cache));
  }
  signal?.throwIfAborted();
  const diffuse=createMipArray(chains,'color',THREE.SRGBColorSpace);let props;
  try {props=createMipArray(chains,'props');}catch(e){diffuse.dispose();throw e;}
  const slots=Object.fromEntries(ids.map((id,i)=>[id,i]));
  const roleData=SURFACE_TEXTURE_ROLES.map(role=>resolveSurfaceReference(document.roles[role.id],document));
  const mapping=roleData.map(items=>new THREE.Vector4(slots[items[0].assetId],items[1]?slots[items[1].assetId]:-1,items[0].wetness||0,items[0].scale||1));
  const tints=roleData.map(items=>new THREE.Vector3(...items[0].tint));
  const sizes=ids.map(id=>catalog.assets.find(a=>a.id===id)?.physicalSize?.[0]||2);
  return {backend:'array',document,paint,graph:compileSurfaceGraph(graph,document,slots),diffuse,props,slots,ids,mapping,tints,sizes,budget,
    present:new Array(SURFACE_TEXTURE_ROWS).fill(1),rolePresent:SURFACE_TEXTURE_ROLES.map(()=>1),
    tile:SURFACE_TEXTURE_ROLES.map(()=>12),anyPresent:true,bakedAt:Date.now(),
    coverage:{diffuseReady:ids.length,total:ids.length,missingDiffuse:0,missingOptional:ids.filter(id=>catalog.assets.find(a=>a.id===id)?.missingOptional?.length).length},
    layers:ids.map(id=>({id,hasDiffuse:true})),};
}
