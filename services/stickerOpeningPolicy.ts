export type StickerOpeningDirective = 'ALLOW' | 'AVOID';

const OPENING_FIELD = /(?:^|\|)\s*OPENING:\s*(ALLOW|AVOID)\s*(?=\||$)/i;

// These subjects often invite enclosed transparent voids. They are not banned;
// they simply compete for the small pack-level opening budget.
const OPENING_PRONE_SUBJECT = /\b(?:alarm\s+clock|basket|bag|tote|purse|handbag|backpack|mug|cup|pitcher|watering\s+can|spray\s+bottle|trigger|scissors|ring|hoop|chain|frame|wreath|arch|window|handle|handled|loop|keychain|carabiner|bucket|teapot|kettle|tag|luggage\s+tag|shopping\s+cart)\b/i;

/**
 * Keep enclosed openings uncommon rather than banning them completely.
 * A 10-item test run may contain at most one; a 100-item production run may
 * contain at most six. Small replacement batches default to closed silhouettes.
 */
export const getIntentionalOpeningBudget = (count: number) => {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount < 10) return 0;
  return Math.min(8, Math.max(1, Math.round(safeCount * 0.06)));
};

export const getStickerOpeningDirective = (prompt: string): StickerOpeningDirective => {
  const match = prompt.match(OPENING_FIELD);
  return match?.[1]?.toUpperCase() === 'ALLOW' ? 'ALLOW' : 'AVOID';
};

export const setStickerOpeningDirective = (
  prompt: string,
  directive: StickerOpeningDirective
) => {
  const cleaned = prompt
    .replace(OPENING_FIELD, match => match.startsWith('|') ? '|' : '')
    .replace(/\|\s*\|/g, '|')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\|\s*/, '')
    .replace(/\s*\|$/, '');

  const textField = cleaned.match(/\s*\|\s*TEXT:/i);
  if (textField?.index !== undefined) {
    const beforeText = cleaned.slice(0, textField.index).trim();
    const textAndAfter = cleaned.slice(textField.index).replace(/^\s*\|\s*/, '');
    return `${beforeText} | OPENING: ${directive} | ${textAndAfter}`;
  }

  return `${cleaned} | OPENING: ${directive}`;
};

/**
 * Enforce the budget locally without another model call. Explicit ALLOW requests
 * are honored first; otherwise naturally opening-prone concepts may consume the
 * remaining budget. Every other concept receives an explicit AVOID directive.
 */
export const applyStickerOpeningBudget = (
  prompts: string[],
  totalCount = prompts.length
) => {
  const budget = getIntentionalOpeningBudget(totalCount);
  let allowed = 0;

  return prompts.map(prompt => {
    const explicitlyAllowed = getStickerOpeningDirective(prompt) === 'ALLOW';
    const naturallyOpeningProne = OPENING_PRONE_SUBJECT.test(prompt);
    const mayUseOpening = allowed < budget && (explicitlyAllowed || naturallyOpeningProne);
    const directive: StickerOpeningDirective = mayUseOpening ? 'ALLOW' : 'AVOID';
    if (directive === 'ALLOW') allowed++;
    return setStickerOpeningDirective(prompt, directive);
  });
};

export const getStickerOpeningGenerationInstruction = (prompt: string) =>
  getStickerOpeningDirective(prompt) === 'ALLOW'
    ? 'INTERNAL OPENING POLICY: ALLOW AT MOST ONE identity-essential enclosed opening. Keep it large, simple, clean and clearly separated from fine artwork. Do not add secondary holes, decorative gaps, tiny loops or repeated cutouts.'
    : 'INTERNAL OPENING POLICY: AVOID enclosed openings. Build a closed, solid silhouette. Show handles, loops, arches, punch holes and ring-like parts from a side-on, overlapped or filled angle so they do not create transparent internal voids. Preserve the subject identity without internal gaps.';
