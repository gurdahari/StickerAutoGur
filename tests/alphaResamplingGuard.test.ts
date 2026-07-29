import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeEnclosedWhiteCutlineSpecks,
  sanitizeTransparentRgbBeforeResize,
  softenExteriorAlphaOnly
} from '../services/alphaResamplingGuard';

const setPixel = (
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rgba: [number, number, number, number]
) => data.set(rgba, (y * width + x) * 4);

const getPixel = (
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

const paintRect = (
  data: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  rgba: [number, number, number, number]
) => {
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) setPixel(data, width, x, y, rgba);
  }
};

const cutHole = (
  data: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
) => paintRect(data, width, startX, startY, endX, endY, [255, 255, 255, 0]);

test('sanitizes hidden RGB only on transparent pixels', () => {
  const width = 3;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4);
  setPixel(data, width, 0, 0, [0, 255, 59, 0]);
  setPixel(data, width, 1, 0, [12, 30, 80, 8]);
  setPixel(data, width, 2, 0, [20, 40, 60, 9]);

  const changed = sanitizeTransparentRgbBeforeResize(data, width, height);

  assert.equal(changed, 2);
  assert.deepEqual(getPixel(data, width, 0, 0), [255, 255, 255, 0]);
  assert.deepEqual(getPixel(data, width, 1, 0), [255, 255, 255, 8]);
  assert.deepEqual(getPixel(data, width, 2, 0), [20, 40, 60, 9]);
});

test('softens the exterior silhouette without changing enclosed-hole alpha', () => {
  const width = 64;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  paintRect(data, width, 10, 10, 53, 53, [248, 248, 248, 255]);
  cutHole(data, width, 26, 24, 37, 39);

  // Canvas-like antialiasing around the retained opening. These values must stay
  // byte-for-byte unchanged because the final blur is now exterior-only.
  for (let x = 25; x <= 38; x++) {
    setPixel(data, width, x, 23, [245, 245, 245, 72]);
    setPixel(data, width, x, 40, [245, 245, 245, 184]);
  }
  const beforeAlpha = new Uint8ClampedArray(width * height);
  for (let position = 0; position < width * height; position++) {
    beforeAlpha[position] = data[position * 4 + 3];
  }

  const result = softenExteriorAlphaOnly(data, width, height);

  assert.equal(result.applied, true);
  let exteriorChanged = 0;
  for (let position = 0; position < width * height; position++) {
    const x = position % width;
    const y = Math.floor(position / width);
    const after = data[position * 4 + 3];
    if (x >= 23 && x <= 40 && y >= 21 && y <= 42) {
      assert.equal(after, beforeAlpha[position]);
    } else if (after !== beforeAlpha[position]) {
      exteriorChanged++;
    }
  }
  assert.ok(exteriorChanged > 0);
});

test('neutralizes dark low-alpha specks on a proven white enclosed cutline', () => {
  const width = 48;
  const height = 48;
  const data = new Uint8ClampedArray(width * height * 4);
  paintRect(data, width, 5, 5, 42, 42, [248, 247, 246, 255]);
  cutHole(data, width, 17, 14, 30, 33);

  setPixel(data, width, 16, 21, [0, 0, 0, 24]);
  setPixel(data, width, 31, 25, [42, 48, 39, 76]);
  const alphaBefore = Array.from({ length: width * height }, (_, position) => data[position * 4 + 3]);

  const result = normalizeEnclosedWhiteCutlineSpecks(data, width, height);

  assert.equal(result.holesDetected, 1);
  assert.equal(result.holesNormalized, 1);
  assert.equal(result.pixelsNormalized, 2);
  assert.deepEqual(getPixel(data, width, 16, 21), [248, 248, 248, 24]);
  assert.deepEqual(getPixel(data, width, 31, 25), [248, 248, 248, 76]);
  for (let position = 0; position < width * height; position++) {
    assert.equal(data[position * 4 + 3], alphaBefore[position]);
  }
});

test('preserves a colored structural opening without white-cutline proof', () => {
  const width = 48;
  const height = 48;
  const data = new Uint8ClampedArray(width * height * 4);
  paintRect(data, width, 5, 5, 42, 42, [145, 112, 170, 255]);
  cutHole(data, width, 17, 14, 30, 33);
  setPixel(data, width, 16, 22, [24, 20, 30, 58]);
  const before = getPixel(data, width, 16, 22);

  const result = normalizeEnclosedWhiteCutlineSpecks(data, width, height);

  assert.equal(result.holesDetected, 1);
  assert.equal(result.holesNormalized, 0);
  assert.equal(result.pixelsNormalized, 0);
  assert.deepEqual(getPixel(data, width, 16, 22), before);
});

test('treats a diagonal transparent route to the canvas as exterior', () => {
  const width = 48;
  const height = 48;
  const data = new Uint8ClampedArray(width * height * 4);
  paintRect(data, width, 5, 5, 42, 42, [248, 248, 248, 255]);
  cutHole(data, width, 20, 18, 27, 27);

  for (let step = 0; step <= 15; step++) {
    setPixel(data, width, 20 - step, 18 - step, [255, 255, 255, 0]);
  }
  setPixel(data, width, 28, 22, [0, 0, 0, 30]);
  const before = getPixel(data, width, 28, 22);

  const result = normalizeEnclosedWhiteCutlineSpecks(data, width, height);

  assert.equal(result.holesDetected, 0);
  assert.equal(result.pixelsNormalized, 0);
  assert.deepEqual(getPixel(data, width, 28, 22), before);
});
