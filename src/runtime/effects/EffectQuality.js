export const WATER_QUALITY_DEFAULTS={waterQuality:2,waterDetail:1,waterReflection:1,waterWaves:2};
export const CLOUD_QUALITY_DEFAULTS={cloudSteps:12,cloudLightSteps:2,cloudOctaves:3,cloudDetailOctaves:0,
  cloudRealisticSteps:24,cloudRenderScale:.5,cloudMaxDistance:6,cloudUseErosion:true,
  cloudSelfShadow:true,cloudLightMode:0,cloudStepLOD:false,cloudFallback:'none'};
const limits={waterQuality:[0,2,true],waterDetail:[0,2],waterReflection:[0,2],waterWaves:[0,4],
  cloudSteps:[8,128,true],cloudLightSteps:[1,12,true],cloudOctaves:[1,6,true],cloudDetailOctaves:[0,5,true],
  cloudRealisticSteps:[8,128,true],cloudRenderScale:[.25,1],cloudMaxDistance:[1,20],cloudLightMode:[0,1,true]};
export function effectQuality(patch={},base){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new TypeError('quality must be an object');
  for(const [key,value]of Object.entries(patch)){
    if(!(key in base))throw new TypeError('Unknown quality option '+key);
    if(typeof base[key]==='boolean'){if(typeof value!=='boolean')throw new TypeError(key+' must be boolean');}
    else if(key==='cloudFallback'){if(!['none','lite','off'].includes(value))throw new TypeError('Invalid cloudFallback');}
    else{const [min,max,integer]=limits[key];if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw new RangeError('Invalid '+key);}
  }
  return {...base,...patch};
}
