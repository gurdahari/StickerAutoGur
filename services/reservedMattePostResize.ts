import type { RgbColor } from './reservedMatte';
import {
  clearMinorDetachedEnclosedHoleChroma,
  neutralizeNearWhiteEnclosedHoleStripResiduals
} from './enclosedHoleMicroClean';
import { neutralizeSmallEnclosedHoleColorIslands } from './enclosedHoleIslandNeutralizer';
import { neutralizeAcuteEnclosedHoleCornerChroma } from './acuteEnclosedHoleCornerCleaner';

const TRANSPARENT_ALPHA = 8;
const PARTIAL_ALPHA_LIMIT = 250;
const MIN_CHROMA_LENGTH = 18;
const MIN_AXIS_ALIGNMENT = 0.42;
const MIN_AXIS_MAGNITUDE = 12;
const WHITE_SEARCH_RADIUS = 6;

export const MAX_MINOR_MATTE_AXIS_PIXELS = 48;
export const MAX_MINOR_MATTE_AXIS_EFFECTIVE_PIXELS = 32;
export const MAX_MINOR_MATTE_AXIS_ALPHA = 224;

interface WhiteSample {
  index: number;
  distance: number;
  alpha: number;
  minimumChannel: number;
  channelSpread: number;
}

interface ResidualCandidate {
  position: number;
  replacementValue: number;
}

export interface ReservedMatteAxisContaminationMeasurement {
  pixelCount: number;
  effectivePixels: number;
  maxAlpha: number;
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

      const sampleIndex = whiteSamples[0].index;
      const replacementValue = Math.max(
        225,
        source[sampleIndex],
        source[sampleIndex + 1],
        source[sampleIndex + 2]
      );
      candidates.push({ position, replacementValue });
    }
  }

  return candidates;
};

export const measureEnclosedReservedMatteAxisContamination = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
): ReservedMatteAxisContaminationMeasurement => {
  const candidates = findEnclosedMatteAxisResiduals(data, width, height, background);
  let alphaMass = 0;
  let maxAlpha = 0;

  for (const candidate of candidates) {
    const alpha = data[candidate.position * 4 + 3];
    alphaMass += alpha / 255;
    maxAlpha = Math.max(maxAlpha, alpha);
  }

  return {
    pixelCount: candidates.length,
    effectivePixels: Number(alphaMass.toFixed(3)),
    maxAlpha
  };
};

export const isMinorEnclosedReservedMatteAxisContamination = (
  measurement: ReservedMatteAxisContaminationMeasurement
) => measurement.pixelCount > 0
  && measurement.pixelCount <= MAX_MINOR_MATTE_AXIS_PIXELS
  && measurement.effectivePixels <= MAX_MINOR_MATTE_AXIS_EFFECTIVE_PIXELS
  && measurement.maxAlpha <= MAX_MINOR_MATTE_AXIS_ALPHA;

/**
 * Returns only blocking post-resize matte-axis contamination. A tiny amount of
 * low-opacity fringe around a locally proven enclosed white cutline is treated
 * as a cosmetic warning, not as a reason to buy a completely new image. Exact
 * key contamination remains governed by the separate zero-tolerance guard.
 */
export const countEnclosedReservedMatteAxisContamination = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
) => {
  const measurement = measureEnclosedReservedMatteAxisContamination(data, width, height, background);
  return isMinorEnclosedReservedMatteAxisContamination(measurement) ? 0 : measurement.pixelCount;
};

/**
 * Repairs the broader signed matte-axis remainder left by canvas resampling.
 * A trusted cutline sample supplies brightness, but the output is made exactly
 * neutral before writing. Copying a slightly tinted witness can reintroduce the
 * same technical matte direction and make a clean repair fail its own check.
 * Alpha is preserved byte-for-byte, so geometry never changes.
 */
export const repairEnclosedReservedMatteAxisContamination = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
) => {
  const candidates = findEnclosedMatteAxisResiduals(data, width, height, background);

  for (const candidate of candidates) {
    const pixelIndex = candidate.position * 4;
    data[pixelIndex] = candidate.replacementValue;
    data[pixelIndex + 1] = candidate.replacementValue;
    data[pixelIndex + 2] = candidate.replacementValue;
  }

  // Keep the broad attached-fringe pass first. The strip, island and acute-tip
  // passes are conservative survivors-only cleanup. Every pass preserves alpha.
  clearMinorDetachedEnclosedHoleChroma(data, width, height, background);
  neutralizeNearWhiteEnclosedHoleStripResiduals(data, width, height, background);
  neutralizeSmallEnclosedHoleColorIslands(data, width, height);
  neutralizeAcuteEnclosedHoleCornerChroma(data, width, height, background);

  return {
    detectedPixels: candidates.length,
    repairedPixels: candidates.length
  };
};
