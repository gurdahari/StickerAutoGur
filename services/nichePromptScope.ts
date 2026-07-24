export interface NichePromptScope {
  primarySubject: string;
}

const PRIMARY_SUBJECT_MARKER = 'NON-NEGOTIABLE PRIMARY SUBJECT:';

/**
 * A preset can mark a category whose supporting objects are never valid on
 * their own. The marker travels inside the existing generation brief, so old
 * saved runs remain compatible and no UI-specific branching is needed.
 */
export const getNichePromptScope = (niche: string): NichePromptScope | null => {
  const match = niche.match(new RegExp(`${PRIMARY_SUBJECT_MARKER}\\s*([^\\n.]+)`, 'i'));
  const primarySubject = match?.[1]?.trim();
  return primarySubject ? { primarySubject } : null;
};

export const getPrimarySubjectScopeInstruction = (scope: NichePromptScope | null) => scope
  ? `NON-NEGOTIABLE SCOPE (HIGHEST PRIORITY): Every concept must show ${scope.primarySubject} as the main, largest, visually dominant subject. Props, food, habitat, weather, tools, places and decorations are allowed only when they are visibly attached to, used by, or interacting with that primary subject. A standalone supporting object is out of scope and invalid.`
  : '';

export const getScopedFallbackFamily = (scope: NichePromptScope | null) => scope
  ? `${scope.primarySubject} as the main subject, with a distinct pose, species, action or interaction`
  : null;
