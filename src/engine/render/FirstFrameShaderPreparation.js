// Keep first-use programs out of a live frame. Compile all independent passes
// before awaiting any of them so the driver can link them in parallel.
export class FirstFrameShaderPreparation {
  cancel() { this.state = null; }

  request(passes, { renderer, compile, isCurrent = () => true }) {
    const key = JSON.stringify([renderer.outputColorSpace, renderer.toneMapping,
      passes.map(({ material, source, renderTarget }) => [material.id, material.version,
        !!source?.isInstancedMesh, !!source?.instanceColor,
        Object.keys(source?.geometry?.attributes || {}).sort(),
        renderTarget ? [renderTarget.texture?.colorSpace, renderTarget.texture?.type,
          renderTarget.texture?.format, renderTarget.samples || 0] : 'canvas'])]);
    const targets = passes.map(pass => pass.renderTarget);
    const previous = this.state;
    const samePendingTargets = !previous?.pending || targets.every((target, index) => target === previous.targets[index]);
    if (previous?.renderer === renderer && previous.key === key && !previous.aborted && samePendingTargets) return previous;
    const state = { key, renderer, targets, pending: true, ready: false, aborted: false, error: null };
    this.state = state;
    const current = () => this.state === state && isCurrent();
    state.promise = Promise.all(passes.map(pass => Promise.resolve().then(() => compile(pass, current)))).then(results => {
      state.aborted = !current() || results.some(result => result?.aborted);
      state.ready = !state.aborted && results.every(result => result?.ready === true);
      if (!state.ready && !state.aborted) state.error = results.find(result => result?.error)?.error
        || new Error('First-frame shaders did not become ready');
      return state;
    }).catch(error => {
      state.aborted = !current();
      if (!state.aborted) state.error = error;
      return state;
    }).finally(() => { state.pending = false; });
    return state;
  }
}
