import { Color, Vector4 } from 'three';

/** Preserve host state around every optional GPU pass, including failure. */
export function captureRendererState(renderer) {
  const gl = renderer.getContext?.();
  const packBuffer = gl?.PIXEL_PACK_BUFFER_BINDING
    ? gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)
    : undefined;
  const target = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace?.() ?? 0;
  const mip = renderer.getActiveMipmapLevel?.() ?? 0;
  const viewport = renderer.getViewport(new Vector4());
  const scissor = renderer.getScissor(new Vector4());
  const scissorTest = renderer.getScissorTest();
  const color = renderer.getClearColor(new Color());
  const alpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  const xr = renderer.xr?.enabled;
  const shadow = renderer.shadowMap?.autoUpdate;
  return () => {
    renderer.setRenderTarget(target, face, mip);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
    renderer.setClearColor(color, alpha);
    renderer.autoClear = autoClear;
    if (packBuffer !== undefined) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packBuffer);
    if (renderer.xr) renderer.xr.enabled = xr;
    if (renderer.shadowMap) renderer.shadowMap.autoUpdate = shadow;
  };
}

export function withRendererState(renderer, task) {
  const restore = captureRendererState(renderer);
  try {
    const result = task();
    if (result?.then) return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}
