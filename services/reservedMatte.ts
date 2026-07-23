export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const RESERVED_MATTE_KEYS: RgbColor[] = [
  { r: 0, g: 255, b: 59 },
  { r: 255, g: 0, b: 212 },
  { r: 0, g: 229, b: 255 },
  { r: 255, g: 90, b: 0 }
];

const median = (values: number[]) => {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] || 0;
};

const colorDistance = (left: RgbColor, right: RgbColor) => {
  const red = left.r - right.r;
  const green = left.g - right.g;
  const blue = left.b - right.b;
  return Math.sqrt(red * red + green * green + blue * blue);
};

/**
 * Verifies that every corner contains the same known technical key. A vivid
 * color elsewhere in the image is never enough to enable enclosed removal.
 */
export const inspectStickerBackground = (data: Uint8ClampedArray, width: number, height: number) => {
  const sampleSize = Math.max(3, Math.floor(Math.min(width, height) * 0.018));
  const corners = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize]
  ];
  const cornerSamples: RgbColor[][] = [];

  for (const [startX, startY] of corners) {
    const samples: RgbColor[] = [];
    for (let y = startY; y < startY + sampleSize; y += 2) {
      for (let x = startX; x < startX + sampleSize; x += 2) {
        const index = (y * width + x) * 4;
        if (data[index + 3] === 0) continue;
        samples.push({ r: data[index], g: data[index + 1], b: data[index + 2] });
      }
    }
    cornerSamples.push(samples);
  }

  const allSamples = cornerSamples.flat();
  const background = {
    r: median(allSamples.map(sample => sample.r)),
    g: median(allSamples.map(sample => sample.g)),
    b: median(allSamples.map(sample => sample.b))
  };
  const reservedKey = RESERVED_MATTE_KEYS
    .map(key => ({ key, distance: colorDistance(background, key) }))
    .sort((left, right) => left.distance - right.distance)[0];
  const hasStableReservedMatte = Boolean(
    reservedKey
    && reservedKey.distance <= 62
    && cornerSamples.every(samples => {
      if (samples.length < 8) return false;
      const cornerMedian = {
        r: median(samples.map(sample => sample.r)),
        g: median(samples.map(sample => sample.g)),
        b: median(samples.map(sample => sample.b))
      };
      const matchingSamples = samples.filter(sample => colorDistance(sample, reservedKey.key) <= 72);
      return colorDistance(cornerMedian, reservedKey.key) <= 62
        && matchingSamples.length / samples.length >= 0.82;
    })
  );

  return { background, hasStableReservedMatte };
};

/**
 * Removes even tiny enclosed regions that match the verified background key.
 * It deliberately has no black/dark-color heuristic.
 */
export const removeEnclosedReservedMatte = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  distanceFromBackground: (pixelIndex: number) => number
) => {
  const pixelCount = width * height;
  const remove = new Uint8Array(pixelCount);
  let removalCount = 0;

  for (let position = 0; position < pixelCount; position++) {
    const pixelIndex = position * 4;
    if (data[pixelIndex + 3] <= 8 || distanceFromBackground(pixelIndex) > 48) continue;
    remove[position] = 1;
    removalCount++;
  }

  // A valid opening may be large, but a key-colored region covering most of the
  // image means the provider did not honor the sticker contract. Fail closed.
  if (!removalCount || removalCount > pixelCount * 0.35) return 0;

  for (let position = 0; position < pixelCount; position++) {
    if (remove[position]) data[position * 4 + 3] = 0;
  }

  return removalCount;
};

/**
 * Solves the one-dimensional matte-to-white blend at the die-cut boundary,
 * replacing a colored fringe with the equivalent white alpha pixel.
 */
export const reconstructReservedMatteWhitePixel = (
  data: Uint8ClampedArray,
  pixelIndex: number,
  background: RgbColor
) => {
  const whiteVector = {
    r: 255 - background.r,
    g: 255 - background.g,
    b: 255 - background.b
  };
  const vectorLengthSquared = whiteVector.r * whiteVector.r
    + whiteVector.g * whiteVector.g
    + whiteVector.b * whiteVector.b;
  if (vectorLengthSquared < 1) return false;

  const observed = {
    r: data[pixelIndex] - background.r,
    g: data[pixelIndex + 1] - background.g,
    b: data[pixelIndex + 2] - background.b
  };
  const alpha = Math.max(0, Math.min(1, (
    observed.r * whiteVector.r
    + observed.g * whiteVector.g
    + observed.b * whiteVector.b
  ) / vectorLengthSquared));
  const expected = {
    r: background.r + alpha * whiteVector.r,
    g: background.g + alpha * whiteVector.g,
    b: background.b + alpha * whiteVector.b
  };
  const residual = Math.hypot(
    data[pixelIndex] - expected.r,
    data[pixelIndex + 1] - expected.g,
    data[pixelIndex + 2] - expected.b
  );
  if (alpha < 0.18 || residual > 30) return false;

  data[pixelIndex] = 255;
  data[pixelIndex + 1] = 255;
  data[pixelIndex + 2] = 255;
  data[pixelIndex + 3] = Math.min(data[pixelIndex + 3], Math.round(alpha * 255));
  return true;
};
