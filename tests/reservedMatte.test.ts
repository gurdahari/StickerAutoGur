import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countReservedMatteEdgeContamination,
  extractVerifiedReservedMatte,
  type RgbColor
} from '../services/reservedMatte';

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

const composite = (matte: RgbColor, foreground: RgbColor, coverage: number) => [
  Math.round(foreground.r * coverage + matte.r * (1 - coverage)),
  Math.round(foreground.g * coverage + matte.g * (1 - coverage)),
  Math.round(foreground.b * coverage + matte.b * (1 - coverage)),
  255
];

test('removes an opaque reserved matte and recovers colored antialias pixels', () => {
  const width = 31;
  const height = 31;
  const matte = { r: 0, g: 255, b: 59 };
  const purple = { r: 126, g: 72, b: 190 };
  const data = new Uint8ClampedArray(width * height * 4);

  for (let position = 0; position < width * height; position++) {
    data.set([matte.r, matte.g, matte.b, 255], position * 4);
  }
  for (let y = 2; y <= 28; y++) {
    for (let x = 2; x <= 28; x++) {
      data.set([purple.r, purple.g, purple.b, 255], (y * width + x) * 4);
    }
  }

  // Closed screen/handle opening. The provider flattened both antialias rings
  // to opaque RGB even though they represent partial foreground coverage.
  data.set([matte.r, matte.g, matte.b, 255], (15 * width + 15) * 4);
  for (let y = 14; y <= 16; y++) {
    for (let x = 14; x <= 16; x++) {
      if (x === 15 && y === 15) continue;
      data.set(composite(matte, purple, 0.35), (y * width + x) * 4);
    }
  }
  for (let y = 13; y <= 17; y++) {
    for (let x = 13; x <= 17; x++) {
      if (x > 13 && x < 17 && y > 13 && y < 17) continue;
      data.set(composite(matte, purple, 0.75), (y * width + x) * 4);
    }
  }

  const result = extractVerifiedReservedMatte(data, width, height, matte);

  assert.ok(result.removedPixels > 0);
  assert.ok(result.correctedEdgePixels > 0);
  assert.deepEqual(pixel(data, width, 15, 15), [255, 255, 255, 0]);

  const innerEdge = pixel(data, width, 15, 14);
  assert.ok(Math.abs(innerEdge[0] - purple.r) <= 2);
  assert.ok(Math.abs(innerEdge[1] - purple.g) <= 2);
  assert.ok(Math.abs(innerEdge[2] - purple.b) <= 2);
  assert.ok(Math.abs(innerEdge[3] - 89) <= 2);

  const outerEdge = pixel(data, width, 15, 13);
  assert.ok(Math.abs(outerEdge[0] - purple.r) <= 2);
  assert.ok(Math.abs(outerEdge[1] - purple.g) <= 2);
  assert.ok(Math.abs(outerEdge[2] - purple.b) <= 2);
  assert.ok(Math.abs(outerEdge[3] - 191) <= 2);
  assert.equal(countReservedMatteEdgeContamination(data, width, height, matte), 0);
});

test('recovers a white cutline without leaving the technical key in RGB', () => {
  const width = 13;
  const height = 13;
  const matte = { r: 0, g: 229, b: 255 };
  const white = { r: 255, g: 255, b: 255 };
  const data = new Uint8ClampedArray(width * height * 4);

  for (let position = 0; position < width * height; position++) {
    data.set([matte.r, matte.g, matte.b, 255], position * 4);
  }
  for (let y = 3; y <= 9; y++) {
    for (let x = 3; x <= 9; x++) {
      const boundary = x === 3 || x === 9 || y === 3 || y === 9;
      data.set(
        boundary ? composite(matte, white, 0.4) : [255, 255, 255, 255],
        (y * width + x) * 4
      );
    }
  }

  extractVerifiedReservedMatte(data, width, height, matte);

  const edge = pixel(data, width, 6, 3);
  assert.ok(edge.slice(0, 3).every(channel => channel >= 254));
  assert.ok(Math.abs(edge[3] - 102) <= 2);
});

test('preserves unrelated green artwork away from verified matte components', () => {
  const width = 15;
  const height = 15;
  const matte = { r: 255, g: 0, b: 212 };
  const artworkGreen = [26, 134, 67, 255];
  const data = new Uint8ClampedArray(width * height * 4);

  for (let position = 0; position < width * height; position++) {
    data.set([matte.r, matte.g, matte.b, 255], position * 4);
  }
  for (let y = 2; y <= 12; y++) {
    for (let x = 2; x <= 12; x++) {
      data.set([255, 255, 255, 255], (y * width + x) * 4);
    }
  }
  data.set(artworkGreen, (7 * width + 7) * 4);

  extractVerifiedReservedMatte(data, width, height, matte);

  assert.deepEqual(pixel(data, width, 7, 7), artworkGreen);
});
