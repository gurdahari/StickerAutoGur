export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const RESERVED_MATTE_KEYS: RgbColor[] = [
  { r: 0, g: 255, b: 59 },
  { r: 255, g: 0, b: 212 },
  { r: 0, g: 229, b: 255 },
  { r: 255, g: 90, b: 0 }
];

const STRICT_MATTE_DISTANCE = 48;
const EXTERIOR_MATTE_DISTANCE = 88;
const EDGE_DEPTH = 3;

const median = (values: number[]) => {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] || 0;
};

const colorDistance = (left: RgbColor, right: RgbColor) => {
  const red = left.r - right.r;
  const green = left.g - right.g;
  const blue = left.b - right.b;
  return Math.sqrt(red * red + green * green + blue * blue);
};

/**
 * Verifies that every corner contains the same known technical key. A vivid
 * color elsewhere in the image is never enough to enable enclosed removal.
 */
export const inspectStickerBackground = (data: Uint8ClampedArray, width: number, height: number) => {
  const sampleSize = Math.max(3, Math.floor(Math.min(width, height) * 0.018));
  const corners = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize]
  ];
  const cornerSamples: RgbColor[][] = [];

  for (const [startX, startY] of corners) {
    const samples: RgbColor[] = [];
    for (let y = startY; y < startY + sampleSize; y += 2) {
      for (let x = startX; x < startX + sampleSize; x += 2) {
        const index = (y * width + x) * 4;
        if (data[index + 3] === 0) continue;
        samples.push({ r: data[index], g: data[index + 1], b: data[index + 2] });
      }
    }
    cornerSamples.push(samples);
  }

  const allSamples = cornerSamples.flat();
  const background = {
    r: median(allSamples.map(sample => sample.r)),
    g: median(allSamples.map(sample => sample.g)),
    b: median(allSamples.map(sample => sample.b))
  };
  const reservedKey = RESERVED_MATTE_KEYS
    .map(key => ({ key, distance: colorDistance(background, key) }))
    .sort((left, right) => left.distance - right.distance)[0];
  const hasStableReservedMatte = Boolean(
    reservedKey
    && reservedKey.distance <= 62
    && cornerSamples.every(samples => {
      if (samples.length < 8) return false;
      const cornerMedian = {
        r: median(samples.map(sample => sample.r)),
        g: median(samples.map(sample => sample.g)),
        b: median(samples.map(sample => sample.b))
      };
      const matchingSamples = samples.filter(sample => colorDistance(sample, reservedKey.key) <= 72);
      return colorDistance(cornerMedian, reservedKey.key) <= 62
        && matchingSamples.length / samples.length >= 0.82;
    })
  );

  return { background, hasStableReservedMatte };
};

/**
 * Converts a verified technical matte into transparency before any resize.
 *
 * The edge color generated against a solid matte is a composite:
 *
 *   observed = foreground × coverage + matte × (1 − coverage)
 *
 * A clean foreground core is selected only beyond the transition band, then
 * the equation is solved against that verified endpoint. If a thin feature has
 * no safe core, deterministic color-to-alpha is used as a no-chroma fallback.
 */
export const extractVerifiedReservedMatte = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
) => {
  const pixelCount = width * height;
  if (!pixelCount || data.length < pixelCount * 4) {
    return { removedPixels: 0, correctedEdgePixels: 0 };
  }

  const source = new Uint8ClampedArray(data);
  const matte = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  const distanceFromMatte = (pixelIndex: number) => Math.hypot(
    source[pixelIndex] - background.r,
    source[pixelIndex + 1] - background.g,
    source[pixelIndex + 2] - background.b
  );

  const enqueueExterior = (position: number) => {
    if (position < 0 || position >= pixelCount || matte[position]) return;
    const pixelIndex = position * 4;
    if (
      source[pixelIndex + 3] > 8
      && distanceFromMatte(pixelIndex) > EXTERIOR_MATTE_DISTANCE
    ) {
      return;
    }
    matte[position] = 1;
    queue[queueEnd++] = position;
  };

  for (let x = 0; x < width; x++) {
    enqueueExterior(x);
    enqueueExterior((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueueExterior(y * width);
    enqueueExterior(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const position = queue[queueStart++];
    const x = position % width;
    const y = Math.floor(position / width);
    if (x > 0) enqueueExterior(position - 1);
    if (x + 1 < width) enqueueExterior(position + 1);
    if (y > 0) enqueueExterior(position - width);
    if (y + 1 < height) enqueueExterior(position + width);
  }

  // Exact-key components that are not connected to the canvas edge are real
  // enclosed openings. A very large second matte region is treated as a failed
  // provider result instead of being removed speculatively.
  const enclosed: number[] = [];
  for (let position = 0; position < pixelCount; position++) {
    if (matte[position]) continue;
    const pixelIndex = position * 4;
    if (
      source[pixelIndex + 3] > 8
      && distanceFromMatte(pixelIndex) <= STRICT_MATTE_DISTANCE
    ) {
      enclosed.push(position);
    }
  }
  if (enclosed.length <= pixelCount * 0.35) {
    for (const position of enclosed) matte[position] = 1;
  }

  let removedPixels = 0;
  for (let position = 0; position < pixelCount; position++) {
    if (!matte[position]) continue;
    const pixelIndex = position * 4;
    data[pixelIndex] = 255;
    data[pixelIndex + 1] = 255;
    data[pixelIndex + 2] = 255;
    if (data[pixelIndex + 3] > 0) removedPixels++;
    data[pixelIndex + 3] = 0;
  }

  // Build a short spatial transition around exterior and enclosed matte using
  // the original, unmodified source. Strong contamination is allowed farther
  // into the edge; clean foreground is left untouched.
  const edgeDistance = new Uint8Array(pixelCount);
  queueStart = 0;
  queueEnd = 0;
  for (let position = 0; position < pixelCount; position++) {
    if (matte[position]) queue[queueEnd++] = position;
  }
  while (queueStart < queueEnd) {
    const position = queue[queueStart++];
    const currentDistance = edgeDistance[position];
    if (currentDistance >= EDGE_DEPTH) continue;
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
        if (matte[next] || edgeDistance[next]) continue;
        edgeDistance[next] = currentDistance + 1;
        queue[queueEnd++] = next;
      }
    }
  }

  const matteChannels = [background.r, background.g, background.b].map(channel => channel / 255);
  const maxCoverageByDepth = [0, 0.999, 0.96, 0.82];
  let correctedEdgePixels = 0;

  for (let position = 0; position < pixelCount; position++) {
    const depth = edgeDistance[position];
    if (!depth || depth > EDGE_DEPTH) continue;
    const pixelIndex = position * 4;
    if (source[pixelIndex + 3] <= 8) continue;

    const observed = [
      source[pixelIndex] / 255,
      source[pixelIndex + 1] / 255,
      source[pixelIndex + 2] / 255
    ];
    let coverage = 0;
    for (let channel = 0; channel < 3; channel++) {
      const value = observed[channel];
      const matteValue = matteChannels[channel];
      const requiredCoverage = value > matteValue
        ? (value - matteValue) / Math.max(1 / 255, 1 - matteValue)
        : (matteValue - value) / Math.max(1 / 255, matteValue);
      coverage = Math.max(coverage, requiredCoverage);
    }
    coverage = Math.max(0, Math.min(1, coverage));

    // Resolve the otherwise underdetermined foreground from pixels that are
    // spatially beyond the whole matte transition. A contaminated midpoint can
    // never become a sample, which was the failure mode of the old local picker.
    const x = position % width;
    const y = Math.floor(position / width);
    let bestForeground: [number, number, number] | null = null;
    let bestCoverage = coverage;
    let bestResidual = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let radius = 1; radius <= 10; radius++) {
      for (let offsetY = -radius; offsetY <= radius; offsetY++) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= height) continue;
        for (let offsetX = -radius; offsetX <= radius; offsetX++) {
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
          const sampleX = x + offsetX;
          if (sampleX < 0 || sampleX >= width) continue;
          const samplePosition = sampleY * width + sampleX;
          if (matte[samplePosition] || edgeDistance[samplePosition]) continue;
          const sampleIndex = samplePosition * 4;
          if (
            source[sampleIndex + 3] <= 8
            || distanceFromMatte(sampleIndex) <= EXTERIOR_MATTE_DISTANCE
          ) {
            continue;
          }

          const foreground: [number, number, number] = [
            source[sampleIndex] / 255,
            source[sampleIndex + 1] / 255,
            source[sampleIndex + 2] / 255
          ];
          const vector = foreground.map((value, channel) => value - matteChannels[channel]);
          const vectorLengthSquared = vector.reduce((sum, value) => sum + value * value, 0);
          if (vectorLengthSquared < 0.02) continue;

          const observedVector = observed.map((value, channel) => value - matteChannels[channel]);
          const projectedCoverage = observedVector.reduce(
            (sum, value, channel) => sum + value * vector[channel],
            0
          ) / vectorLengthSquared;
          if (projectedCoverage < 0.01 || projectedCoverage > 1.01) continue;
          const candidateCoverage = Math.max(0, Math.min(1, projectedCoverage));
          const residual = Math.hypot(...observed.map((value, channel) => (
            value
            - (
              matteChannels[channel] * (1 - candidateCoverage)
              + foreground[channel] * candidateCoverage
            )
          ) * 255));
          const spatialDistance = offsetX * offsetX + offsetY * offsetY;

          if (
            residual < bestResidual - 0.5
            || (Math.abs(residual - bestResidual) <= 0.5 && spatialDistance < bestDistance)
          ) {
            bestForeground = foreground;
            bestCoverage = candidateCoverage;
            bestResidual = residual;
            bestDistance = spatialDistance;
          }
        }
      }
      if (bestForeground && bestResidual <= 24) break;
    }

    if (bestForeground && bestResidual <= 24) coverage = bestCoverage;
    if (coverage >= maxCoverageByDepth[depth]) continue;

    if (coverage <= 1 / 255) {
      data[pixelIndex] = 255;
      data[pixelIndex + 1] = 255;
      data[pixelIndex + 2] = 255;
      data[pixelIndex + 3] = 0;
      correctedEdgePixels++;
      continue;
    }

    for (let channel = 0; channel < 3; channel++) {
      const recovered = bestForeground && bestResidual <= 24
        ? bestForeground[channel]
        : (
          observed[channel]
          - (1 - coverage) * matteChannels[channel]
        ) / coverage;
      data[pixelIndex + channel] = Math.round(Math.max(0, Math.min(1, recovered)) * 255);
    }
    data[pixelIndex + 3] = Math.round(source[pixelIndex + 3] * coverage);
    correctedEdgePixels++;
  }

  return { removedPixels, correctedEdgePixels };
};

/**
 * Final deterministic guard for the verified key only. This is intentionally
 * not a generic green/cyan scan: it checks the measured matte color and only
 * on visible pixels touching transparency after normalization.
 */
const findReservedMatteEdgeContamination = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
) => {
  const positions: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      const pixelIndex = position * 4;
      if (data[pixelIndex + 3] <= 8) continue;
      const distance = Math.hypot(
        data[pixelIndex] - background.r,
        data[pixelIndex + 1] - background.g,
        data[pixelIndex + 2] - background.b
      );
      if (distance > 80) continue;

      let touchesTransparency = false;
      for (let offsetY = -1; offsetY <= 1 && !touchesTransparency; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          if (data[(nextY * width + nextX) * 4 + 3] <= 8) {
            touchesTransparency = true;
            break;
          }
        }
      }
      if (touchesTransparency) positions.push(position);
    }
  }

  return positions;
};

export const countReservedMatteEdgeContamination = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
) => findReservedMatteEdgeContamination(data, width, height, background).length;

/**
 * Repairs only a tiny post-resize remainder of the already verified matte.
 *
 * Resampling can leave a handful of visible RGB pixels next to transparency
 * even after the source matte was extracted correctly. Re-running the complete
 * topology pass at this stage can alter an otherwise clean edge, so this final
 * fallback copies RGB from the nearest clean visible neighbour while preserving
 * every alpha value. Larger remainders are deliberately left untouched so the
 * caller can fail closed instead of hiding a real extraction failure.
 */
export const repairSmallReservedMatteEdgeResiduals = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor,
  maxPixels = 32
) => {
  const pixelCount = width * height;
  const residual = new Uint8Array(pixelCount);
  const positions = findReservedMatteEdgeContamination(data, width, height, background);
  for (const position of positions) residual[position] = 1;

  if (!positions.length || positions.length > maxPixels) {
    return { detectedPixels: positions.length, repairedPixels: 0 };
  }

  const source = new Uint8ClampedArray(data);
  let repairedPixels = 0;

  for (const position of positions) {
    const x = position % width;
    const y = Math.floor(position / width);
    const pixelIndex = position * 4;
    let bestSample = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestAlpha = -1;

    for (let radius = 1; radius <= 8; radius++) {
      for (let offsetY = -radius; offsetY <= radius; offsetY++) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= height) continue;
        for (let offsetX = -radius; offsetX <= radius; offsetX++) {
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
          const sampleX = x + offsetX;
          if (sampleX < 0 || sampleX >= width) continue;
          const samplePosition = sampleY * width + sampleX;
          if (residual[samplePosition]) continue;
          const sampleIndex = samplePosition * 4;
          const sampleAlpha = source[sampleIndex + 3];
          if (sampleAlpha <= 8) continue;
          const sampleMatteDistance = Math.hypot(
            source[sampleIndex] - background.r,
            source[sampleIndex + 1] - background.g,
            source[sampleIndex + 2] - background.b
          );
          if (sampleMatteDistance <= 112) continue;

          const spatialDistance = offsetX * offsetX + offsetY * offsetY;
          if (
            spatialDistance < bestDistance
            || (spatialDistance === bestDistance && sampleAlpha > bestAlpha)
          ) {
            bestSample = sampleIndex;
            bestDistance = spatialDistance;
            bestAlpha = sampleAlpha;
          }
        }
      }
      if (bestSample >= 0) break;
    }

    if (bestSample >= 0) {
      data[pixelIndex] = source[bestSample];
      data[pixelIndex + 1] = source[bestSample + 1];
      data[pixelIndex + 2] = source[bestSample + 2];
    } else {
      // White is the neutral die-cut fallback when a sub-pixel remnant has no
      // trustworthy local foreground sample. Alpha is intentionally unchanged.
      data[pixelIndex] = 255;
      data[pixelIndex + 1] = 255;
      data[pixelIndex + 2] = 255;
    }
    repairedPixels++;
  }

  return { detectedPixels: positions.length, repairedPixels };
};
