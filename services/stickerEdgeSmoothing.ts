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

interface WhiteBoundarySample {
  isEdge: boolean;
  red: number;
  green: number;
  blue: number;
}

const inspectWhiteBoundary = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): WhiteBoundarySample => {
  let minimumAlpha = 255;
  let maximumAlpha = 0;
  let weightedRed = 0;
  let weightedGreen = 0;
  let weightedBlue = 0;
  let whiteWeight = 0;

  for (let offsetY = -EDGE_RADIUS; offsetY <= EDGE_RADIUS; offsetY++) {
    const sampleY = y + offsetY;
    if (sampleY < 0 || sampleY >= height) {
      minimumAlpha = 0;
      continue;
    }
    for (let offsetX = -EDGE_RADIUS; offsetX <= EDGE_RADIUS; offsetX++) {
      const sampleX = x + offsetX;
      if (sampleX < 0 || sampleX >= width) {
        minimumAlpha = 0;
        continue;
      }
      const index = (sampleY * width + sampleX) * 4;
      const alpha = data[index + 3];
      minimumAlpha = Math.min(minimumAlpha, alpha);
      maximumAlpha = Math.max(maximumAlpha, alpha);
      if (alpha < 48) continue;

      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
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

  const crossesTransparencyBoundary = minimumAlpha <= 40 && maximumAlpha >= 210;
  if (!crossesTransparencyBoundary || whiteWeight <= 0) {
    return { isEdge: false, red: 255, green: 255, blue: 255 };
  }

  return {
    isEdge: true,
    red: weightedRed / whiteWeight,
    green: weightedGreen / whiteWeight,
    blue: weightedBlue / whiteWeight
  };
};

const chooseSupersampleScale = (width: number, height: number) => {
  const scaleByPixels = Math.floor(Math.sqrt(MAX_SUPERSAMPLED_PIXELS / Math.max(1, width * height)));
  return Math.max(MIN_SUPERSAMPLE_SCALE, Math.min(MAX_SUPERSAMPLE_SCALE, scaleByPixels));
};

const buildSupersampledMask = (
  sourceData: Uint8ClampedArray,
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
    mask.data[index + 3] = sourceData[index + 3];
  }
  maskContext.putImageData(mask, 0, 0);

  const highResolutionCanvas = document.createElement('canvas');
  highResolutionCanvas.width = width * scale;
  highResolutionCanvas.height = height * scale;
  const highResolutionContext = highResolutionCanvas.getContext('2d');
  if (!highResolutionContext) return null;
  highResolutionContext.clearRect(0, 0, highResolutionCanvas.width, highResolutionCanvas.height);
  highResolutionContext.imageSmoothingEnabled = false;
  highResolutionContext.drawImage(
    maskCanvas,
    0,
    0,
    highResolutionCanvas.width,
    highResolutionCanvas.height
  );

  const reconstructedCanvas = document.createElement('canvas');
  reconstructedCanvas.width = width;
  reconstructedCanvas.height = height;
  const reconstructedContext = reconstructedCanvas.getContext('2d', { willReadFrequently: true });
  if (!reconstructedContext) return null;
  reconstructedContext.clearRect(0, 0, width, height);
  reconstructedContext.imageSmoothingEnabled = true;
  reconstructedContext.imageSmoothingQuality = 'high';
  // The small destination-space blur rounds the block geometry created by hard
  // alpha thresholding. Supersampling then converts it into a clean sub-pixel
  // coverage mask instead of simply making the old stair-step translucent.
  reconstructedContext.filter = 'blur(0.62px)';
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

  // Release large backing stores immediately. Sticker generation may have many
  // image workers, while this final local pass is intentionally serialized.
  highResolutionCanvas.width = 1;
  highResolutionCanvas.height = 1;
  maskCanvas.width = 1;
  maskCanvas.height = 1;
  reconstructedCanvas.width = 1;
  reconstructedCanvas.height = 1;
  return result;
};

const runSupersampledSmoothing = async (blob: Blob): Promise<Blob> => {
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
  const scale = chooseSupersampleScale(width, height);
  const reconstructedMask = buildSupersampledMask(sourceData, width, height, scale);
  if (!reconstructedMask) return blob;

  const candidateAlpha = new Uint8ClampedArray(pixelCount);
  const candidateMask = new Uint8Array(pixelCount);
  const candidateRed = new Uint8ClampedArray(pixelCount);
  const candidateGreen = new Uint8ClampedArray(pixelCount);
  const candidateBlue = new Uint8ClampedArray(pixelCount);

  let edgePixels = 0;
  let originalEdgeAlpha = 0;
  let reconstructedEdgeAlpha = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      const index = position * 4;
      const originalAlpha = sourceData[index + 3];
      const boundary = inspectWhiteBoundary(sourceData, width, height, x, y);
      if (!boundary.isEdge) continue;

      const supersampledCoverage = reconstructedMask[index + 3] / 255;
      const reconstructedCoverage = smoothStep(0.08, 0.92, supersampledCoverage);
      let nextAlpha = clampByte(originalAlpha * 0.04 + reconstructedCoverage * 255 * 0.96);
      if (nextAlpha < 3) nextAlpha = 0;
      else if (nextAlpha > 252) nextAlpha = 255;
      if (Math.abs(nextAlpha - originalAlpha) < 2) continue;

      candidateMask[position] = 1;
      candidateAlpha[position] = nextAlpha;
      candidateRed[position] = clampByte(boundary.red);
      candidateGreen[position] = clampByte(boundary.green);
      candidateBlue[position] = clampByte(boundary.blue);
      edgePixels++;
      originalEdgeAlpha += originalAlpha;
      reconstructedEdgeAlpha += nextAlpha;
    }
  }

  if (!edgePixels || edgePixels > pixelCount * 0.18) return blob;

  // Preserve the total coverage of the original white cutline. This lets local
  // corners move by a fraction of a pixel while preventing the border from
  // becoming visibly thicker or thinner overall.
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

    // Newly visible sub-pixels must be white cutline pixels. Reusing hidden RGB
    // from the old transparent matte would create a dark or chroma fringe.
    if (originalAlpha <= 24 && nextAlpha > originalAlpha) {
      outputData[index] = candidateRed[position] || 255;
      outputData[index + 1] = candidateGreen[position] || 255;
      outputData[index + 2] = candidateBlue[position] || 255;
    }
  }

  if (!changedPixels || changedPixels > pixelCount * 0.18) return blob;
  const maximumAreaDrift = Math.max(255 * 24, pixelCount * 255 * 0.0012);
  if (Math.abs(finalAlphaDelta) > maximumAreaDrift) return blob;

  context.putImageData(output, 0, 0);
  return canvasToBlob(canvas);
};

// Edge reconstruction can temporarily allocate a 4x alpha canvas. Serialize
// only this local post-processing step so ten Seedream workers cannot create ten
// large supersampled masks at the same instant.
let smoothingQueue: Promise<void> = Promise.resolve();

export const smoothStickerAlphaEdge = (blob: Blob): Promise<Blob> => {
  const task = smoothingQueue.then(
    () => runSupersampledSmoothing(blob),
    () => runSupersampledSmoothing(blob)
  );
  smoothingQueue = task.then(() => undefined, () => undefined);
  return task;
};
