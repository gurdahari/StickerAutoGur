const loadImage = (source: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Failed to load image for exterior matte removal.'));
  image.src = source;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Failed to encode exterior-matte-cleaned PNG.'));
  }, 'image/png');
});

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const median = (values: number[]) => {
  values.sort((left, right) => left - right);
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
 * Removes only the matte connected to the outside canvas and reconstructs the
 * model-created matte/white transition as a continuous alpha edge.
 *
 * The earlier black-matte pipeline could identify an antialiased white border
 * by looking for neutral gray pixels. With a vivid chroma matte, a valid blended
 * edge is tinted rather than neutral. Treating it as generic fringe and setting
 * it directly to alpha 0 caused the visible one-pixel staircase. We now project
 * each boundary pixel onto the actual line between the sampled matte color and
 * pure white. That projection is the subpixel white-cutline coverage.
 */
export const processStickerImage = async (
  source: string,
  _itemPrompt = '',
  _forceOpeningRepair = false
): Promise<Blob> => {
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for exterior matte removal.');

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

  const whiteVector = {
    r: 255 - background.r,
    g: 255 - background.g,
    b: 255 - background.b
  };
  const whiteVectorLengthSquared = Math.max(
    1,
    whiteVector.r * whiteVector.r + whiteVector.g * whiteVector.g + whiteVector.b * whiteVector.b
  );

  const distanceFromBackground = (pixelIndex: number) => {
    const red = data[pixelIndex] - background.r;
    const green = data[pixelIndex + 1] - background.g;
    const blue = data[pixelIndex + 2] - background.b;
    return Math.sqrt(red * red + green * green + blue * blue);
  };

  const projectOntoMatteWhite = (pixelIndex: number) => {
    const red = data[pixelIndex] - background.r;
    const green = data[pixelIndex + 1] - background.g;
    const blue = data[pixelIndex + 2] - background.b;
    const rawCoverage = (
      red * whiteVector.r + green * whiteVector.g + blue * whiteVector.b
    ) / whiteVectorLengthSquared;
    const coverage = Math.max(0, Math.min(1, rawCoverage));
    const expectedRed = background.r + whiteVector.r * coverage;
    const expectedGreen = background.g + whiteVector.g * coverage;
    const expectedBlue = background.b + whiteVector.b * coverage;
    const residualRed = data[pixelIndex] - expectedRed;
    const residualGreen = data[pixelIndex + 1] - expectedGreen;
    const residualBlue = data[pixelIndex + 2] - expectedBlue;
    const residual = Math.sqrt(
      residualRed * residualRed + residualGreen * residualGreen + residualBlue * residualBlue
    );
    return { rawCoverage, coverage, residual };
  };

  const isMatteWhiteBlend = (pixelIndex: number) => {
    const projection = projectOntoMatteWhite(pixelIndex);
    return projection.rawCoverage >= 0.012
      && projection.rawCoverage <= 1.08
      && projection.residual <= 46;
  };

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;
  const tryQueue = (x: number, y: number) => {
    const position = y * width + x;
    if (visited[position]) return;
    const pixelIndex = position * 4;
    const transparent = data[pixelIndex + 3] === 0;
    const plainMatte = distanceFromBackground(pixelIndex) <= floodTolerance
      && !isMatteWhiteBlend(pixelIndex);
    if (transparent || plainMatte) {
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

  const hasTransparentNeighbour = (x: number, y: number) => {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
    return data[((y * width + x - 1) * 4) + 3] <= 2
      || data[((y * width + x + 1) * 4) + 3] <= 2
      || data[(((y - 1) * width + x) * 4) + 3] <= 2
      || data[(((y + 1) * width + x) * 4) + 3] <= 2;
  };

  // Resolve only the narrow edge-connected band. Valid matte/white mixtures get
  // fractional alpha; unrelated matte contamination is removed. No global alpha
  // threshold, blur, morphology or contour guessing is used.
  for (let pass = 0; pass < 3; pass++) {
    const remove = new Uint8Array(pixelCount);
    let changed = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const position = y * width + x;
        const pixelIndex = position * 4;
        if (data[pixelIndex + 3] === 0 || !hasTransparentNeighbour(x, y)) continue;

        const projection = projectOntoMatteWhite(pixelIndex);
        const validBlend = projection.rawCoverage >= 0.012
          && projection.rawCoverage <= 1.08
          && projection.residual <= 46;
        if (validBlend) {
          const nextAlpha = projection.coverage <= 0.012
            ? 0
            : Math.max(1, clampByte(projection.coverage * 255));
          data[pixelIndex] = 255;
          data[pixelIndex + 1] = 255;
          data[pixelIndex + 2] = 255;
          data[pixelIndex + 3] = Math.min(data[pixelIndex + 3], nextAlpha);
          changed++;
        } else if (distanceFromBackground(pixelIndex) <= haloTolerance) {
          remove[position] = 1;
        }
      }
    }
    for (let position = 0; position < pixelCount; position++) {
      if (!remove[position]) continue;
      data[position * 4 + 3] = 0;
      changed++;
    }
    if (!changed) break;
  }

  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};