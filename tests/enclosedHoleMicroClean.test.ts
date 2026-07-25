import assert from 'node:assert/strict';
import test from 'node:test';
import { clearMinorDetachedEnclosedHoleChroma } from '../services/enclosedHoleMicroClean';

const matte = { r: 0, g: 255, b: 59 };
const transparent = [255, 255, 255, 0];
const white = [248, 248, 248, 255];
const greenArtwork = [70, 190, 145, 255];

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

const createWhiteCutlineRing = (size = 41) => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let position = 0; position < size * size; position++) data.set(transparent, position * 4);

  for (let y = 5; y <= size - 6; y++) {
    for (let x = 5; x <= size - 6; x++) {
      const outerArtwork = x <= 7 || x >= size - 8 || y <= 7 || y >= size - 8;
      const whiteCutline = x <= 11 || x >= size - 12 || y <= 11 || y >= size - 12;
      if (outerArtwork) data.set(greenArtwork, (y * size + x) * 4);
      else if (whiteCutline) data.set(white, (y * size + x) * 4);
    }
  }
  return data;
};

test('neutralizes a saturated attached fringe several pixels deep without changing alpha', () => {
  const width = 41;
  const height = 41;
  const data = createWhiteCutlineRing(width);
  const fringe: Array<[number, number, number[]]> = [
    [13, 20, [255, 95, 68, 75]],
    [14, 20, [227, 104, 78, 91]],
    [15, 20, [249, 186, 153, 180]],
    [16, 20, [255, 199, 206, 165]]
  ];
  fringe.forEach(([x, y, rgba]) => data.set(rgba, (y * width + x) * 4));

  const result = clearMinorDetachedEnclosedHoleChroma(data, width, height, matte);

  assert.equal(result.componentsCleared, 1);
  assert.equal(result.pixelsCleared, fringe.length);
  assert.equal(
    result.effectivePixelsCleared,
    Number((fringe.reduce((sum, [, , rgba]) => sum + rgba[3], 0) / 255).toFixed(3))
  );
  fringe.forEach(([x, y, rgba]) => {
    const revised = pixel(data, width, x, y);
    assert.equal(revised[0], revised[1]);
    assert.equal(revised[1], revised[2]);
    assert.equal(revised[3], rgba[3]);
  });
});

test('does not touch a colored partial pixel behind an opaque white barrier', () => {
  const width = 41;
  const height = 41;
  const data = createWhiteCutlineRing(width);
  const x = 7;
  const y = 20;
  const artworkAntialias = [99, 156, 68, 180];
  data.set(artworkAntialias, (y * width + x) * 4);
  const before = pixel(data, width, x, y);

  const result = clearMinorDetachedEnclosedHoleChroma(data, width, height, matte);

  assert.deepEqual(result, { componentsCleared: 0, pixelsCleared: 0, effectivePixelsCleared: 0 });
  assert.deepEqual(pixel(data, width, x, y), before);
});

test('does not touch exterior edge color', () => {
  const width = 41;
  const height = 41;
  const data = createWhiteCutlineRing(width);
  const x = 4;
  const y = 20;
  const exteriorEdge = [255, 95, 68, 75];
  data.set(exteriorEdge, (y * width + x) * 4);
  const before = pixel(data, width, x, y);

  const result = clearMinorDetachedEnclosedHoleChroma(data, width, height, matte);

  assert.deepEqual(result, { componentsCleared: 0, pixelsCleared: 0, effectivePixelsCleared: 0 });
  assert.deepEqual(pixel(data, width, x, y), before);
});

test('requires nearby neutral-white cutline proof', () => {
  const width = 25;
  const height = 25;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let position = 0; position < width * height; position++) data.set(transparent, position * 4);
  for (let y = 5; y <= 19; y++) {
    for (let x = 5; x <= 19; x++) {
      const border = x === 5 || x === 19 || y === 5 || y === 19;
      if (border) data.set(greenArtwork, (y * width + x) * 4);
    }
  }
  const suspect = [255, 95, 68, 75];
  data.set(suspect, (12 * width + 7) * 4);
  const before = pixel(data, width, 7, 12);

  const result = clearMinorDetachedEnclosedHoleChroma(data, width, height, matte);

  assert.deepEqual(result, { componentsCleared: 0, pixelsCleared: 0, effectivePixelsCleared: 0 });
  assert.deepEqual(pixel(data, width, 7, 12), before);
});
