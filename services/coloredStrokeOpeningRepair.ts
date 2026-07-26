import type { RgbColor } from './reservedMatte';

const TRANSPARENT_ALPHA = 8;
const TRUSTED_SAMPLE_ALPHA = 160;
const SAMPLE_RADIUS = 7;
const MICRO_SAMPLE_RADIUS = 10;
const MICRO_SAMPLE_ALPHA = 96;
const MAX_EDGE_DEPTH = 4;
const MAX_EDGE_ALPHA = 224;
const MIN_AXIS_ALIGNMENT = 0.82;
const MIN_AXIS_MAGNITUDE = 10;
const MIN_SAMPLE_MATTE_DISTANCE = 112;
const MIN_SAMPLE_DISTANCE_ADVANTAGE = 24;
const MAX_MIXTURE_RESIDUAL = 14;
const MAX_MIXTURE_COVERAGE = 0.92;
const MIN_COLORED_SUPPORT_RATIO = 0.5;

interface OpeningComponent {
  positions: number[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

interface ReplacementCandidate {
  position: number;
  sampleIndex: number;
  depth: number;
}

export interface ColoredStrokeMicroOpeningRepairResult {
  openingsDetected: number;
  openingsClosed: number;
  pixelsFilled: number;
}

export interface RetainedOpeningStrokeCleanResult {
  componentsNeutralized: number;
  pixelsNeutralized: number;
  effectivePixelsNeutralized: number;
}

const colorDistanceFrom = (
  data: Uint8ClampedArray,
  pixelIndex: number,
  color: RgbColor
) => Math.hypot(
  data[pixelIndex] - color.r,
  data[pixelIndex + 1] - color.g,
  data[pixelIndex + 2] - color.b
);

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

const collectEnclosedComponents = (
  data: Uint8ClampedArray,
  exterior: Uint8Array,
  width: number,
  height: number
) => {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: OpeningComponent[] = [];

  for (let seed = 0; seed < pixelCount; seed++) {
    if (visited[seed] || exterior[seed] || data[seed * 4 + 3] > TRANSPARENT_ALPHA) continue;

    let start = 0;
    let end = 0;
    visited[seed] = 1;
    queue[end++] = seed;
    const positions: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;

    while (start < end) {
      const position = queue[start++];
      positions.push(position);
      const x = position % width;
      const y = Math.floor(position / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;

      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (
            !visited[next]
            && !exterior[next]
            && data[next * 4 + 3] <= TRANSPARENT_ALPHA
          ) {
            visited[next] = 1;
            queue[end++] = next;
          }
        }
      }
    }

    components.push({
      positions,
      area: positions.length,
      minX,
      minY,
      maxX,
      maxY,
      centerX: sumX / positions.length,
      centerY: sumY / positions.length
    });
  }

  return components;
};

const findArtworkBounds = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= TRANSPARENT_ALPHA) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX >= minX && maxY >= minY
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
};

const areLogicalPartners = (
  left: OpeningComponent,
  right: OpeningComponent,
  centerX: number,
  centerY: number,
  xTolerance: number,
  yTolerance: number
) => {
  const areaRatio = Math.max(left.area, right.area) / Math.max(1, Math.min(left.area, right.area));
  if (areaRatio > 1.75) return false;
  const leftWidth = left.maxX - left.minX + 1;
  const rightWidth = right.maxX - right.minX + 1;
  const leftHeight = left.maxY - left.minY + 1;
  const rightHeight = right.maxY - right.minY + 1;
  if (
    Math.abs(leftWidth - rightWidth) > Math.max(4, Math.max(leftWidth, rightWidth) * 0.45)
    || Math.abs(leftHeight - rightHeight) > Math.max(4, Math.max(leftHeight, rightHeight) * 0.45)
  ) return false;

  return (
    Math.abs((left.centerX + right.centerX) - centerX * 2) <= xTolerance
    && Math.abs(left.centerY - right.centerY) <= yTolerance
  ) || (
    Math.abs((left.centerY + right.centerY) - centerY * 2) <= yTolerance
    && Math.abs(left.centerX - right.centerX) <= xTolerance
  );
};

const findTrustedSample = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  position: number,
  background: RgbColor,
  minimumAlpha = TRUSTED_SAMPLE_ALPHA,
  searchRadius = SAMPLE_RADIUS
) => {
  const x = position % width;
  const y = Math.floor(position / width);
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlpha = -1;

  for (let radius = 1; radius <= searchRadius; radius++) {
    for (let offsetY = -radius; offsetY <= radius; offsetY++) {
      const nextY = y + offsetY;
      if (nextY < 0 || nextY >= height) continue;
      for (let offsetX = -radius; offsetX <= radius; offsetX++) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
        const nextX = x + offsetX;
        if (nextX < 0 || nextX >= width) continue;
        const nextIndex = (nextY * width + nextX) * 4;
        const sampleAlpha = source[nextIndex + 3];
        if (sampleAlpha < minimumAlpha) continue;
        if (colorDistanceFrom(source, nextIndex, background) < MIN_SAMPLE_MATTE_DISTANCE) continue;
        const distance = offsetX * offsetX + offsetY * offsetY;
        if (distance < bestDistance || (distance === bestDistance && sampleAlpha > bestAlpha)) {
          bestIndex = nextIndex;
          bestDistance = distance;
          bestAlpha = sampleAlpha;
        }
      }
    }
    if (bestIndex >= 0) break;
  }

  return bestIndex;
};

/**
 * Closes only tiny off-axis holes embedded in a dark or colored stroke. The
 * previous logical-opening pass intentionally required a white cutline; this
 * companion pass handles thin stems, cords and handles without turning their
 * holes into white patches. Large, centered and mirrored openings are retained.
 */
export const closeColoredStrokeMicroOpenings = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
): ColoredStrokeMicroOpeningRepairResult => {
  const source = new Uint8ClampedArray(data);
  const exterior = buildExteriorTransparency(source, width, height);
  const components = collectEnclosedComponents(source, exterior, width, height);
  if (!components.length) return { openingsDetected: 0, openingsClosed: 0, pixelsFilled: 0 };

  const bounds = findArtworkBounds(source, width, height);
  const boundsWidth = bounds.maxX - bounds.minX + 1;
  const boundsHeight = bounds.maxY - bounds.minY + 1;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const maxMicroArea = Math.max(24, Math.min(220, Math.round(width * height * 0.00022)));
  const maxMicroDimension = Math.max(8, Math.min(28, Math.round(Math.min(width, height) * 0.025)));
  const xTolerance = Math.max(5, boundsWidth * 0.055);
  const yTolerance = Math.max(5, boundsHeight * 0.055);
  const centralXTolerance = Math.max(3, boundsWidth * 0.035);
  const centralYTolerance = Math.max(3, boundsHeight * 0.035);

  const micro = components.map(component => {
    const componentWidth = component.maxX - component.minX + 1;
    const componentHeight = component.maxY - component.minY + 1;
    return component.area <= maxMicroArea
      && Math.max(componentWidth, componentHeight) <= maxMicroDimension;
  });
  const partnered = new Uint8Array(components.length);
  for (let left = 0; left < components.length; left++) {
    if (!micro[left]) continue;
    for (let right = left + 1; right < components.length; right++) {
      if (
        micro[right]
        && areLogicalPartners(components[left], components[right], centerX, centerY, xTolerance, yTolerance)
      ) {
        partnered[left] = 1;
        partnered[right] = 1;
      }
    }
  }

  const accepted: Array<{ component: OpeningComponent; samples: Map<number, number> }> = [];
  for (let index = 0; index < components.length; index++) {
    if (!micro[index] || partnered[index]) continue;
    const component = components[index];
    const centered = Math.abs(component.centerX - centerX) <= centralXTolerance
      || Math.abs(component.centerY - centerY) <= centralYTolerance;
    if (centered) continue;

    const samples = new Map<number, number>();
    let supported = 0;
    for (const position of component.positions) {
      const sampleIndex = findTrustedSample(
        source, width, height, position, background, MICRO_SAMPLE_ALPHA, MICRO_SAMPLE_RADIUS
      );
      if (sampleIndex < 0) continue;
      samples.set(position, sampleIndex);
      supported++;
    }
    if (supported / component.positions.length >= MIN_COLORED_SUPPORT_RATIO) {
      accepted.push({ component, samples });
    }
  }

  let pixelsFilled = 0;
  for (const { component, samples } of accepted) {
    for (const position of component.positions) {
      const sampleIndex = samples.get(position)
        ?? findTrustedSample(
          source, width, height, position, background, MICRO_SAMPLE_ALPHA, MICRO_SAMPLE_RADIUS
        );
      if (sampleIndex === undefined || sampleIndex < 0) continue;
      const pixelIndex = position * 4;
      data[pixelIndex] = source[sampleIndex];
      data[pixelIndex + 1] = source[sampleIndex + 1];
      data[pixelIndex + 2] = source[sampleIndex + 2];
      data[pixelIndex + 3] = 255;
      pixelsFilled++;
    }
  }

  return {
    openingsDetected: components.length,
    openingsClosed: accepted.length,
    pixelsFilled
  };
};

const buildHoleDistance = (
  data: Uint8ClampedArray,
  exterior: Uint8Array,
  width: number,
  height: number
) => {
  const pixelCount = width * height;
  const distance = new Uint8Array(pixelCount);
  distance.fill(255);
  const queue = new Int32Array(pixelCount);
  let start = 0;
  let end = 0;

  for (let position = 0; position < pixelCount; position++) {
    if (data[position * 4 + 3] <= TRANSPARENT_ALPHA && !exterior[position]) {
      distance[position] = 0;
      queue[end++] = position;
    }
  }
  while (start < end) {
    const position = queue[start++];
    const current = distance[position];
    if (current >= MAX_EDGE_DEPTH) continue;
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
        if (distance[next] !== 255 || exterior[next]) continue;
        distance[next] = current + 1;
        queue[end++] = next;
      }
    }
  }
  return distance;
};

const findMixtureSample = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  position: number,
  background: RgbColor,
  candidateMatteDistance: number,
  minimumAlpha: number
) => {
  const pixelIndex = position * 4;
  const observed = [source[pixelIndex], source[pixelIndex + 1], source[pixelIndex + 2]].map(value => value / 255);
  const matte = [background.r, background.g, background.b].map(value => value / 255);
  const x = position % width;
  const y = Math.floor(position / width);
  let bestSample = -1;
  let bestResidual = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let radius = 1; radius <= SAMPLE_RADIUS; radius++) {
    for (let offsetY = -radius; offsetY <= radius; offsetY++) {
      const sampleY = y + offsetY;
      if (sampleY < 0 || sampleY >= height) continue;
      for (let offsetX = -radius; offsetX <= radius; offsetX++) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
        const sampleX = x + offsetX;
        if (sampleX < 0 || sampleX >= width) continue;
        const sampleIndex = (sampleY * width + sampleX) * 4;
        if (source[sampleIndex + 3] < minimumAlpha) continue;
        const sampleMatteDistance = colorDistanceFrom(source, sampleIndex, background);
        if (
          sampleMatteDistance < MIN_SAMPLE_MATTE_DISTANCE
          || sampleMatteDistance < candidateMatteDistance + MIN_SAMPLE_DISTANCE_ADVANTAGE
        ) continue;

        const foreground = [source[sampleIndex], source[sampleIndex + 1], source[sampleIndex + 2]].map(value => value / 255);
        const vector = foreground.map((value, channel) => value - matte[channel]);
        const vectorLengthSquared = vector.reduce((sum, value) => sum + value * value, 0);
        if (vectorLengthSquared < 0.02) continue;
        const observedVector = observed.map((value, channel) => value - matte[channel]);
        const coverage = observedVector.reduce(
          (sum, value, channel) => sum + value * vector[channel],
          0
        ) / vectorLengthSquared;
        if (coverage < 0.02 || coverage > MAX_MIXTURE_COVERAGE) continue;
        const residual = Math.hypot(...observed.map((value, channel) => (
          value - (matte[channel] * (1 - coverage) + foreground[channel] * coverage)
        ) * 255));
        const spatialDistance = offsetX * offsetX + offsetY * offsetY;
        if (
          residual < bestResidual - 0.25
          || (Math.abs(residual - bestResidual) <= 0.25 && spatialDistance < bestDistance)
        ) {
          bestSample = sampleIndex;
          bestResidual = residual;
          bestDistance = spatialDistance;
        }
      }
    }
    if (bestSample >= 0 && bestResidual <= MAX_MIXTURE_RESIDUAL) break;
  }

  return bestResidual <= MAX_MIXTURE_RESIDUAL ? bestSample : -1;
};

/**
 * Reconstructs partial-alpha matte mixtures on retained openings from a nearby
 * trusted dark or colored stroke sample. Alpha remains byte-for-byte unchanged;
 * only the technical green/cyan/magenta/orange cast is removed.
 */
export const repairRetainedOpeningStrokeEdges = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
): RetainedOpeningStrokeCleanResult => {
  const source = new Uint8ClampedArray(data);
  const pixelCount = width * height;
  const exterior = buildExteriorTransparency(source, width, height);
  const holeDistance = buildHoleDistance(source, exterior, width, height);
  const matteMean = (background.r + background.g + background.b) / 3;
  const matteChroma = [background.r - matteMean, background.g - matteMean, background.b - matteMean];
  const matteChromaLength = Math.hypot(...matteChroma);
  if (matteChromaLength < 32) {
    return { componentsNeutralized: 0, pixelsNeutralized: 0, effectivePixelsNeutralized: 0 };
  }

  const candidates: ReplacementCandidate[] = [];
  for (let position = 0; position < pixelCount; position++) {
    const depth = holeDistance[position];
    if (!depth || depth === 255 || depth > MAX_EDGE_DEPTH) continue;
    const pixelIndex = position * 4;
    const alpha = source[pixelIndex + 3];
    if (alpha <= TRANSPARENT_ALPHA || alpha > MAX_EDGE_ALPHA) continue;
    const minimum = Math.min(source[pixelIndex], source[pixelIndex + 1], source[pixelIndex + 2]);
    const maximum = Math.max(source[pixelIndex], source[pixelIndex + 1], source[pixelIndex + 2]);
    if (minimum >= 190 && maximum - minimum <= 40) continue;

    const mean = (source[pixelIndex] + source[pixelIndex + 1] + source[pixelIndex + 2]) / 3;
    const chroma = [source[pixelIndex] - mean, source[pixelIndex + 1] - mean, source[pixelIndex + 2] - mean];
    const chromaLength = Math.hypot(...chroma);
    if (chromaLength < 10) continue;
    const axisProjection = chroma.reduce(
      (sum, value, channel) => sum + value * matteChroma[channel],
      0
    ) / matteChromaLength;
    const alignment = Math.abs(axisProjection) / chromaLength;
    if (alignment < MIN_AXIS_ALIGNMENT || Math.abs(axisProjection) < MIN_AXIS_MAGNITUDE) continue;

    const matteDistance = colorDistanceFrom(source, pixelIndex, background);
    const sampleIndex = findMixtureSample(
      source,
      width,
      height,
      position,
      background,
      matteDistance,
      Math.max(TRUSTED_SAMPLE_ALPHA, Math.min(252, alpha + 48))
    );
    if (sampleIndex >= 0) candidates.push({ position, sampleIndex, depth });
  }

  if (!candidates.length) {
    return { componentsNeutralized: 0, pixelsNeutralized: 0, effectivePixelsNeutralized: 0 };
  }

  const candidateMap = new Int32Array(pixelCount);
  candidateMap.fill(-1);
  candidates.forEach((candidate, index) => { candidateMap[candidate.position] = index; });
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const accepted: ReplacementCandidate[][] = [];

  for (let seedIndex = 0; seedIndex < candidates.length; seedIndex++) {
    const seed = candidates[seedIndex];
    if (visited[seed.position]) continue;
    let start = 0;
    let end = 0;
    visited[seed.position] = 1;
    queue[end++] = seed.position;
    const component: ReplacementCandidate[] = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let effectivePixels = 0;
    let minDepth = 255;

    while (start < end) {
      const position = queue[start++];
      const candidate = candidates[candidateMap[position]];
      component.push(candidate);
      const x = position % width;
      const y = Math.floor(position / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      effectivePixels += source[position * 4 + 3] / 255;
      minDepth = Math.min(minDepth, candidate.depth);

      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (candidateMap[next] < 0 || visited[next]) continue;
          visited[next] = 1;
          queue[end++] = next;
        }
      }
    }

    if (
      component.length <= 400
      && effectivePixels <= 220
      && Math.max(maxX - minX + 1, maxY - minY + 1) <= 64
      && minDepth <= 2
    ) accepted.push(component);
  }

  let pixelsNeutralized = 0;
  let effectivePixelsNeutralized = 0;
  for (const component of accepted) {
    for (const candidate of component) {
      const pixelIndex = candidate.position * 4;
      data[pixelIndex] = source[candidate.sampleIndex];
      data[pixelIndex + 1] = source[candidate.sampleIndex + 1];
      data[pixelIndex + 2] = source[candidate.sampleIndex + 2];
      effectivePixelsNeutralized += source[pixelIndex + 3] / 255;
      pixelsNeutralized++;
    }
  }

  return {
    componentsNeutralized: accepted.length,
    pixelsNeutralized,
    effectivePixelsNeutralized: Number(effectivePixelsNeutralized.toFixed(3))
  };
};
