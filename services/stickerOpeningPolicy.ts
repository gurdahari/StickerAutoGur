export type StickerOpeningDirective = 'ALLOW' | 'AVOID';

const OPENING_FIELD = /(?:^|\|)\s*OPENING:\s*(ALLOW|AVOID)\s*(?=\||$)/i;

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
 * Enforce the pack-level budget locally so prompt-model drift cannot turn an
 * occasional visual device into a recurring masking risk. Missing directives
 * and requests above budget become AVOID without another model call.
 */
export const applyStickerOpeningBudget = (
  prompts: string[],
  totalCount = prompts.length
) => {
  const budget = getIntentionalOpeningBudget(totalCount);
  let allowed = 0;

  return prompts.map(prompt => {
    const requested = getStickerOpeningDirective(prompt) === 'ALLOW';
    const directive: StickerOpeningDirective = requested && allowed < budget
      ? 'ALLOW'
      : 'AVOID';
    if (directive === 'ALLOW') allowed++;
    return setStickerOpeningDirective(prompt, directive);
  });
};
