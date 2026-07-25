import assert from 'node:assert/strict';
import test from 'node:test';
import { clearMinorDetachedEnclosedHoleChroma } from '../services/enclosedHoleMicroClean';

const matte = { r: 0, g: 255, b: 59 };
const transparent = [255, 255, 255, 0];
const opaqueArtwork = [70, 190, 145, 255];
const faintPink = [255, 200, 245, 48];

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

const createRing = (size = 33, outerStart = 5, outerEnd = 27, thickness = 3) => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let position = 0; position < size * size; position++) data.set(transparent, position * 4);

  for (let y = outerStart; y <= outerEnd; y++) {
    for (let x = outerStart; x <= outerEnd; x++) {
      const border = x < outerStart + thickness
        || x > outerEnd - thickness
        || y < outerStart + thickness
        || y > outerEnd - thickness;
      if (border) data.set(opaqueArtwork, (y * size + x) * 4);
    }
  }
  return data;
};

test('clears a faint thin matte-complement arc floating inside an enclosed hole', () => {
  const width = 33;
  const height = 33;
  const data = createRing(width);
  const arc: Array<[number, number]> = [];

  for (let x = 11; x <= 21; x++) {
    const y = 14 + Math.round(Math.abs(x - 16) / 4);
    data.set(faintPink, (y * width + x) * 4);
    arc.push([x, y]);
  }

  const result = clearMinorDetachedEnclosedHoleChroma(data, width, height, matte);

  assert.deepEqual(result, {
    componentsCleared: 1,
    pixelsCleared: arc.length,
    effectivePixelsCleared: Number((arc.length * 48 / 255).toFixed(3))
  });
  arc.forEach(([x, y]) => assert.deepEqual(pixel(data, width, x, y), transparent));
  assert.deepEqual(pixel(data, width, 5, 5), opaqueArtwork);
});

test('preserves low-alpha colored antialias anchored to an opaque edge', () => {
  const width = 33;
  const height = 33;
  const data = createRing(width);
  const x = 8;
  const y = 16;
  data.set(faintPink, (y * width + x) * 4);
  const before = pixel(data, width, x, y);

  const result = clearMinorDetachedEnclosedHoleChroma(data, width, height, matte);

  assert.deepEqual(result, { componentsCleared: 0, pixelsCleared: 0, effectivePixelsCleared: 0 });
  assert.deepEqual(pixel(data, width, x, y), before);
});

test('preserves faint colored pixels beside exterior transparency', () => {
  const width = 33;
  const height = 33;
  const data = createRing(width);
  const x = 3;
  const y = 16;
  data.set(faintPink, (y * width + x) * 4);
  const before = pixel(data, width, x, y);

  const result = clearMinorDetachedEnclosedHoleChroma(data, width, height, matte);

  assert.deepEqual(result, { componentsCleared: 0, pixelsCleared: 0, effectivePixelsCleared: 0 });
  assert.deepEqual(pixel(data, width, x, y), before);
});

test('preserves a large translucent region instead of erasing uncertain artwork', () => {
  const width = 55;
  const height = 55;
  const data = createRing(width, 3, 51, 3);
  const before: Array<[number, number, number[]]> = [];

  for (let y = 14; y <= 34; y++) {
    for (let x = 14; x <= 34; x++) {
      data.set([255, 200, 245, 80], (y * width + x) * 4);
      before.push([x, y, pixel(data, width, x, y)]);
    }
  }

  const result = clearMinorDetachedEnclosedHoleChroma(data, width, height, matte);

  assert.deepEqual(result, { componentsCleared: 0, pixelsCleared: 0, effectivePixelsCleared: 0 });
  before.forEach(([x, y, rgba]) => assert.deepEqual(pixel(data, width, x, y), rgba));
});
