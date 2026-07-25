import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStickerOpeningBudget,
  getIntentionalOpeningBudget,
  getStickerOpeningDirective,
  getStickerOpeningGenerationInstruction,
  setStickerOpeningDirective
} from '../services/stickerOpeningPolicy';

test('opening budget stays occasional rather than becoming a pack-wide feature', () => {
  assert.equal(getIntentionalOpeningBudget(5), 0);
  assert.equal(getIntentionalOpeningBudget(10), 1);
  assert.equal(getIntentionalOpeningBudget(30), 2);
  assert.equal(getIntentionalOpeningBudget(100), 6);
  assert.equal(getIntentionalOpeningBudget(500), 8);
});

test('a ten-sticker run allows only one naturally hole-prone concept', () => {
  const prompts = [
    'TYPE: Object | SUBJECT: grocery basket with woven handle | COMPOSITION: centered | TEXT: NONE',
    'TYPE: Object | SUBJECT: spray bottle with trigger handle | COMPOSITION: centered | TEXT: NONE',
    'TYPE: Object | SUBJECT: closed notebook | COMPOSITION: centered | TEXT: NONE',
    ...Array.from({ length: 7 }, (_, index) => `TYPE: Object | SUBJECT: solid object ${index} | COMPOSITION: centered | TEXT: NONE`)
  ];

  const revised = applyStickerOpeningBudget(prompts, 10);
  assert.equal(revised.filter(prompt => getStickerOpeningDirective(prompt) === 'ALLOW').length, 1);
  assert.equal(getStickerOpeningDirective(revised[0]), 'ALLOW');
  assert.equal(getStickerOpeningDirective(revised[1]), 'AVOID');
  assert.ok(revised.every(prompt => /\| OPENING: (?:ALLOW|AVOID) \| TEXT:/i.test(prompt)));
});

test('a 100-sticker plan cannot exceed six intentional openings', () => {
  const prompts = Array.from({ length: 100 }, (_, index) =>
    `TYPE: Object | SUBJECT: handled basket ${index} | COMPOSITION: centered | TEXT: NONE`
  );
  const revised = applyStickerOpeningBudget(prompts, 100);
  assert.equal(revised.filter(prompt => getStickerOpeningDirective(prompt) === 'ALLOW').length, 6);
  assert.equal(revised.filter(prompt => getStickerOpeningDirective(prompt) === 'AVOID').length, 94);
});

test('explicit AVOID is never overridden for a hole-prone subject', () => {
  const revised = applyStickerOpeningBudget([
    'TYPE: Object | SUBJECT: handled basket | COMPOSITION: centered | OPENING: AVOID | TEXT: NONE',
    'TYPE: Object | SUBJECT: handled tote | COMPOSITION: centered | TEXT: NONE',
    ...Array.from({ length: 8 }, (_, index) => `TYPE: Object | SUBJECT: solid item ${index} | COMPOSITION: centered | TEXT: NONE`)
  ], 10);

  assert.equal(getStickerOpeningDirective(revised[0]), 'AVOID');
  assert.equal(getStickerOpeningDirective(revised[1]), 'ALLOW');
});

test('setting a directive replaces the old field without duplicating it', () => {
  const original = 'TYPE: Object | SUBJECT: mug | COMPOSITION: side view | OPENING: ALLOW | TEXT: NONE';
  const revised = setStickerOpeningDirective(original, 'AVOID');
  assert.equal((revised.match(/OPENING:/g) || []).length, 1);
  assert.equal(getStickerOpeningDirective(revised), 'AVOID');
});

test('generation instructions are materially different for allowed and avoided concepts', () => {
  const avoid = getStickerOpeningGenerationInstruction('SUBJECT: basket | OPENING: AVOID | TEXT: NONE');
  const allow = getStickerOpeningGenerationInstruction('SUBJECT: basket | OPENING: ALLOW | TEXT: NONE');
  assert.match(avoid, /closed, solid silhouette/i);
  assert.match(allow, /at most one/i);
});
