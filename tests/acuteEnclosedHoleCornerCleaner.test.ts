import assert from 'node:assert/strict';
import test from 'node:test';
import { neutralizeAcuteEnclosedHoleCornerChroma } from '../services/acuteEnclosedHoleCornerCleaner';

const MATTE = { r: 0, g: 255, b: 59 };

const createCanvas = (width: number, height: number) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let position = 0; position < width * height; position++) {
    const pixelIndex = position * 4;
    data[pixelIndex] = 255;
    data[pixelIndex + 1] = 255;
    data[pixelIndex + 2] = 255;
    data[pixelIndex + 3] = 0;
  }
  for (let y = 4; y < height - 4; y++) {
    for (let x = 4; x < width - 4; x++) {
      const pixelIndex = (y * width + x) * 4;
      data[pixelIndex + 3] = 255;
    }
  }
  return data;
};

const setTransparent = (
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
) => {
  const pixelIndex = (y * width + x) * 4;
  data[pixelIndex] = 255;
  data[pixelIndex + 1] = 255;
  data[pixelIndex + 2] = 255;
  data[pixelIndex + 3] = 0;
};

const setGreen = (
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  alpha = 255
) => {
  const pixelIndex = (y * width + x) * 4;
  data[pixelIndex] = 18;
  data[pixelIndex + 1] = 188;
  data[pixelIndex + 2] = 65;
  data[pixelIndex + 3] = alpha;
};

const rgba = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const pixelIndex = (y * width + x) * 4;
  return Array.from(data.slice(pixelIndex, pixelIndex + 4));
};

test('neutralizes an opaque matte wedge extending from an acute enclosed-hole tip', () => {
  const width = 64;
  const height = 64;
  const data = createCanvas(width, height);

  // A triangular enclosed hole with a sharp bottom tip at y=30.
  for (let y = 12; y <= 30; y++) {
    const halfWidth = Math.max(0, Math.floor((30 - y) / 2));
    for (let x = 32 - halfWidth; x <= 32 + halfWidth; x++) {
      setTransparent(data, width, x, y);
    }
  }

  // Opaque green wedge connected to the acute tip and stretched through the
  // surrounding white cutline, matching the real surfboard/umbrella failure.
  const wedgePixels: Array<[number, number]> = [];
  for (let y = 31; y <= 56; y++) {
    const halfWidth = y < 37 ? 2 : 1;
    for (let x = 32 - halfWidth; x <= 32 + halfWidth; x++) {
      setGreen(data, width, x, y);
      wedgePixels.push([x, y]);
    }
  }

  const alphaBefore = data.filter((_, index) => index % 4 === 3);
  const result = neutralizeAcuteEnclosedHoleCornerChroma(data, width, height, MATTE);
  const alphaAfter = data.filter((_, index) => index % 4 === 3);

  assert.ok(result.acuteTipsDetected > 0);
  assert.equal(result.componentsNeutralized, 1);
  assert.equal(result.pixelsNeutralized, wedgePixels.length);
  assert.deepEqual(alphaAfter, alphaBefore);
  for (const [x, y] of wedgePixels) {
    const [red, green, blue, alpha] = rgba(data, width, x, y);
    assert.equal(red, green);
    assert.equal(green, blue);
    assert.equal(alpha, 255);
  }
});

test('does not erase matte-colored detail beside the straight side of a hole', () => {
  const width = 56;
  const height = 56;
  const data = createCanvas(width, height);

  for (let y = 14; y <= 40; y++) {
    for (let x = 20; x <= 36; x++) setTransparent(data, width, x, y);
  }
  for (let y = 25; y <= 29; y++) setGreen(data, width, 18, y);

  const before = rgba(data, width, 18, 27);
  const result = neutralizeAcuteEnclosedHoleCornerChroma(data, width, height, MATTE);

  assert.equal(result.componentsNeutralized, 0);
  assert.deepEqual(rgba(data, width, 18, 27), before);
});

test('does not touch a matte-colored component at exterior transparency', () => {
  const width = 40;
  const height = 40;
  const data = createCanvas(width, height);
  for (let y = 14; y <= 18; y++) setGreen(data, width, 4, y);

  const before = rgba(data, width, 4, 16);
  const result = neutralizeAcuteEnclosedHoleCornerChroma(data, width, height, MATTE);

  assert.equal(result.componentsNeutralized, 0);
  assert.deepEqual(rgba(data, width, 4, 16), before);
});

test('leaves a large artwork component unchanged even near an acute hole', () => {
  const width = 64;
  const height = 64;
  const data = createCanvas(width, height);

  for (let y = 12; y <= 26; y++) {
    const halfWidth = Math.max(0, Math.floor((26 - y) / 2));
    for (let x = 32 - halfWidth; x <= 32 + halfWidth; x++) {
      setTransparent(data, width, x, y);
    }
  }
  for (let y = 27; y <= 50; y++) {
    for (let x = 20; x <= 43; x++) setGreen(data, width, x, y);
  }

  const before = rgba(data, width, 32, 32);
  const result = neutralizeAcuteEnclosedHoleCornerChroma(data, width, height, MATTE);

  assert.equal(result.componentsNeutralized, 0);
  assert.deepEqual(rgba(data, width, 32, 32), before);
});
