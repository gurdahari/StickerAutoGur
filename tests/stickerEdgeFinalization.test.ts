import assert from 'node:assert/strict';
import test from 'node:test';
import { neutralizeTransparentWhiteCutline } from '../services/stickerEdgeFinalization';

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

test('removes hidden matte RGB and visible fringe without changing alpha', () => {
  const width = 9;
  const height = 9;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let position = 0; position < width * height; position++) {
    const index = position * 4;
    data.set([0, 255, 59, 0], index);
  }
  for (let y = 2; y <= 6; y++) {
    for (let x = 2; x <= 6; x++) {
      const boundary = x === 2 || x === 6 || y === 2 || y === 6;
      data.set(boundary ? [120, 255, 150, 48] : [255, 255, 255, 255], (y * width + x) * 4);
    }
  }

  const originalAlpha = Array.from(data).filter((_, index) => index % 4 === 3);
  const changed = neutralizeTransparentWhiteCutline(data, width, height, 2);
  const revisedAlpha = Array.from(data).filter((_, index) => index % 4 === 3);

  assert.ok(changed > 0);
  assert.deepEqual(revisedAlpha, originalAlpha);
  assert.deepEqual(pixel(data, width, 0, 0), [255, 255, 255, 0]);
  assert.deepEqual(pixel(data, width, 2, 4), [255, 255, 255, 48]);
  assert.deepEqual(pixel(data, width, 4, 4), [255, 255, 255, 255]);
});

test('does not recolor artwork beyond the short exterior cutline band', () => {
  const width = 11;
  const height = 11;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let position = 0; position < width * height; position++) {
    data.set([0, 255, 59, 0], position * 4);
  }
  for (let y = 1; y < 10; y++) {
    for (let x = 1; x < 10; x++) {
      data.set([255, 255, 255, 255], (y * width + x) * 4);
    }
  }
  data.set([26, 134, 67, 255], (5 * width + 5) * 4);

  neutralizeTransparentWhiteCutline(data, width, height, 3);
  assert.deepEqual(pixel(data, width, 5, 5), [26, 134, 67, 255]);
});
