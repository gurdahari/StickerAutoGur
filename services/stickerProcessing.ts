import {
  inspectStickerBackground,
  reconstructReservedMatteWhitePixel,
  removeEnclosedReservedMatte
} from './reservedMatte';

const loadImage = (source: string | Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : null;
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    resolve(image);
  };
  image.onerror = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    reject(new Error('Failed to load image for sticker processing.'));
  };
  image.src = typeof source === 'string' ? source : objectUrl!;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Failed to encode processed sticker PNG.'));
  }, 'image/png');
});

const removeDetachedPixels = (data: Uint8ClampedArray, width: number, height: number) => {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let largestSeed = -1;
  let largestSize = 0;
  const isVisible = (position: number) => data[position * 4 + 3] > 8;

  const visitComponent = (seed: number) => {
    let start = 0;
    let end = 0;
    visited[seed] = 1;
    queue[end++] = seed;

    while (start < end) {
      const position = queue[start++];
      const x = position % width;
      const y = Math.floor(position / width);

      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (visited[next] || !isVisible(next)) continue;
          visited[next] = 1;
          queue[end++] = next;
        }
      }
    }

    return end;
  };

  for (let position = 0; position < pixelCount; position++) {
    if (visited[position] || !isVisible(position)) continue;
    const size = visitComponent(position);
    if (size > largestSize) {
      largestSeed = position;
      largestSize = size;
    }
  }

  if (largestSeed < 0) return;
  visited.fill(0);
  visitComponent(largestSeed);

  for (let position = 0; position < pixelCount; position++) {
    if (!visited[position]) data[position * 4 + 3] = 0;
  }
};

const softenFinalAlphaEdge = (context: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const source = new Uint8ClampedArray(data);
  const weights = [0.216, 0.568, 0.216];
  let originalCoverage = 0;
  let revisedCoverage = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const originalAlpha = source[index + 3];
      originalCoverage += originalAlpha;
      let blurredAlpha = 0;

      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const neighbourY = y + offsetY;
        if (neighbourY < 0 || neighbourY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const neighbourX = x + offsetX;
          if (neighbourX < 0 || neighbourX >= width) continue;
          const neighbour = (neighbourY * width + neighbourX) * 4;
          blurredAlpha += source[neighbour + 3]
            * weights[offsetX + 1]
            * weights[offsetY + 1];
        }
      }

      const revisedAlpha = Math.round(blurredAlpha);
      data[index + 3] = revisedAlpha;
      revisedCoverage += revisedAlpha;
      if (originalAlpha === 0 && revisedAlpha > 0) {
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
      }
    }
  }

  const coverageChange = Math.abs(revisedCoverage - originalCoverage) / Math.max(1, originalCoverage);
  if (coverageChange > 0.003) return;
  context.putImageData(imageData, 0, 0);
};

/**
 * Turns Seedream's flat matte background into a clean transparent PNG.
 * Edge-connected pixels remain the default background path. Enclosed pixels
 * are removed only when all four corners verify one exact reserved matte key,
 * so black outlines, shadows and artwork stay protected.
 */
export const expectsTransparentOpening = (prompt = '') =>
  /\b(frame|window|tube|pipe|hose|ring|hoop|loop|chain|scissors|glasses|stethoscope|wheel|handle|arch|doorway|portal|opening|cutout|negative space)\b/i.test(prompt);

export const processStickerImage = async (
  source: string | Blob,
  _itemPrompt = '',
  forceOpeningRepair = false
): Promise<Blob> => {
  const image = await loadImage(source);
  const workingCanvas = document.createElement('canvas');
  workingCanvas.width = image.width;
  workingCanvas.height = image.height;
  const context = workingCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for sticker processing.');

  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;
  const width = image.width;
  const height = image.height;
  const pixelCount = width * height;
  const backgroundInspection = inspectStickerBackground(data, width, height);
  const background = backgroundInspection.background;
  if (!forceOpeningRepair && !backgroundInspection.hasStableReservedMatte) {
    throw new Error('The generated source did not contain one verified reserved matte key in all four corners.');
  }
  const backgroundLuma = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b;
  const floodTolerance = backgroundInspection.hasStableReservedMatte
    ? 88
    : backgroundLuma < 70
      ? 205
      : 105;
  const haloTolerance = backgroundInspection.hasStableReservedMatte
    ? 112
    : backgroundLuma < 70
      ? 305
      : 145;

  const distanceFromBackground = (pixelIndex: number) => {
    const red = data[pixelIndex] - background.r;
    const green = data[pixelIndex + 1] - background.g;
    const blue = data[pixelIndex + 2] - background.b;
    return Math.sqrt(red * red + green * green + blue * blue);
  };

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  const tryQueue = (x: number, y: number) => {
    const position = y * width + x;
    if (visited[position]) return;
    const pixelIndex = position * 4;
    if (data[pixelIndex + 3] === 0 || distanceFromBackground(pixelIndex) <= floodTolerance) {
      visited[position] = 1;
      queue[queueEnd++] = position;
    }
  };

  for (let x = 0; x < width; x++) {
    tryQueue(x, 0);
    tryQueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryQueue(0, y);
    tryQueue(width - 1, y);
  }

  while (queueStart < queueEnd) {
    const position = queue[queueStart++];
    const x = position % width;
    const y = Math.floor(position / width);
    data[position * 4 + 3] = 0;

    if (x > 0) tryQueue(x - 1, y);
    if (x + 1 < width) tryQueue(x + 1, y);
    if (y > 0) tryQueue(x, y - 1);
    if (y + 1 < height) tryQueue(x, y + 1);
  }

  if (backgroundInspection.hasStableReservedMatte) {
    removeEnclosedReservedMatte(data, width, height, distanceFromBackground);
  }

  const hasTransparentNeighbor = (x: number, y: number) => {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
    return data[((y * width + x - 1) * 4) + 3] === 0
      || data[((y * width + x + 1) * 4) + 3] === 0
      || data[(((y - 1) * width + x) * 4) + 3] === 0
      || data[(((y + 1) * width + x) * 4) + 3] === 0;
  };

  // Peel two contamination layers around the exterior and any verified reserved
  // matte openings. No generic black/dark-pixel cleanup runs here.
  for (let pass = 0; pass < 2; pass++) {
    const remove = new Uint8Array(pixelCount);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const position = y * width + x;
        const pixelIndex = position * 4;
        if (data[pixelIndex + 3] === 0 || !hasTransparentNeighbor(x, y)) continue;
        if (distanceFromBackground(pixelIndex) <= haloTolerance) remove[position] = 1;
      }
    }
    for (let position = 0; position < pixelCount; position++) {
      if (remove[position]) data[position * 4 + 3] = 0;
    }
  }

  // Reconstruct a short anti-aliased white cutline instead of keeping a dirty
  // gray fringe that was blended against Seedream's black matte.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      const pixelIndex = position * 4;
      if (data[pixelIndex + 3] === 0 || !hasTransparentNeighbor(x, y)) continue;

      if (
        backgroundInspection.hasStableReservedMatte
        && reconstructReservedMatteWhitePixel(data, pixelIndex, background)
      ) {
        continue;
      }

      const channelSpread = Math.max(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2])
        - Math.min(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2]);
      const distance = distanceFromBackground(pixelIndex);
      if (channelSpread <= 32 && distance < 405) {
        const alpha = Math.max(70, Math.min(255, Math.round(((distance - haloTolerance) / (405 - haloTolerance)) * 255)));
        data[pixelIndex] = 255;
        data[pixelIndex + 1] = 255;
        data[pixelIndex + 2] = 255;
        data[pixelIndex + 3] = Math.min(data[pixelIndex + 3], alpha);
      }
    }
  }

  // The generation contract requires one connected sticker. Preserve its
  // pixels exactly and discard only detached dots or matte debris.
  removeDetachedPixels(data, width, height);

  context.putImageData(imageData, 0, 0);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) throw new Error('Sticker cleanup removed the entire image.');

  // Normalize every sticker to a consistent square canvas and let the artwork
  // occupy 92% of it. This replaces the old shadow padding that made assets small.
  const outputSize = Math.max(width, height);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputSize;
  outputCanvas.height = outputSize;
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) throw new Error('Canvas is unavailable for sticker normalization.');

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const availableSize = outputSize * 0.92;
  const scale = Math.min(availableSize / cropWidth, availableSize / cropHeight);
  const drawWidth = cropWidth * scale;
  const drawHeight = cropHeight * scale;

  outputContext.clearRect(0, 0, outputSize, outputSize);
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  outputContext.drawImage(
    workingCanvas,
    minX,
    minY,
    cropWidth,
    cropHeight,
    (outputSize - drawWidth) / 2,
    (outputSize - drawHeight) / 2,
    drawWidth,
    drawHeight
  );
  softenFinalAlphaEdge(outputContext, outputSize, outputSize);

  return canvasToBlob(outputCanvas);
};
