// Mobile browsers do not offer pointer lock. Track a single touch on the
// viewport instead; joystick touches are handled by their own UI elements.
export function bindTouchLook(dom, onLook) {
  let active = null;
  const down = (event) => {
    if (event.pointerType !== 'touch' || active) return;
    active = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { dom.setPointerCapture?.(event.pointerId); } catch { /* unavailable */ }
    event.preventDefault();
  };
  const move = (event) => {
    if (!active || event.pointerId !== active.id) return;
    onLook({
      pointerType: 'touch',
      movementX: event.clientX - active.x,
      movementY: event.clientY - active.y,
    });
    active.x = event.clientX;
    active.y = event.clientY;
    event.preventDefault();
  };
  const up = (event) => {
    if (!active || event.pointerId !== active.id) return;
    active = null;
    try { dom.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
  };
  const handlers = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up, lostpointercapture: up };
  for (const [type, handler] of Object.entries(handlers)) dom.addEventListener(type, handler, { passive: false });
  return () => {
    if (active) up({ pointerId: active.id });
    for (const [type, handler] of Object.entries(handlers)) dom.removeEventListener(type, handler);
  };
}

export function requestMouseLock(dom, event) {
  if (event?.pointerType === 'touch' || (event?.button != null && event.button !== 0)) return;
  if (dom.tabIndex < 0) dom.tabIndex = 0;
  dom.focus?.({ preventScroll: true });
  try {
    dom.requestPointerLock?.()?.catch?.(() => {});
  } catch { /* unsupported or denied; let the next click retry */ }
}
