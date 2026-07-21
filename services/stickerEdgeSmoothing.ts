const loadBlobImage = (blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to load sticker for edge smoothing.'));
  };
  image.src = url;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Failed to encode edge-smoothed sticker PNG.'));
  }, 'image/png');
});

const isNearWhite = (red: number, green: number, blue: number) => {
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  return minimum >= 188 && maximum - minimum <= 48;
};

/**
 * Smooths only the outer white die-cut edge. It first strips isolated dark
 * matte pixels that touch transparency, then rebuilds a one-pixel antialiased
 * white boundary from local alpha coverage. Interior artwork is never blurred.
 */
export const smoothWhiteCutlineEdges = async (blob: Blob): Promise<Blob> => {
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
  const width = image.width;
  const height = image.height;
  const pixelCount = width * height;

  const alphaAt = (position: number) => data[position * 4 + 3];
  const hasTransparentNeighbour = (position: number) => {
    const x = position % width;
    const y = Math.floor(position / width);
    return x === 0
      || y === 0
      || x === width - 1
      || y === height - 1
      || alphaAt(position - 1) <= 12
      || alphaAt(position + 1) <= 12
      || alphaAt(position - width) <= 12
      || alphaAt(position + width) <= 12;
  };

  // Confirm that this asset really has a white die-cut border before touching
  // its boundary. This makes the pass safe for unusual transparent assets.
  let boundaryPixels = 0;
  let whiteBoundaryPixels = 0;
  for (let position = 0; position < pixelCount; position++) {
    const index = position * 4;
    if (data[index + 3] <= 20 || !hasTransparentNeighbour(position)) continue;
    boundaryPixels++;
    if (isNearWhite(data[index], data[index + 1], data[index + 2])) whiteBoundaryPixels++;
  }
  if (boundaryPixels < 24 || whiteBoundaryPixels / boundaryPixels < 0.58) return blob;

  // Remove only dark contamination directly touching transparency. A valid
  // sticker with a white border should never expose dark artwork at this edge.
  for (let pass = 0; pass < 2; pass++) {
    const remove = new Uint8Array(pixelCount);
    for (let position = 0; position < pixelCount; position++) {
      const index = position * 4;
      if (data[index + 3] <= 20 || !hasTransparentNeighbour(position)) continue;
      if (!isNearWhite(data[index], data[index + 1], data[index + 2])) remove[position] = 1;
    }
    let removed = 0;
    for (let position = 0; position < pixelCount; position++) {
      if (!remove[position]) continue;
      data[position * 4 + 3] = 0;
      removed++;
    }
    if (!removed) break;
  }

  const sourceAlpha = new Uint8ClampedArray(pixelCount);
  for (let position = 0; position < pixelCount; position++) sourceAlpha[position] = alphaAt(position);
  const weights = [1, 2, 1, 2, 4, 2, 1, 2, 1];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      let weightedAlpha = 0;
      let weightTotal = 0;
      let neighbourWhite = false;
      let weightIndex = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const weight = weights[weightIndex++];
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
          const samplePosition = sampleY * width + sampleX;
          const sampleIndex = samplePosition * 4;
          weightedAlpha += sourceAlpha[samplePosition] * weight;
          weightTotal += weight;
          if (sourceAlpha[samplePosition] > 32 && isNearWhite(data[sampleIndex], data[sampleIndex + 1], data[sampleIndex + 2])) {
            neighbourWhite = true;
          }
        }
      }

      const currentAlpha = sourceAlpha[position];
      const smoothedAlpha = Math.round(weightedAlpha / Math.max(1, weightTotal));
      const isBoundaryZone = currentAlpha < 250 || hasTransparentNeighbour(position);
      if (!isBoundaryZone || !neighbourWhite) continue;

      const index = position * 4;
      if (smoothedAlpha <= 10) {
        data[index + 3] = 0;
        continue;
      }
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.min(255, Math.max(currentAlpha, smoothedAlpha));
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};
