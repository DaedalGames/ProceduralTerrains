import * as THREE from 'three';

// Shared objects follow both the manual lighting palette and time of day.
export function miniLightingUniforms(shared) {
  return {
    uTerrainSunCol: shared.uTerrainSunCol ?? { value: new THREE.Vector3(1, 0.94, 0.82) },
    uTerrainSunIntensity: shared.uTerrainSunIntensity ?? { value: 1.25 },
    uTerrainSkyAmb: shared.uTerrainSkyAmb ?? { value: new THREE.Vector3(0.62, 0.70, 0.82) },
    uTerrainBounce: shared.uTerrainBounce ?? { value: new THREE.Vector3(0.34, 0.30, 0.24) },
  };
}

export const MINI_LIGHTING_GLSL = /* glsl */ `
uniform vec3 uTerrainSunCol;
uniform float uTerrainSunIntensity;
uniform vec3 uTerrainSkyAmb;
uniform vec3 uTerrainBounce;

vec3 miniLighting(float diffuse, float visibility, float ao) {
  return (uTerrainSkyAmb * 0.65 + uTerrainBounce * 0.25
    + uTerrainSunCol * uTerrainSunIntensity * diffuse * visibility * 0.45)
    * mix(0.88, 1.0, ao);
}
`;
