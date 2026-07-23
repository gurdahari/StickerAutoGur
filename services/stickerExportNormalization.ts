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
const EXTERIOR_ALPHA_THRESHOLD = 8;
const WHITE_EDGE_DEPTH = 4;

/**
 * Neutralizes the final antialias band without changing its geometry.
 *
 * Source-background RGB can survive inside low-alpha samples at the generated
 * subject boundary. The final resize can blend those samples into the
 * deterministic white cutline. At this point the sticker contract is strong:
 * every exterior-facing edge is the locally constructed white border. We
 * therefore whiten only the short band connected to real canvas-exterior
 * transparency and preserve every alpha value exactly.
 */
export const neutralizeExteriorCutlineFringe = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edgeDepth = WHITE_EDGE_DEPTH
) => {
  const pixelCount = width * height;
  if (!pixelCount || data.length < pixelCount * 4) return 0;

  const exterior = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let start = 0;
  let end = 0;

  const enqueueExterior = (position: number) => {
    if (position < 0 || position >= pixelCount || exterior[position]) return;
    if (data[position * 4 + 3] > EXTERIOR_ALPHA_THRESHOLD) return;
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

  let changedPixels = 0;
  const whiten = (position: number) => {
    const index = position * 4;
    if (!data[index + 3]) return;
    if (data[index] === 255 && data[index + 1] === 255 && data[index + 2] === 255) return;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    changedPixels++;
  };

  const safeDepth = Math.max(1, Math.min(8, Math.round(edgeDepth)));
  const edgeDistance = new Uint8Array(pixelCount);
  const edgeQueue = new Int32Array(pixelCount);
  let edgeStart = 0;
  let edgeEnd = 0;

  // Alpha 1–8 pixels belong to the exterior flood, but remain visible on dark
  // surfaces. Neutralize their RGB instead of thresholding them away. In the
  // same pass, seed only the first opaque edge row so later growth is O(edge)
  // rather than rescanning the full 1K canvas for every depth.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      if (exterior[position]) {
        whiten(position);
        continue;
      }
      if (data[position * 4 + 3] === 0) continue;

      let adjacentToExterior = false;
      for (let offsetY = -1; offsetY <= 1 && !adjacentToExterior; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          if (exterior[nextY * width + nextX]) {
            adjacentToExterior = true;
            break;
          }
        }
      }

      if (!adjacentToExterior) continue;
      edgeDistance[position] = 1;
      edgeQueue[edgeEnd++] = position;
      whiten(position);
    }
  }

  while (edgeStart < edgeEnd) {
    const position = edgeQueue[edgeStart++];
    const currentDistance = edgeDistance[position];
    if (currentDistance >= safeDepth) continue;
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
        if (exterior[next] || edgeDistance[next] || data[next * 4 + 3] === 0) continue;
        edgeDistance[next] = currentDistance + 1;
        edgeQueue[edgeEnd++] = next;
        whiten(next);
      }
    }
  }

  return changedPixels;
};

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

  // Run after the last resample so interpolation cannot tint the locally
  // constructed white border with source-background RGB.
  const outputImageData = outputContext.getImageData(0, 0, safeOutputSize, safeOutputSize);
  neutralizeExteriorCutlineFringe(outputImageData.data, safeOutputSize, safeOutputSize);
  outputContext.putImageData(outputImageData, 0, 0);

  return canvasToBlob(outputCanvas);
};
