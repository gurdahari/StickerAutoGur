import type { Sticker } from '../types';

export const MAX_AUTOMATIC_REPLACEMENTS_PER_STICKER = 2;

const NEEDS_NEW_ARTWORK = [
  /near-exact duplicate|verified reserved matte key|sticker cleanup removed the entire image|failed to load image for sticker processing/i,
  /transparent background is missing|artwork occupies too little|artwork fills almost the entire canvas|extreme semi-transparent edge coverage/i,
  /large solid-black interior region|large unintended transparent hole|subject center is mostly transparent|sticker silhouette is abnormally hollow/i,
  /artwork is fragmented|artwork touches the canvas edge|below the minimum safe pixel dimension|final sticker file is not a PNG/i
];

/**
 * These failures originate in the generated pixels and cannot be repaired by
 * rerunning the same local mask. A new Seedream source is the correct recovery.
 */
export const requiresNewArtwork = (sticker: Pick<Sticker, 'qaIssues'>) =>
  (sticker.qaIssues || []).some(issue => NEEDS_NEW_ARTWORK.some(pattern => pattern.test(issue)));

export const canAutomaticallyRegenerate = (
  sticker: Pick<Sticker, 'qaStatus' | 'qaIssues' | 'sourceBlob' | 'replacementCount'>
) =>
  sticker.qaStatus !== 'approved'
  && (!sticker.sourceBlob || requiresNewArtwork(sticker))
  && (sticker.replacementCount || 0) < MAX_AUTOMATIC_REPLACEMENTS_PER_STICKER;

export const hasBlockingQaFailure = (sticker: Pick<Sticker, 'qaStatus'>) =>
  sticker.qaStatus === 'rejected';
