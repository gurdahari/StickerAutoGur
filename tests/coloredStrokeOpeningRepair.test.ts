import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeColoredStrokeMicroOpenings,
  repairRetainedOpeningStrokeEdges
} from '../services/coloredStrokeOpeningRepair';

const MATTE = { r: 0, g: 255, b: 59 };

const createSticker = (
  width: number,
  height: number,
  color: [number, number, number] = [18, 24, 30]
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 5; y < height - 5; y++) {
    for (let x = 5; x < width - 5; x++) {
      data.set([...color, 255], (y * width + x) * 4);
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
  const index = (y * width + x) * 4;
  return Array.from(data.slice(index, index + 4));
};

test('closes an isolated micro-hole inside a dark thin stroke using local artwork color', () => {
  const width = 80;
  const height = 80;
  const data = createSticker(width, height, [12, 18, 22]);
  cutHole(data, width, 18, 24, 4, 4);

  const result = closeColoredStrokeMicroOpenings(data, width, height, MATTE);

  assert.equal(result.openingsDetected, 1);
  assert.equal(result.openingsClosed, 1);
  assert.equal(result.pixelsFilled, 16);
  assert.deepEqual(rgba(data, width, 19, 25), [12, 18, 22, 255]);
});

test('keeps a matched pair of small openings', () => {
  const width = 80;
  const height = 80;
  const data = createSticker(width, height);
  cutHole(data, width, 19, 30, 4, 5);
  cutHole(data, width, 57, 30, 4, 5);

  const result = closeColoredStrokeMicroOpenings(data, width, height, MATTE);

  assert.equal(result.openingsDetected, 2);
  assert.equal(result.openingsClosed, 0);
  assert.equal(rgba(data, width, 20, 31)[3], 0);
  assert.equal(rgba(data, width, 58, 31)[3], 0);
});

test('keeps a centered punch opening', () => {
  const width = 80;
  const height = 80;
  const data = createSticker(width, height);
  cutHole(data, width, 38, 17, 4, 4);

  const result = closeColoredStrokeMicroOpenings(data, width, height, MATTE);

  assert.equal(result.openingsClosed, 0);
  assert.equal(rgba(data, width, 39, 18)[3], 0);
});

test('keeps a large structural opening even with a dark boundary', () => {
  const width = 120;
  const height = 120;
  const data = createSticker(width, height);
  cutHole(data, width, 20, 28, 24, 26);

  const result = closeColoredStrokeMicroOpenings(data, width, height, MATTE);

  assert.equal(result.openingsDetected, 1);
  assert.equal(result.openingsClosed, 0);
  assert.equal(rgba(data, width, 30, 40)[3], 0);
});

test('treats diagonal transparency connected to the canvas as exterior', () => {
  const width = 48;
  const height = 48;
  const data = createSticker(width, height);

  // A diagonal-only chain reaches the exterior. Four-neighbour flood fill would
  // misclassify it as several enclosed holes; the repair uses eight-connectivity.
  for (let point = 0; point <= 8; point++) {
    const x = 4 + point;
    const y = 4 + point;
    data.set([255, 255, 255, 0], (y * width + x) * 4);
  }

  const result = closeColoredStrokeMicroOpenings(data, width, height, MATTE);

  assert.equal(result.openingsDetected, 0);
  assert.equal(result.openingsClosed, 0);
});

test('removes matte cast from a retained dark-stroke opening without changing alpha', () => {
  const width = 64;
  const height = 64;
  const data = createSticker(width, height, [12, 18, 22]);
  cutHole(data, width, 22, 20, 20, 24);

  // A partial-alpha pixel on the retained opening is a green-matte/black-stroke
  // mixture. A clean opaque stroke core exists a few pixels farther inward.
  data.set([5, 170, 45, 100], (30 * width + 21) * 4);
  data.set([15, 15, 15, 255], (30 * width + 18) * 4);
  const alphaBefore = rgba(data, width, 21, 30)[3];

  const result = repairRetainedOpeningStrokeEdges(data, width, height, MATTE);
  const repaired = rgba(data, width, 21, 30);

  assert.ok(result.componentsNeutralized >= 1);
  assert.ok(result.pixelsNeutralized >= 1);
  assert.equal(repaired[3], alphaBefore);
  assert.ok(repaired[0] < 40 && repaired[1] < 40 && repaired[2] < 40);
});

test('does not recolor fully opaque green artwork beside an opening', () => {
  const width = 64;
  const height = 64;
  const data = createSticker(width, height, [30, 120, 55]);
  cutHole(data, width, 22, 20, 20, 24);
  data.set([20, 150, 45, 255], (30 * width + 21) * 4);
  const before = rgba(data, width, 21, 30);

  repairRetainedOpeningStrokeEdges(data, width, height, MATTE);

  assert.deepEqual(rgba(data, width, 21, 30), before);
});

test('does not clean matte-axis color touching only exterior transparency', () => {
  const width = 48;
  const height = 48;
  const data = createSticker(width, height, [12, 18, 22]);
  data.set([5, 170, 45, 100], (20 * width + 5) * 4);
  const before = rgba(data, width, 5, 20);

  const result = repairRetainedOpeningStrokeEdges(data, width, height, MATTE);

  assert.equal(result.pixelsNeutralized, 0);
  assert.deepEqual(rgba(data, width, 5, 20), before);
});
