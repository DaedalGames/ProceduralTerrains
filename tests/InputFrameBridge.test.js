import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputFrameBridge } from '../src/engine/InputFrameBridge.js';

class FakeCanvas extends EventTarget {
  constructor() {
    super();
    this.setPointerCapture = vi.fn();
    this.releasePointerCapture = vi.fn();
    this.parentElement = {
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    };
  }
}

afterEach(() => vi.unstubAllGlobals());

function installBrowserGlobals() {
  const fakeDocument = new EventTarget();
  fakeDocument.visibilityState = 'visible';
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return fakeDocument;
}

function pointerEvent(type, properties) {
  return Object.assign(new Event(type, { cancelable: true }), properties);
}

describe('InputFrameBridge', () => {
  it('requests real mouse lock during a canvas click only in first-person modes', () => {
    const canvas = new FakeCanvas();
    const doc = installBrowserGlobals();
    canvas.focus = vi.fn();
    canvas.requestPointerLock = vi.fn();
    doc.exitPointerLock = vi.fn();
    const bridge = new InputFrameBridge({ canvas, send: vi.fn() });
    const click = () => canvas.dispatchEvent(pointerEvent('click', { button: 0, pointerType: 'mouse' }));
    click();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    bridge.setPointerLockEnabled(true);
    canvas.dispatchEvent(pointerEvent('click', { button: 0, pointerType: 'touch' }));
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    click();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(canvas.focus).toHaveBeenCalled();
    doc.pointerLockElement = canvas;
    bridge.setPointerLockEnabled(false);
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);
    doc.pointerLockElement = null;
    bridge.dispose();
    click();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it('forwards actual lock state, relative mouse look and Escape unlock', () => {
    const canvas = new FakeCanvas();
    const doc = installBrowserGlobals();
    const send = vi.fn();
    const bridge = new InputFrameBridge({ canvas, send });
    doc.dispatchEvent(pointerEvent('mousemove', { movementX: 50, movementY: 5 }));
    expect(bridge.pointerEvents).toEqual([]);
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(send).toHaveBeenLastCalledWith('applyInputFrame', [expect.objectContaining({ pointerLocked: true })]);
    doc.dispatchEvent(pointerEvent('mousemove', { movementX: 12, movementY: -8 }));
    bridge._flush();
    expect(send).toHaveBeenLastCalledWith('applyInputFrame', [expect.objectContaining({
      pointerLocked: true,
      pointerEvents: [expect.objectContaining({ type: 'mousemove', movementX: 12, movementY: -8 })],
    })]);
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(send).toHaveBeenLastCalledWith('applyInputFrame', [expect.objectContaining({ pointerLocked: false })]);
    bridge.dispose();
  });

  it('prevents the native context menu on the worker-backed viewport', () => {
    const canvas = new FakeCanvas();
    installBrowserGlobals();

    const bridge = new InputFrameBridge({ canvas, send: vi.fn() });
    const contextMenu = new Event('contextmenu', { cancelable: true });

    expect(canvas.dispatchEvent(contextMenu)).toBe(false);
    expect(contextMenu.defaultPrevented).toBe(true);

    bridge.dispose();
    const afterDispose = new Event('contextmenu', { cancelable: true });
    expect(canvas.dispatchEvent(afterDispose)).toBe(true);
    expect(afterDispose.defaultPrevented).toBe(false);
  });

  it('keeps a right-drag captured and suppresses its menu over an overlay', () => {
    const canvas = new FakeCanvas();
    const fakeDocument = installBrowserGlobals();
    const bridge = new InputFrameBridge({ canvas, send: vi.fn() });

    const down = pointerEvent('pointerdown', {
      button: 2,
      buttons: 2,
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 500,
      clientY: 300,
    });
    canvas.dispatchEvent(down);
    canvas.dispatchEvent(pointerEvent('pointerup', {
      button: 2,
      buttons: 0,
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 650,
      clientY: 420,
    }));

    expect(down.defaultPrevented).toBe(true);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);

    const overlayContextMenu = new Event('contextmenu', { cancelable: true });
    expect(fakeDocument.dispatchEvent(overlayContextMenu)).toBe(false);
    expect(overlayContextMenu.defaultPrevented).toBe(true);

    bridge.dispose();
  });

  it('forwards terrain shape dragover and drop events to the render worker', () => {
    const canvas = new FakeCanvas();
    installBrowserGlobals();
    const send = vi.fn();
    const bridge = new InputFrameBridge({ canvas, send });
    const dataTransfer = {
      types: ['application/x-terrain-shape'],
      dropEffect: 'none',
    };
    const dragover = Object.assign(new Event('dragover', { cancelable: true }), {
      clientX: 320,
      clientY: 240,
      dataTransfer,
    });
    const drop = Object.assign(new Event('drop', { cancelable: true }), {
      clientX: 360,
      clientY: 260,
      dataTransfer,
    });

    expect(canvas.dispatchEvent(dragover)).toBe(false);
    expect(dragover.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe('copy');
    expect(send).not.toHaveBeenCalled();

    expect(canvas.dispatchEvent(drop)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('applyInputFrame', [{
      pointerEvents: [],
      dragEvents: [
        expect.objectContaining({ type: 'dragover', clientX: 320, clientY: 240 }),
        expect.objectContaining({ type: 'drop', clientX: 360, clientY: 260 }),
      ],
      keyEvents: [],
      wheel: null,
      pointerLocked: false,
      visible: true,
    }]);

    bridge.dispose();
  });
});
