const TRANSPARENT_ALPHA = 8;
const STRONG_WHITE_ALPHA = 160;
const STRONG_WHITE_MIN_CHANNEL = 195;
const STRONG_WHITE_MAX_SPREAD = 40;
const WHITE_SEARCH_RADIUS = 5;
const MIN_WHITE_BOUNDARY_RATIO = 0.82;

interface OpeningComponent {
  positions: number[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
  whiteBoundaryRatio: number;
}

export interface EnclosedOpeningLogicRepairResult {
  openingsDetected: number;
  openingsClosed: number;
  pixelsFilled: number;
}

const channelStats = (data: Uint8ClampedArray, pixelIndex: number) => {
  const minimum = Math.min(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2]);
  const maximum = Math.max(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2]);
  return { minimum, spread: maximum - minimum };
};

const isStrongWhite = (data: Uint8ClampedArray, position: number) => {
  const pixelIndex = position * 4;
  if (data[pixelIndex + 3] < STRONG_WHITE_ALPHA) return false;
  const stats = channelStats(data, pixelIndex);
  return stats.minimum >= STRONG_WHITE_MIN_CHANNEL && stats.spread <= STRONG_WHITE_MAX_SPREAD;
};

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

  if (maxX < minX || maxY < minY) {
    return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
  }
  return { minX, minY, maxX, maxY };
};

const collectEnclosedComponents = (
  source: Uint8ClampedArray,
  exterior: Uint8Array,
  width: number,
  height: number
) => {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: OpeningComponent[] = [];

  for (let seed = 0; seed < pixelCount; seed++) {
    if (
      visited[seed]
      || exterior[seed]
      || source[seed * 4 + 3] > TRANSPARENT_ALPHA
    ) {
      continue;
    }

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
    let boundarySamples = 0;
    let whiteBoundarySamples = 0;

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
          if (source[next * 4 + 3] <= TRANSPARENT_ALPHA) {
            if (!exterior[next] && !visited[next]) {
              visited[next] = 1;
              queue[end++] = next;
            }
            continue;
          }
          boundarySamples++;
          if (isStrongWhite(source, next)) whiteBoundarySamples++;
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
      centerY: sumY / positions.length,
      whiteBoundaryRatio: boundarySamples ? whiteBoundarySamples / boundarySamples : 0
    });
  }

  return components;
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
  ) {
    return false;
  }

  const horizontalMirror = Math.abs((left.centerX + right.centerX) - centerX * 2) <= xTolerance
    && Math.abs(left.centerY - right.centerY) <= yTolerance;
  const verticalMirror = Math.abs((left.centerY + right.centerY) - centerY * 2) <= yTolerance
    && Math.abs(left.centerX - right.centerX) <= xTolerance;
  return horizontalMirror || verticalMirror;
};

const nearestWhiteValue = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  position: number
) => {
  const x = position % width;
  const y = Math.floor(position / width);
  let bestDistance = Number.POSITIVE_INFINITY;
  let value = 255;

  for (let offsetY = -WHITE_SEARCH_RADIUS; offsetY <= WHITE_SEARCH_RADIUS; offsetY++) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) continue;
    for (let offsetX = -WHITE_SEARCH_RADIUS; offsetX <= WHITE_SEARCH_RADIUS; offsetX++) {
      const nextX = x + offsetX;
      if (nextX < 0 || nextX >= width) continue;
      const next = nextY * width + nextX;
      if (!isStrongWhite(source, next)) continue;
      const distance = offsetX * offsetX + offsetY * offsetY;
      if (distance >= bestDistance) continue;
      const pixelIndex = next * 4;
      bestDistance = distance;
      value = Math.max(225, source[pixelIndex], source[pixelIndex + 1], source[pixelIndex + 2]);
    }
  }

  return value;
};

/**
 * Closes only clearly accidental micro-openings after matte extraction.
 * Large openings, centered single openings and matched symmetric pairs are kept.
 * This is a local bitmap repair: it does not alter prompt frequency, QA, rejects
 * or provider usage.
 */
export const closeIllogicalEnclosedMicroOpenings = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): EnclosedOpeningLogicRepairResult => {
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
      && Math.max(componentWidth, componentHeight) <= maxMicroDimension
      && component.whiteBoundaryRatio >= MIN_WHITE_BOUNDARY_RATIO;
  });

  const partnered = new Uint8Array(components.length);
  for (let left = 0; left < components.length; left++) {
    if (!micro[left]) continue;
    for (let right = left + 1; right < components.length; right++) {
      if (!micro[right]) continue;
      if (areLogicalPartners(
        components[left],
        components[right],
        centerX,
        centerY,
        xTolerance,
        yTolerance
      )) {
        partnered[left] = 1;
        partnered[right] = 1;
      }
    }
  }

  const close: OpeningComponent[] = [];
  for (let index = 0; index < components.length; index++) {
    if (!micro[index] || partnered[index]) continue;
    const component = components[index];
    const centered = Math.abs(component.centerX - centerX) <= centralXTolerance
      || Math.abs(component.centerY - centerY) <= centralYTolerance;
    if (!centered) close.push(component);
  }

  let pixelsFilled = 0;
  for (const component of close) {
    for (const position of component.positions) {
      const pixelIndex = position * 4;
      const neutral = nearestWhiteValue(source, width, height, position);
      data[pixelIndex] = neutral;
      data[pixelIndex + 1] = neutral;
      data[pixelIndex + 2] = neutral;
      data[pixelIndex + 3] = 255;
      pixelsFilled++;
    }
  }

  return {
    openingsDetected: components.length,
    openingsClosed: close.length,
    pixelsFilled
  };
};
