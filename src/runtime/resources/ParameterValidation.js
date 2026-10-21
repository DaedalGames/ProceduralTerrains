export function validateParameters(patch, defaults, extra = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new TypeError('Parameters must be an object');
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in defaults) && !(key in extra)) throw new TypeError(`Unknown parameter ${key}`);
    const sample = key in defaults ? defaults[key] : extra[key];
    if (typeof sample === 'number' && !Number.isFinite(value))
      throw new TypeError(`${key} must be finite`);
    if (typeof sample === 'boolean' && typeof value !== 'boolean')
      throw new TypeError(`${key} must be boolean`);
    if (typeof sample === 'string' && typeof value !== 'string')
      throw new TypeError(`${key} must be a string`);
    if (
      Array.isArray(sample) &&
      (!Array.isArray(value) ||
        value.length !== sample.length ||
        value.some((v) => !Number.isFinite(v)))
    )
      throw new TypeError(`Invalid ${key}`);
  }
}
