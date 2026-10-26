import { DataUtils, HalfFloatType, UnsignedByteType } from 'three';

// Geographic heights have their own meter range. Never change procedural
// amplitude/frequency to accommodate a DEM: noise keeps its existing domain.
export function heightImportTransform(entry, heightScale) {
  const min = entry?.meta?.minElev;
  const max = entry?.meta?.maxElev;
  const meters = !!entry?.geoRef && entry.settings?.elevationMode === 'meters'
    && Number.isFinite(min) && Number.isFinite(max) && max >= min;
  return { meters, scale: meters ? max - min : heightScale, offset: meters ? min : 0 };
}

export function heightImportBounds(entry, heightScale) {
  const transform = heightImportTransform(entry, heightScale);
  const strength = entry?.settings?.heightStrength ?? 1;
  const offset = entry?.settings?.heightOffset ?? 0;
  const a = transform.offset * strength + offset;
  const b = (transform.offset + transform.scale) * strength + offset;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

// RGB export packing must cover geographic elevations, including below sea
// level, without reusing the noise amplitude as a ceiling.
export function heightExportRange(uniforms, heightScale) {
  const meters = (uniforms.uImportHeightMeters?.value ?? 0) > 0.5
    && (uniforms.uImportHeightMode?.value ?? 0) > 1.5
    && (uniforms.uInfiniteMode?.value ?? 0) < 0.5;
  if (!meters) return { min: 0, max: heightScale };
  const range = uniforms.uImportElevationRange.value;
  const strength = uniforms.uImportHeightStrength.value;
  const offset = uniforms.uImportHeightOffset.value;
  const a = range.x * strength + offset;
  const b = (range.x + range.y) * strength + offset;
  return { min: Math.min(0, a, b), max: Math.max(heightScale * 1.35, a, b) };
}

// CPU fallback for imported maps uses the same texel centers and half-float
// decoding as the GPU, including the residual lane of meter-height textures.
export function sampleImportedHeight(uniforms, x, z) {
  const texture = uniforms.uImportHeightTex?.value;
  const image = texture?.image;
  if (!image?.data || !image.width || !image.height) return null;
  const region = uniforms.uImportHeightRegion.value;
  const fx = Math.max(0, Math.min(image.width - 1, (x - region.x) / region.z * image.width - 0.5));
  const fy = Math.max(0, Math.min(image.height - 1, (z - region.y) / region.w * image.height - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1);
  const meters = (uniforms.uImportHeightMeters?.value ?? 0) > 0.5;
  const read = (px, py) => {
    const i = (py * image.width + px) * 4;
    const channel = (lane) => texture.type === HalfFloatType ? DataUtils.fromHalfFloat(image.data[i + lane])
      : image.data[i + lane] / (texture.type === UnsignedByteType ? 255 : 1);
    return meters ? channel(0) + channel(1) : channel(0) * 0.2126 + channel(1) * 0.7152 + channel(2) * 0.0722;
  };
  const tx = fx - x0, ty = fy - y0;
  const top = read(x0, y0) * (1 - tx) + read(x1, y0) * tx;
  const bottom = read(x0, y1) * (1 - tx) + read(x1, y1) * tx;
  let value = top * (1 - ty) + bottom * ty;
  if (meters) value = value * uniforms.uImportElevationRange.value.y + uniforms.uImportElevationRange.value.x;
  else value *= uniforms.uHeightScale.value;
  return value * uniforms.uImportHeightStrength.value + uniforms.uImportHeightOffset.value;
}
