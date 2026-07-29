import assert from 'node:assert/strict';
import test from 'node:test';
import { clearRetainedOpeningInteriorDust } from '../services/retainedOpeningInteriorDustCleaner';

const MATTE = { r: 0, g: 255, b: 59 };

const createSticker = (width: number, height: number) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 4; y < height - 4; y++) {
    for (let x = 4; x < width - 4; x++) {
      data.set([248, 247, 246, 255], (y * width + x) * 4);
    }
  }
  return data;
};

const cutHole = (
  data: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  holeWidth: number,
  holeHeight: number
) => {
  for (let y = startY; y < startY + holeHeight; y++) {
    for (let x = startX; x < startX + holeWidth; x++) {
      data.set([255, 255, 255, 0], (y * width + x) * 4);
    }
  }
};

const rgba = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const pixelIndex = (y * width + x) * 4;
  return Array.from(data.slice(pixelIndex, pixelIndex + 4));
};

test('removes pale low-alpha dust that becomes visible on a white background', () => {
  const width = 36;
  const height = 36;
  const data = createSticker(width, height);
  cutHole(data, width, 13, 11, 10, 14);

  data.set([238, 225, 229, 72], (17 * width + 12) * 4);

  const result = clearRetainedOpeningInteriorDust(data, width, height, MATTE);

  assert.equal(result.componentsCleared, 1);
  assert.equal(result.pixelsCleared, 1);
  assert.deepEqual(rgba(data, width, 12, 17), [255, 255, 255, 0]);
});

test('removes a weak matte-axis dot beside a retained opening', () => {
  const width = 36;
  const height = 36;
  const data = createSticker(width, height);
  cutHole(data, width, 13, 11, 10, 14);

  data.set([105, 210, 128, 88], (18 * width + 12) * 4);

  const result = clearRetainedOpeningInteriorDust(data, width, height, MATTE);

  assert.equal(result.pixelsCleared, 1);
  assert.equal(rgba(data, width, 12, 18)[3], 0);
});

test('preserves a real soft colored edge with a matching opaque artwork core', () => {
  const width = 40;
  const height = 40;
  const data = createSticker(width, height);
  cutHole(data, width, 15, 12, 10, 16);

  data.set([35, 110, 60, 90], (20 * width + 14) * 4);
  data.set([32, 105, 58, 255], (20 * width + 12) * 4);
  const before = rgba(data, width, 14, 20);

  const result = clearRetainedOpeningInteriorDust(data, width, height, MATTE);

  assert.equal(result.pixelsCleared, 0);
  assert.deepEqual(rgba(data, width, 14, 20), before);
});

test('ignores faint pixels that touch only exterior transparency', () => {
  const width = 32;
  const height = 32;
  const data = createSticker(width, height);
  data.set([238, 225, 229, 72], (15 * width + 4) * 4);
  const before = rgba(data, width, 4, 15);

  const result = clearRetainedOpeningInteriorDust(data, width, height, MATTE);

  assert.deepEqual(result, { componentsCleared: 0, pixelsCleared: 0 });
  assert.deepEqual(rgba(data, width, 4, 15), before);
});

test('treats a diagonal transparent path to the canvas as exterior', () => {
  const width = 36;
  const height = 36;
  const data = createSticker(width, height);

  for (let point = 0; point <= 10; point++) {
    data.set([255, 255, 255, 0], ((4 + point) * width + 4 + point) * 4);
  }
  data.set([238, 225, 229, 72], (15 * width + 14) * 4);
  const before = rgba(data, width, 14, 15);

  const result = clearRetainedOpeningInteriorDust(data, width, height, MATTE);

  assert.equal(result.pixelsCleared, 0);
  assert.deepEqual(rgba(data, width, 14, 15), before);
});
