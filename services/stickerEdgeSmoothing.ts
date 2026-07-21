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

const smoothStep = (minimum: number, maximum: number, value: number) => {
  const normalized = Math.max(0, Math.min(1, (value - minimum) / Math.max(0.0001, maximum - minimum)));
  return normalized * normalized * (3 - 2 * normalized);
};

const KERNEL = [
  { x: -1, y: -1, weight: 1 }, { x: 0, y: -1, weight: 2 }, { x: 1, y: -1, weight: 1 },
  { x: -1, y: 0, weight: 2 }, { x: 0, y: 0, weight: 4 }, { x: 1, y: 0, weight: 2 },
  { x: -1, y: 1, weight: 1 }, { x: 0, y: 1, weight: 2 }, { x: 1, y: 1, weight: 1 }
] as const;
const KERNEL_WEIGHT = 16;

/**
 * Rebuilds only the one-pixel alpha transition around the final sticker shape.
 * RGB artwork remains untouched. A small Gaussian coverage estimate is remapped
 * around the original 50% contour, which removes stair-step / saw-tooth edges
 * without blurring the illustration or making the white cutline visibly wider.
 */
export const smoothStickerAlphaEdge = async (blob: Blob): Promise<Blob> => {
  const image = await loadBlobImage(blob);
  const width = image.width;
  const height = image.height;
  if (width < 3 || height < 3) return blob;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return blob;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0);

  const source = context.getImageData(0, 0, width, height);
  const output = new ImageData(new Uint8ClampedArray(source.data), width, height);
  const sourceData = source.data;
  const outputData = output.data;
  const pixelCount = width * height;
  let changedPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      const pixelIndex = position * 4;
      const originalAlpha = sourceData[pixelIndex + 3];
      let minimumAlpha = 255;
      let maximumAlpha = 0;
      let weightedAlpha = 0;
      let weightedPremultipliedRed = 0;
      let weightedPremultipliedGreen = 0;
      let weightedPremultipliedBlue = 0;
      let weightedColorAlpha = 0;

      for (const sample of KERNEL) {
        const sampleX = x + sample.x;
        const sampleY = y + sample.y;
        if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) {
          minimumAlpha = 0;
          continue;
        }
        const sampleIndex = (sampleY * width + sampleX) * 4;
        const alpha = sourceData[sampleIndex + 3];
        minimumAlpha = Math.min(minimumAlpha, alpha);
        maximumAlpha = Math.max(maximumAlpha, alpha);
        weightedAlpha += alpha * sample.weight;
        if (alpha > 0) {
          const premultipliedWeight = alpha * sample.weight;
          weightedPremultipliedRed += sourceData[sampleIndex] * premultipliedWeight;
          weightedPremultipliedGreen += sourceData[sampleIndex + 1] * premultipliedWeight;
          weightedPremultipliedBlue += sourceData[sampleIndex + 2] * premultipliedWeight;
          weightedColorAlpha += premultipliedWeight;
        }
      }

      // Fully opaque or fully transparent neighborhoods are not edges.
      if (maximumAlpha - minimumAlpha < 72 && (originalAlpha === 0 || originalAlpha === 255)) continue;

      const coverage = weightedAlpha / (KERNEL_WEIGHT * 255);
      let nextAlpha = Math.round(smoothStep(0.12, 0.88, coverage) * 255);
      if (nextAlpha < 6) nextAlpha = 0;
      else if (nextAlpha > 249) nextAlpha = 255;

      // Keep the antialias band narrow. Transparent pixels may receive only a
      // light fringe, while opaque edge pixels retain almost all of their body.
      if (originalAlpha === 0) nextAlpha = Math.min(nextAlpha, 86);
      else if (originalAlpha === 255) nextAlpha = Math.max(nextAlpha, 176);
      else nextAlpha = Math.round(originalAlpha * 0.35 + nextAlpha * 0.65);

      if (Math.abs(nextAlpha - originalAlpha) < 3) continue;
      outputData[pixelIndex + 3] = nextAlpha;
      changedPixels++;

      // Newly antialiased pixels inherit premultiplied neighboring color instead
      // of exposing stale black/chroma RGB hidden under transparent pixels.
      if (originalAlpha <= 8 && nextAlpha > 0 && weightedColorAlpha > 0) {
        outputData[pixelIndex] = Math.round(weightedPremultipliedRed / weightedColorAlpha);
        outputData[pixelIndex + 1] = Math.round(weightedPremultipliedGreen / weightedColorAlpha);
        outputData[pixelIndex + 2] = Math.round(weightedPremultipliedBlue / weightedColorAlpha);
      }
    }
  }

  // Fail closed if an unexpected image would require changing a large fraction
  // of its pixels. Normal sticker contours affect only a thin perimeter band.
  if (!changedPixels || changedPixels > pixelCount * 0.12) return blob;
  context.putImageData(output, 0, 0);
  return canvasToBlob(canvas);
};
