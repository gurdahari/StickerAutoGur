import type { ImageSize } from '../types';

/**
 * Sellable sticker assets are always generated from a 2K source.
 *
 * The old Turbo flag mixed two unrelated concerns: provider concurrency and
 * image resolution. Because Turbo is enabled by default, production silently
 * fell back to 1K source artwork. A 1024px export cannot meaningfully downsample
 * a 1K source, so any raster stair-stepping in the model-created cutline remains
 * visible. Keeping resolution fixed at 2K restores a real downsampling step,
 * while the existing Turbo flag can continue to control queue concurrency.
 */
export const STICKER_SOURCE_SIZE: ImageSize = '2K';

export const usesHighResolutionStickerSource = () => STICKER_SOURCE_SIZE === '2K';
