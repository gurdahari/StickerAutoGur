import assert from 'node:assert/strict';
import test from 'node:test';
import type { Sticker } from '../types';
import {
  assertCompleteApprovedInventory,
  canAutomaticallyRegenerate,
  countApprovedInventory,
  getRemainingReplacementBudget,
  requiresNewArtwork
} from '../services/stickerReplacementPolicy';

const approvedSticker = (id: number): Sticker => ({
  id,
  prompt: `Sticker ${id}`,
  url: `blob:sticker-${id}`,
  blob: new Blob([String(id)], { type: 'image/png' }),
  status: 'completed',
  qaStatus: 'approved'
});

test('replacement budget counts replacement attempts, not base generation attempts', () => {
  assert.equal(getRemainingReplacementBudget(25, 0), 25);
  assert.equal(getRemainingReplacementBudget(25, 1), 24);
  assert.equal(getRemainingReplacementBudget(25, 25), 0);
  assert.equal(getRemainingReplacementBudget(25, 31), 0);
});

test('approved inventory excludes severe rejects', () => {
  const stickers = Array.from({ length: 100 }, (_, index) => approvedSticker(index + 1));
  stickers[44] = { ...stickers[44], qaStatus: 'rejected' };
  assert.equal(countApprovedInventory(stickers, 100), 99);
});

test('packaging gate rejects 99 of 100 approved stickers', () => {
  const stickers = Array.from({ length: 100 }, (_, index) => approvedSticker(index + 1));
  stickers[44] = { ...stickers[44], qaStatus: 'rejected' };
  assert.throws(
    () => assertCompleteApprovedInventory(stickers, 100),
    /incomplete \(99\/100\).*Packaging and mockups are blocked/
  );
});

test('packaging gate accepts a complete approved inventory', () => {
  const stickers = Array.from({ length: 100 }, (_, index) => approvedSticker(index + 1));
  assert.doesNotThrow(() => assertCompleteApprovedInventory(stickers, 100));
});

test('failed matte postcondition enters automatic replacement even with a preserved source', () => {
  const failed: Sticker = {
    id: 1,
    prompt: 'Sticker 1',
    url: null,
    sourceBlob: new Blob(['paid source'], { type: 'image/png' }),
    status: 'error',
    qaStatus: 'rejected',
    qaIssues: [
      'Local processing failed; paid source preserved: Reserved matte edge contamination remained after local repair (0 exact-key, 34 matte-axis pixels).'
    ],
    replacementCount: 0
  };

  assert.equal(requiresNewArtwork(failed), true);
  assert.equal(canAutomaticallyRegenerate(failed), true);
});

test('generic local browser failure still does not spend a paid replacement', () => {
  const failed: Sticker = {
    id: 2,
    prompt: 'Sticker 2',
    url: null,
    sourceBlob: new Blob(['paid source'], { type: 'image/png' }),
    status: 'error',
    qaStatus: 'rejected',
    qaIssues: ['Local processing failed; paid source preserved: Canvas is unavailable for sticker processing.'],
    replacementCount: 0
  };

  assert.equal(requiresNewArtwork(failed), false);
  assert.equal(canAutomaticallyRegenerate(failed), false);
});
