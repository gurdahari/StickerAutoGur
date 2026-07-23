import { normalizeStickerExport } from './stickerExportNormalization';
import {
  inferStickerForegroundMask,
  type StickerForegroundMask
} from './stickerForegroundMask';

const OPEN_GEOMETRY = /\b(frame|window|tube|tubing|pipe|hose|ring|hoop|loop|coil|chain|link|scissors|glasses|eyeglasses|stethoscope|wheel|tire|bracelet|necklace|keyring|carabiner|handle|mug|cup|teapot|bottle|flask|vial|beaker|cauldron|kettle|apparatus|alembic|retort|alchemy|laboratory|basket|bag|bucket|padlock|lock|keyhole|door|doorway|arch|archway|tunnel|portal|tent|teepee|tipi|canopy|hood|helmet|mask|visor|cave|wreath|donut|doughnut|opening|cutout|negative space)\b/i;

export const expectsTransparentOpening = (prompt = '') => OPEN_GEOMETRY.test(prompt);

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Could not encode the locally masked sticker PNG.'));
  }, 'image/png');
});

const loadImage = (source: string | Blob): Promise<{ image: HTMLImageElement; revoke?: () => void }> =>
  new Promise((resolve, reject) => {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => resolve({
      image,
      ...(typeof source === 'string' ? {} : { revoke: () => URL.revokeObjectURL(url) })
    });
    image.onerror = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(url);
      reject(new Error('Could not decode the preserved source image.'));
    };
    image.src = url;
  });

const alphaCanvas = (
  alpha: Uint8ClampedArray,
  size: number
) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for local mask composition.');
  const imageData = context.createImageData(size, size);
  for (let position = 0; position < size * size; position++) {
    const index = position * 4;
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = alpha[position];
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
};

const composeSticker = async (
  image: HTMLImageElement,
  mask: StickerForegroundMask
) => {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('The preserved source image has invalid dimensions.');

  const subjectMask = alphaCanvas(mask.subjectAlpha, mask.size);
  const borderMask = alphaCanvas(mask.borderAlpha, mask.size);
  const artworkCanvas = document.createElement('canvas');
  artworkCanvas.width = width;
  artworkCanvas.height = height;
  const artworkContext = artworkCanvas.getContext('2d');
  if (!artworkContext) throw new Error('Canvas is unavailable for local foreground composition.');

  artworkContext.drawImage(image, 0, 0, width, height);
  artworkContext.globalCompositeOperation = 'destination-in';
  artworkContext.imageSmoothingEnabled = true;
  artworkContext.imageSmoothingQuality = 'high';
  artworkContext.drawImage(subjectMask, 0, 0, width, height);
  artworkContext.globalCompositeOperation = 'source-over';

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) throw new Error('Canvas is unavailable for local sticker composition.');
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  outputContext.drawImage(borderMask, 0, 0, width, height);
  outputContext.drawImage(artworkCanvas, 0, 0);
  return canvasToBlob(outputCanvas);
};

/**
 * One paid generation, one immutable source, one deterministic local export.
 *
 * Seedream is responsible only for illustration. A local segmentation model
 * owns transparency, and Canvas owns the white die-cut border. No generated
 * color is treated as a technical mask contract.
 */
export const processStickerImage = async (
  source: string | Blob,
  _itemPrompt = '',
  _forceOpeningRepair = false
): Promise<Blob> => {
  const loaded = await loadImage(source);
  try {
    const mask = await inferStickerForegroundMask(loaded.image);
    const composed = await composeSticker(loaded.image, mask);
    return normalizeStickerExport(composed, 1024);
  } finally {
    loaded.revoke?.();
  }
};
