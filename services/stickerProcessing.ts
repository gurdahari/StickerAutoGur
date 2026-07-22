import { processStickerImage as removeExteriorMatte } from './stickerExteriorMatte';
import {
  expectsResidualTransparentOpening,
  repairResidualEnclosedMatte
} from './residualMatteRepair';
import {
  detectVividCornerMatte,
  removeResidualChromaMatte
} from './chromaMatte';
import { isolateStickerByWhiteCutline } from './stickerCutlineIsolation';
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
  expectsResidualTransparentOpening(prompt);

const finishStickerExport = async (blob: Blob) => {
  let isolated = blob;
  try {
    // This color-agnostic geometry pass removes Seedream fragments that sit
    // outside the continuous white cutline. It runs for black and vivid mattes.
    isolated = await isolateStickerByWhiteCutline(blob);
  } catch (error) {
    console.warn('White-cutline debris isolation was skipped; preserving the cleaned PNG.', error);
  }

  try {
    return await normalizeStickerExport(isolated, 1024);
  } catch (error) {
    console.warn('Historical sticker export normalization was skipped; preserving the cleaned PNG.', error);
    return isolated;
  }
};

export const processStickerImage = async (
  source: string,
  itemPrompt = '',
  forceOpeningRepair = false
): Promise<Blob> => {
  const chromaMatte = await detectVividCornerMatte(source).catch(() => null);
  const allowAutomaticEnclosedCleanup = isSafeAutomaticEnclosedCleanupPrompt(itemPrompt);

  // Stage 1 is intentionally simple and proven: remove only the exterior matte
  // while preserving the full continuous alpha range of the white cutline.
  const base = await removeExteriorMatte(source, itemPrompt, forceOpeningRepair);

  // Stage 2 removes the reserved vivid key, including intended inner openings,
  // without interpreting black shadows or dark illustration pixels as matte.
  if (chromaMatte) {
    const cleaned = await removeResidualChromaMatte(base, chromaMatte);
    return finishStickerExport(cleaned);
  }

  // Legacy black-matte generations keep the conservative/manual behavior.
  if (!forceOpeningRepair && !allowAutomaticEnclosedCleanup) return finishStickerExport(base);
  const repaired = await repairResidualEnclosedMatte(base, itemPrompt, forceOpeningRepair);
  return finishStickerExport(repaired);
};
