const DEFAULT_EDGE_DEPTH = 4;
const EXTERIOR_ALPHA_THRESHOLD = 8;
const ENCLOSED_FRINGE_ALPHA_LIMIT = 160;
const ENCLOSED_FRINGE_DEPTH = 2;
const RESERVED_MATTE_KEYS = [
  { r: 0, g: 255, b: 59 },
  { r: 255, g: 0, b: 212 },
  { r: 0, g: 229, b: 255 },
  { r: 255, g: 90, b: 0 }
] as const;

const isReservedMatteWhiteBlend = (data: Uint8ClampedArray, index: number) => {
  const alpha = data[index + 3];
  if (alpha <= EXTERIOR_ALPHA_THRESHOLD || alpha >= ENCLOSED_FRINGE_ALPHA_LIMIT) return false;

  return RESERVED_MATTE_KEYS.some(matte => {
    const whiteRed = 255 - matte.r;
    const whiteGreen = 255 - matte.g;
    const whiteBlue = 255 - matte.b;
    const vectorLengthSquared = whiteRed * whiteRed
      + whiteGreen * whiteGreen
      + whiteBlue * whiteBlue;
    const observedRed = data[index] - matte.r;
    const observedGreen = data[index + 1] - matte.g;
    const observedBlue = data[index + 2] - matte.b;
    const whiteCoverage = Math.max(0, Math.min(1, (
      observedRed * whiteRed
      + observedGreen * whiteGreen
      + observedBlue * whiteBlue
    ) / Math.max(1, vectorLengthSquared)));
    if (whiteCoverage < 0.04 || whiteCoverage > 0.96) return false;

    const expectedRed = matte.r + whiteCoverage * whiteRed;
    const expectedGreen = matte.g + whiteCoverage * whiteGreen;
    const expectedBlue = matte.b + whiteCoverage * whiteBlue;
    return Math.hypot(
      data[index] - expectedRed,
      data[index + 1] - expectedGreen,
      data[index + 2] - expectedBlue
    ) <= 32;
  });
};

/**
 * Makes a transparent white-cutline PNG safe for every later resize.
 *
 * Canvas keeps RGB values even when alpha is zero. A reserved green, magenta,
 * cyan or orange matte can therefore remain hidden in transparent pixels and
 * be blended back into a visible edge by a later drawImage operation. This
 * pass changes RGB only: exterior-connected transparency and the short visible
 * cutline band are made neutral white while every alpha value stays untouched.
 */
export const neutralizeTransparentWhiteCutline = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edgeDepth = DEFAULT_EDGE_DEPTH
) => {
  const pixelCount = width * height;
  if (!pixelCount || data.length < pixelCount * 4) return 0;

  const exterior = new Uint8Array(pixelCount);
  const exteriorQueue = new Int32Array(pixelCount);
  let exteriorStart = 0;
  let exteriorEnd = 0;

  const enqueueExterior = (position: number) => {
    if (position < 0 || position >= pixelCount || exterior[position]) return;
    if (data[position * 4 + 3] > EXTERIOR_ALPHA_THRESHOLD) return;
    exterior[position] = 1;
    exteriorQueue[exteriorEnd++] = position;
  };

  for (let x = 0; x < width; x++) {
    enqueueExterior(x);
    enqueueExterior((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueueExterior(y * width);
    enqueueExterior(y * width + width - 1);
  }

  while (exteriorStart < exteriorEnd) {
    const position = exteriorQueue[exteriorStart++];
    const x = position % width;
    const y = Math.floor(position / width);
    if (x > 0) enqueueExterior(position - 1);
    if (x + 1 < width) enqueueExterior(position + 1);
    if (y > 0) enqueueExterior(position - width);
    if (y + 1 < height) enqueueExterior(position + width);
  }

  let changedPixels = 0;
  const whiten = (position: number) => {
    const index = position * 4;
    if (data[index] === 255 && data[index + 1] === 255 && data[index + 2] === 255) return;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    changedPixels++;
  };

  // Neutralize hidden RGB too. It is invisible now, but otherwise a later
  // resize can interpolate the reserved matte back into non-zero-alpha pixels.
  for (let position = 0; position < pixelCount; position++) {
    if (exterior[position]) whiten(position);
  }

  const safeDepth = Math.max(1, Math.min(8, Math.round(edgeDepth)));
  const edgeDistance = new Uint8Array(pixelCount);
  const edgeQueue = new Int32Array(pixelCount);
  let edgeStart = 0;
  let edgeEnd = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      if (exterior[position] || data[position * 4 + 3] === 0) continue;

      let adjacentToExterior = false;
      for (let offsetY = -1; offsetY <= 1 && !adjacentToExterior; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          if (exterior[nextY * width + nextX]) {
            adjacentToExterior = true;
            break;
          }
        }
      }

      if (!adjacentToExterior) continue;
      edgeDistance[position] = 1;
      edgeQueue[edgeEnd++] = position;
      whiten(position);
    }
  }

  while (edgeStart < edgeEnd) {
    const position = edgeQueue[edgeStart++];
    const currentDistance = edgeDistance[position];
    if (currentDistance >= safeDepth) continue;
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
        if (exterior[next] || edgeDistance[next] || data[next * 4 + 3] === 0) continue;
        edgeDistance[next] = currentDistance + 1;
        edgeQueue[edgeEnd++] = next;
        whiten(next);
      }
    }
  }

  // Enclosed transparent openings cannot be reached by the exterior flood.
  // Their hidden RGB is still neutralized, but visible pixels are changed only
  // when they match the measured line between a reserved matte key and white.
  // This removes key spill from handles, rings and punched holes without using
  // a broad green/cyan detector that could damage real colored artwork.
  const enclosedTransparency = new Uint8Array(pixelCount);
  for (let position = 0; position < pixelCount; position++) {
    if (exterior[position] || data[position * 4 + 3] > EXTERIOR_ALPHA_THRESHOLD) continue;
    enclosedTransparency[position] = 1;
    whiten(position);
  }

  const enclosedDistance = new Uint8Array(pixelCount);
  const enclosedQueue = new Int32Array(pixelCount);
  let enclosedStart = 0;
  let enclosedEnd = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      const index = position * 4;
      if (!isReservedMatteWhiteBlend(data, index)) continue;

      let adjacentToOpening = false;
      for (let offsetY = -1; offsetY <= 1 && !adjacentToOpening; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          if (enclosedTransparency[nextY * width + nextX]) {
            adjacentToOpening = true;
            break;
          }
        }
      }

      if (!adjacentToOpening) continue;
      enclosedDistance[position] = 1;
      enclosedQueue[enclosedEnd++] = position;
      whiten(position);
    }
  }

  while (enclosedStart < enclosedEnd) {
    const position = enclosedQueue[enclosedStart++];
    const currentDistance = enclosedDistance[position];
    if (currentDistance >= ENCLOSED_FRINGE_DEPTH) continue;
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
        const nextIndex = next * 4;
        if (
          exterior[next]
          || enclosedTransparency[next]
          || enclosedDistance[next]
          || !isReservedMatteWhiteBlend(data, nextIndex)
        ) {
          continue;
        }
        enclosedDistance[next] = currentDistance + 1;
        enclosedQueue[enclosedEnd++] = next;
        whiten(next);
      }
    }
  }

  return changedPixels;
};
