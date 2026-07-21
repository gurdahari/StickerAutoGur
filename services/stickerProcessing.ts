import {
  expectsTransparentOpening as baseExpectsTransparentOpening,
  processStickerImage as processStickerImageBase
} from './stickerProcessingBase';
import {
  expectsResidualTransparentOpening,
  repairResidualEnclosedMatte
} from './residualMatteRepair';

const SIMPLE_OBJECT_TYPE = /\bTYPE\s*:\s*(?:OBJECT|PROP|ICON|FUNCTIONAL_LABEL)\b/i;
const OPEN_GEOMETRY = /\b(frame|window|tube|pipe|hose|ring|hoop|loop|chain|scissors|glasses|stethoscope|wheel|tire|bracelet|necklace|keyring|carabiner|handle|strap|mug|cup|teapot|bottle|flask|vial|beaker|cauldron|kettle|basket|bag|tote|purse|backpack|bucket|padlock|lock|keyhole|door|arch|tunnel|portal|tent|canopy|hood|helmet|mask|visor|wreath|donut|doughnut|chair|stool|bench|lantern|cage|stall|stand|cart|rack|shelf|ladder|opening|cutout|negative space)\b/i;
const COMPLEX_OR_DETAIL_RISK = /\b(scene|scenery|landscape|panorama|environment|interior|room|library|staircase|stairs|forest|tree|grove|woodland|jungle|garden|meadow|field|mountain|valley|cottage|house|building|village|city|path|road|sky|night|starry|stars|galaxy|nebula|moon|sunset|sunrise|cosmic|storybook|detailed background|character|person|people|woman|man|girl|boy|child|witch|wizard|animal|creature|foliage|flowers?|multiple|collection|arrangement)\b/i;

/**
 * Automatic enclosed-hole cleanup is intentionally fail-closed. It runs only
 * for prompts that explicitly describe a simple isolated object with known open
 * geometry. Complex scenes, characters and detailed illustrations keep only the
 * safe exterior flood-fill cleanup. The purple manual repair remains available
 * when the user explicitly confirms that an interior opening should be clear.
 */
export const isSafeAutomaticEnclosedCleanupPrompt = (prompt = '') =>
  SIMPLE_OBJECT_TYPE.test(prompt)
  && OPEN_GEOMETRY.test(prompt)
  && !COMPLEX_OR_DETAIL_RISK.test(prompt);

export const expectsTransparentOpening = (prompt = '') =>
  baseExpectsTransparentOpening(prompt) || expectsResidualTransparentOpening(prompt);

export const processStickerImage = async (
  source: string,
  itemPrompt = '',
  forceOpeningRepair = false
): Promise<Blob> => {
  const allowAutomaticEnclosedCleanup = isSafeAutomaticEnclosedCleanupPrompt(itemPrompt);

  if (!forceOpeningRepair && !allowAutomaticEnclosedCleanup) {
    // The base processor uses prompt keywords to decide whether to delete
    // enclosed dark components. Passing a protected sentinel preserves its
    // proven exterior background removal while disabling every automatic
    // interior deletion path for risky artwork.
    return processStickerImageBase(
      source,
      'TYPE: PROTECTED_ARTWORK | silhouette | preserve all enclosed dark artwork',
      false
    );
  }

  const base = await processStickerImageBase(source, itemPrompt, forceOpeningRepair);
  return repairResidualEnclosedMatte(base, itemPrompt, forceOpeningRepair);
};
