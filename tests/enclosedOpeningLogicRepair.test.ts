import assert from 'node:assert/strict';
import test from 'node:test';
import { closeIllogicalEnclosedMicroOpenings } from '../services/enclosedOpeningLogicRepair';

const createWhiteSticker = (width: number, height: number) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 6; y < height - 6; y++) {
    for (let x = 6; x < width - 6; x++) {
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

const alphaAt = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  data[(y * width + x) * 4 + 3];

test('closes a tiny isolated off-axis opening without a paid regeneration', () => {
  const width = 80;
  const height = 80;
  const data = createWhiteSticker(width, height);
  cutHole(data, width, 18, 24, 4, 4);

  const result = closeIllogicalEnclosedMicroOpenings(data, width, height);

  assert.equal(result.openingsDetected, 1);
  assert.equal(result.openingsClosed, 1);
  assert.equal(result.pixelsFilled, 16);
  assert.equal(alphaAt(data, width, 19, 25), 255);
});

test('keeps a matched symmetric pair of small openings', () => {
  const width = 80;
  const height = 80;
  const data = createWhiteSticker(width, height);
  cutHole(data, width, 19, 30, 4, 5);
  cutHole(data, width, 57, 30, 4, 5);

  const result = closeIllogicalEnclosedMicroOpenings(data, width, height);

  assert.equal(result.openingsDetected, 2);
  assert.equal(result.openingsClosed, 0);
  assert.equal(alphaAt(data, width, 20, 31), 0);
  assert.equal(alphaAt(data, width, 58, 31), 0);
});

test('keeps a centered single punch opening', () => {
  const width = 80;
  const height = 80;
  const data = createWhiteSticker(width, height);
  cutHole(data, width, 38, 17, 4, 4);

  const result = closeIllogicalEnclosedMicroOpenings(data, width, height);

  assert.equal(result.openingsDetected, 1);
  assert.equal(result.openingsClosed, 0);
  assert.equal(alphaAt(data, width, 39, 18), 0);
});

test('keeps a large structural opening even when it is off-axis', () => {
  const width = 120;
  const height = 120;
  const data = createWhiteSticker(width, height);
  cutHole(data, width, 20, 28, 24, 26);

  const result = closeIllogicalEnclosedMicroOpenings(data, width, height);

  assert.equal(result.openingsDetected, 1);
  assert.equal(result.openingsClosed, 0);
  assert.equal(alphaAt(data, width, 30, 40), 0);
});

test('does not treat exterior transparency as an opening', () => {
  const width = 64;
  const height = 64;
  const data = createWhiteSticker(width, height);

  const result = closeIllogicalEnclosedMicroOpenings(data, width, height);

  assert.deepEqual(result, { openingsDetected: 0, openingsClosed: 0, pixelsFilled: 0 });
});
