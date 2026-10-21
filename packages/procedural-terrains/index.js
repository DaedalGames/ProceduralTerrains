// During the extraction, the studio and package share the existing source
// graph. The library build closes this graph into dist; no external source
// paths or private studio entry points are shipped in the npm tarball.
export { createTerrain, FiniteTerrain } from '../../src/runtime/FiniteTerrain.js';
