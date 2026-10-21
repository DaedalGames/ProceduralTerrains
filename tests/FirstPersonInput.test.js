import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { FPSControls } from '../src/engine/FPSControls.js';
import { PlanetController } from '../src/engine/player/PlanetController.js';
import { PlaneController } from '../src/engine/player/PlaneController.js';
import { PlayerController } from '../src/engine/player/PlayerController.js';
import { WorkerCanvasFacade, createWorkerDom } from '../src/engine/WorkerDom.js';
import { requestMouseLock } from '../src/engine/FirstPersonInput.js';

afterEach(() => vi.unstubAllGlobals());

function setup(kind) {
  const canvas = new WorkerCanvasFacade({ width: 800, height: 600 }, { width: 800, height: 600 });
  const exitPointerLock = vi.fn();
  const { documentTarget, windowTarget } = createWorkerDom(canvas, { exitPointerLock });
  vi.stubGlobal('document', documentTarget);
  vi.stubGlobal('window', windowTarget);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 110, 0);
  const sampler = { heightAt: () => 0, normalAt: () => ({ x: 0, y: 1, z: 0 }) };
  const controls = kind === 'planet'
    ? new PlanetController({ camera, domElement: canvas, sampler: { surfaceRadius: () => 100 } })
    : kind === 'plane'
      ? new PlaneController({ camera, domElement: canvas, sampler })
      : new FPSControls(camera, canvas);
  const player = kind === 'walk' ? new PlayerController({ controls, camera, sampler, getWaterLevel: () => null }) : null;
  const engine = Object.assign(Object.create(Engine.prototype), { canvas });
  return { canvas, doc: documentTarget, camera, controls, player, engine, exitPointerLock };
}

describe('first-person input through the render worker', () => {
  for (const kind of ['fly', 'walk', 'planet', 'plane']) {
    it(`${kind}: applies browser lock before mouse and keyboard, then clears keys on unlock`, () => {
      const { engine, controls, camera, player } = setup(kind);
      const before = camera.quaternion.clone();
      engine.applyInputFrame({
        pointerLocked: true,
        pointerEvents: [{ type: 'mousemove', movementX: 80, movementY: 20 }],
        keyEvents: [{ type: 'keydown', code: 'KeyW' }],
      });
      expect(controls.isLocked).toBe(true);
      expect(controls.keys.has('KeyW')).toBe(true);
      controls.update(0.1);
      player?.update(0.1);
      expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.001);
      engine.applyInputFrame({ pointerLocked: false });
      expect(controls.isLocked).toBe(false);
      expect(controls.keys.size).toBe(0);
      player?.dispose();
      controls.dispose();
    });

    it(`${kind}: looks and moves with touch without claiming mouse lock`, () => {
      const { canvas, controls, camera, player } = setup(kind);
      const before = camera.quaternion.clone();
      const position = camera.position.clone();
      const touch = (type, x, y) => canvas.dispatchTerrainEvent(type, {
        pointerId: 7, pointerType: 'touch', clientX: x, clientY: y,
      });
      touch('pointerdown', 300, 200);
      touch('pointermove', 380, 220);
      controls.setTouchInput({ moveY: 1 });
      controls.update(0.1);
      player?.update(0.1);
      expect(controls.isLocked).toBe(false);
      expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.001);
      expect(camera.position.distanceTo(position)).toBeGreaterThan(0.01);
      touch('pointercancel', 380, 220);
      const mouse = kind === 'plane' ? controls._mouseX : kind === 'planet' ? controls.pitch : controls.yaw;
      touch('pointermove', 500, 400);
      expect(kind === 'plane' ? controls._mouseX : kind === 'planet' ? controls.pitch : controls.yaw).toBe(mouse);
      player?.dispose();
      controls.dispose();
    });
  }

  it('does not invent a worker lock and requests browser exit when disposed', () => {
    const { canvas, doc, controls, engine, exitPointerLock } = setup('fly');
    canvas.requestPointerLock();
    expect(doc.pointerLockElement).toBe(null);
    engine.applyInputFrame({ pointerLocked: true });
    controls.dispose();
    expect(exitPointerLock).toHaveBeenCalledTimes(1);
  });

  it('handles unsupported, throwing and rejected lock requests', async () => {
    requestMouseLock({});
    requestMouseLock({ requestPointerLock() { throw new Error('denied'); } });
    requestMouseLock({ requestPointerLock: () => Promise.reject(new Error('denied')) });
    await Promise.resolve();
  });
});
