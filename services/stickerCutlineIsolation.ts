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

/**
 * Removes model-created colored debris outside the white die-cut outline.
 *
 * The operation is deliberately color-agnostic. The white cutline is treated as
 * a closed barrier, then a flood-fill starts from the transparent canvas edge.
 * Any opaque non-white pixel reachable from outside is not part of the sticker
 * silhouette and can be removed. Artwork inside the cutline remains unreachable
 * even when it uses the exact same green, pink, cyan or orange as an artifact.
 *
 * Soft near-white edge pixels are protected as the barrier. A low-alpha pixel
 * immediately outside that barrier is whitened rather than deleted so the smooth
 * antialias restored by the previous fix is not turned back into a hard staircase.
 * The pass fails closed when the cutline is missing or removal would be large.
 */
export const isolateStickerByWhiteCutline = async (blob: Blob): Promise<Blob> => {
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
  const barrier = new Uint8Array(pixelCount);
  let barrierPixels = 0;
  let totalAlpha = 0;

  const isWhiteCutlinePixel = (position: number) => {
    const index = position * 4;
    const alpha = original[index + 3];
    if (alpha <= 2) return false;
    const red = original[index];
    const green = original[index + 1];
    const blue = original[index + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    // Include the full soft white antialias band, not only opaque paper white.
    return minimum >= 184 && maximum - minimum <= 72 && luma >= 202;
  };

  for (let position = 0; position < pixelCount; position++) {
    totalAlpha += original[position * 4 + 3] / 255;
    if (!isWhiteCutlinePixel(position)) continue;
    barrier[position] = 1;
    barrierPixels++;
  }

  // A valid sticker should have a substantial white cutline. Without one, never
  // infer geometry or risk deleting artwork.
  const minimumBarrierPixels = Math.max(80, Math.round(pixelCount * 0.00035));
  if (barrierPixels < minimumBarrierPixels || totalAlpha < pixelCount * 0.002) return blob;

  const exterior = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let start = 0;
  let end = 0;

  const enqueue = (position: number) => {
    if (position < 0 || position >= pixelCount || exterior[position] || barrier[position]) return;
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

  const touchesBarrier = (position: number) => {
    const x = position % width;
    const y = Math.floor(position / width);
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      const nextY = y + offsetY;
      if (nextY < 0 || nextY >= height) continue;
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const nextX = x + offsetX;
        if (nextX < 0 || nextX >= width || (!offsetX && !offsetY)) continue;
        if (barrier[nextY * width + nextX]) return true;
      }
    }
    return false;
  };

  let removedAlpha = 0;
  let changedPixels = 0;
  for (let position = 0; position < pixelCount; position++) {
    if (!exterior[position] || barrier[position]) continue;
    const index = position * 4;
    const alpha = original[index + 3];
    if (!alpha) continue;

    const red = original[index];
    const green = original[index + 1];
    const blue = original[index + 2];
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;

    // Preserve a smooth subpixel cutline: a faint bright pixel directly beside
    // the white barrier becomes neutral white with the same alpha. Fully opaque
    // colored protrusions and detached specks are removed instead.
    if (alpha < 190 && luma >= 118 && touchesBarrier(position)) {
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

  // Fail closed if the white barrier was not actually closed and the flood entered
  // meaningful artwork. Normal exterior debris is tiny relative to the sticker.
  const removalRatio = removedAlpha / Math.max(1, totalAlpha);
  if (removalRatio > 0.075 || totalAlpha - removedAlpha < totalAlpha * 0.82) return blob;

  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};
