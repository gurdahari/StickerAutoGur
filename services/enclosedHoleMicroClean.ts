import type { RgbColor } from './reservedMatte';

const TRANSPARENT_ALPHA = 8;
const MAX_SPECK_ALPHA = 112;
const MIN_SPECK_CHROMA = 5;
const MIN_AXIS_ALIGNMENT = 0.22;
const MIN_AXIS_MAGNITUDE = 2.5;
const OPAQUE_ANCHOR_ALPHA = 168;
const OPAQUE_ANCHOR_RADIUS = 3;
const MAX_COMPONENT_PIXELS = 320;
const MAX_COMPONENT_EFFECTIVE_PIXELS = 40;
const MIN_HOLE_TOUCH_RATIO = 0.2;
const MAX_DENSE_FILL_RATIO = 0.35;
const MAX_THIN_COMPONENT_SIZE = 8;

export interface EnclosedHoleMicroCleanResult {
  componentsCleared: number;
  pixelsCleared: number;
  effectivePixelsCleared: number;
}

const buildExteriorTransparency = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const pixelCount = width * height;
  const exterior = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let start = 0;
  let end = 0;

  const enqueue = (position: number) => {
    if (position < 0 || position >= pixelCount || exterior[position]) return;
    if (data[position * 4 + 3] > TRANSPARENT_ALPHA) return;
    exterior[position] = 1;
    queue[end++] = position;
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (start < end) {
    const position = queue[start++];
    const x = position % width;
    const y = Math.floor(position / width);
    if (x > 0) enqueue(position - 1);
    if (x + 1 < width) enqueue(position + 1);
    if (y > 0) enqueue(position - width);
    if (y + 1 < height) enqueue(position + width);
  }

  return exterior;
};

const transparencyContact = (
  data: Uint8ClampedArray,
  exterior: Uint8Array,
  width: number,
  height: number,
  position: number
) => {
  const x = position % width;
  const y = Math.floor(position / width);
  let enclosed = false;
  let outside = false;

  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) continue;
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      if (!offsetX && !offsetY) continue;
      const nextX = x + offsetX;
      if (nextX < 0 || nextX >= width) continue;
      const next = nextY * width + nextX;
      if (data[next * 4 + 3] > TRANSPARENT_ALPHA) continue;
      if (exterior[next]) outside = true;
      else enclosed = true;
    }
  }

  return { enclosed, outside };
};

const hasOpaqueAnchor = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  positions: number[]
) => {
  for (const position of positions) {
    const x = position % width;
    const y = Math.floor(position / width);
    for (let offsetY = -OPAQUE_ANCHOR_RADIUS; offsetY <= OPAQUE_ANCHOR_RADIUS; offsetY++) {
      const nextY = y + offsetY;
      if (nextY < 0 || nextY >= height) continue;
      for (let offsetX = -OPAQUE_ANCHOR_RADIUS; offsetX <= OPAQUE_ANCHOR_RADIUS; offsetX++) {
        const nextX = x + offsetX;
        if (nextX < 0 || nextX >= width) continue;
        if (data[(nextY * width + nextX) * 4 + 3] >= OPAQUE_ANCHOR_ALPHA) return true;
      }
    }
  }
  return false;
};

/**
 * Removes only faint, detached matte-colored traces floating inside an enclosed
 * transparent opening. This is deliberately narrower than the normal edge
 * repair: candidates must be low-alpha, matte-axis aligned, surrounded by the
 * enclosed hole and separated from any opaque artwork edge.
 *
 * Accepted components are made fully transparent. Hidden RGB is reset to white
 * so later resampling cannot revive a pink/green line from transparent pixels.
 */
export const clearMinorDetachedEnclosedHoleChroma = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
): EnclosedHoleMicroCleanResult => {
  const source = new Uint8ClampedArray(data);
  const pixelCount = width * height;
  const exterior = buildExteriorTransparency(source, width, height);
  const matteMean = (background.r + background.g + background.b) / 3;
  const matteChroma = [
    background.r - matteMean,
    background.g - matteMean,
    background.b - matteMean
  ];
  const matteChromaLength = Math.hypot(...matteChroma);
  if (matteChromaLength < 32) {
    return { componentsCleared: 0, pixelsCleared: 0, effectivePixelsCleared: 0 };
  }

  const candidate = new Uint8Array(pixelCount);
  for (let position = 0; position < pixelCount; position++) {
    const pixelIndex = position * 4;
    const alpha = source[pixelIndex + 3];
    if (alpha <= TRANSPARENT_ALPHA || alpha > MAX_SPECK_ALPHA) continue;

    const mean = (
      source[pixelIndex]
      + source[pixelIndex + 1]
      + source[pixelIndex + 2]
    ) / 3;
    const chroma = [
      source[pixelIndex] - mean,
      source[pixelIndex + 1] - mean,
      source[pixelIndex + 2] - mean
    ];
    const chromaLength = Math.hypot(...chroma);
    if (chromaLength < MIN_SPECK_CHROMA) continue;

    const axisProjection = chroma.reduce(
      (sum, value, channel) => sum + value * matteChroma[channel],
      0
    ) / matteChromaLength;
    const alignment = Math.abs(axisProjection) / chromaLength;
    if (alignment < MIN_AXIS_ALIGNMENT || Math.abs(axisProjection) < MIN_AXIS_MAGNITUDE) continue;
    candidate[position] = 1;
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const accepted: number[][] = [];

  for (let seed = 0; seed < pixelCount; seed++) {
    if (!candidate[seed] || visited[seed]) continue;
    let start = 0;
    let end = 0;
    visited[seed] = 1;
    queue[end++] = seed;
    const positions: number[] = [];
    let alphaMass = 0;
    let maxAlpha = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let enclosedTouches = 0;
    let outsideTouches = 0;

    while (start < end) {
      const position = queue[start++];
      positions.push(position);
      const x = position % width;
      const y = Math.floor(position / width);
      const alpha = source[position * 4 + 3];
      alphaMass += alpha / 255;
      maxAlpha = Math.max(maxAlpha, alpha);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const contact = transparencyContact(source, exterior, width, height, position);
      if (contact.enclosed) enclosedTouches++;
      if (contact.outside) outsideTouches++;

      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (!candidate[next] || visited[next]) continue;
          visited[next] = 1;
          queue[end++] = next;
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const fillRatio = positions.length / Math.max(1, componentWidth * componentHeight);
    const thinOrSparse = Math.min(componentWidth, componentHeight) <= MAX_THIN_COMPONENT_SIZE
      || fillRatio <= MAX_DENSE_FILL_RATIO;
    const holeTouchRatio = enclosedTouches / positions.length;

    if (
      positions.length > MAX_COMPONENT_PIXELS
      || alphaMass > MAX_COMPONENT_EFFECTIVE_PIXELS
      || maxAlpha > MAX_SPECK_ALPHA
      || outsideTouches > 0
      || holeTouchRatio < MIN_HOLE_TOUCH_RATIO
      || !thinOrSparse
      || hasOpaqueAnchor(source, width, height, positions)
    ) {
      continue;
    }

    accepted.push(positions);
  }

  let pixelsCleared = 0;
  let effectivePixelsCleared = 0;
  for (const component of accepted) {
    for (const position of component) {
      const pixelIndex = position * 4;
      effectivePixelsCleared += source[pixelIndex + 3] / 255;
      data[pixelIndex] = 255;
      data[pixelIndex + 1] = 255;
      data[pixelIndex + 2] = 255;
      data[pixelIndex + 3] = 0;
      pixelsCleared++;
    }
  }

  return {
    componentsCleared: accepted.length,
    pixelsCleared,
    effectivePixelsCleared: Number(effectivePixelsCleared.toFixed(3))
  };
};
