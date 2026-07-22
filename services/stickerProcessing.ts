import {
  expectsTransparentOpening as baseExpectsTransparentOpening,
  processStickerImage as processStickerImageBase
} from './stickerProcessingBase';
import {
  expectsResidualTransparentOpening,
  repairResidualEnclosedMatte
} from './residualMatteRepair';
import {
  detectVividCornerMatte,
  removeResidualChromaMatte
} from './chromaMatte';
import { normalizeStickerExport } from './stickerExportNormalization';

const SIMPLE_OBJECT_TYPE = /\bTYPE\s*:\s*(?:OBJECT|PROP|ICON|FUNCTIONAL_LABEL)\b/i;
const OPEN_GEOMETRY = /\b(frame|window|tube|pipe|hose|ring|hoop|loop|chain|scissors|glasses|stethoscope|wheel|tire|bracelet|necklace|keyring|carabiner|handle|strap|mug|cup|teapot|bottle|flask|vial|beaker|cauldron|kettle|basket|bag|tote|purse|backpack|bucket|padlock|lock|keyhole|door|arch|tunnel|portal|tent|canopy|hood|helmet|mask|visor|wreath|donut|doughnut|chair|stool|bench|lantern|cage|stall|stand|cart|rack|shelf|ladder|opening|cutout|negative space)\b/i;
const COMPLEX_OR_DETAIL_RISK = /\b(scene|scenery|landscape|panorama|environment|interior|room|library|staircase|stairs|forest|tree|grove|woodland|jungle|garden|meadow|field|mountain|valley|cottage|house|building|village|city|path|road|sky|night|starry|stars|galaxy|nebula|moon|sunset|sunrise|cosmic|storybook|detailed background|character|person|people|woman|man|girl|boy|child|witch|wizard|animal|creature|foliage|flowers?|multiple|collection|arrangement)\b/i;

/**
 * Automatic enclosed-dark cleanup remains fail-closed. New sticker generations
 * use a vivid chroma matte instead, which can be detected from the corners and
 * removed safely without interpreting black artwork as background.
 */
export const isSafeAutomaticEnclosedCleanupPrompt = (prompt = '') =>
  SIMPLE_OBJECT_TYPE.test(prompt)
  && OPEN_GEOMETRY.test(prompt)
  && !COMPLEX_OR_DETAIL_RISK.test(prompt);

export const expectsTransparentOpening = (prompt = '') =>
  baseExpectsTransparentOpening(prompt) || expectsResidualTransparentOpening(prompt);

const finishStickerExport = async (blob: Blob) => {
  try {
    return await normalizeStickerExport(blob, 1024);
  } catch (error) {
    console.warn('Historical sticker export normalization was skipped; preserving the cleaned PNG.', error);
    return blob;
  }
};

export const processStickerImage = async (
  source: string,
  itemPrompt = '',
  forceOpeningRepair = false
): Promise<Blob> => {
  const chromaMatte = await detectVividCornerMatte(source).catch(() => null);
  const allowAutomaticEnclosedCleanup = isSafeAutomaticEnclosedCleanupPrompt(itemPrompt);

  let base: Blob;
  if (!forceOpeningRepair && !allowAutomaticEnclosedCleanup) {
    base = await processStickerImageBase(
      source,
      'TYPE: PROTECTED_ARTWORK | silhouette | preserve all enclosed dark artwork',
      false
    );
  } else {
    base = await processStickerImageBase(source, itemPrompt, forceOpeningRepair);
  }

  // A vivid key color is reserved exclusively for removable background. This
  // pass is safe for scenes and characters because it never targets black,
  // shadows, windows, interiors or generic dark pixels.
  if (chromaMatte) {
    const cleaned = await removeResidualChromaMatte(base, chromaMatte);
    return finishStickerExport(cleaned);
  }

  // Legacy black-matte generations keep the conservative/manual behavior.
  if (!forceOpeningRepair && !allowAutomaticEnclosedCleanup) return finishStickerExport(base);
  const repaired = await repairResidualEnclosedMatte(base, itemPrompt, forceOpeningRepair);
  return finishStickerExport(repaired);
};
