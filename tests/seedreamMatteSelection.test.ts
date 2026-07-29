import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStickerReservedMatte } from '../server/providers/seedream';

const selectedMatte = (prompt: string) => {
  const rewritten = applyStickerReservedMatte(`GENERATE A RAW DIGITAL STICKER ASSET. ${prompt}`);
  const match = rewritten.match(/uniform [^(]+ \((#[0-9A-F]{6})\)/i);
  assert.ok(match?.[1], 'expected final reserved-matte contract');
  return match[1].toUpperCase();
};

test('a daffodil with an umbrella avoids green, cyan and orange semantic collisions', () => {
  assert.equal(
    selectedMatte('Cute daffodil character holding a tiny polka dot umbrella.'),
    '#FF00D4'
  );
});

test('an ocean scene does not receive cyan matte', () => {
  assert.notEqual(selectedMatte('Blue ocean wave with water splashes.'), '#00E5FF');
});

test('a pink unicorn does not receive magenta matte', () => {
  assert.notEqual(selectedMatte('Pink pastel unicorn with a purple mane.'), '#FF00D4');
});

test('an autumn pumpkin does not receive orange matte', () => {
  assert.notEqual(selectedMatte('Warm orange autumn pumpkin with golden leaves.'), '#FF5A00');
});

test('non-sticker requests are left unchanged', () => {
  const prompt = 'Create a premium laptop mockup.';
  assert.equal(applyStickerReservedMatte(prompt), prompt);
});
