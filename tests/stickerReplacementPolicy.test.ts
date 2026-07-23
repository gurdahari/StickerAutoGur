import assert from 'node:assert/strict';
import test from 'node:test';
import type { Sticker } from '../types';
import {
  assertCompleteApprovedInventory,
  countApprovedInventory,
  getRemainingReplacementBudget
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
