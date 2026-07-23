import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expectsEnclosedOpening,
  removeVerifiedEnclosedBlackOpenings
} from '../services/enclosedBlackOpening';

const width = 128;
const height = 128;
const pixel = (x: number, y: number) => (y * width + x) * 4;

const paint = (
  data: Uint8ClampedArray,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  color: [number, number, number, number]
) => {
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      data.set(color, pixel(x, y));
    }
  }
};

const makeSticker = () => {
  const data = new Uint8ClampedArray(width * height * 4);
  paint(data, 12, 12, 115, 115, [248, 246, 240, 255]);

  // Legitimate dark artwork has a colored boundary, not a light cutline.
  paint(data, 20, 45, 48, 77, [185, 92, 28, 255]);
  paint(data, 26, 51, 42, 71, [20, 20, 20, 255]);

  // Simulate a black matte mistake plus its neutral antialias fringe.
  paint(data, 64, 47, 90, 78, [112, 112, 112, 255]);
  paint(data, 65, 48, 89, 77, [0, 0, 0, 255]);
  return data;
};

const basketPrompt =
  'TYPE: Object-Only | SUBJECT: picnic basket with bottle | COMPOSITION: centered | TEXT: NONE';

test('recognizes basket prompts as opening-bearing geometry', () => {
  assert.equal(expectsEnclosedOpening(basketPrompt), true);
});

test('repairs one enclosed black opening without touching dark artwork', () => {
  const data = makeSticker();
  assert.equal(
    removeVerifiedEnclosedBlackOpenings(data, width, height, basketPrompt),
    25 * 30
  );
  assert.equal(data[pixel(70, 60) + 3], 0);
  assert.equal(data[pixel(30, 60) + 3], 255);
  assert.deepEqual(
    Array.from(data.slice(pixel(64, 60), pixel(64, 60) + 4)),
    [255, 255, 255, 112]
  );
});

test('fails closed for complex scenes and protected dark artwork', () => {
  const complex = makeSticker();
  assert.equal(
    removeVerifiedEnclosedBlackOpenings(
      complex,
      width,
      height,
      'TYPE: Object | SUBJECT: picnic basket in a forest landscape | TEXT: NONE'
    ),
    0
  );
  assert.equal(complex[pixel(70, 60) + 3], 255);

  const protectedArt = makeSticker();
  assert.equal(
    removeVerifiedEnclosedBlackOpenings(
      protectedArt,
      width,
      height,
      'TYPE: Object | SUBJECT: charcoal basket silhouette with handle | TEXT: NONE'
    ),
    0
  );
});

test('manual repair keeps the same geometry guard while bypassing prompt risk', () => {
  const data = makeSticker();
  assert.equal(
    removeVerifiedEnclosedBlackOpenings(
      data,
      width,
      height,
      'TYPE: Object | SUBJECT: charcoal basket silhouette with handle | TEXT: NONE',
      true
    ),
    25 * 30
  );
});

test('repairs several bounded openings only for multi-opening structures', () => {
  const data = makeSticker();
  paint(data, 66, 91, 79, 102, [105, 105, 105, 255]);
  paint(data, 67, 92, 78, 101, [0, 0, 0, 255]);

  assert.equal(
    removeVerifiedEnclosedBlackOpenings(
      data,
      width,
      height,
      'TYPE: Object-Only | SUBJECT: bicycle with two wheels | TEXT: NONE'
    ),
    (25 * 30) + (12 * 10)
  );
  assert.equal(data[pixel(70, 60) + 3], 0);
  assert.equal(data[pixel(70, 96) + 3], 0);
  assert.equal(data[pixel(30, 60) + 3], 255);
});

test('keeps the single-opening budget for ordinary objects', () => {
  const data = makeSticker();
  paint(data, 66, 91, 79, 102, [105, 105, 105, 255]);
  paint(data, 67, 92, 78, 101, [0, 0, 0, 255]);

  assert.equal(removeVerifiedEnclosedBlackOpenings(data, width, height, basketPrompt), 0);
  assert.equal(data[pixel(70, 60) + 3], 255);
  assert.equal(data[pixel(70, 96) + 3], 255);
});
