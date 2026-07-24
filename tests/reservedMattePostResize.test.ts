import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countEnclosedReservedMatteAxisContamination,
  repairEnclosedReservedMatteAxisContamination
} from '../services/reservedMattePostResize';

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

test('repairs green matte-axis pixels in a narrow enclosed hole without changing alpha', () => {
  const width = 13;
  const height = 13;
  const matte = { r: 0, g: 255, b: 59 };
  const artwork = [92, 63, 118, 255];
  const white = [248, 247, 246, 164];
  const residual = [99, 156, 68, 180];
  const data = new Uint8ClampedArray(width * height * 4);

  for (let position = 0; position < width * height; position++) {
    data.set(artwork, position * 4);
  }

  // One-pixel enclosed opening with a narrow white proof sample. The residual
  // is far from the exact green key, so the old distance-only guard misses it.
  data.set([255, 255, 255, 0], (6 * width + 6) * 4);
  data.set(residual, (6 * width + 5) * 4);
  data.set(white, (5 * width + 5) * 4);
  const alphaBefore = pixel(data, width, 5, 6)[3];

  assert.equal(countEnclosedReservedMatteAxisContamination(data, width, height, matte), 1);
  const result = repairEnclosedReservedMatteAxisContamination(data, width, height, matte);

  assert.deepEqual(result, { detectedPixels: 1, repairedPixels: 1 });
  assert.equal(countEnclosedReservedMatteAxisContamination(data, width, height, matte), 0);
  assert.deepEqual(pixel(data, width, 5, 6).slice(0, 3), [248, 248, 248]);
  assert.equal(pixel(data, width, 5, 6)[3], alphaBefore);
});

test('repairs a train-window residual after resampling drifts off the strict matte axis', () => {
  const width = 15;
  const height = 15;
  const matte = { r: 0, g: 255, b: 59 };
  const data = new Uint8ClampedArray(width * height * 4);
  const residual = [104, 133, 29, 44];

  for (let position = 0; position < width * height; position++) {
    data.set([92, 63, 118, 255], position * 4);
  }
  for (let y = 6; y <= 8; y++) {
    for (let x = 6; x <= 8; x++) {
      data.set([255, 255, 255, 0], (y * width + x) * 4);
    }
  }
  data.set(residual, (7 * width + 5) * 4);
  data.set([255, 255, 255, 90], (6 * width + 5) * 4);
  data.set([248, 247, 246, 80], (8 * width + 5) * 4);
  const alphaBefore = pixel(data, width, 5, 7)[3];

  assert.equal(countEnclosedReservedMatteAxisContamination(data, width, height, matte), 1);
  repairEnclosedReservedMatteAxisContamination(data, width, height, matte);

  assert.equal(countEnclosedReservedMatteAxisContamination(data, width, height, matte), 0);
  assert.ok(pixel(data, width, 5, 7).slice(0, 3).every(channel => channel >= 248));
  assert.equal(pixel(data, width, 5, 7)[3], alphaBefore);
});

test('does not copy a smaller matte tint from accepted white proof pixels', () => {
  const width = 15;
  const height = 15;
  const matte = { r: 0, g: 255, b: 59 };
  const data = new Uint8ClampedArray(width * height * 4);
  const residual = [99, 156, 68, 180];
  const tintedWhite = [225, 248, 226, 210];

  for (let position = 0; position < width * height; position++) {
    data.set([92, 63, 118, 255], position * 4);
  }
  data.set([255, 255, 255, 0], (7 * width + 7) * 4);
  data.set(residual, (7 * width + 6) * 4);
  data.set(tintedWhite, (6 * width + 4) * 4);
  data.set(tintedWhite, (8 * width + 4) * 4);
  const alphaBefore = pixel(data, width, 6, 7)[3];

  assert.equal(countEnclosedReservedMatteAxisContamination(data, width, height, matte), 1);
  repairEnclosedReservedMatteAxisContamination(data, width, height, matte);

  assert.equal(countEnclosedReservedMatteAxisContamination(data, width, height, matte), 0);
  assert.deepEqual(pixel(data, width, 6, 7).slice(0, 3), [248, 248, 248]);
  assert.equal(pixel(data, width, 6, 7)[3], alphaBefore);
});

test('does not alter matte-aligned colored artwork on exterior transparency', () => {
  const width = 9;
  const height = 9;
  const matte = { r: 0, g: 255, b: 59 };
  const data = new Uint8ClampedArray(width * height * 4);
  const artwork = [99, 156, 68, 180];

  for (let y = 2; y <= 6; y++) {
    for (let x = 2; x <= 6; x++) {
      data.set([248, 247, 246, 255], (y * width + x) * 4);
    }
  }
  data.set(artwork, (4 * width + 2) * 4);
  const before = new Uint8ClampedArray(data);

  assert.equal(countEnclosedReservedMatteAxisContamination(data, width, height, matte), 0);
  assert.deepEqual(repairEnclosedReservedMatteAxisContamination(data, width, height, matte), {
    detectedPixels: 0,
    repairedPixels: 0
  });
  assert.deepEqual(data, before);
});
