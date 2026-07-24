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
  assert.deepEqual(pixel(data, width, 5, 6).slice(0, 3), white.slice(0, 3));
  assert.equal(pixel(data, width, 5, 6)[3], alphaBefore);
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
