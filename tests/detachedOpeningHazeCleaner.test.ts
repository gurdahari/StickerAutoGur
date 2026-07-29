import assert from 'node:assert/strict';
import test from 'node:test';
import { clearDetachedOpeningHaze } from '../services/detachedOpeningHazeCleaner';

const MATTE = { r: 0, g: 255, b: 59 };

const createSticker = (width: number, height: number) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 5; y < height - 5; y++) {
    for (let x = 5; x < width - 5; x++) {
      data.set([248, 248, 248, 255], (y * width + x) * 4);
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

const paintEllipse = (
  data: Uint8ClampedArray,
  width: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  rgba: [number, number, number, number]
) => {
  let pixels = 0;
  for (let y = centerY - radiusY; y <= centerY + radiusY; y++) {
    for (let x = centerX - radiusX; x <= centerX + radiusX; x++) {
      const normalized = ((x - centerX) ** 2) / (radiusX ** 2)
        + ((y - centerY) ** 2) / (radiusY ** 2);
      if (normalized > 1) continue;
      data.set(rgba, (y * width + x) * 4);
      pixels++;
    }
  }
  return pixels;
};

const alphaAt = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  data[(y * width + x) * 4 + 3];

test('clears a detached pale haze patch larger than the tiny-dust limit', () => {
  const width = 96;
  const height = 96;
  const data = createSticker(width, height);
  cutHole(data, width, 20, 18, 56, 55);

  const hazePixels = paintEllipse(data, width, 48, 42, 9, 13, [247, 232, 236, 78]);
  assert.ok(hazePixels > 48);

  const result = clearDetachedOpeningHaze(data, width, height, MATTE);

  assert.equal(result.componentsCleared, 1);
  assert.equal(result.pixelsCleared, hazePixels);
  assert.equal(alphaAt(data, width, 48, 42), 0);
});

test('clears a detached matte-axis haze island inside a retained opening', () => {
  const width = 80;
  const height = 80;
  const data = createSticker(width, height);
  cutHole(data, width, 18, 16, 44, 46);
  paintEllipse(data, width, 40, 38, 6, 8, [28, 166, 54, 92]);

  const result = clearDetachedOpeningHaze(data, width, height, MATTE);

  assert.equal(result.componentsCleared, 1);
  assert.equal(alphaAt(data, width, 40, 38), 0);
});

test('preserves a soft edge attached to a strong opaque artwork core', () => {
  const width = 80;
  const height = 80;
  const data = createSticker(width, height);
  cutHole(data, width, 24, 20, 32, 40);

  for (let y = 30; y <= 42; y++) {
    data.set([125, 82, 178, 255], (y * width + 23) * 4);
    data.set([202, 181, 222, 100], (y * width + 24) * 4);
  }

  const before = alphaAt(data, width, 24, 36);
  const result = clearDetachedOpeningHaze(data, width, height, MATTE);

  assert.equal(result.componentsCleared, 0);
  assert.equal(alphaAt(data, width, 24, 36), before);
});

test('preserves a detached opaque decorative detail inside an opening', () => {
  const width = 80;
  const height = 80;
  const data = createSticker(width, height);
  cutHole(data, width, 18, 16, 44, 46);
  paintEllipse(data, width, 40, 38, 5, 7, [245, 225, 232, 255]);

  const result = clearDetachedOpeningHaze(data, width, height, MATTE);

  assert.equal(result.componentsCleared, 0);
  assert.equal(alphaAt(data, width, 40, 38), 255);
});

test('does not clear low-alpha haze surrounded by exterior transparency', () => {
  const width = 64;
  const height = 64;
  const data = createSticker(width, height);
  paintEllipse(data, width, 2, 30, 1, 5, [247, 232, 236, 78]);

  const before = alphaAt(data, width, 2, 30);
  const result = clearDetachedOpeningHaze(data, width, height, MATTE);

  assert.equal(result.componentsCleared, 0);
  assert.equal(alphaAt(data, width, 2, 30), before);
});
