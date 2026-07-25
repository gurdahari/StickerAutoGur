import type { RgbColor } from './reservedMatte';

const TRANSPARENT_ALPHA = 8;
const STRONG_WHITE_ALPHA = 160;
const STRONG_WHITE_MIN_CHANNEL = 195;
const STRONG_WHITE_MAX_SPREAD = 40;

const ACUTE_RAY_COUNT = 32;
const ACUTE_RAY_RADIUS = 6;
const MAX_INTERIOR_RAYS_AT_ACUTE_TIP = 10;
const ACUTE_PROXIMITY_RADIUS = 16;
const MAX_COMPONENT_DISTANCE_FROM_TIP = 2;

const MIN_CHROMA_LENGTH = 12;
const MIN_AXIS_ALIGNMENT = 0.72;
const MIN_AXIS_MAGNITUDE = 12;
const WHITE_PROOF_RADIUS = 4;
const WHITE_REPLACEMENT_RADIUS = 6;
const MIN_CLOSE_WHITE_RATIO = 0.95;

const MAX_COMPONENT_PIXELS = 180;
const MAX_COMPONENT_EFFECTIVE_PIXELS = 150;
const MAX_COMPONENT_DIMENSION = 32;

export interface AcuteEnclosedHoleCornerCleanResult {
  acuteTipsDetected: number;
  componentsNeutralized: number;
  pixelsNeutralized: number;
  effectivePixelsNeutralized: number;
}

const RAY_DIRECTIONS = Array.from({ length: ACUTE_RAY_COUNT }, (_, index) => {
  const angle = (Math.PI * 2 * index) / ACUTE_RAY_COUNT;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});

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

const touchesExteriorTransparency = (
  data: Uint8ClampedArray,
  exterior: Uint8Array,
  width: number,
  height: number,
  positions: number[]
) => {
  for (const position of positions) {
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
        if (data[next * 4 + 3] <= TRANSPARENT_ALPHA && exterior[next]) return true;
      }
    }
  }
  return false;
};

const buildAcuteHoleTips = (
  data: Uint8ClampedArray,
  exterior: Uint8Array,
  width: number,
  height: number
) => {
  const pixelCount = width * height;
  const enclosed = new Uint8Array(pixelCount);
  const acute = new Uint8Array(pixelCount);

  for (let position = 0; position < pixelCount; position++) {
    if (data[position * 4 + 3] <= TRANSPARENT_ALPHA && !exterior[position]) {
      enclosed[position] = 1;
    }
  }

  const isBoundary = (position: number) => {
    const x = position % width;
    const y = Math.floor(position / width);
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      const nextY = y + offsetY;
      if (nextY < 0 || nextY >= height) continue;
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (!offsetX && !offsetY) continue;
        const nextX = x + offsetX;
        if (nextX < 0 || nextX >= width) continue;
        if (!enclosed[nextY * width + nextX]) return true;
      }
    }
    return false;
  };

  for (let position = 0; position < pixelCount; position++) {
    if (!enclosed[position] || !isBoundary(position)) continue;
    const x = position % width;
    const y = Math.floor(position / width);
    let interiorRays = 0;

    for (const direction of RAY_DIRECTIONS) {
      let staysInside = true;
      for (let step = 1; step <= ACUTE_RAY_RADIUS; step++) {
        const sampleX = Math.round(x + direction.x * step);
        const sampleY = Math.round(y + direction.y * step);
        if (
          sampleX < 0
          || sampleX >= width
          || sampleY < 0
          || sampleY >= height
          || !enclosed[sampleY * width + sampleX]
        ) {
          staysInside = false;
          break;
        }
      }
      if (staysInside) interiorRays++;
    }

    if (interiorRays <= MAX_INTERIOR_RAYS_AT_ACUTE_TIP) acute[position] = 1;
  }

  return acute;
};

/**
 * Removes the opaque or nearly opaque matte-colored wedges that form at sharp
 * corners of enclosed transparent holes. These wedges can extend much farther
 * than ordinary antialiasing, so previous low-alpha strip passes leave them.
 *
 * Safety is geometry-first:
 *  - only components anchored within two pixels of a measured acute enclosed
 *    hole tip are eligible;
 *  - the complete signed matte-axis component must stay tiny and entirely in a
 *    strong neutral-white cutline corridor;
 *  - exterior transparency is excluded;
 *  - RGB is neutralized while alpha is preserved byte-for-byte.
 *
 * This is a repair-only pass. It does not alter QA or rejection thresholds.
 */
export const neutralizeAcuteEnclosedHoleCornerChroma = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: RgbColor
): AcuteEnclosedHoleCornerCleanResult => {
  const source = new Uint8ClampedArray(data);
  const pixelCount = width * height;
  const exterior = buildExteriorTransparency(source, width, height);
  const acuteTips = buildAcuteHoleTips(source, exterior, width, height);
  const acuteTipsDetected = acuteTips.reduce((sum, value) => sum + value, 0);

  if (!acuteTipsDetected) {
    return {
      acuteTipsDetected: 0,
      componentsNeutralized: 0,
      pixelsNeutralized: 0,
      effectivePixelsNeutralized: 0
    };
  }

  const acuteDistance = buildLimitedDistance(
    width,
    height,
    ACUTE_PROXIMITY_RADIUS,
    position => Boolean(acuteTips[position]),
    position => !exterior[position]
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

  const matteMean = (background.r + background.g + background.b) / 3;
  const matteChroma = [
    background.r - matteMean,
    background.g - matteMean,
    background.b - matteMean
  ];
  const matteChromaLength = Math.hypot(...matteChroma);
  if (matteChromaLength < 32) {
    return {
      acuteTipsDetected,
      componentsNeutralized: 0,
      pixelsNeutralized: 0,
      effectivePixelsNeutralized: 0
    };
  }

  const candidate = new Uint8Array(pixelCount);
  for (let position = 0; position < pixelCount; position++) {
    const pixelIndex = position * 4;
    if (
      exterior[position]
      || source[pixelIndex + 3] <= TRANSPARENT_ALPHA
      || isStrongWhite(position)
    ) {
      continue;
    }

    const red = source[pixelIndex];
    const green = source[pixelIndex + 1];
    const blue = source[pixelIndex + 2];
    const mean = (red + green + blue) / 3;
    const chroma = [red - mean, green - mean, blue - mean];
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
    let effectivePixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let minAcuteDistance = 255;
    let closeWhitePixels = 0;
    let maxWhiteDistance = 0;

    while (start < end) {
      const position = queue[start++];
      positions.push(position);
      const x = position % width;
      const y = Math.floor(position / width);
      effectivePixels += source[position * 4 + 3] / 255;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      minAcuteDistance = Math.min(minAcuteDistance, acuteDistance[position]);
      const distanceToWhite = whiteDistance[position];
      maxWhiteDistance = Math.max(maxWhiteDistance, distanceToWhite);
      if (distanceToWhite <= WHITE_PROOF_RADIUS) closeWhitePixels++;

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
    const closeWhiteRatio = closeWhitePixels / positions.length;

    if (
      positions.length > MAX_COMPONENT_PIXELS
      || effectivePixels > MAX_COMPONENT_EFFECTIVE_PIXELS
      || Math.max(componentWidth, componentHeight) > MAX_COMPONENT_DIMENSION
      || minAcuteDistance > MAX_COMPONENT_DISTANCE_FROM_TIP
      || maxWhiteDistance > WHITE_PROOF_RADIUS
      || closeWhiteRatio < MIN_CLOSE_WHITE_RATIO
      || touchesExteriorTransparency(source, exterior, width, height, positions)
    ) {
      continue;
    }

    accepted.push(positions);
  }

  let pixelsNeutralized = 0;
  let effectivePixelsNeutralized = 0;

  for (const component of accepted) {
    for (const position of component) {
      const x = position % width;
      const y = Math.floor(position / width);
      const pixelIndex = position * 4;
      let nearestWhiteDistance = 255;
      let nearestWhiteValue = 225;

      for (let offsetY = -WHITE_REPLACEMENT_RADIUS; offsetY <= WHITE_REPLACEMENT_RADIUS; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -WHITE_REPLACEMENT_RADIUS; offsetX <= WHITE_REPLACEMENT_RADIUS; offsetX++) {
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (!isStrongWhite(next)) continue;
          const distance = Math.max(Math.abs(offsetX), Math.abs(offsetY));
          if (distance >= nearestWhiteDistance) continue;
          const nextIndex = next * 4;
          nearestWhiteDistance = distance;
          nearestWhiteValue = Math.max(
            225,
            source[nextIndex],
            source[nextIndex + 1],
            source[nextIndex + 2]
          );
        }
      }

      const neutral = Math.max(
        nearestWhiteValue,
        source[pixelIndex],
        source[pixelIndex + 1],
        source[pixelIndex + 2]
      );
      data[pixelIndex] = neutral;
      data[pixelIndex + 1] = neutral;
      data[pixelIndex + 2] = neutral;
      effectivePixelsNeutralized += source[pixelIndex + 3] / 255;
      pixelsNeutralized++;
    }
  }

  return {
    acuteTipsDetected,
    componentsNeutralized: accepted.length,
    pixelsNeutralized,
    effectivePixelsNeutralized: Number(effectivePixelsNeutralized.toFixed(3))
  };
};
