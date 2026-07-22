export interface ChromaMatteColor {
  r: number;
  g: number;
  b: number;
}

const loadSourceImage = (source: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Failed to load sticker source for chroma-matte detection.'));
  image.src = source;
});

const loadBlobImage = (blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to load processed sticker for chroma cleanup.'));
  };
  image.src = url;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Failed to encode chroma-cleaned sticker PNG.'));
  }, 'image/png');
});

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const smoothStep = (minimum: number, maximum: number, value: number) => {
  const normalized = Math.max(0, Math.min(1, (value - minimum) / Math.max(0.0001, maximum - minimum)));
  return normalized * normalized * (3 - 2 * normalized);
};

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] || 0;
};

const colorDistance = (red: number, green: number, blue: number, matte: ChromaMatteColor) => {
  const deltaRed = red - matte.r;
  const deltaGreen = green - matte.g;
  const deltaBlue = blue - matte.b;
  return Math.sqrt(deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue);
};

/**
 * Detects only a vivid, highly saturated, uniform corner matte. Black, gray,
 * white and ordinary illustration colors are intentionally rejected. This is
 * the safety boundary that lets enclosed chroma pockets be removed without
 * reviving destructive dark-pixel cleanup.
 */
export const detectVividCornerMatte = async (source: string): Promise<ChromaMatteColor | null> => {
  const image = await loadSourceImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  const sampleSize = Math.max(4, Math.round(Math.min(image.width, image.height) * 0.022));
  const corners = [
    [0, 0],
    [image.width - sampleSize, 0],
    [0, image.height - sampleSize],
    [image.width - sampleSize, image.height - sampleSize]
  ];
  const samples: ChromaMatteColor[] = [];

  for (const [startX, startY] of corners) {
    for (let y = startY; y < startY + sampleSize; y += 2) {
      for (let x = startX; x < startX + sampleSize; x += 2) {
        const index = (y * image.width + x) * 4;
        if (data[index + 3] < 220) continue;
        samples.push({ r: data[index], g: data[index + 1], b: data[index + 2] });
      }
    }
  }

  if (samples.length < 16) return null;
  const matte = {
    r: median(samples.map(sample => sample.r)),
    g: median(samples.map(sample => sample.g)),
    b: median(samples.map(sample => sample.b))
  };
  const maximum = Math.max(matte.r, matte.g, matte.b);
  const minimum = Math.min(matte.r, matte.g, matte.b);
  const chroma = maximum - minimum;
  if (maximum < 205 || chroma < 125) return null;

  const closeSamples = samples.filter(sample => colorDistance(sample.r, sample.g, sample.b, matte) <= 58).length;
  if (closeSamples / samples.length < 0.74) return null;
  return matte;
};

/**
 * Removes reserved chroma from both enclosed openings and residual exterior
 * debris while preserving the soft alpha edge created by stickerExteriorMatte.
 *
 * Exterior cleanup grows only through pixels that still strongly resemble the
 * measured key color. A matte-to-white mixture is converted to white plus
 * fractional alpha; a key-color core becomes transparent. This removes green,
 * magenta, cyan or orange spill without thresholding or redrawing the cutline.
 */
export const removeResidualChromaMatte = async (
  blob: Blob,
  matte: ChromaMatteColor
): Promise<Blob> => {
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
  const original = new Uint8ClampedArray(data);
  const width = image.width;
  const height = image.height;
  const pixelCount = width * height;
  const seedTolerance = 44;
  const growTolerance = 92;
  const fringeTolerance = 126;
  const exteriorTolerance = 150;

  const distanceAt = (position: number) => {
    const index = position * 4;
    return colorDistance(original[index], original[index + 1], original[index + 2], matte);
  };

  const originalAlphaAt = (position: number) => original[position * 4 + 3];
  const whiteVector = {
    r: 255 - matte.r,
    g: 255 - matte.g,
    b: 255 - matte.b
  };
  const whiteVectorLengthSquared = Math.max(
    1,
    whiteVector.r * whiteVector.r + whiteVector.g * whiteVector.g + whiteVector.b * whiteVector.b
  );

  const projectOntoMatteWhite = (position: number) => {
    const index = position * 4;
    const red = original[index] - matte.r;
    const green = original[index + 1] - matte.g;
    const blue = original[index + 2] - matte.b;
    const rawCoverage = (
      red * whiteVector.r + green * whiteVector.g + blue * whiteVector.b
    ) / whiteVectorLengthSquared;
    const coverage = Math.max(0, Math.min(1, rawCoverage));
    const expectedRed = matte.r + whiteVector.r * coverage;
    const expectedGreen = matte.g + whiteVector.g * coverage;
    const expectedBlue = matte.b + whiteVector.b * coverage;
    const residualRed = original[index] - expectedRed;
    const residualGreen = original[index + 1] - expectedGreen;
    const residualBlue = original[index + 2] - expectedBlue;
    const residual = Math.sqrt(
      residualRed * residualRed + residualGreen * residualGreen + residualBlue * residualBlue
    );
    return { rawCoverage, coverage, residual };
  };

  const setTransparent = (position: number) => {
    const index = position * 4;
    data[index] = 0;
    data[index + 1] = 0;
    data[index + 2] = 0;
    data[index + 3] = 0;
  };

  const decontaminate = (position: number, coverage: number) => {
    const index = position * 4;
    const originalAlpha = original[index + 3];
    if (coverage <= 0.025) {
      setTransparent(position);
      return;
    }

    const safeCoverage = Math.max(0.06, Math.min(1, coverage));
    data[index] = clampByte((original[index] - matte.r * (1 - safeCoverage)) / safeCoverage);
    data[index + 1] = clampByte((original[index + 1] - matte.g * (1 - safeCoverage)) / safeCoverage);
    data[index + 2] = clampByte((original[index + 2] - matte.b * (1 - safeCoverage)) / safeCoverage);
    data[index + 3] = Math.min(originalAlpha, Math.max(1, clampByte(originalAlpha * safeCoverage)));
  };

  // Build only the transparency connected to the canvas exterior. Internal holes
  // are deliberately excluded so the exterior debris pass cannot cross into art.
  const exteriorTransparency = new Uint8Array(pixelCount);
  const exteriorQueue = new Int32Array(pixelCount);
  let exteriorStart = 0;
  let exteriorEnd = 0;
  const enqueueExteriorTransparency = (position: number) => {
    if (position < 0 || position >= pixelCount || exteriorTransparency[position]) return;
    if (originalAlphaAt(position) > 8) return;
    exteriorTransparency[position] = 1;
    exteriorQueue[exteriorEnd++] = position;
  };

  for (let x = 0; x < width; x++) {
    enqueueExteriorTransparency(x);
    enqueueExteriorTransparency((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueueExteriorTransparency(y * width);
    enqueueExteriorTransparency(y * width + width - 1);
  }
  while (exteriorStart < exteriorEnd) {
    const position = exteriorQueue[exteriorStart++];
    const x = position % width;
    const y = Math.floor(position / width);
    if (x > 0) enqueueExteriorTransparency(position - 1);
    if (x + 1 < width) enqueueExteriorTransparency(position + 1);
    if (y > 0) enqueueExteriorTransparency(position - width);
    if (y + 1 < height) enqueueExteriorTransparency(position + width);
  }

  // Peel residual key-colored islands from the outside inward. Pure matte is
  // removed; matte/white mixtures are whitened and retain fractional alpha. A
  // preserved soft edge is not used as a new frontier, so the pass stops there.
  const exteriorProcessed = new Uint8Array(pixelCount);
  let exteriorFrontier = exteriorTransparency;
  let exteriorChanges = 0;
  for (let pass = 0; pass < 32; pass++) {
    const nextFrontier = new Uint8Array(pixelCount);
    let passChanges = 0;
    for (let position = 0; position < pixelCount; position++) {
      if (exteriorProcessed[position] || originalAlphaAt(position) === 0) continue;
      const x = position % width;
      const y = Math.floor(position / width);
      const adjacentToExterior = (x > 0 && exteriorFrontier[position - 1])
        || (x + 1 < width && exteriorFrontier[position + 1])
        || (y > 0 && exteriorFrontier[position - width])
        || (y + 1 < height && exteriorFrontier[position + width]);
      if (!adjacentToExterior) continue;

      const distance = distanceAt(position);
      if (distance > exteriorTolerance) continue;
      const projection = projectOntoMatteWhite(position);
      const validWhiteBlend = projection.rawCoverage >= 0.006
        && projection.rawCoverage <= 1.10
        && projection.residual <= 82;

      exteriorProcessed[position] = 1;
      if (validWhiteBlend && projection.coverage > 0.025) {
        const index = position * 4;
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
        data[index + 3] = Math.min(
          originalAlphaAt(position),
          Math.max(1, clampByte(projection.coverage * 255))
        );
      } else {
        setTransparent(position);
        nextFrontier[position] = 1;
      }
      passChanges++;
    }
    exteriorChanges += passChanges;
    if (!passChanges) break;
    exteriorFrontier = nextFrontier;
  }

  // Enclosed chroma components are handled separately. Components touching the
  // exterior remain excluded here because the exterior pass above already made
  // the safe distinction between key cores and soft white-cutline mixtures.
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const removal = new Uint8Array(pixelCount);
  let totalRemoval = 0;

  for (let seed = 0; seed < pixelCount; seed++) {
    const seedIndex = seed * 4;
    if (visited[seed] || original[seedIndex + 3] < 80 || distanceAt(seed) > seedTolerance) continue;
    let start = 0;
    let end = 0;
    let corePixels = 0;
    let distanceSum = 0;
    let touchesExterior = false;
    visited[seed] = 1;
    queue[end++] = seed;

    const enqueue = (position: number) => {
      if (position < 0 || position >= pixelCount || visited[position]) return;
      const index = position * 4;
      if (original[index + 3] < 45 || distanceAt(position) > growTolerance) return;
      visited[position] = 1;
      queue[end++] = position;
    };

    while (start < end) {
      const position = queue[start++];
      const x = position % width;
      const y = Math.floor(position / width);
      const distance = distanceAt(position);
      distanceSum += distance;
      if (distance <= seedTolerance) corePixels++;

      if (exteriorTransparency[position]
        || (x > 0 && exteriorTransparency[position - 1])
        || (x + 1 < width && exteriorTransparency[position + 1])
        || (y > 0 && exteriorTransparency[position - width])
        || (y + 1 < height && exteriorTransparency[position + width])) {
        touchesExterior = true;
      }

      if (x > 0) enqueue(position - 1);
      if (x + 1 < width) enqueue(position + 1);
      if (y > 0) enqueue(position - width);
      if (y + 1 < height) enqueue(position + width);
    }

    const area = end;
    const coreRatio = corePixels / Math.max(1, area);
    const averageDistance = distanceSum / Math.max(1, area);
    const eligible = !touchesExterior
      && area >= 8
      && area <= pixelCount * 0.35
      && coreRatio >= 0.58
      && averageDistance <= 66;
    if (!eligible) continue;
    totalRemoval += area;
    for (let index = 0; index < end; index++) removal[queue[index]] = 1;
  }

  if (totalRemoval <= pixelCount * 0.30) {
    for (let position = 0; position < pixelCount; position++) {
      if (!removal[position]) continue;
      const coverage = smoothStep(seedTolerance - 8, fringeTolerance, distanceAt(position));
      decontaminate(position, coverage);
    }

    let frontier = new Uint8Array(removal);
    for (let pass = 0; pass < 2; pass++) {
      const nextFrontier = new Uint8Array(pixelCount);
      for (let position = 0; position < pixelCount; position++) {
        if (removal[position] || originalAlphaAt(position) === 0) continue;
        const x = position % width;
        const y = Math.floor(position / width);
        const adjacent = (x > 0 && frontier[position - 1])
          || (x + 1 < width && frontier[position + 1])
          || (y > 0 && frontier[position - width])
          || (y + 1 < height && frontier[position + width]);
        if (!adjacent) continue;
        const distance = distanceAt(position);
        if (distance > fringeTolerance) continue;
        const coverage = smoothStep(seedTolerance - 8, fringeTolerance, distance);
        decontaminate(position, coverage);
        nextFrontier[position] = 1;
      }
      frontier = nextFrontier;
    }
  }

  if (!exteriorChanges && !totalRemoval) return blob;

  // Fail closed if the complete soft operation changed implausibly much alpha.
  let effectiveRemovedPixels = 0;
  for (let position = 0; position < pixelCount; position++) {
    effectiveRemovedPixels += Math.max(0, originalAlphaAt(position) - data[position * 4 + 3]) / 255;
  }
  if (effectiveRemovedPixels > pixelCount * 0.30) return blob;

  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};
