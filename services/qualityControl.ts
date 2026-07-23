import type { Sticker, StickerQaMetrics } from '../types';
import type { QaContactSheetInput } from './aiService';
import { expectsTransparentOpening } from './stickerProcessing';

export interface LocalStickerQaResult {
  id: number;
  metrics: StickerQaMetrics;
  perceptualHash: string;
  issues: string[];
}

interface AlphaTopologyMetrics {
  boundingBoxFillRatio: number;
  largestInteriorTransparentRatio: number;
  centerTransparentRatio: number;
  significantOpaqueComponents: number;
  largestOpaqueComponentRatio: number;
}

const RESERVED_CHROMA_MATTES = [
  { name: 'green', r: 0, g: 255, b: 59 },
  { name: 'magenta', r: 255, g: 0, b: 212 },
  { name: 'cyan', r: 0, g: 229, b: 255 },
  { name: 'orange', r: 255, g: 90, b: 0 }
] as const;
const RESERVED_CHROMA_DISTANCE_SQUARED = 48 * 48;

export const measureReservedChromaLeak = (
  data: Uint8ClampedArray,
  artworkPixels: number
) => {
  const counts = new Uint32Array(RESERVED_CHROMA_MATTES.length);
  const pixelCount = Math.floor(data.length / 4);

  for (let position = 0; position < pixelCount; position++) {
    const index = position * 4;
    if (data[index + 3] <= 20) continue;
    for (let matteIndex = 0; matteIndex < RESERVED_CHROMA_MATTES.length; matteIndex++) {
      const matte = RESERVED_CHROMA_MATTES[matteIndex];
      const red = data[index] - matte.r;
      const green = data[index + 1] - matte.g;
      const blue = data[index + 2] - matte.b;
      if (red * red + green * green + blue * blue <= RESERVED_CHROMA_DISTANCE_SQUARED) {
        counts[matteIndex]++;
      }
    }
  }

  let dominantIndex = 0;
  for (let index = 1; index < counts.length; index++) {
    if (counts[index] > counts[dominantIndex]) dominantIndex = index;
  }
  const leakedPixels = counts[dominantIndex] || 0;
  return {
    matte: RESERVED_CHROMA_MATTES[dominantIndex].name,
    leakedPixels,
    canvasRatio: leakedPixels / Math.max(1, pixelCount),
    artworkRatio: leakedPixels / Math.max(1, artworkPixels)
  };
};

const loadBlobImage = (blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to load a sticker for quality control.'));
  };
  image.src = url;
});

const makePerceptualHash = (image: HTMLImageElement) => {
  const canvas = document.createElement('canvas');
  canvas.width = 9;
  canvas.height = 8;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for duplicate detection.');
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, 9, 8);
  const scale = Math.min(9 / image.width, 8 / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (9 - width) / 2, (8 - height) / 2, width, height);
  const pixels = context.getImageData(0, 0, 9, 8).data;
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = (y * 9 + x) * 4;
      const right = left + 4;
      const leftLuma = pixels[left] * 0.299 + pixels[left + 1] * 0.587 + pixels[left + 2] * 0.114;
      const rightLuma = pixels[right] * 0.299 + pixels[right + 1] * 0.587 + pixels[right + 2] * 0.114;
      bits += leftLuma > rightLuma ? '1' : '0';
    }
  }
  return bits.match(/.{1,4}/g)?.map(group => parseInt(group, 2).toString(16)).join('') || '';
};

export const hammingDistance = (left: string, right: string) => {
  if (!left || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index++) {
    let xor = parseInt(left[index], 16) ^ parseInt(right[index], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
};

const measureLargestSolidBlackComponent = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  artworkPixels: number
) => {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const minimumSpan = Math.max(8, Math.round(Math.min(width, height) * 0.025));
  let largestDenseComponent = 0;

  const isSolidBlack = (position: number) => {
    const index = position * 4;
    return data[index + 3] >= 220
      && data[index] <= 12
      && data[index + 1] <= 12
      && data[index + 2] <= 12;
  };

  for (let seed = 0; seed < pixelCount; seed++) {
    if (visited[seed] || !isSolidBlack(seed)) continue;
    let start = 0;
    let end = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    visited[seed] = 1;
    queue[end++] = seed;
    const enqueue = (neighbour: number) => {
      if (visited[neighbour] || !isSolidBlack(neighbour)) return;
      visited[neighbour] = 1;
      queue[end++] = neighbour;
    };

    while (start < end) {
      const position = queue[start++];
      const x = position % width;
      const y = Math.floor(position / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      if (x > 0) enqueue(position - 1);
      if (x + 1 < width) enqueue(position + 1);
      if (y > 0) enqueue(position - width);
      if (y + 1 < height) enqueue(position + width);
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const density = end / Math.max(1, componentWidth * componentHeight);
    if (
      Math.min(componentWidth, componentHeight) >= minimumSpan
      && density >= 0.28
      && end > largestDenseComponent
    ) {
      largestDenseComponent = end;
    }
  }

  return largestDenseComponent / Math.max(1, artworkPixels);
};

const measureAlphaTopology = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  artworkPixels: number
): AlphaTopologyMetrics => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let position = 0; position < width * height; position++) {
    if (data[position * 4 + 3] <= 20) continue;
    const x = position % width;
    const y = Math.floor(position / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (maxX < minX || maxY < minY) {
    return {
      boundingBoxFillRatio: 0,
      largestInteriorTransparentRatio: 1,
      centerTransparentRatio: 1,
      significantOpaqueComponents: 0,
      largestOpaqueComponentRatio: 0
    };
  }

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const boxArea = Math.max(1, boxWidth * boxHeight);
  const pixelCount = width * height;
  const queue = new Int32Array(pixelCount);

  const transparentVisited = new Uint8Array(pixelCount);
  let largestInteriorTransparent = 0;
  const isTransparent = (position: number) => data[position * 4 + 3] <= 8;

  for (let seedY = minY; seedY <= maxY; seedY++) {
    for (let seedX = minX; seedX <= maxX; seedX++) {
      const seed = seedY * width + seedX;
      if (transparentVisited[seed] || !isTransparent(seed)) continue;
      let start = 0;
      let end = 0;
      let touchesBoxEdge = false;
      transparentVisited[seed] = 1;
      queue[end++] = seed;
      const enqueue = (position: number) => {
        if (transparentVisited[position] || !isTransparent(position)) return;
        transparentVisited[position] = 1;
        queue[end++] = position;
      };

      while (start < end) {
        const position = queue[start++];
        const x = position % width;
        const y = Math.floor(position / width);
        if (x === minX || x === maxX || y === minY || y === maxY) touchesBoxEdge = true;
        if (x > minX) enqueue(position - 1);
        if (x < maxX) enqueue(position + 1);
        if (y > minY) enqueue(position - width);
        if (y < maxY) enqueue(position + width);
      }

      if (!touchesBoxEdge) largestInteriorTransparent = Math.max(largestInteriorTransparent, end);
    }
  }

  const opaqueVisited = new Uint8Array(pixelCount);
  let significantOpaqueComponents = 0;
  let largestOpaqueComponent = 0;
  const minimumSignificantArea = Math.max(20, Math.round(boxArea * 0.0015));
  const isOpaque = (position: number) => data[position * 4 + 3] > 20;

  for (let seedY = minY; seedY <= maxY; seedY++) {
    for (let seedX = minX; seedX <= maxX; seedX++) {
      const seed = seedY * width + seedX;
      if (opaqueVisited[seed] || !isOpaque(seed)) continue;
      let start = 0;
      let end = 0;
      opaqueVisited[seed] = 1;
      queue[end++] = seed;
      const enqueue = (position: number) => {
        if (opaqueVisited[position] || !isOpaque(position)) return;
        opaqueVisited[position] = 1;
        queue[end++] = position;
      };

      while (start < end) {
        const position = queue[start++];
        const x = position % width;
        const y = Math.floor(position / width);
        if (x > minX) enqueue(position - 1);
        if (x < maxX) enqueue(position + 1);
        if (y > minY) enqueue(position - width);
        if (y < maxY) enqueue(position + width);
      }

      largestOpaqueComponent = Math.max(largestOpaqueComponent, end);
      if (end >= minimumSignificantArea) significantOpaqueComponents++;
    }
  }

  const centerMinX = minX + Math.floor(boxWidth * 0.2);
  const centerMaxX = maxX - Math.floor(boxWidth * 0.2);
  const centerMinY = minY + Math.floor(boxHeight * 0.2);
  const centerMaxY = maxY - Math.floor(boxHeight * 0.2);
  let centerPixels = 0;
  let centerTransparent = 0;
  for (let y = centerMinY; y <= centerMaxY; y++) {
    for (let x = centerMinX; x <= centerMaxX; x++) {
      centerPixels++;
      if (isTransparent(y * width + x)) centerTransparent++;
    }
  }

  return {
    boundingBoxFillRatio: artworkPixels / boxArea,
    largestInteriorTransparentRatio: largestInteriorTransparent / boxArea,
    centerTransparentRatio: centerTransparent / Math.max(1, centerPixels),
    significantOpaqueComponents,
    largestOpaqueComponentRatio: largestOpaqueComponent / Math.max(1, artworkPixels)
  };
};

const allowsSparseOrOpenGeometry = (prompt: string) =>
  expectsTransparentOpening(prompt)
  || /\b(crescent|moon phase|wreath|outline|line art|wireframe|skeleton|rib ?cage|skull|antlers?|branches?|tree|feather|wings?|lace|web|spiderweb|constellation|orbit|frame|arch|portal|ring|chain)\b/i.test(prompt);

export const inspectStickerLocally = async (sticker: Sticker): Promise<LocalStickerQaResult> => {
  if (!sticker.blob || sticker.blob.size === 0) {
    throw new Error(`Sticker #${sticker.id} has no PNG data.`);
  }
  const image = await loadBlobImage(sticker.blob);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for local quality control.');
  context.clearRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  const pixelCount = image.width * image.height;
  let transparent = 0;
  let artwork = 0;
  let softAlpha = 0;
  let touchesCanvasEdge = false;

  for (let position = 0; position < pixelCount; position++) {
    const alpha = data[position * 4 + 3];
    if (alpha <= 8) transparent++;
    if (alpha > 20) artwork++;
    if (alpha > 8 && alpha < 104) softAlpha++;
    if (alpha > 8) {
      const x = position % image.width;
      const y = Math.floor(position / image.width);
      if (x === 0 || y === 0 || x === image.width - 1 || y === image.height - 1) touchesCanvasEdge = true;
    }
  }

  const metrics: StickerQaMetrics = {
    width: image.width,
    height: image.height,
    transparentRatio: transparent / Math.max(1, pixelCount),
    artworkRatio: artwork / Math.max(1, pixelCount),
    softAlphaRatio: softAlpha / Math.max(1, artwork),
    largestSolidBlackRatio: measureLargestSolidBlackComponent(data, image.width, image.height, artwork),
    touchesCanvasEdge
  };
  const topology = measureAlphaTopology(data, image.width, image.height, artwork);
  const chromaLeak = measureReservedChromaLeak(data, artwork);
  const issues: string[] = [];
  if (Math.min(image.width, image.height) < 256) issues.push('Exported PNG is below the minimum safe pixel dimension.');
  if (sticker.blob.type && sticker.blob.type !== 'image/png') issues.push('Final sticker file is not a PNG.');
  if (metrics.transparentRatio < 0.01) issues.push('Transparent background is missing or too small to verify.');
  if (metrics.artworkRatio < 0.035) issues.push('Artwork occupies too little of the exported canvas.');
  if (metrics.artworkRatio > 0.985) issues.push('Artwork fills almost the entire canvas and may contain an unremoved background.');
  if (metrics.softAlphaRatio > 0.10) issues.push('Extreme semi-transparent edge coverage may create a visible halo.');
  const subject = sticker.prompt.match(/SUBJECT:\s*([^|]+)/i)?.[1] || sticker.prompt;
  const explicitlyBlackSubject = /\b(silhouette|solid black|black cat|black bear|black dog|black raven|black crow|black bat|black ink|vinyl record|tire|shadow figure)\b/i.test(subject);
  const blackRegionLimit = expectsTransparentOpening(sticker.prompt)
    ? 0.04
    : explicitlyBlackSubject
      ? 0.25
      : 0.12;
  if (metrics.largestSolidBlackRatio > blackRegionLimit) {
    issues.push('Large solid-black interior region may be an unremoved opening or a Seedream artwork hallucination.');
  }

  const allowsOpenGeometry = allowsSparseOrOpenGeometry(sticker.prompt);
  if (!allowsOpenGeometry && topology.largestInteriorTransparentRatio > 0.055) {
    issues.push('Large unintended transparent hole detected inside the sticker silhouette.');
  }
  if (
    !allowsOpenGeometry
    && topology.centerTransparentRatio > 0.58
    && topology.boundingBoxFillRatio < 0.42
  ) {
    issues.push('The subject center is mostly transparent, suggesting cleanup removed part of the artwork.');
  }
  if (!allowsOpenGeometry && topology.boundingBoxFillRatio < 0.16) {
    issues.push('The sticker silhouette is abnormally hollow for this subject.');
  }
  if (
    topology.significantOpaqueComponents >= 8
    && topology.largestOpaqueComponentRatio < 0.72
  ) {
    issues.push('Artwork is fragmented into too many disconnected pieces.');
  }
  if (
    chromaLeak.canvasRatio > 0.04
    && chromaLeak.artworkRatio > 0.16
    && topology.significantOpaqueComponents >= 2
    && topology.largestOpaqueComponentRatio < 0.82
  ) {
    issues.push(`Reserved ${chromaLeak.matte} chroma-matte background remains in multiple large image regions.`);
  }
  if (touchesCanvasEdge) issues.push('Artwork touches the canvas edge and may be cropped.');

  return {
    id: sticker.id,
    metrics,
    perceptualHash: makePerceptualHash(image),
    issues
  };
};

export const findVisualDuplicateGroups = (
  stickers: Pick<Sticker, 'id' | 'perceptualHash'>[],
  maximumDistance = 3
): number[][] => {
  const candidates = stickers.filter(sticker => sticker.perceptualHash);
  const parent = new Map(candidates.map(sticker => [sticker.id, sticker.id]));
  const find = (id: number): number => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      if (hammingDistance(candidates[left].perceptualHash!, candidates[right].perceptualHash!) <= maximumDistance) {
        union(candidates[left].id, candidates[right].id);
      }
    }
  }
  const groups = new Map<number, number[]>();
  candidates.forEach(sticker => {
    const root = find(sticker.id);
    groups.set(root, [...(groups.get(root) || []), sticker.id]);
  });
  return [...groups.values()].filter(group => group.length >= 2);
};

const drawCheckerboard = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  size = 24
) => {
  for (let row = 0; row < Math.ceil(height / size); row++) {
    for (let column = 0; column < Math.ceil(width / size); column++) {
      context.fillStyle = (row + column) % 2 === 0 ? '#F8FAFC' : '#CBD5E1';
      context.fillRect(x + column * size, y + row * size, size, size);
    }
  }
};

export const createQaContactSheets = async (stickers: Sticker[]): Promise<QaContactSheetInput[]> => {
  const valid = stickers.filter(sticker => sticker.blob && sticker.status === 'completed');
  const sheets: QaContactSheetInput[] = [];
  const pageSize = 20;
  const columns = 5;
  const rows = 4;
  const tileWidth = 360;
  const tileHeight = 360;

  for (let start = 0; start < valid.length; start += pageSize) {
    const page = valid.slice(start, start + pageSize);
    const images = await Promise.all(page.map(sticker => loadBlobImage(sticker.blob!)));
    const canvas = document.createElement('canvas');
    canvas.width = columns * tileWidth;
    canvas.height = rows * tileHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable for QA contact sheets.');
    context.fillStyle = '#0F172A';
    context.fillRect(0, 0, canvas.width, canvas.height);

    page.forEach((sticker, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = column * tileWidth;
      const y = row * tileHeight;
      drawCheckerboard(context, x + 7, y + 7, tileWidth - 14, tileHeight - 14);
      const image = images[index];
      const maxWidth = tileWidth - 38;
      const maxHeight = tileHeight - 64;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(image, x + (tileWidth - width) / 2, y + 50 + (maxHeight - height) / 2, width, height);
      context.fillStyle = 'rgba(2, 6, 23, 0.92)';
      context.fillRect(x + 7, y + 7, 112, 43);
      context.fillStyle = '#FFFFFF';
      context.font = '900 28px Arial, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(`#${sticker.id}`, x + 63, y + 29);
      context.strokeStyle = '#475569';
      context.lineWidth = 4;
      context.strokeRect(x + 5, y + 5, tileWidth - 10, tileHeight - 10);
    });

    sheets.push({
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      stickerIds: page.map(sticker => sticker.id)
    });
  }
  return sheets;
};
