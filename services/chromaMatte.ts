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
 * Removes only components that strongly match the vivid corner key color.
 * It never targets black or generic dark pixels, so it is safe to run even on
 * detailed scenes where the normal enclosed-matte algorithm is fail-closed.
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
  const width = image.width;
  const height = image.height;
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const removal = new Uint8Array(pixelCount);
  const seedTolerance = 44;
  const growTolerance = 88;
  let totalRemoval = 0;

  const distanceAt = (position: number) => {
    const index = position * 4;
    return colorDistance(data[index], data[index + 1], data[index + 2], matte);
  };

  for (let seed = 0; seed < pixelCount; seed++) {
    const seedIndex = seed * 4;
    if (visited[seed] || data[seedIndex + 3] < 80 || distanceAt(seed) > seedTolerance) continue;
    let start = 0;
    let end = 0;
    let corePixels = 0;
    let distanceSum = 0;
    visited[seed] = 1;
    queue[end++] = seed;

    const enqueue = (position: number) => {
      if (position < 0 || position >= pixelCount || visited[position]) return;
      const index = position * 4;
      if (data[index + 3] < 45 || distanceAt(position) > growTolerance) return;
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
      if (x > 0) enqueue(position - 1);
      if (x + 1 < width) enqueue(position + 1);
      if (y > 0) enqueue(position - width);
      if (y + 1 < height) enqueue(position + width);
    }

    const area = end;
    const coreRatio = corePixels / Math.max(1, area);
    const averageDistance = distanceSum / Math.max(1, area);
    const eligible = area >= 8
      && area <= pixelCount * 0.35
      && coreRatio >= 0.58
      && averageDistance <= 64;
    if (!eligible) continue;
    totalRemoval += area;
    for (let index = 0; index < end; index++) removal[queue[index]] = 1;
  }

  if (!totalRemoval || totalRemoval > pixelCount * 0.30) return blob;
  for (let position = 0; position < pixelCount; position++) {
    if (removal[position]) data[position * 4 + 3] = 0;
  }

  const hasTransparentNeighbour = (position: number) => {
    const x = position % width;
    const y = Math.floor(position / width);
    return x === 0
      || y === 0
      || x === width - 1
      || y === height - 1
      || data[(position - 1) * 4 + 3] === 0
      || data[(position + 1) * 4 + 3] === 0
      || data[(position - width) * 4 + 3] === 0
      || data[(position + width) * 4 + 3] === 0;
  };

  for (let pass = 0; pass < 2; pass++) {
    const fringe = new Uint8Array(pixelCount);
    for (let position = 0; position < pixelCount; position++) {
      const index = position * 4;
      if (data[index + 3] === 0 || !hasTransparentNeighbour(position)) continue;
      if (distanceAt(position) <= 112) fringe[position] = 1;
    }
    for (let position = 0; position < pixelCount; position++) {
      if (fringe[position]) data[position * 4 + 3] = 0;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};
