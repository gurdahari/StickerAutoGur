const loadBlobImage = (blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to load cleaned sticker for export normalization.'));
  };
  image.src = url;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Failed to encode normalized sticker PNG.'));
  }, 'image/png');
});

const DEFAULT_EXPORT_SIZE = 1024;
const ARTWORK_OCCUPANCY = 0.92;

/**
 * Restores the export method that produced the historically smooth cutlines:
 * crop to the real alpha bounds, then resample the complete premultiplied RGBA
 * sticker once onto a square transparent canvas with the browser's high-quality
 * image scaler. This deliberately does not inspect, threshold, blur or rebuild
 * alpha by itself. RGB and alpha travel through the same resampling operation,
 * which preserves a natural antialiased white die-cut edge.
 */
export const normalizeStickerExport = async (
  blob: Blob,
  outputSize = DEFAULT_EXPORT_SIZE
): Promise<Blob> => {
  const image = await loadBlobImage(blob);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.width;
  sourceCanvas.height = image.height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) return blob;
  sourceContext.clearRect(0, 0, image.width, image.height);
  sourceContext.drawImage(image, 0, 0);

  const pixels = sourceContext.getImageData(0, 0, image.width, image.height).data;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (pixels[(y * image.width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return blob;

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const safeOutputSize = Math.max(256, Math.round(outputSize));
  const availableSize = safeOutputSize * ARTWORK_OCCUPANCY;
  const scale = Math.min(availableSize / cropWidth, availableSize / cropHeight);
  const drawWidth = cropWidth * scale;
  const drawHeight = cropHeight * scale;

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = safeOutputSize;
  outputCanvas.height = safeOutputSize;
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) return blob;
  outputContext.clearRect(0, 0, safeOutputSize, safeOutputSize);
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  outputContext.drawImage(
    sourceCanvas,
    minX,
    minY,
    cropWidth,
    cropHeight,
    (safeOutputSize - drawWidth) / 2,
    (safeOutputSize - drawHeight) / 2,
    drawWidth,
    drawHeight
  );

  return canvasToBlob(outputCanvas);
};
