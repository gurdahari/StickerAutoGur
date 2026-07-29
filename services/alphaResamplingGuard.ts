const TRANSPARENT_ALPHA = 8;
const WHITE_SUPPORT_MIN_ALPHA = 64;
const STRONG_WHITE_MIN_ALPHA = 128;
const WHITE_MIN_CHANNEL = 190;
const WHITE_MAX_SPREAD = 55;
const STRONG_WHITE_MIN_CHANNEL = 205;
const STRONG_WHITE_MAX_SPREAD = 40;
const MIN_WHITE_SUPPORT_PIXELS = 24;
const MIN_STRONG_WHITE_PIXELS = 12;
const MIN_WHITE_SUPPORT_RATIO = 0.82;
const MAX_RING_DEPTH = 4;
const MAX_DARK_SPECK_ALPHA = 112;
const MAX_DARK_SPECK_CHANNEL = 180;
const WHITE_SAMPLE_RADIUS = 6;

export interface ExteriorAlphaSoftenResult {
  applied: boolean;
  changedPixels: number;
  coverageChange: number;
}

export interface EnclosedHoleCutlineNormalizationResult {
  holesDetected: number;
  holesNormalized: number;
  pixelsNormalized: number;
}

const channelStats = (data: Uint8ClampedArray, pixelIndex: number) => {
  const red = data[pixelIndex];
  const green = data[pixelIndex + 1];
  const blue = data[pixelIndex + 2];
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  return { minimum, maximum, spread: maximum - minimum };
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

const touchesExteriorTransparency = (
  exterior: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
) => {
  const position = y * width + x;
  if (exterior[position]) return true;

  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) continue;
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      if (!offsetX && !offsetY) continue;
      const nextX = x + offsetX;
      if (nextX < 0 || nextX >= width) continue;
      if (exterior[nextY * width + nextX]) return true;
    }
  }

  return false;
};

/**
 * Canvas stores pixels internally in premultiplied form, but transparent pixels
 * can still carry arbitrary straight-RGB values before drawImage. Normalizing
 * those hidden channels prevents detached artwork colors from becoming visible
 * if a later resample gives the pixel a small non-zero alpha.
 */
export const sanitizeTransparentRgbBeforeResize = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const pixelCount = width * height;
  let sanitizedPixels = 0;

  for (let position = 0; position < pixelCount; position++) {
    const pixelIndex = position * 4;
    if (data[pixelIndex + 3] > TRANSPARENT_ALPHA) continue;
    if (
      data[pixelIndex] === 255
      && data[pixelIndex + 1] === 255
      && data[pixelIndex + 2] === 255
    ) {
      continue;
    }
    data[pixelIndex] = 255;
    data[pixelIndex + 1] = 255;
    data[pixelIndex + 2] = 255;
    sanitizedPixels++;
  }

  return sanitizedPixels;
};

/**
 * The previous global alpha blur also softened enclosed openings. That could
 * create fresh low-alpha pixels inside handles, loops and eyelets after the
 * matte had already been removed correctly. Keep the same gentle smoothing for
 * the outside silhouette only; enclosed-hole alpha remains byte-for-byte intact.
 */
export const softenExteriorAlphaOnly = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): ExteriorAlphaSoftenResult => {
  const source = new Uint8ClampedArray(data);
  const exterior = buildExteriorTransparency(source, width, height);
  const pixelCount = width * height;
  const revisedAlpha = new Uint8ClampedArray(pixelCount);
  const weights = [0.216, 0.568, 0.216];
  let originalCoverage = 0;
  let revisedCoverage = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      const pixelIndex = position * 4;
      const originalAlpha = source[pixelIndex + 3];
      originalCoverage += originalAlpha;

      if (!touchesExteriorTransparency(exterior, width, height, x, y)) {
        revisedAlpha[position] = originalAlpha;
        revisedCoverage += originalAlpha;
        continue;
      }

      let blurredAlpha = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const neighbourY = y + offsetY;
        if (neighbourY < 0 || neighbourY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const neighbourX = x + offsetX;
          if (neighbourX < 0 || neighbourX >= width) continue;
          const neighbourIndex = (neighbourY * width + neighbourX) * 4;
          blurredAlpha += source[neighbourIndex + 3]
            * weights[offsetX + 1]
            * weights[offsetY + 1];
        }
      }

      const nextAlpha = Math.round(blurredAlpha);
      revisedAlpha[position] = nextAlpha;
      revisedCoverage += nextAlpha;
    }
  }

  const coverageChange = Math.abs(revisedCoverage - originalCoverage) / Math.max(1, originalCoverage);
  if (coverageChange > 0.003) {
    return { applied: false, changedPixels: 0, coverageChange };
  }

  let changedPixels = 0;
  for (let position = 0; position < pixelCount; position++) {
    const pixelIndex = position * 4;
    const nextAlpha = revisedAlpha[position];
    if (nextAlpha === source[pixelIndex + 3]) continue;

    data[pixelIndex + 3] = nextAlpha;
    if (source[pixelIndex + 3] <= TRANSPARENT_ALPHA && nextAlpha > TRANSPARENT_ALPHA) {
      data[pixelIndex] = 255;
      data[pixelIndex + 1] = 255;
      data[pixelIndex + 2] = 255;
    }
    changedPixels++;
  }

  return { applied: true, changedPixels, coverageChange };
};

const collectEnclosedTransparentComponents = (
  data: Uint8ClampedArray,
  exterior: Uint8Array,
  width: number,
  height: number
) => {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: number[][] = [];

  for (let seed = 0; seed < pixelCount; seed++) {
    if (
      visited[seed]
      || exterior[seed]
      || data[seed * 4 + 3] > TRANSPARENT_ALPHA
    ) {
      continue;
    }

    let start = 0;
    let end = 0;
    visited[seed] = 1;
    queue[end++] = seed;
    const positions: number[] = [];

    while (start < end) {
      const position = queue[start++];
      positions.push(position);
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

    components.push(positions);
  }

  return components;
};

const buildComponentRingDepth = (
  component: number[],
  width: number,
  height: number
) => {
  const pixelCount = width * height;
  const encodedDepth = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let start = 0;
  let end = 0;

  for (const position of component) {
    encodedDepth[position] = 1;
    queue[end++] = position;
  }

  while (start < end) {
    const position = queue[start++];
    const depth = encodedDepth[position] - 1;
    if (depth >= MAX_RING_DEPTH) continue;
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
        if (encodedDepth[next]) continue;
        encodedDepth[next] = depth + 2;
        queue[end++] = next;
      }
    }
  }

  return encodedDepth;
};

const findNearestStrongWhiteValue = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  position: number
) => {
  const x = position % width;
  const y = Math.floor(position / width);
  let bestValue = 255;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let radius = 1; radius <= WHITE_SAMPLE_RADIUS; radius++) {
    for (let offsetY = -radius; offsetY <= radius; offsetY++) {
      const nextY = y + offsetY;
      if (nextY < 0 || nextY >= height) continue;
      for (let offsetX = -radius; offsetX <= radius; offsetX++) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
        const nextX = x + offsetX;
        if (nextX < 0 || nextX >= width) continue;
        const nextPosition = nextY * width + nextX;
        const nextIndex = nextPosition * 4;
        if (source[nextIndex + 3] < STRONG_WHITE_MIN_ALPHA) continue;
        const stats = channelStats(source, nextIndex);
        if (
          stats.minimum < STRONG_WHITE_MIN_CHANNEL
          || stats.spread > STRONG_WHITE_MAX_SPREAD
        ) {
          continue;
        }
        const distance = offsetX * offsetX + offsetY * offsetY;
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        bestValue = Math.max(225, stats.maximum);
      }
    }
    if (bestDistance < Number.POSITIVE_INFINITY) break;
  }

  return bestValue;
};

/**
 * Resampling can produce a few near-black, very-low-alpha pixels directly on
 * the transparent side of an otherwise clean white internal cutline. They are
 * nearly invisible on black but become gray dirt on white backgrounds.
 *
 * This pass changes RGB only. A hole must have overwhelming local white-cutline
 * evidence before any pixel is touched, and the alpha mask is preserved exactly.
 * Colored/metal structural openings such as spiral eyelets therefore remain
 * outside the pass even when they are small or repeated.
 */
export const normalizeEnclosedWhiteCutlineSpecks = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): EnclosedHoleCutlineNormalizationResult => {
  const source = new Uint8ClampedArray(data);
  const exterior = buildExteriorTransparency(source, width, height);
  const components = collectEnclosedTransparentComponents(source, exterior, width, height);
  let holesNormalized = 0;
  let pixelsNormalized = 0;

  for (const component of components) {
    const ringDepth = buildComponentRingDepth(component, width, height);
    let supportPixels = 0;
    let whiteSupportPixels = 0;
    let strongWhitePixels = 0;
    const candidates: number[] = [];

    for (let position = 0; position < ringDepth.length; position++) {
      const depth = ringDepth[position] - 1;
      if (depth < 1 || depth > MAX_RING_DEPTH) continue;
      const pixelIndex = position * 4;
      const alpha = source[pixelIndex + 3];
      if (alpha <= TRANSPARENT_ALPHA) continue;
      const stats = channelStats(source, pixelIndex);

      if (alpha >= WHITE_SUPPORT_MIN_ALPHA) {
        supportPixels++;
        if (stats.minimum >= WHITE_MIN_CHANNEL && stats.spread <= WHITE_MAX_SPREAD) {
          whiteSupportPixels++;
        }
      }
      if (
        alpha >= STRONG_WHITE_MIN_ALPHA
        && stats.minimum >= STRONG_WHITE_MIN_CHANNEL
        && stats.spread <= STRONG_WHITE_MAX_SPREAD
      ) {
        strongWhitePixels++;
      }

      if (
        depth === 1
        && alpha <= MAX_DARK_SPECK_ALPHA
        && stats.maximum <= MAX_DARK_SPECK_CHANNEL
      ) {
        candidates.push(position);
      }
    }

    const whiteRatio = whiteSupportPixels / Math.max(1, supportPixels);
    if (
      !candidates.length
      || supportPixels < MIN_WHITE_SUPPORT_PIXELS
      || strongWhitePixels < MIN_STRONG_WHITE_PIXELS
      || whiteRatio < MIN_WHITE_SUPPORT_RATIO
    ) {
      continue;
    }

    let changedInHole = 0;
    for (const position of candidates) {
      const pixelIndex = position * 4;
      const neutral = findNearestStrongWhiteValue(source, width, height, position);
      data[pixelIndex] = neutral;
      data[pixelIndex + 1] = neutral;
      data[pixelIndex + 2] = neutral;
      changedInHole++;
    }

    if (changedInHole) {
      holesNormalized++;
      pixelsNormalized += changedInHole;
    }
  }

  return {
    holesDetected: components.length,
    holesNormalized,
    pixelsNormalized
  };
};
