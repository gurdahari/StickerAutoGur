import type { RgbColor } from './reservedMatte';

const TRANSPARENT_ALPHA = 8;
const PARTIAL_ALPHA_LIMIT = 250;
const MIN_CHROMA_LENGTH = 18;
const MIN_AXIS_ALIGNMENT = 0.42;
const MIN_AXIS_MAGNITUDE = 12;
const WHITE_SEARCH_RADIUS = 6;

interface WhiteSample {
  index: number;
  distance: number;
  alpha: number;
  minimumChannel: number;
  channelSpread: number;
}

interface ResidualCandidate {
  position: number;
  replacementIndex: number;
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

const touchesEnclosedTransparency = (
  data: Uint8ClampedArray,
  exterior: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
) => {
  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) continue;
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      if (!offsetX && !offsetY) continue;
      const nextX = x + offsetX;
      if (nextX < 0 || nextX >= width) continue;
      const position = nextY * width + nextX;
      if (data[position * 4 + 3] <= TRANSPARENT_ALPHA && !exterior[position]) {
        return true;
      }
    }
  }
  return false;
};

const collectWhiteSamples = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  alpha: number
) => {
  const samples: WhiteSample[] = [];

  for (let radius = 1; radius <= WHITE_SEARCH_RADIUS; radius++) {
    for (let offsetY = -radius; offsetY <= radius; offsetY++) {
      const sampleY = y + offsetY;
      if (sampleY < 0 || sampleY >= height) continue;
      for (let offsetX = -radius; offsetX <= radius; offsetX++) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
        const sampleX = x + offsetX;
        if (sampleX < 0 || sampleX >= width) continue;
        const sampleIndex = (sampleY * width + sampleX) * 4;
        const sampleAlpha = source[sampleIndex + 3];
        const minimumChannel = Math.min(
          source[sampleIndex],
          source[sampleIndex + 1],
          source[sampleIndex + 2]
        );
        const channelSpread = Math.max(
          source[sampleIndex],
          source[sampleIndex + 1],
          source[sampleIndex + 2]
        ) - minimumChannel;

        if (
          sampleAlpha <= TRANSPARENT_ALPHA
          || sampleAlpha + 16 < alpha
          || minimumChannel < 200
          || channelSpread > 32
        ) {
          continue;
        }

        samples.push({
          index: sampleIndex,
          distance: offsetX * offsetX + offsetY * offsetY,
          alpha: sampleAlpha,
          minimumChannel,
          channelSpread
        });
      }
    }
    if (samples.length >= 2) break;
  }

  samples.sort((left, right) =>
    left.distance - right.distance || right.alpha - left.alpha
  );
  return samples;
};

const hasWhiteCutlineProof = (samples: WhiteSample[], alpha: number) => {
  if (samples.length >= 2) return true;
  const sample = samples[0];
  return Boolean(
    sample
    && sample.alpha + 16 >= alpha
    && sample.minimumChannel >= 225
    && sample.channelSpread <= 20
  );
};

const findEnclosedMatteAxisResiduals = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
) => {
  const source = new Uint8ClampedArray(data);
  const exterior = buildExteriorTransparency(source, width, height);
  const matteMean = (background.r + background.g + background.b) / 3;
  const matteChroma = [
    background.r - matteMean,
    background.g - matteMean,
    background.b - matteMean
  ];
  const matteChromaLength = Math.hypot(...matteChroma);
  if (matteChromaLength < 32) return [];

  const candidates: ResidualCandidate[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      const pixelIndex = position * 4;
      const alpha = source[pixelIndex + 3];
      if (
        alpha <= TRANSPARENT_ALPHA
        || alpha >= PARTIAL_ALPHA_LIMIT
        || !touchesEnclosedTransparency(source, exterior, width, height, x, y)
      ) {
        continue;
      }

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
      if (chromaLength < MIN_CHROMA_LENGTH) continue;

      const axisProjection = chroma.reduce(
        (sum, value, channel) => sum + value * matteChroma[channel],
        0
      ) / matteChromaLength;
      const alignment = Math.abs(axisProjection) / chromaLength;
      if (
        alignment < MIN_AXIS_ALIGNMENT
        || Math.abs(axisProjection) < MIN_AXIS_MAGNITUDE
      ) {
        continue;
      }

      const whiteSamples = collectWhiteSamples(source, width, height, x, y, alpha);
      if (!hasWhiteCutlineProof(whiteSamples, alpha)) continue;

      candidates.push({
        position,
        replacementIndex: whiteSamples[0].index
      });
    }
  }

  return candidates;
};

/**
 * Counts post-resize matte chroma that drifted away from the exact key around
 * enclosed transparent openings. The check is limited to locally proven white
 * cutlines, so legitimate colored artwork is not treated as technical spill.
 */
export const countEnclosedReservedMatteAxisContamination = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
) => findEnclosedMatteAxisResiduals(data, width, height, background).length;

/**
 * Repairs the broader signed matte-axis remainder left by canvas resampling.
 * Only RGB is replaced from the nearest trusted white cutline sample; alpha is
 * preserved byte-for-byte so the hole geometry and edge smoothness do not move.
 */
export const repairEnclosedReservedMatteAxisContamination = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
) => {
  const source = new Uint8ClampedArray(data);
  const candidates = findEnclosedMatteAxisResiduals(source, width, height, background);

  for (const candidate of candidates) {
    const pixelIndex = candidate.position * 4;
    data[pixelIndex] = source[candidate.replacementIndex];
    data[pixelIndex + 1] = source[candidate.replacementIndex + 1];
    data[pixelIndex + 2] = source[candidate.replacementIndex + 2];
  }

  return {
    detectedPixels: candidates.length,
    repairedPixels: candidates.length
  };
};
