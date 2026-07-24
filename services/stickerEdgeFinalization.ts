const DEFAULT_EDGE_DEPTH = 4;
const EXTERIOR_ALPHA_THRESHOLD = 8;

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

  return changedPixels;
};
