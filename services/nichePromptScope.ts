export interface NicheConceptScope {
  collectionPromise: string;
  membershipRule: string;
  allowedPrimarySubjects: string;
  supportingOnlySubjects: string;
}

export interface NicheScopeAnalysis {
  themeUniverse?: string;
  subthemes?: string;
  collectionPromise?: string;
  membershipRule?: string;
  allowedPrimarySubjects?: string;
  supportingOnlySubjects?: string;
}

const clean = (value?: string) => value?.replace(/\s+/g, ' ').trim() || '';

/**
 * Builds one collection contract for every niche. Model-produced boundaries
 * are preferred, while the conservative fallback keeps older saved analyses
 * and non-Autopilot callers fail-safe without category-specific exceptions.
 */
export const createNicheConceptScope = (
  niche: string,
  analysis?: NicheScopeAnalysis
): NicheConceptScope => {
  const themeUniverse = clean(analysis?.themeUniverse) || clean(niche) || 'the submitted niche';
  const collectionPromise = clean(analysis?.collectionPromise)
    || `A coherent sticker collection whose visual subjects directly represent ${themeUniverse}`;
  const membershipRule = clean(analysis?.membershipRule)
    || `A concept is valid only when its primary visual subject directly and unmistakably represents ${themeUniverse}; association through style, mood, color, setting or an adjacent prop alone is not sufficient.`;
  const allowedPrimarySubjects = clean(analysis?.allowedPrimarySubjects)
    || clean(analysis?.subthemes)
    || `Direct visual subjects from ${themeUniverse}`;
  const supportingOnlySubjects = clean(analysis?.supportingOnlySubjects)
    || 'Any adjacent element that does not independently pass the membership rule';

  return {
    collectionPromise,
    membershipRule,
    allowedPrimarySubjects,
    supportingOnlySubjects
  };
};

export const getCollectionContractInstruction = (scope: NicheConceptScope) => `
COLLECTION CONTRACT (HIGHEST PRIORITY):
- Product promise: ${scope.collectionPromise}
- Binary membership test: ${scope.membershipRule}
- Valid primary-subject space: ${scope.allowedPrimarySubjects}
- Supporting-only space: ${scope.supportingOnlySubjects}
Every concept must pass the binary membership test based on what will be visibly dominant in the final image. A related vibe is not membership. Variety, style and count never override this contract.
`.trim();

export const getContractBoundFallbackFamily = (
  scope: NicheConceptScope,
  family?: string
) => `${clean(family) || scope.allowedPrimarySubjects}; the visibly dominant subject must pass this membership test: ${scope.membershipRule}`;
