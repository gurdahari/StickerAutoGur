import type { Sticker } from '../types';

const loadStickerImage = (sticker: Sticker): Promise<HTMLImageElement | null> => new Promise(resolve => {
  if (!sticker.url) {
    resolve(null);
    return;
  }
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = sticker.url;
});

export const createTargetedGridPreview = async (stickers: Sticker[]): Promise<string> => {
  const usable = stickers.filter(sticker => sticker.status === 'completed' && sticker.url && sticker.qaStatus !== 'rejected');
  const canvas = document.createElement('canvas');
  const size = 3000;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for grid refresh.');

  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, size, size);
  if (!usable.length) {
    context.fillStyle = '#F3F4F6';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#9CA3AF';
    context.font = '100px Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText('NO STICKERS AVAILABLE', size / 2, size / 2);
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  const images = await Promise.all(usable.map(loadStickerImage));
  const valid = images
    .map((image, index) => ({ image, sticker: usable[index] }))
    .filter((entry): entry is { image: HTMLImageElement; sticker: Sticker } => Boolean(entry.image?.width));
  const columns = Math.ceil(Math.sqrt(valid.length));
  const rows = Math.ceil(valid.length / columns);
  const cellWidth = size / columns;
  const cellHeight = size / rows;
  const padding = 30;

  valid.forEach(({ image }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    let xOffset = 0;
    if (row === rows - 1) {
      const lastRowCount = valid.length % columns || columns;
      if (lastRowCount < columns) xOffset = (size - lastRowCount * cellWidth) / 2;
    }
    const x = column * cellWidth + padding + xOffset;
    const y = row * cellHeight + padding;
    const maxWidth = cellWidth - padding * 2;
    const maxHeight = cellHeight - padding * 2;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;

    context.save();
    context.shadowColor = 'rgba(0,0,0,0.15)';
    context.shadowBlur = 20;
    context.shadowOffsetX = 5;
    context.shadowOffsetY = 10;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image,
      x + (maxWidth - width) / 2,
      y + (maxHeight - height) / 2,
      width,
      height
    );
    context.restore();
  });

  context.fillStyle = 'rgba(0,0,0,0.4)';
  context.font = '50px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.fillText('HIGH-RES TRANSPARENT PNG • INSTANT DOWNLOAD', size / 2, size - 180);
  context.fillStyle = 'rgba(0,0,0,0.8)';
  context.font = 'bold 80px Inter, Arial, sans-serif';
  context.fillText('PREMIUM STICKER COLLECTION', size / 2, size - 80);
  return canvas.toDataURL('image/jpeg', 0.9);
};
