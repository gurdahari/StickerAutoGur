import type { RgbColor } from './reservedMatte';

const TRANSPARENT_ALPHA = 8;
const MAX_HAZE_ALPHA = 184;
const STRONG_ARTWORK_ALPHA = 208;
const MIN_COMPONENT_PIXELS = 6;
const MAX_COMPONENT_AREA_RATIO = 0.006;
const MAX_COMPONENT_PIXELS = 8000;
const MAX_COMPONENT_DIMENSION_RATIO = 0.18;
const MAX_AVERAGE_ALPHA = 140;
const MIN_RESIDUE_RATIO = 0.34;
const MIN_RETAINED_BOUNDARY_SAMPLES = 6;
const PALE_MIN_CHANNEL = 184;
const PALE_MAX_SPREAD = 72;
const MIN_MATTE_ALIGNMENT = 0.42;
const MIN_MATTE_PROJECTION = 6;

export interface DetachedOpeningHazeResult {
  componentsCleared: number;
  pixelsCleared: number;
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

    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      const nextY = y + offsetY;
      if (nextY < 0 || nextY >= height) continue;
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (!offsetX && !offsetY) continue;
        const nextX = x + offsetX;
        if (nextX < 0 || nextX >= width) continue;
        enqueue(nextY * width + nextX);
      }
    }
  }

  return exterior;
};

const channelStats = (data: Uint8ClampedArray, pixelIndex: number) => {
  const red = data[pixelIndex];
  const green = data[pixelIndex + 1];
  const blue = data[pixelIndex + 2];
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  return {
    red,
    green,
    blue,
    mean: (red + green + blue) / 3,
    minimum,
    spread: maximum - minimum
  };
};

const hasResidueColorEvidence = (
  data: Uint8ClampedArray,
  pixelIndex: number,
  background: RgbColor
) => {
  const stats = channelStats(data, pixelIndex);
  if (stats.minimum >= PALE_MIN_CHANNEL && stats.spread <= PALE_MAX_SPREAD) {
    return true;
  }

  const pixelChroma = [
    stats.red - stats.mean,
    stats.green - stats.mean,
    stats.blue - stats.mean
  ];
  const matteMean = (background.r + background.g + background.b) / 3;
  const matteChroma = [
    background.r - matteMean,
    background.g - matteMean,
    background.b - matteMean
  ];
  const pixelLength = Math.hypot(...pixelChroma);
  const matteLength = Math.hypot(...matteChroma);
  if (pixelLength < 1 || matteLength < 32) return false;

  const projection = pixelChroma.reduce(
    (sum, value, channel) => sum + value * matteChroma[channel],
    0
  ) / matteLength;
  const alignment = Math.abs(projection) / pixelLength;
  return alignment >= MIN_MATTE_ALIGNMENT && Math.abs(projection) >= MIN_MATTE_PROJECTION;
};

/**
 * Removes detached, low-alpha haze islands that float inside an otherwise valid
 * enclosed opening. These islands can be much larger than ordinary edge dust,
 * so the tiny-component fringe cleaner deliberately leaves them behind.
 *
 * Safety is topology-first:
 *  - the complete visible component must be surrounded by retained enclosed
 *    transparency rather than exterior transparency;
 *  - it must have no contact with a strong opaque artwork core;
 *  - it must remain low-alpha, spatially bounded and mostly pale/matte-like.
 *
 * This is local bitmap cleanup only. It does not change QA, rejects, prompts,
 * hole frequency or provider usage.
 */
export const clearDetachedOpeningHaze = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
): DetachedOpeningHazeResult => {
  const source = new Uint8ClampedArray(data);
  const pixelCount = width * height;
  const exterior = buildExteriorTransparency(source, width, height);
  const candidate = new Uint8Array(pixelCount);

  for (let position = 0; position < pixelCount; position++) {
    const alpha = source[position * 4 + 3];
    if (alpha > TRANSPARENT_ALPHA && alpha <= MAX_HAZE_ALPHA) {
      candidate[position] = 1;
    }
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const accepted: number[][] = [];
  const adaptiveMaxPixels = Math.max(
    96,
    Math.min(MAX_COMPONENT_PIXELS, Math.round(pixelCount * MAX_COMPONENT_AREA_RATIO))
  );
  const maxDimension = Math.max(
    16,
    Math.round(Math.min(width, height) * MAX_COMPONENT_DIMENSION_RATIO)
  );

  for (let seed = 0; seed < pixelCount; seed++) {
    if (!candidate[seed] || visited[seed]) continue;

    let start = 0;
    let end = 0;
    visited[seed] = 1;
    queue[end++] = seed;
    const positions: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let alphaSum = 0;
    let residuePixels = 0;
    let retainedBoundarySamples = 0;
    let exteriorBoundarySamples = 0;
    let touchesStrongArtwork = false;
    let touchesCanvas = false;

    while (start < end) {
      const position = queue[start++];
      positions.push(position);
      const x = position % width;
      const y = Math.floor(position / width);
      const pixelIndex = position * 4;
      alphaSum += source[pixelIndex + 3];
      if (hasResidueColorEvidence(source, pixelIndex, background)) residuePixels++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const nextY = y + offsetY;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
            touchesCanvas = true;
            continue;
          }

          const next = nextY * width + nextX;
          if (candidate[next]) {
            if (!visited[next]) {
              visited[next] = 1;
              queue[end++] = next;
            }
            continue;
          }

          const nextAlpha = source[next * 4 + 3];
          if (nextAlpha <= TRANSPARENT_ALPHA) {
            if (exterior[next]) exteriorBoundarySamples++;
            else retainedBoundarySamples++;
          } else if (nextAlpha >= STRONG_ARTWORK_ALPHA) {
            touchesStrongArtwork = true;
          }
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const averageAlpha = alphaSum / positions.length;
    const residueRatio = residuePixels / positions.length;

    if (
      positions.length < MIN_COMPONENT_PIXELS
      || positions.length > adaptiveMaxPixels
      || Math.max(componentWidth, componentHeight) > maxDimension
      || averageAlpha > MAX_AVERAGE_ALPHA
      || residueRatio < MIN_RESIDUE_RATIO
      || retainedBoundarySamples < MIN_RETAINED_BOUNDARY_SAMPLES
      || exteriorBoundarySamples > 0
      || touchesStrongArtwork
      || touchesCanvas
    ) {
      continue;
    }

    accepted.push(positions);
  }

  let pixelsCleared = 0;
  for (const component of accepted) {
    for (const position of component) {
      const pixelIndex = position * 4;
      data[pixelIndex] = 255;
      data[pixelIndex + 1] = 255;
      data[pixelIndex + 2] = 255;
      data[pixelIndex + 3] = 0;
      pixelsCleared++;
    }
  }

  return {
    componentsCleared: accepted.length,
    pixelsCleared
  };
};
