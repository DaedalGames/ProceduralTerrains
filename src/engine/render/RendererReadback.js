import { exportError } from '../../export/ExportDiagnostics.js';
import { captureRendererState } from '../../runtime/resources/RendererState.js';

/**
 * Backend-neutral render-target readback. WebGLRenderer accepts a caller-owned
 * buffer while the universal renderer returns one, so callers use this single
 * async contract and never force a synchronous GPU read during export.
 */
export async function readRenderTargetPixelsAsync(
  renderer,
  renderTarget,
  x,
  y,
  width,
  height,
  buffer = null,
  { textureIndex = 0, faceIndex = 0 } = {},
) {
  if (!renderer || !renderTarget) throw new Error('Renderer and render target are required');
  if (renderer.isWebGLRenderer) {
    const output = buffer || new Uint8Array(width * height * 4);
    if (typeof renderer.readRenderTargetPixelsAsync === 'function') {
      try {
        if (renderer.getContext?.()?.isContextLost?.()) throw new Error('Graphics context is lost');
        const gl = renderer.getContext?.();
        const pack = gl?.PIXEL_PACK_BUFFER_BINDING
          ? gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)
          : undefined;
        const pending = renderer.readRenderTargetPixelsAsync(
          renderTarget,
          x,
          y,
          width,
          height,
          output,
          faceIndex,
          textureIndex,
        );
        // Three r185 leaves its async readback buffer bound while waiting on
        // the fence. The host must be able to submit another frame/readback.
        if (pack !== undefined) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack);
        await pending;
      } catch (reason) {
        const error = exportError(
          reason,
          'GPU readback failed without an error message (the graphics device may have been lost)',
        );
        error.code ||= 'GPU_READBACK_FAILED';
        throw error;
      }
    } else {
      renderer.readRenderTargetPixels(renderTarget, x, y, width, height, output, faceIndex);
    }
    return output;
  }

  if (typeof renderer.readRenderTargetPixelsAsync !== 'function') {
    throw new Error('The active renderer does not provide asynchronous target readback');
  }
  const output = await renderer.readRenderTargetPixelsAsync(
    renderTarget,
    x,
    y,
    width,
    height,
    textureIndex,
    faceIndex,
  );
  if (buffer && output !== buffer) buffer.set(output);
  return buffer || output;
}

// Restore the caller's target and free temporary GPU storage even on rejection.
export async function withExportRenderTarget(renderer, target, operation) {
  const previous = renderer.getRenderTarget();
  const restore =
    typeof renderer.getViewport === 'function'
      ? captureRendererState(renderer)
      : () => renderer.setRenderTarget(previous);
  let restored = false;
  const reset = () => {
    if (!restored) {
      restored = true;
      restore();
    }
  };
  try {
    renderer.setRenderTarget(target);
    const pending = operation();
    // GPU submission is synchronous; the fence/encoding wait must not leave
    // the temporary target installed into the caller's render loop.
    reset();
    return await pending;
  } finally {
    reset();
    target.dispose();
  }
}
