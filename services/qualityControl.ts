import type { Sticker, StickerQaMetrics } from '../types';
import type { QaContactSheetInput } from './aiService';
import { expectsTransparentOpening } from './stickerProcessing';

export interface LocalStickerQaResult {
  id: number;
  metrics: StickerQaMetrics;
  perceptualHash: string;
  issues: string[];
}

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
  const issues: string[] = [];
  if (Math.min(image.width, image.height) < 256) issues.push('Exported PNG is below the minimum safe pixel dimension.');
  if (sticker.blob.type && sticker.blob.type !== 'image/png') issues.push('Final sticker file is not a PNG.');
  if (metrics.transparentRatio < 0.01) issues.push('Transparent background is missing or too small to verify.');
  if (metrics.artworkRatio < 0.035) issues.push('Artwork occupies too little of the exported canvas.');
  if (metrics.artworkRatio > 0.97) issues.push('Artwork fills the canvas and may contain an unremoved background.');
  if (metrics.softAlphaRatio > 0.045) issues.push('Excess semi-transparent pixels may create a visible halo.');
  const subject = sticker.prompt.match(/SUBJECT:\s*([^|]+)/i)?.[1] || sticker.prompt;
  const explicitlyBlackSubject = /\b(silhouette|solid black|black cat|black bear|black dog|black raven|black crow|black bat|black ink|vinyl record|tire|shadow figure)\b/i.test(subject);
  const blackRegionLimit = expectsTransparentOpening(sticker.prompt)
    ? 0.008
    : explicitlyBlackSubject
      ? 0.05
      : 0.018;
  if (metrics.largestSolidBlackRatio > blackRegionLimit) {
    issues.push('Large solid-black interior region may be an unremoved opening or a Seedream artwork hallucination.');
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
