import { TerrainBoard } from '../engine/terrain/TerrainBoard.js';

// Keep the studio's existing LOD cadence, profiling and build budgets outside
// this module. The same geometry/LOD/culling path serves the public runtime.
export function updateFiniteTerrainView(board, camera, { lod = true, cull = true } = {}) {
  // cull() already refreshes matrices; the combined path also needs them
  // before selecting LOD. Keep split studio profiling calls at their old cost.
  if (lod && cull) camera.updateMatrixWorld(true);
  if (lod) board.updateLOD(camera.position);
  if (cull) board.cull(camera);
}

export class FiniteTerrainRuntime {
  constructor(parent, material) {
    this.board = new TerrainBoard(parent, material);
  }

  get group() {
    return this.board.group;
  }

  update(camera, budget) {
    if (budget && this.board.isBuilding) this.board.processBuildQueue(budget);
    updateFiniteTerrainView(this.board, camera);
  }

  dispose() {
    this.board.dispose();
    this.board.group.removeFromParent();
  }
}
