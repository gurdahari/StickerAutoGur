import assert from 'node:assert/strict';
import test from 'node:test';
import { neutralizeSmallEnclosedHoleColorIslands } from '../services/enclosedHoleIslandNeutralizer';

const transparent = [255, 255, 255, 0];
const white = [248, 248, 248, 255];
const peachArtwork = [246, 158, 112, 255];

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

const alphaBytes = (data: Uint8ClampedArray) => {
  const alpha: number[] = [];
  for (let index = 3; index < data.length; index += 4) alpha.push(data[index]);
  return alpha;
};

const createWhiteCutlineRing = (size = 41) => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let position = 0; position < size * size; position++) data.set(transparent, position * 4);

  for (let y = 5; y <= size - 6; y++) {
    for (let x = 5; x <= size - 6; x++) {
      const outerArtwork = x <= 7 || x >= size - 8 || y <= 7 || y >= size - 8;
      const whiteCutline = x <= 11 || x >= size - 12 || y <= 11 || y >= size - 12;
      if (outerArtwork) data.set(peachArtwork, (y * size + x) * 4);
      else if (whiteCutline) data.set(white, (y * size + x) * 4);
    }
  }
  return data;
};

test('neutralizes an opaque-tipped color island trapped in an enclosed white cutline', () => {
  const width = 41;
  const height = 41;
  const data = createWhiteCutlineRing(width);
  const island: Array<[number, number, number[]]> = [
    [12, 20, [27, 160, 148, 67]],
    [11, 20, [27, 158, 147, 134]],
    [10, 20, [20, 168, 150, 214]],
    [9, 20, [195, 220, 210, 255]]
  ];
  island.forEach(([x, y, rgba]) => data.set(rgba, (y * width + x) * 4));
  const alphaBefore = alphaBytes(data);

  const result = neutralizeSmallEnclosedHoleColorIslands(data, width, height);

  assert.deepEqual(result, {
    componentsNeutralized: 1,
    pixelsNeutralized: island.length,
    effectivePixelsNeutralized: Number((island.reduce((sum, [, , rgba]) => sum + rgba[3], 0) / 255).toFixed(3))
  });
  island.forEach(([x, y, rgba]) => {
    const revised = pixel(data, width, x, y);
    assert.equal(revised[0], revised[1]);
    assert.equal(revised[1], revised[2]);
    assert.equal(revised[3], rgba[3]);
  });
  assert.deepEqual(alphaBytes(data), alphaBefore);
});

test('does not neutralize color connected to the real artwork component', () => {
  const width = 41;
  const height = 41;
  const data = createWhiteCutlineRing(width);
  const x = 8;
  const y = 20;
  const connectedDetail = [70, 190, 145, 255];
  data.set(connectedDetail, (y * width + x) * 4);
  const before = pixel(data, width, x, y);

  const result = neutralizeSmallEnclosedHoleColorIslands(data, width, height);

  assert.deepEqual(result, {
    componentsNeutralized: 0,
    pixelsNeutralized: 0,
    effectivePixelsNeutralized: 0
  });
  assert.deepEqual(pixel(data, width, x, y), before);
});

test('never touches a chromatic component beside exterior transparency', () => {
  const width = 41;
  const height = 41;
  const data = createWhiteCutlineRing(width);
  const x = 4;
  const y = 20;
  const exteriorTint = [20, 168, 150, 180];
  data.set(exteriorTint, (y * width + x) * 4);
  const before = pixel(data, width, x, y);

  const result = neutralizeSmallEnclosedHoleColorIslands(data, width, height);

  assert.deepEqual(result, {
    componentsNeutralized: 0,
    pixelsNeutralized: 0,
    effectivePixelsNeutralized: 0
  });
  assert.deepEqual(pixel(data, width, x, y), before);
});

test('preserves a large colored region instead of treating it as cutline debris', () => {
  const width = 55;
  const height = 55;
  const data = createWhiteCutlineRing(width);

  for (let y = 18; y < 28; y++) {
    for (let x = 18; x < 28; x++) {
      data.set([20, 168, 150, 180], (y * width + x) * 4);
    }
  }
  const before = pixel(data, width, 20, 20);

  const result = neutralizeSmallEnclosedHoleColorIslands(data, width, height);

  assert.deepEqual(result, {
    componentsNeutralized: 0,
    pixelsNeutralized: 0,
    effectivePixelsNeutralized: 0
  });
  assert.deepEqual(pixel(data, width, 20, 20), before);
});
