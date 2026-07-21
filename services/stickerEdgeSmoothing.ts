const loadBlobImage = (blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to load sticker PNG for edge smoothing.'));
  };
  image.src = url;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Failed to encode edge-smoothed sticker PNG.'));
  }, 'image/png');
});

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const smoothStep = (minimum: number, maximum: number, value: number) => {
  const normalized = Math.max(0, Math.min(1, (value - minimum) / Math.max(0.0001, maximum - minimum)));
  return normalized * normalized * (3 - 2 * normalized);
};

const MAX_SUPERSAMPLE_SCALE = 4;
const MIN_SUPERSAMPLE_SCALE = 2;
const MAX_SUPERSAMPLED_PIXELS = 18_000_000;
const EDGE_RADIUS = 3;
const CONTOUR_PASSES = 2;
const CONTOUR_KERNEL = [1, 2, 1] as const;
const CONTOUR_KERNEL_SUM = 16;

interface WhiteBoundaryCache {
  mask: Uint8Array;
  red: Uint8ClampedArray;
  green: Uint8ClampedArray;
  blue: Uint8ClampedArray;
}

const buildExteriorTransparency = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const pixelCount = width * height;
  const exterior = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  const enqueue = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const position = y * width + x;
    if (exterior[position] || data[position * 4 + 3] > 56) return;
    exterior[position] = 1;
    queue[queueEnd++] = position;
  };

  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (queueStart < queueEnd) {
    const position = queue[queueStart++];
    const x = position % width;
    const y = Math.floor(position / width);
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  return exterior;
};

const buildWhiteBoundaryCache = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  exteriorTransparency: Uint8Array
): WhiteBoundaryCache => {
  const pixelCount = width * height;
  const mask = new Uint8Array(pixelCount);
  const redCache = new Uint8ClampedArray(pixelCount);
  const greenCache = new Uint8ClampedArray(pixelCount);
  const blueCache = new Uint8ClampedArray(pixelCount);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maximumAlpha = 0;
      let touchesExterior = false;
      let weightedRed = 0;
      let weightedGreen = 0;
      let weightedBlue = 0;
      let whiteWeight = 0;

      for (let offsetY = -EDGE_RADIUS; offsetY <= EDGE_RADIUS; offsetY++) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= height) {
          touchesExterior = true;
          continue;
        }
        for (let offsetX = -EDGE_RADIUS; offsetX <= EDGE_RADIUS; offsetX++) {
          const sampleX = x + offsetX;
          if (sampleX < 0 || sampleX >= width) {
            touchesExterior = true;
            continue;
          }
          const samplePosition = sampleY * width + sampleX;
          const sampleIndex = samplePosition * 4;
          const alpha = data[sampleIndex + 3];
          maximumAlpha = Math.max(maximumAlpha, alpha);
          if (exteriorTransparency[samplePosition]) touchesExterior = true;
          if (alpha < 48) continue;

          const red = data[sampleIndex];
          const green = data[sampleIndex + 1];
          const blue = data[sampleIndex + 2];
          const minimumChannel = Math.min(red, green, blue);
          const maximumChannel = Math.max(red, green, blue);
          if (minimumChannel < 168 || maximumChannel - minimumChannel > 76) continue;

          const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
          const weight = alpha * Math.max(0.25, EDGE_RADIUS + 1 - distance);
          weightedRed += red * weight;
          weightedGreen += green * weight;
          weightedBlue += blue * weight;
          whiteWeight += weight;
        }
      }

      if (!touchesExterior || maximumAlpha < 210 || whiteWeight <= 0) continue;
      const position = y * width + x;
      mask[position] = 1;
      redCache[position] = clampByte(weightedRed / whiteWeight);
      greenCache[position] = clampByte(weightedGreen / whiteWeight);
      blueCache[position] = clampByte(weightedBlue / whiteWeight);
    }
  }

  return { mask, red: redCache, green: greenCache, blue: blueCache };
};

const cleanExteriorBinaryContour = (
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  boundaryMask: Uint8Array
) => {
  const pixelCount = width * height;
  const original = new Uint8Array(pixelCount);
  for (let position = 0; position < pixelCount; position++) {
    original[position] = sourceData[position * 4 + 3] >= 128 ? 1 : 0;
  }

  let current = new Uint8Array(original);
  let totalChanged = 0;

  for (let pass = 0; pass < CONTOUR_PASSES; pass++) {
    const next = new Uint8Array(current);
    let passChanged = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const position = y * width + x;
        if (!boundaryMask[position]) continue;

        let occupiedWeight = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          const sampleY = y + offsetY;
          if (sampleY < 0 || sampleY >= height) continue;
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            const sampleX = x + offsetX;
            if (sampleX < 0 || sampleX >= width) continue;
            const weight = CONTOUR_KERNEL[offsetX + 1] * CONTOUR_KERNEL[offsetY + 1];
            occupiedWeight += current[sampleY * width + sampleX] * weight;
          }
        }

        const currentValue = current[position];
        let nextValue = currentValue;
        // Preserve ties. Only clear a strong one-pixel protrusion or fill a
        // strong one-pixel notch, which removes raster teeth without rounding
        // legitimate leaves, corners or narrow artwork features.
        if (currentValue && occupiedWeight <= 7) nextValue = 0;
        else if (!currentValue && occupiedWeight >= 9) nextValue = 1;

        if (nextValue === currentValue) continue;
        next[position] = nextValue;
        passChanged++;
      }
    }

    if (passChanged > pixelCount * 0.009) {
      return { mask: original, changedPixels: 0 };
    }
    current = next;
    totalChanged += passChanged;
    if (!passChanged) break;
  }

  if (totalChanged > pixelCount * 0.014) {
    return { mask: original, changedPixels: 0 };
  }
  return { mask: current, changedPixels: totalChanged };
};

const chooseSupersampleScale = (width: number, height: number) => {
  const scaleByPixels = Math.floor(Math.sqrt(MAX_SUPERSAMPLED_PIXELS / Math.max(1, width * height)));
  return Math.max(MIN_SUPERSAMPLE_SCALE, Math.min(MAX_SUPERSAMPLE_SCALE, scaleByPixels));
};

const buildSupersampledMask = (
  binaryMask: Uint8Array,
  width: number,
  height: number,
  scale: number
) => {
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext('2d');
  if (!maskContext) return null;

  const mask = maskContext.createImageData(width, height);
  for (let position = 0; position < width * height; position++) {
    const index = position * 4;
    mask.data[index] = 255;
    mask.data[index + 1] = 255;
    mask.data[index + 2] = 255;
    mask.data[index + 3] = binaryMask[position] ? 255 : 0;
  }
  maskContext.putImageData(mask, 0, 0);

  const highResolutionCanvas = document.createElement('canvas');
  highResolutionCanvas.width = width * scale;
  highResolutionCanvas.height = height * scale;
  const highResolutionContext = highResolutionCanvas.getContext('2d');
  if (!highResolutionContext) return null;
  highResolutionContext.clearRect(0, 0, highResolutionCanvas.width, highResolutionCanvas.height);
  highResolutionContext.imageSmoothingEnabled = false;
  highResolutionContext.drawImage(maskCanvas, 0, 0, highResolutionCanvas.width, highResolutionCanvas.height);

  const reconstructedCanvas = document.createElement('canvas');
  reconstructedCanvas.width = width;
  reconstructedCanvas.height = height;
  const reconstructedContext = reconstructedCanvas.getContext('2d', { willReadFrequently: true });
  if (!reconstructedContext) return null;
  reconstructedContext.clearRect(0, 0, width, height);
  reconstructedContext.imageSmoothingEnabled = true;
  reconstructedContext.imageSmoothingQuality = 'high';
  reconstructedContext.filter = 'blur(0.46px)';
  reconstructedContext.drawImage(
    highResolutionCanvas,
    0,
    0,
    highResolutionCanvas.width,
    highResolutionCanvas.height,
    0,
    0,
    width,
    height
  );
  reconstructedContext.filter = 'none';

  const result = reconstructedContext.getImageData(0, 0, width, height).data;
  highResolutionCanvas.width = 1;
  highResolutionCanvas.height = 1;
  maskCanvas.width = 1;
  maskCanvas.height = 1;
  reconstructedCanvas.width = 1;
  reconstructedCanvas.height = 1;
  return result;
};

const runContourSmoothing = async (blob: Blob): Promise<Blob> => {
  const image = await loadBlobImage(blob);
  const width = image.width;
  const height = image.height;
  if (width < 5 || height < 5) return blob;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return blob;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0);

  const source = context.getImageData(0, 0, width, height);
  const sourceData = source.data;
  const pixelCount = width * height;
  const exteriorTransparency = buildExteriorTransparency(sourceData, width, height);
  const boundary = buildWhiteBoundaryCache(sourceData, width, height, exteriorTransparency);
  const cleanedContour = cleanExteriorBinaryContour(sourceData, width, height, boundary.mask);
  const scale = chooseSupersampleScale(width, height);
  const reconstructedMask = buildSupersampledMask(cleanedContour.mask, width, height, scale);
  if (!reconstructedMask) return blob;

  const candidateAlpha = new Uint8ClampedArray(pixelCount);
  const candidateMask = new Uint8Array(pixelCount);
  let edgePixels = 0;
  let originalEdgeAlpha = 0;
  let reconstructedEdgeAlpha = 0;

  for (let position = 0; position < pixelCount; position++) {
    if (!boundary.mask[position]) continue;
    const index = position * 4;
    const originalAlpha = sourceData[index + 3];
    const supersampledCoverage = reconstructedMask[index + 3] / 255;
    const reconstructedCoverage = smoothStep(0.1, 0.9, supersampledCoverage);
    let nextAlpha = clampByte(originalAlpha * 0.02 + reconstructedCoverage * 255 * 0.98);
    if (nextAlpha < 3) nextAlpha = 0;
    else if (nextAlpha > 252) nextAlpha = 255;
    if (Math.abs(nextAlpha - originalAlpha) < 2) continue;

    candidateMask[position] = 1;
    candidateAlpha[position] = nextAlpha;
    edgePixels++;
    originalEdgeAlpha += originalAlpha;
    reconstructedEdgeAlpha += nextAlpha;
  }

  if (!edgePixels || edgePixels > pixelCount * 0.18) return blob;

  const areaBias = (reconstructedEdgeAlpha - originalEdgeAlpha) / edgePixels;
  const output = new ImageData(new Uint8ClampedArray(sourceData), width, height);
  const outputData = output.data;
  let changedPixels = 0;
  let finalAlphaDelta = 0;

  for (let position = 0; position < pixelCount; position++) {
    if (!candidateMask[position]) continue;
    const index = position * 4;
    const originalAlpha = sourceData[index + 3];
    let nextAlpha = clampByte(candidateAlpha[position] - areaBias);
    if (nextAlpha < 3) nextAlpha = 0;
    else if (nextAlpha > 252) nextAlpha = 255;
    if (Math.abs(nextAlpha - originalAlpha) < 2) continue;

    outputData[index + 3] = nextAlpha;
    finalAlphaDelta += nextAlpha - originalAlpha;
    changedPixels++;

    if (originalAlpha <= 32 && nextAlpha > originalAlpha) {
      outputData[index] = boundary.red[position] || 255;
      outputData[index + 1] = boundary.green[position] || 255;
      outputData[index + 2] = boundary.blue[position] || 255;
    }
  }

  if (!changedPixels || changedPixels > pixelCount * 0.18) return blob;
  const maximumAreaDrift = Math.max(255 * 24, pixelCount * 255 * 0.0012);
  if (Math.abs(finalAlphaDelta) > maximumAreaDrift) return blob;

  context.putImageData(output, 0, 0);
  return canvasToBlob(canvas);
};

// The high-resolution mask can temporarily allocate significant memory. Only
// this local post-processing stage is serialized; Seedream generation keeps its
// existing adaptive worker concurrency.
let smoothingQueue: Promise<void> = Promise.resolve();

export const smoothStickerAlphaEdge = (blob: Blob): Promise<Blob> => {
  const task = smoothingQueue.then(
    () => runContourSmoothing(blob),
    () => runContourSmoothing(blob)
  );
  smoothingQueue = task.then(() => undefined, () => undefined);
  return task;
};
