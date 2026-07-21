import {
  expectsTransparentOpening as baseExpectsTransparentOpening,
  processStickerImage as processStickerImageBase
} from './stickerProcessingBase';
import {
  expectsResidualTransparentOpening,
  repairResidualEnclosedMatte
} from './residualMatteRepair';

export const expectsTransparentOpening = (prompt = '') =>
  baseExpectsTransparentOpening(prompt) || expectsResidualTransparentOpening(prompt);

/**
 * Two-stage cleanup:
 * 1. Remove the exterior matte and obvious enclosed background using the
 *    established processor.
 * 2. Inspect the already-transparent PNG for thick neutral-dark islands that
 *    are topologically trapped inside handles, chairs, stalls, lanterns and
 *    similar open geometry.
 */
export const processStickerImage = async (
  source: string,
  itemPrompt = '',
  forceOpeningRepair = false
): Promise<Blob> => {
  const base = await processStickerImageBase(source, itemPrompt, forceOpeningRepair);
  return repairResidualEnclosedMatte(base, itemPrompt, forceOpeningRepair);
};
