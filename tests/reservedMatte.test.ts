import assert from 'node:assert/strict';
import test from 'node:test';
import { removeReservedMatteWithTrimap } from '../services/reservedMatte';

const width = 36;
const height = 24;
const matte = { r: 0, g: 255, b: 59 };
const pixel = (x: number, y: number) => (y * width + x) * 4;

const blend = (
  foreground: [number, number, number],
  coverage: number
): [number, number, number, number] => [
  Math.round(matte.r + coverage * (foreground[0] - matte.r)),
  Math.round(matte.g + coverage * (foreground[1] - matte.g)),
  Math.round(matte.b + coverage * (foreground[2] - matte.b)),
  255
];

const paint = (
  data: Uint8ClampedArray,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  color: [number, number, number, number]
) => {
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) data.set(color, pixel(x, y));
  }
};

test('creates a clean four-layer alpha ramp without keeping chroma RGB', () => {
  const data = new Uint8ClampedArray(width * height * 4);
  paint(data, 0, 0, width - 1, height - 1, [matte.r, matte.g, matte.b, 255]);
  const foreground: [number, number, number] = [190, 150, 120];
  paint(data, 10, 5, 28, 18, [...foreground, 255]);
  paint(data, 6, 5, 6, 18, blend(foreground, 0.15));
  paint(data, 7, 5, 7, 18, blend(foreground, 0.35));
  paint(data, 8, 5, 8, 18, blend(foreground, 0.60));
  paint(data, 9, 5, 9, 18, blend(foreground, 0.85));

  removeReservedMatteWithTrimap(data, width, height, matte);

  assert.deepEqual(Array.from(data.slice(pixel(6, 10), pixel(6, 10) + 4)), [255, 255, 255, 0]);
  for (let x = 7; x <= 10; x++) {
    assert.deepEqual(Array.from(data.slice(pixel(x, 10), pixel(x, 10) + 3)), foreground);
  }
  assert.deepEqual(
    [7, 8, 9, 10].map(x => data[pixel(x, 10) + 3]),
    [32, 96, 159, 223]
  );
});

test('uses the same trimap for a closed opening', () => {
  const data = new Uint8ClampedArray(width * height * 4);
  paint(data, 0, 0, width - 1, height - 1, [255, 255, 255, 255]);
  const foreground: [number, number, number] = [91, 58, 35];
  paint(data, 7, 3, 28, 20, [...foreground, 255]);
  paint(data, 11, 7, 24, 16, blend(foreground, 0.80));
  paint(data, 12, 8, 23, 15, blend(foreground, 0.55));
  paint(data, 13, 9, 22, 14, blend(foreground, 0.30));
  paint(data, 14, 10, 21, 13, [matte.r, matte.g, matte.b, 255]);

  removeReservedMatteWithTrimap(data, width, height, matte);

  assert.equal(data[pixel(17, 11) + 3], 0);
  assert.deepEqual(Array.from(data.slice(pixel(13, 11), pixel(13, 11) + 3)), foreground);
  assert.equal(data[pixel(13, 11) + 3], 32);
});

test('falls back safely for a thin foreground with no wide clean core', () => {
  const data = new Uint8ClampedArray(width * height * 4);
  paint(data, 0, 0, width - 1, height - 1, [matte.r, matte.g, matte.b, 255]);
  const foreground: [number, number, number] = [30, 30, 30];
  paint(data, 8, 11, 27, 12, [...foreground, 255]);

  removeReservedMatteWithTrimap(data, width, height, matte);

  assert.deepEqual(Array.from(data.slice(pixel(17, 11), pixel(17, 11) + 3)), foreground);
  assert.notEqual(data[pixel(17, 11) + 1], matte.g);
});

test('does not alter unrelated artwork outside the transition band', () => {
  const data = new Uint8ClampedArray(width * height * 4);
  paint(data, 0, 0, width - 1, height - 1, [255, 255, 255, 255]);
  paint(data, 1, 1, 5, 5, [matte.r, matte.g, matte.b, 255]);
  paint(data, 20, 8, 30, 18, [26, 134, 67, 255]);
  const original = Array.from(data.slice(pixel(25, 12), pixel(25, 12) + 4));

  removeReservedMatteWithTrimap(data, width, height, matte);

  assert.deepEqual(Array.from(data.slice(pixel(25, 12), pixel(25, 12) + 4)), original);
});
