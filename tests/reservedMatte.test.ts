import assert from 'node:assert/strict';
import test from 'node:test';
import { removeReservedMatteWithLocalForeground } from '../services/reservedMatte';

const width = 24;
const height = 16;
const matte = { r: 0, g: 229, b: 255 };
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

test('reconstructs black, colored, and white antialias edges from one matte', () => {
  const data = new Uint8ClampedArray(width * height * 4);
  paint(data, 0, 0, width - 1, height - 1, [matte.r, matte.g, matte.b, 255]);

  const foregrounds: [number, number, number][] = [
    [0, 0, 0],
    [248, 116, 151],
    [255, 255, 255]
  ];

  foregrounds.forEach((foreground, row) => {
    const y = 3 + row * 4;
    data.set(blend(foreground, 0.28), pixel(7, y));
    data.set(blend(foreground, 0.68), pixel(8, y));
    paint(data, 9, y - 1, 14, y + 1, [...foreground, 255]);
  });

  const changed = removeReservedMatteWithLocalForeground(data, width, height, matte);
  assert.ok(changed > 0);

  foregrounds.forEach((foreground, row) => {
    const y = 3 + row * 4;
    assert.deepEqual(Array.from(data.slice(pixel(7, y), pixel(7, y) + 3)), foreground);
    assert.ok(Math.abs(data[pixel(7, y) + 3] - 71) <= 2);
    assert.deepEqual(Array.from(data.slice(pixel(8, y), pixel(8, y) + 3)), foreground);
    assert.ok(Math.abs(data[pixel(8, y) + 3] - 173) <= 2);
    assert.deepEqual(Array.from(data.slice(pixel(12, y), pixel(12, y) + 4)), [...foreground, 255]);
  });
  assert.deepEqual(Array.from(data.slice(pixel(0, 0), pixel(0, 0) + 4)), [255, 255, 255, 0]);
});

test('removes the same matte inside a closed opening', () => {
  const data = new Uint8ClampedArray(width * height * 4);
  paint(data, 0, 0, width - 1, height - 1, [255, 255, 255, 255]);
  paint(data, 7, 4, 16, 11, [22, 22, 22, 255]);
  paint(data, 8, 5, 15, 10, blend([22, 22, 22], 0.72));
  paint(data, 9, 6, 14, 9, [matte.r, matte.g, matte.b, 255]);

  removeReservedMatteWithLocalForeground(data, width, height, matte);

  assert.equal(data[pixel(11, 7) + 3], 0);
  assert.deepEqual(Array.from(data.slice(pixel(8, 7), pixel(8, 7) + 3)), [22, 22, 22]);
  assert.ok(Math.abs(data[pixel(8, 7) + 3] - 184) <= 2);
  assert.deepEqual(Array.from(data.slice(pixel(7, 7), pixel(7, 7) + 4)), [22, 22, 22, 255]);
});

test('never uses another matte-blended edge pixel as foreground', () => {
  const data = new Uint8ClampedArray(width * height * 4);
  paint(data, 0, 0, width - 1, height - 1, [255, 255, 255, 255]);
  const foreground: [number, number, number] = [190, 150, 120];
  paint(data, 3, 4, 8, 11, [matte.r, matte.g, matte.b, 255]);
  paint(data, 9, 4, 9, 11, blend([210, 160, 110], 0.30));
  paint(data, 10, 4, 10, 11, blend([210, 160, 110], 0.60));
  paint(data, 11, 4, 11, 11, blend([210, 160, 110], 0.76));
  paint(data, 12, 4, 12, 11, blend([210, 160, 110], 0.90));
  paint(data, 13, 4, 18, 11, [...foreground, 255]);

  removeReservedMatteWithLocalForeground(data, width, height, matte);

  assert.deepEqual(Array.from(data.slice(pixel(9, 7), pixel(9, 7) + 3)), foreground);
  assert.ok(Math.abs(data[pixel(9, 7) + 3] - 80) <= 2);
});

test('does not recolor unrelated artwork outside the matte boundary band', () => {
  const data = new Uint8ClampedArray(width * height * 4);
  paint(data, 0, 0, width - 1, height - 1, [255, 255, 255, 255]);
  paint(data, 1, 1, 3, 3, [matte.r, matte.g, matte.b, 255]);
  paint(data, 15, 5, 20, 10, [26, 134, 67, 255]);
  const original = Array.from(data.slice(pixel(18, 7), pixel(18, 7) + 4));

  removeReservedMatteWithLocalForeground(data, width, height, matte);

  assert.deepEqual(Array.from(data.slice(pixel(18, 7), pixel(18, 7) + 4)), original);
});
