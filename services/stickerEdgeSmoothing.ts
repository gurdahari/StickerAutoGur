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

const GAUSSIAN = [1, 4, 6, 4, 1] as const;
const GAUSSIAN_SUM = 16;
const GAUSSIAN_2D_SUM = GAUSSIAN_SUM * GAUSSIAN_SUM;
const RADIUS = 2;

/**
 * Smooths only the white die-cut transparency contour. A separable 5x5
 * Gaussian coverage pass rounds pixel stair-steps over a two-pixel band while
 * preserving the original 50% contour, RGB artwork and visible cutline width.
 */
export const smoothStickerAlphaEdge = async (blob: Blob): Promise<Blob> => {
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
  const output = new ImageData(new Uint8ClampedArray(sourceData), width, height);
  const outputData = output.data;
  const pixelCount = width * height;

  const horizontalAlpha = new Float32Array(pixelCount);
  const horizontalRed = new Float32Array(pixelCount);
  const horizontalGreen = new Float32Array(pixelCount);
  const horizontalBlue = new Float32Array(pixelCount);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      let alphaSum = 0;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;

      for (let offset = -RADIUS; offset <= RADIUS; offset++) {
        const sampleX = x + offset;
        if (sampleX < 0 || sampleX >= width) continue;
        const weight = GAUSSIAN[offset + RADIUS];
        const sampleIndex = (y * width + sampleX) * 4;
        const alpha = sourceData[sampleIndex + 3];
        alphaSum += alpha * weight;
        redSum += sourceData[sampleIndex] * alpha * weight;
        greenSum += sourceData[sampleIndex + 1] * alpha * weight;
        blueSum += sourceData[sampleIndex + 2] * alpha * weight;
      }

      horizontalAlpha[position] = alphaSum;
      horizontalRed[position] = redSum;
      horizontalGreen[position] = greenSum;
      horizontalBlue[position] = blueSum;
    }
  }

  let changedPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      const pixelIndex = position * 4;
      const originalAlpha = sourceData[pixelIndex + 3];
      let blurredAlpha = 0;
      let blurredPremultipliedRed = 0;
      let blurredPremultipliedGreen = 0;
      let blurredPremultipliedBlue = 0;

      for (let offset = -RADIUS; offset <= RADIUS; offset++) {
        const sampleY = y + offset;
        if (sampleY < 0 || sampleY >= height) continue;
        const weight = GAUSSIAN[offset + RADIUS];
        const samplePosition = sampleY * width + x;
        blurredAlpha += horizontalAlpha[samplePosition] * weight;
        blurredPremultipliedRed += horizontalRed[samplePosition] * weight;
        blurredPremultipliedGreen += horizontalGreen[samplePosition] * weight;
        blurredPremultipliedBlue += horizontalBlue[samplePosition] * weight;
      }

      const coverage = blurredAlpha / (255 * GAUSSIAN_2D_SUM);
      if (coverage <= 0.012 || coverage >= 0.988) continue;

      const colorDenominator = Math.max(1, blurredAlpha);
      const nearbyRed = blurredPremultipliedRed / colorDenominator;
      const nearbyGreen = blurredPremultipliedGreen / colorDenominator;
      const nearbyBlue = blurredPremultipliedBlue / colorDenominator;
      const nearbyMinimum = Math.min(nearbyRed, nearbyGreen, nearbyBlue);
      const nearbyMaximum = Math.max(nearbyRed, nearbyGreen, nearbyBlue);

      // Sticker assets should have a white cutline. Restricting smoothing to a
      // bright neutral boundary prevents any softening of the illustration.
      const isWhiteCutlineBoundary = nearbyMinimum >= 172 && nearbyMaximum - nearbyMinimum <= 72;
      if (!isWhiteCutlineBoundary) continue;

      const reconstructedCoverage = smoothStep(0.18, 0.82, coverage);
      const reconstructedAlpha = Math.round(reconstructedCoverage * 255);
      let nextAlpha = Math.round(originalAlpha * 0.14 + reconstructedAlpha * 0.86);
      if (nextAlpha < 4) nextAlpha = 0;
      else if (nextAlpha > 251) nextAlpha = 255;

      // Keep the 50% contour in place: the smoother can create a soft outside
      // pixel or soften an inside pixel, but it cannot shift the shape by more
      // than one source pixel.
      if (originalAlpha <= 8) nextAlpha = Math.min(nextAlpha, 148);
      else if (originalAlpha >= 247) nextAlpha = Math.max(nextAlpha, 108);

      if (Math.abs(nextAlpha - originalAlpha) < 3) continue;
      outputData[pixelIndex + 3] = nextAlpha;
      changedPixels++;

      if (originalAlpha <= 16 && nextAlpha > 0) {
        outputData[pixelIndex] = Math.round(nearbyRed);
        outputData[pixelIndex + 1] = Math.round(nearbyGreen);
        outputData[pixelIndex + 2] = Math.round(nearbyBlue);
      }
    }
  }

  // Normal cutline smoothing affects only a narrow perimeter. Preserve the
  // original cleaned PNG if an unexpected file would require a broad rewrite.
  if (!changedPixels || changedPixels > pixelCount * 0.16) return blob;
  context.putImageData(output, 0, 0);
  return canvasToBlob(canvas);
};
