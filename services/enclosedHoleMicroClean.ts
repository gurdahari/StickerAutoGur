import type { RgbColor } from './reservedMatte';

const TRANSPARENT_ALPHA = 8;
const PARTIAL_BARRIER_ALPHA = 250;
const MAX_HOLE_BAND_DEPTH = 8;
const MIN_FRINGE_CHROMA = 5;
const MIN_AXIS_ALIGNMENT = 0.28;
const MIN_AXIS_MAGNITUDE = 4;
const STRONG_WHITE_ALPHA = 168;
const STRONG_WHITE_MIN_CHANNEL = 200;
const STRONG_WHITE_MAX_SPREAD = 32;
const WHITE_PROOF_RADIUS = 10;
const COLORED_ARTWORK_RADIUS = 12;
const OPAQUE_COLORED_ARTWORK_ALPHA = 250;
const WHITE_DISTANCE_ADVANTAGE = 2;

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

const buildLimitedDistance = (
  width: number,
  height: number,
  maxDistance: number,
  isSeed: (position: number) => boolean,
  canEnter: (position: number) => boolean = () => true
) => {
  const pixelCount = width * height;
  const distance = new Uint8Array(pixelCount);
  distance.fill(255);
  const queue = new Int32Array(pixelCount);
  let start = 0;
  let end = 0;

  for (let position = 0; position < pixelCount; position++) {
    if (!isSeed(position)) continue;
    distance[position] = 0;
    queue[end++] = position;
  }

  while (start < end) {
    const position = queue[start++];
    const currentDistance = distance[position];
    if (currentDistance >= maxDistance) continue;
    const x = position % width;
    const y = Math.floor(position / width);

    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      const nextY = y + offsetY;
      if (nextY < 0 || nextY >= height) continue;
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (!offsetX && !offsetY) continue;
        const nextX = x + offsetX;
        if (nextX < 0 || nextX >= width) continue;
        const next = nextY * width + nextX;
        if (distance[next] !== 255 || !canEnter(next)) continue;
        distance[next] = currentDistance + 1;
        queue[end++] = next;
      }
    }
  }

  return distance;
};

const channelStats = (data: Uint8ClampedArray, pixelIndex: number) => {
  const minimum = Math.min(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2]);
  const maximum = Math.max(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2]);
  return { minimum, maximum, spread: maximum - minimum };
};

/**
 * Neutralizes the attached pink/green fringe that canvas resampling can spread
 * several pixels into an enclosed transparent opening. Unlike the previous
 * detached-speck pass, this walks a bounded partial-alpha band from the hole and
 * preserves alpha, so the white cutline geometry is unchanged.
 *
 * Safety comes from intersecting three independent proofs:
 *  - the pixel is reachable from enclosed transparency without crossing an
 *    opaque barrier;
 *  - its chroma lies on the verified technical matte axis (either sign);
 *  - a strong neutral-white cutline is closer than opaque colored artwork.
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

  const holeDepth = buildLimitedDistance(
    width,
    height,
    MAX_HOLE_BAND_DEPTH,
    position => source[position * 4 + 3] <= TRANSPARENT_ALPHA && !exterior[position],
    position => !exterior[position] && source[position * 4 + 3] < PARTIAL_BARRIER_ALPHA
  );

  const isStrongWhite = (position: number) => {
    const pixelIndex = position * 4;
    if (source[pixelIndex + 3] < STRONG_WHITE_ALPHA) return false;
    const stats = channelStats(source, pixelIndex);
    return stats.minimum >= STRONG_WHITE_MIN_CHANNEL && stats.spread <= STRONG_WHITE_MAX_SPREAD;
  };

  const whiteDistance = buildLimitedDistance(
    width,
    height,
    WHITE_PROOF_RADIUS,
    isStrongWhite
  );

  const coloredArtworkDistance = buildLimitedDistance(
    width,
    height,
    COLORED_ARTWORK_RADIUS,
    position => {
      const pixelIndex = position * 4;
      return source[pixelIndex + 3] >= OPAQUE_COLORED_ARTWORK_ALPHA && !isStrongWhite(position);
    }
  );

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
  const replacement = new Uint8Array(pixelCount);

  for (let position = 0; position < pixelCount; position++) {
    const bandDepth = holeDepth[position];
    if (!bandDepth || bandDepth === 255 || bandDepth > MAX_HOLE_BAND_DEPTH) continue;
    if (whiteDistance[position] > WHITE_PROOF_RADIUS) continue;
    if (whiteDistance[position] + WHITE_DISTANCE_ADVANTAGE > coloredArtworkDistance[position]) continue;

    const pixelIndex = position * 4;
    const alpha = source[pixelIndex + 3];
    if (alpha <= TRANSPARENT_ALPHA || alpha >= PARTIAL_BARRIER_ALPHA) continue;

    const red = source[pixelIndex];
    const green = source[pixelIndex + 1];
    const blue = source[pixelIndex + 2];
    const mean = (red + green + blue) / 3;
    const chroma = [red - mean, green - mean, blue - mean];
    const chromaLength = Math.hypot(...chroma);
    if (chromaLength < MIN_FRINGE_CHROMA) continue;

    const axisProjection = chroma.reduce(
      (sum, value, channel) => sum + value * matteChroma[channel],
      0
    ) / matteChromaLength;
    const alignment = Math.abs(axisProjection) / chromaLength;
    if (alignment < MIN_AXIS_ALIGNMENT || Math.abs(axisProjection) < MIN_AXIS_MAGNITUDE) continue;

    candidate[position] = 1;
    replacement[position] = Math.max(225, red, green, blue);
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let componentsCleared = 0;
  let pixelsCleared = 0;
  let effectivePixelsCleared = 0;

  for (let seed = 0; seed < pixelCount; seed++) {
    if (!candidate[seed] || visited[seed]) continue;
    componentsCleared++;
    let start = 0;
    let end = 0;
    visited[seed] = 1;
    queue[end++] = seed;

    while (start < end) {
      const position = queue[start++];
      const pixelIndex = position * 4;
      const neutral = replacement[position];
      effectivePixelsCleared += source[pixelIndex + 3] / 255;
      data[pixelIndex] = neutral;
      data[pixelIndex + 1] = neutral;
      data[pixelIndex + 2] = neutral;
      pixelsCleared++;

      const x = position % width;
      const y = Math.floor(position / width);
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
  }

  return {
    componentsCleared,
    pixelsCleared,
    effectivePixelsCleared: Number(effectivePixelsCleared.toFixed(3))
  };
};
