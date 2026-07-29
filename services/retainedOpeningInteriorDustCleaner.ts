import type { RgbColor } from './reservedMatte';

const TRANSPARENT_ALPHA = 8;
const DUST_MAX_ALPHA = 112;
const DIRECT_HOLE_RADIUS = 2;
const MAX_COMPONENT_PIXELS = 48;
const PALE_MIN_CHANNEL = 205;
const PALE_MAX_SPREAD = 38;
const MIN_MATTE_ALIGNMENT = 0.52;
const MIN_MATTE_PROJECTION = 8;
const STRONG_SUPPORT_ALPHA = 176;
const SUPPORT_RADIUS = 2;
const MAX_COMPONENT_SUPPORT_RATIO = 0.34;
const MAX_PASSES = 2;

export interface RetainedOpeningInteriorDustResult {
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

  // Eight-connectivity prevents diagonal exterior gaps from being classified as
  // enclosed openings.
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

const buildRetainedHoleMask = (
  data: Uint8ClampedArray,
  exterior: Uint8Array,
  width: number,
  height: number
) => {
  const hole = new Uint8Array(width * height);
  for (let position = 0; position < width * height; position++) {
    if (data[position * 4 + 3] <= TRANSPARENT_ALPHA && !exterior[position]) {
      hole[position] = 1;
    }
  }
  return hole;
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

const touchesRetainedHole = (
  hole: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
) => {
  for (let offsetY = -DIRECT_HOLE_RADIUS; offsetY <= DIRECT_HOLE_RADIUS; offsetY++) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) continue;
    for (let offsetX = -DIRECT_HOLE_RADIUS; offsetX <= DIRECT_HOLE_RADIUS; offsetX++) {
      if (!offsetX && !offsetY) continue;
      const nextX = x + offsetX;
      if (nextX < 0 || nextX >= width) continue;
      if (hole[nextY * width + nextX]) return true;
    }
  }
  return false;
};

const matteAxisEvidence = (
  data: Uint8ClampedArray,
  pixelIndex: number,
  background: RgbColor
) => {
  const stats = channelStats(data, pixelIndex);
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

const isPaleDust = (data: Uint8ClampedArray, pixelIndex: number) => {
  const stats = channelStats(data, pixelIndex);
  return stats.minimum >= PALE_MIN_CHANNEL && stats.spread <= PALE_MAX_SPREAD;
};

const hasStrongArtworkSupport = (
  source: Uint8ClampedArray,
  candidate: Uint8Array,
  hole: Uint8Array,
  width: number,
  height: number,
  position: number
) => {
  const x = position % width;
  const y = Math.floor(position / width);
  const pixelIndex = position * 4;
  const current = channelStats(source, pixelIndex);

  for (let offsetY = -SUPPORT_RADIUS; offsetY <= SUPPORT_RADIUS; offsetY++) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) continue;
    for (let offsetX = -SUPPORT_RADIUS; offsetX <= SUPPORT_RADIUS; offsetX++) {
      if (!offsetX && !offsetY) continue;
      const nextX = x + offsetX;
      if (nextX < 0 || nextX >= width) continue;
      const next = nextY * width + nextX;
      if (hole[next] || candidate[next]) continue;

      const nextIndex = next * 4;
      if (source[nextIndex + 3] < STRONG_SUPPORT_ALPHA) continue;
      const sample = channelStats(source, nextIndex);

      // Preserve a real soft antialiased edge when an opaque core of a similar
      // non-neutral artwork color exists immediately beside it.
      const colorDistance = Math.hypot(
        current.red - sample.red,
        current.green - sample.green,
        current.blue - sample.blue
      );
      const sampleIsColored = sample.spread > PALE_MAX_SPREAD || sample.minimum < PALE_MIN_CHANNEL;
      if (sampleIsColored && colorDistance <= 62) return true;
    }
  }

  return false;
};

const buildCandidates = (
  source: Uint8ClampedArray,
  hole: Uint8Array,
  width: number,
  height: number,
  background: RgbColor
) => {
  const candidate = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      const pixelIndex = position * 4;
      const alpha = source[pixelIndex + 3];
      if (
        alpha <= TRANSPARENT_ALPHA
        || alpha > DUST_MAX_ALPHA
        || hole[position]
        || !touchesRetainedHole(hole, width, height, x, y)
      ) {
        continue;
      }

      if (isPaleDust(source, pixelIndex) || matteAxisEvidence(source, pixelIndex, background)) {
        candidate[position] = 1;
      }
    }
  }

  return candidate;
};

/**
 * Removes only tiny low-alpha dust components beside retained enclosed openings.
 * These survivors can be almost invisible on black but become dotted pink/gray
 * dirt on white. The pass runs after all reconstruction cleaners, so it erases
 * only weak remnants that still lack a nearby matching opaque artwork core.
 *
 * It does not change QA, rejection thresholds, hole frequency or provider usage.
 */
export const clearRetainedOpeningInteriorDust = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
): RetainedOpeningInteriorDustResult => {
  let componentsCleared = 0;
  let pixelsCleared = 0;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const source = new Uint8ClampedArray(data);
    const exterior = buildExteriorTransparency(source, width, height);
    const hole = buildRetainedHoleMask(source, exterior, width, height);
    const candidate = buildCandidates(source, hole, width, height, background);
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    const accepted: number[][] = [];

    for (let seed = 0; seed < width * height; seed++) {
      if (!candidate[seed] || visited[seed]) continue;
      let start = 0;
      let end = 0;
      visited[seed] = 1;
      queue[end++] = seed;
      const positions: number[] = [];
      let supported = 0;

      while (start < end) {
        const position = queue[start++];
        positions.push(position);
        if (hasStrongArtworkSupport(source, candidate, hole, width, height, position)) {
          supported++;
        }
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

      if (
        positions.length <= MAX_COMPONENT_PIXELS
        && supported / positions.length <= MAX_COMPONENT_SUPPORT_RATIO
      ) {
        accepted.push(positions);
      }
    }

    if (!accepted.length) break;

    for (const component of accepted) {
      for (const position of component) {
        const pixelIndex = position * 4;
        data[pixelIndex] = 255;
        data[pixelIndex + 1] = 255;
        data[pixelIndex + 2] = 255;
        data[pixelIndex + 3] = 0;
        pixelsCleared++;
      }
      componentsCleared++;
    }
  }

  return { componentsCleared, pixelsCleared };
};
