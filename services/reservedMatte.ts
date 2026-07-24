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

const MATTE_CORE_DISTANCE = 48;
const EDGE_DEPTH = 4;
const FOREGROUND_SEARCH_RADIUS = 5;
const MINIMUM_FOREGROUND_GAIN = 10;
const MAXIMUM_LINE_RESIDUAL = 24;

const pixelColorDistance = (
  red: number,
  green: number,
  blue: number,
  color: RgbColor
) => Math.hypot(red - color.r, green - color.g, blue - color.b);

/**
 * Removes one verified technical matte and reconstructs its antialiased edge
 * from nearby opaque foreground colors.
 *
 * The source is a flattened RGB image, so a boundary pixel is:
 *   observed = matte * (1 - coverage) + foreground * coverage
 *
 * Unlike a white-only chroma repair, the foreground sample can be black,
 * colored, or white. The function changes only a short band around verified
 * matte pixels and never scans arbitrary artwork for green/cyan hues.
 */
export const removeReservedMatteWithLocalForeground = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  matte: RgbColor
) => {
  const pixelCount = width * height;
  if (!pixelCount || data.length < pixelCount * 4) return 0;

  const source = new Uint8ClampedArray(data);
  const mattePixel = new Uint8Array(pixelCount);
  const distance = new Uint8Array(pixelCount);
  distance.fill(255);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;
  let changed = 0;

  for (let position = 0; position < pixelCount; position++) {
    const index = position * 4;
    if (
      source[index + 3] > 8
      && pixelColorDistance(source[index], source[index + 1], source[index + 2], matte)
        <= MATTE_CORE_DISTANCE
    ) {
      mattePixel[position] = 1;
      distance[position] = 0;
      queue[queueEnd++] = position;
    }
  }

  if (!queueEnd || queueEnd > pixelCount * 0.92) return 0;

  for (let position = 0; position < pixelCount; position++) {
    if (!mattePixel[position]) continue;
    const index = position * 4;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 0;
    changed++;
  }

  while (queueStart < queueEnd) {
    const position = queue[queueStart++];
    const currentDistance = distance[position];
    if (currentDistance >= EDGE_DEPTH) continue;
    const x = position % width;
    const y = Math.floor(position / width);

    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      const nextY = y + offsetY;
      if (nextY < 0 || nextY >= height) continue;
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (!offsetX && !offsetY) continue;
        const nextX = x + offsetX;
        if (nextX < 0 || nextX >= width) continue;
        const next = nextY * width + nextX;
        if (distance[next] !== 255) continue;
        distance[next] = currentDistance + 1;
        queue[queueEnd++] = next;
      }
    }
  }

  for (let position = 0; position < pixelCount; position++) {
    if (distance[position] < 1 || distance[position] > EDGE_DEPTH) continue;
    const index = position * 4;
    if (source[index + 3] <= 8) continue;

    const x = position % width;
    const y = Math.floor(position / width);
    const observedRed = source[index];
    const observedGreen = source[index + 1];
    const observedBlue = source[index + 2];
    const observedDistance = pixelColorDistance(
      observedRed,
      observedGreen,
      observedBlue,
      matte
    );

    let best:
      | {
        coverage: number;
        residual: number;
        foregroundDistance: number;
        red: number;
        green: number;
        blue: number;
      }
      | undefined;

    for (let offsetY = -FOREGROUND_SEARCH_RADIUS; offsetY <= FOREGROUND_SEARCH_RADIUS; offsetY++) {
      const sampleY = y + offsetY;
      if (sampleY < 0 || sampleY >= height) continue;
      for (let offsetX = -FOREGROUND_SEARCH_RADIUS; offsetX <= FOREGROUND_SEARCH_RADIUS; offsetX++) {
        const sampleX = x + offsetX;
        if (sampleX < 0 || sampleX >= width || (!offsetX && !offsetY)) continue;
        const samplePosition = sampleY * width + sampleX;
        if (mattePixel[samplePosition]) continue;
        const sampleIndex = samplePosition * 4;
        if (source[sampleIndex + 3] < 220) continue;

        const foregroundRed = source[sampleIndex];
        const foregroundGreen = source[sampleIndex + 1];
        const foregroundBlue = source[sampleIndex + 2];
        const foregroundVectorRed = foregroundRed - matte.r;
        const foregroundVectorGreen = foregroundGreen - matte.g;
        const foregroundVectorBlue = foregroundBlue - matte.b;
        const foregroundDistance = Math.hypot(
          foregroundVectorRed,
          foregroundVectorGreen,
          foregroundVectorBlue
        );
        if (foregroundDistance < observedDistance + MINIMUM_FOREGROUND_GAIN) continue;

        const vectorLengthSquared = foregroundDistance * foregroundDistance;
        const coverage = (
          (observedRed - matte.r) * foregroundVectorRed
          + (observedGreen - matte.g) * foregroundVectorGreen
          + (observedBlue - matte.b) * foregroundVectorBlue
        ) / Math.max(1, vectorLengthSquared);
        if (coverage <= 0.02 || coverage >= 0.985) continue;

        const residual = Math.hypot(
          observedRed - (matte.r + coverage * foregroundVectorRed),
          observedGreen - (matte.g + coverage * foregroundVectorGreen),
          observedBlue - (matte.b + coverage * foregroundVectorBlue)
        );
        if (residual > MAXIMUM_LINE_RESIDUAL) continue;

        if (
          !best
          // A matte-blended neighbor can fit the same line perfectly, but it is
          // only another midpoint—not the real foreground endpoint. Prefer the
          // accepted sample farthest from the matte, then use residual as the
          // tie-breaker.
          || foregroundDistance > best.foregroundDistance + 1
          || (
            Math.abs(foregroundDistance - best.foregroundDistance) <= 1
            && residual < best.residual
          )
        ) {
          best = {
            coverage,
            residual,
            foregroundDistance,
            red: foregroundRed,
            green: foregroundGreen,
            blue: foregroundBlue
          };
        }
      }
    }

    if (!best) continue;
    data[index] = best.red;
    data[index + 1] = best.green;
    data[index + 2] = best.blue;
    data[index + 3] = Math.min(
      source[index + 3],
      Math.round(best.coverage * 255)
    );
    changed++;
  }

  return changed;
};
