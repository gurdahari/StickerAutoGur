const loadBlobImage = (blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to load sticker for cutline isolation.'));
  };
  image.src = url;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Failed to encode cutline-isolated sticker PNG.'));
  }, 'image/png');
});

const countMask = (mask: Uint8Array) => {
  let count = 0;
  for (let index = 0; index < mask.length; index++) count += mask[index] ? 1 : 0;
  return count;
};

const dilateMask = (source: Uint8Array, width: number, height: number, iterations: number) => {
  let current = source;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const next = new Uint8Array(source.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const position = y * width + x;
        let active = false;
        for (let offsetY = -1; offsetY <= 1 && !active; offsetY++) {
          const nextY = y + offsetY;
          if (nextY < 0 || nextY >= height) continue;
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            const nextX = x + offsetX;
            if (nextX < 0 || nextX >= width) continue;
            if (current[nextY * width + nextX]) {
              active = true;
              break;
            }
          }
        }
        if (active) next[position] = 1;
      }
    }
    current = next;
  }
  return current;
};

const erodeMask = (source: Uint8Array, width: number, height: number, iterations: number) => {
  let current = source;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const next = new Uint8Array(source.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let active = true;
        for (let offsetY = -1; offsetY <= 1 && active; offsetY++) {
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            if (!current[(y + offsetY) * width + x + offsetX]) {
              active = false;
              break;
            }
          }
        }
        if (active) next[y * width + x] = 1;
      }
    }
    current = next;
  }
  return current;
};

const closeSmallGaps = (source: Uint8Array, width: number, height: number, iterations: number) =>
  erodeMask(dilateMask(source, width, height, iterations), width, height, iterations);

const retainMeaningfulComponents = (source: Uint8Array, width: number, height: number) => {
  const pixelCount = source.length;
  const labels = new Int32Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const counts: number[] = [0];
  let label = 0;
  let largest = 0;

  for (let seed = 0; seed < pixelCount; seed++) {
    if (!source[seed] || labels[seed]) continue;
    label++;
    let start = 0;
    let end = 0;
    labels[seed] = label;
    queue[end++] = seed;

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
          const next = nextY * width + nextX;
          if (!source[next] || labels[next]) continue;
          labels[next] = label;
          queue[end++] = next;
        }
      }
    }

    counts[label] = end;
    if (end > largest) largest = end;
  }

  if (!largest) return new Uint8Array(pixelCount);
  const minimumComponent = Math.max(12, Math.floor(largest * 0.018));
  const result = new Uint8Array(pixelCount);
  for (let position = 0; position < pixelCount; position++) {
    const component = labels[position];
    if (component && counts[component] >= minimumComponent) result[position] = 1;
  }
  return result;
};

const isNearMask = (
  mask: Uint8Array,
  position: number,
  width: number,
  height: number,
  radius: number
) => {
  const x = position % width;
  const y = Math.floor(position / width);
  for (let offsetY = -radius; offsetY <= radius; offsetY++) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) continue;
    for (let offsetX = -radius; offsetX <= radius; offsetX++) {
      const nextX = x + offsetX;
      if (nextX < 0 || nextX >= width) continue;
      if (mask[nextY * width + nextX]) return true;
    }
  }
  return false;
};

let isolationQueue: Promise<void> = Promise.resolve();

const isolateStickerByWhiteCutlineImpl = async (blob: Blob): Promise<Blob> => {
  const image = await loadBlobImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return blob;
  context.clearRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);

  const imageData = context.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;
  const original = new Uint8ClampedArray(data);
  const width = image.width;
  const height = image.height;
  const pixelCount = width * height;
  let totalAlpha = 0;

  // Measure distance from real exterior transparency. Restricting the white mask
  // to this band avoids treating large white details inside the illustration as
  // the protective cutline.
  const distance = new Uint8Array(pixelCount);
  distance.fill(255);
  const distanceQueue = new Int32Array(pixelCount);
  let distanceStart = 0;
  let distanceEnd = 0;
  for (let position = 0; position < pixelCount; position++) {
    const alpha = original[position * 4 + 3];
    totalAlpha += alpha / 255;
    if (alpha > 8) continue;
    distance[position] = 0;
    distanceQueue[distanceEnd++] = position;
  }

  while (distanceStart < distanceEnd) {
    const position = distanceQueue[distanceStart++];
    const currentDistance = distance[position];
    if (currentDistance >= 8) continue;
    const x = position % width;
    const y = Math.floor(position / width);
    const enqueue = (next: number) => {
      if (distance[next] <= currentDistance + 1) return;
      distance[next] = currentDistance + 1;
      distanceQueue[distanceEnd++] = next;
    };
    if (x > 0) enqueue(position - 1);
    if (x + 1 < width) enqueue(position + 1);
    if (y > 0) enqueue(position - width);
    if (y + 1 < height) enqueue(position + width);
  }

  const whiteCandidates = new Uint8Array(pixelCount);
  for (let position = 0; position < pixelCount; position++) {
    if (distance[position] > 8) continue;
    const index = position * 4;
    const alpha = original[index + 3];
    if (alpha <= 2) continue;
    const red = original[index];
    const green = original[index + 1];
    const blue = original[index + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const chroma = maximum - minimum;
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const strongWhite = minimum >= 176 && chroma <= 64 && luma >= 196;
    const softNeutralEdge = alpha < 225 && minimum >= 138 && chroma <= 42 && luma >= 158;
    if (strongWhite || softNeutralEdge) whiteCandidates[position] = 1;
  }

  const rawCutline = retainMeaningfulComponents(whiteCandidates, width, height);
  const rawCutlinePixels = countMask(rawCutline);
  const minimumCutlinePixels = Math.max(90, Math.round(pixelCount * 0.00035));
  if (rawCutlinePixels < minimumCutlinePixels || totalAlpha < pixelCount * 0.002) return blob;

  // PR #23 used the raw white pixels as a barrier. A one-pixel colored or
  // transparent nick was therefore enough for the exterior flood to leak into
  // the sticker and trigger the fail-closed rollback. Morphological closing is
  // used only on this temporary geometry mask; it never blurs the PNG itself.
  let barrier = closeSmallGaps(rawCutline, width, height, 2);
  let barrierPixels = countMask(barrier);
  const maximumReasonableBarrier = rawCutlinePixels * 1.16 + 900;
  if (barrierPixels > maximumReasonableBarrier) {
    barrier = closeSmallGaps(rawCutline, width, height, 1);
    barrierPixels = countMask(barrier);
  }
  if (barrierPixels < rawCutlinePixels * 0.82 || barrierPixels > rawCutlinePixels * 1.22 + 1200) return blob;

  const exterior = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let start = 0;
  let end = 0;
  const enqueueExterior = (position: number) => {
    if (position < 0 || position >= pixelCount || exterior[position] || barrier[position]) return;
    exterior[position] = 1;
    queue[end++] = position;
  };

  for (let x = 0; x < width; x++) {
    enqueueExterior(x);
    enqueueExterior((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueueExterior(y * width);
    enqueueExterior(y * width + width - 1);
  }
  while (start < end) {
    const position = queue[start++];
    const x = position % width;
    const y = Math.floor(position / width);
    if (x > 0) enqueueExterior(position - 1);
    if (x + 1 < width) enqueueExterior(position + 1);
    if (y > 0) enqueueExterior(position - width);
    if (y + 1 < height) enqueueExterior(position + width);
  }

  let removedAlpha = 0;
  let repairedAlpha = 0;
  let changedPixels = 0;

  for (let position = 0; position < pixelCount; position++) {
    const index = position * 4;
    const alpha = original[index + 3];

    if (barrier[position]) {
      const nearExterior = isNearMask(exterior, position, width, height, 2);
      if (!nearExterior) continue;

      if (!rawCutline[position]) {
        // A tiny gap in the expected cutline is usually exactly where colored
        // fringe leaked through. Repair that local pixel as white instead of
        // preserving the green/pink fragment or opening the barrier again.
        let neighbourAlpha = 0;
        const x = position % width;
        const y = Math.floor(position / width);
        for (let offsetY = -2; offsetY <= 2; offsetY++) {
          const nextY = y + offsetY;
          if (nextY < 0 || nextY >= height) continue;
          for (let offsetX = -2; offsetX <= 2; offsetX++) {
            const nextX = x + offsetX;
            if (nextX < 0 || nextX >= width) continue;
            const next = nextY * width + nextX;
            if (!rawCutline[next]) continue;
            neighbourAlpha = Math.max(neighbourAlpha, original[next * 4 + 3]);
          }
        }
        const repaired = Math.max(alpha, Math.min(220, neighbourAlpha));
        if (repaired > alpha) repairedAlpha += (repaired - alpha) / 255;
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
        data[index + 3] = repaired;
        changedPixels++;
        continue;
      }

      // Neutralize only the outward-facing edge of the actual cutline. Alpha is
      // untouched, so the smooth subpixel contour from PR #21 is preserved.
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      changedPixels++;
      continue;
    }

    if (!exterior[position] || !alpha) continue;

    if (alpha < 205 && isNearMask(barrier, position, width, height, 1)) {
      // A partially transparent pixel immediately outside the repaired barrier is
      // the antialias band. Make it neutral white instead of deleting it.
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      changedPixels++;
      continue;
    }

    removedAlpha += alpha / 255;
    data[index] = 0;
    data[index + 1] = 0;
    data[index + 2] = 0;
    data[index + 3] = 0;
    changedPixels++;
  }

  if (!changedPixels) return blob;

  // Keep the operation conservative. Normal colored fringe is tiny; a large
  // alpha change means the temporary cutline barrier was not trustworthy.
  const removalRatio = removedAlpha / Math.max(1, totalAlpha);
  const repairRatio = repairedAlpha / Math.max(1, totalAlpha);
  if (removalRatio > 0.095 || repairRatio > 0.018 || totalAlpha - removedAlpha < totalAlpha * 0.84) {
    return blob;
  }

  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};

/**
 * Serialize this CPU/memory-heavy pass. Seedream generation remains concurrent;
 * only the local canvas analysis is queued, preventing ten 1K masks from being
 * allocated at the same time in the browser.
 */
export const isolateStickerByWhiteCutline = (blob: Blob): Promise<Blob> => {
  const run = isolationQueue.then(
    () => isolateStickerByWhiteCutlineImpl(blob),
    () => isolateStickerByWhiteCutlineImpl(blob)
  );
  isolationQueue = run.then(() => undefined, () => undefined);
  return run;
};
