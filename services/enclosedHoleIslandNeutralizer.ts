const TRANSPARENT_ALPHA = 8;
const PARTIAL_BARRIER_ALPHA = 250;
const MAX_HOLE_BAND_DEPTH = 8;
const MIN_ISLAND_CHANNEL_SPREAD = 24;
const STRONG_WHITE_ALPHA = 168;
const STRONG_WHITE_MIN_CHANNEL = 200;
const STRONG_WHITE_MAX_SPREAD = 32;
const WHITE_PROOF_RADIUS = 4;
const CLOSE_WHITE_DISTANCE = 3;
const MIN_CLOSE_WHITE_RATIO = 0.75;
const MAX_COMPONENT_PIXELS = 64;
const MAX_COMPONENT_EFFECTIVE_PIXELS = 40;
const MAX_COMPONENT_DIMENSION = 16;
const MIN_COMPONENT_BAND_RATIO = 0.6;

export interface EnclosedHoleColorIslandNeutralizeResult {
  componentsNeutralized: number;
  pixelsNeutralized: number;
  effectivePixelsNeutralized: number;
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

/**
 * Neutralizes small chromatic islands trapped inside an enclosed-hole white
 * cutline. This catches the remaining class that can include an opaque colored
 * tip connected to a partial-alpha fringe, such as the turquoise triangle at a
 * grocery-bag handle opening.
 *
 * The pass never changes alpha. Safety comes from component topology rather
 * than wider color thresholds: an accepted island must be tiny, mostly inside
 * the bounded enclosed-hole band, close to strong neutral white, disconnected
 * from the exterior, and not part of a larger colored artwork component.
 */
export const neutralizeSmallEnclosedHoleColorIslands = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): EnclosedHoleColorIslandNeutralizeResult => {
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

  const chromatic = new Uint8Array(pixelCount);
  for (let position = 0; position < pixelCount; position++) {
    const pixelIndex = position * 4;
    if (source[pixelIndex + 3] <= TRANSPARENT_ALPHA || isStrongWhite(position)) continue;
    if (channelStats(source, pixelIndex).spread >= MIN_ISLAND_CHANNEL_SPREAD) {
      chromatic[position] = 1;
    }
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const accepted: number[][] = [];

  for (let seed = 0; seed < pixelCount; seed++) {
    if (!chromatic[seed] || visited[seed]) continue;

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
    let bandPixels = 0;
    let minBandDepth = 255;
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

      const depth = holeDepth[position];
      if (depth > 0 && depth !== 255 && depth <= MAX_HOLE_BAND_DEPTH) {
        bandPixels++;
        minBandDepth = Math.min(minBandDepth, depth);
      }
      const distanceToWhite = whiteDistance[position];
      maxWhiteDistance = Math.max(maxWhiteDistance, distanceToWhite);
      if (distanceToWhite <= CLOSE_WHITE_DISTANCE) closeWhitePixels++;

      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (!chromatic[next] || visited[next]) continue;
          visited[next] = 1;
          queue[end++] = next;
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const bandRatio = bandPixels / positions.length;
    const closeWhiteRatio = closeWhitePixels / positions.length;

    if (
      positions.length > MAX_COMPONENT_PIXELS
      || effectivePixels > MAX_COMPONENT_EFFECTIVE_PIXELS
      || Math.max(componentWidth, componentHeight) > MAX_COMPONENT_DIMENSION
      || bandRatio < MIN_COMPONENT_BAND_RATIO
      || minBandDepth > 2
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

      for (let offsetY = -WHITE_PROOF_RADIUS; offsetY <= WHITE_PROOF_RADIUS; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -WHITE_PROOF_RADIUS; offsetX <= WHITE_PROOF_RADIUS; offsetX++) {
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
    componentsNeutralized: accepted.length,
    pixelsNeutralized,
    effectivePixelsNeutralized: Number(effectivePixelsNeutralized.toFixed(3))
  };
};
