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

const median = (values: number[]) => {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] || 0;
};

const estimateBackground = (data: Uint8ClampedArray, width: number, height: number) => {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const sampleSize = Math.max(3, Math.floor(Math.min(width, height) * 0.018));
  const corners = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize]
  ];

  for (const [startX, startY] of corners) {
    for (let y = startY; y < startY + sampleSize; y += 2) {
      for (let x = startX; x < startX + sampleSize; x += 2) {
        const index = (y * width + x) * 4;
        if (data[index + 3] === 0) continue;
        reds.push(data[index]);
        greens.push(data[index + 1]);
        blues.push(data[index + 2]);
      }
    }
  }

  return { r: median(reds), g: median(greens), b: median(blues) };
};

/**
 * Turns Seedream's flat matte background into a clean transparent PNG.
 * Only pixels connected to the canvas edge are treated as background, so dark
 * details inside the sticker remain protected by the white die-cut border.
 */
export const expectsTransparentOpening = (_prompt = '') => false;

export const processStickerImage = async (
  source: string | Blob,
  _itemPrompt = '',
  _forceOpeningRepair = false
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
  const background = estimateBackground(data, width, height);
  const backgroundLuma = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b;
  const floodTolerance = backgroundLuma < 70 ? 205 : 105;
  const haloTolerance = backgroundLuma < 70 ? 305 : 145;

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

  const hasTransparentNeighbor = (x: number, y: number) => {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
    return data[((y * width + x - 1) * 4) + 3] === 0
      || data[((y * width + x + 1) * 4) + 3] === 0
      || data[(((y - 1) * width + x) * 4) + 3] === 0
      || data[(((y + 1) * width + x) * 4) + 3] === 0;
  };

  // Peel away two exterior halo layers. This removes matte contamination and
  // model-created gray/dotted edge noise without touching protected interior art.
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

  return canvasToBlob(outputCanvas);
};
