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
const TRANSITION_DEPTH = 4;
const FOREGROUND_CORE_DISTANCE = 96;
const FOREGROUND_SEARCH_RADIUS = 12;

const pixelColorDistance = (
  red: number,
  green: number,
  blue: number,
  color: RgbColor
) => Math.hypot(red - color.r, green - color.g, blue - color.b);

/**
 * Converts a verified technical matte into alpha using a spatial trimap.
 *
 * The technical matte is background core, pixels beyond the transition band
 * are foreground core, and the four pixels between them receive a fixed smooth
 * alpha ramp. Transition RGB is copied from foreground core rather than solved
 * from a chroma-contaminated source pixel.
 */
export const removeReservedMatteWithTrimap = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  matte: RgbColor
) => {
  const pixelCount = width * height;
  if (!pixelCount || data.length < pixelCount * 4) return 0;

  const source = new Uint8ClampedArray(data);
  const matteCore = new Uint8Array(pixelCount);
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
      matteCore[position] = 1;
      distance[position] = 0;
      queue[queueEnd++] = position;
    }
  }

  if (!queueEnd || queueEnd > pixelCount * 0.92) return 0;

  while (queueStart < queueEnd) {
    const position = queue[queueStart++];
    const currentDistance = distance[position];
    if (currentDistance >= TRANSITION_DEPTH) continue;
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
    if (!matteCore[position]) continue;
    const index = position * 4;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 0;
    changed++;
  }

  for (let position = 0; position < pixelCount; position++) {
    const layer = distance[position];
    if (layer < 1 || layer > TRANSITION_DEPTH) continue;
    const x = position % width;
    const y = Math.floor(position / width);

    let cleanSample = -1;
    let cleanSpatialDistance = Number.POSITIVE_INFINITY;
    let cleanColorDistance = -1;
    let fallbackSample = -1;
    let fallbackColorDistance = -1;
    let fallbackSpatialDistance = Number.POSITIVE_INFINITY;

    for (let offsetY = -FOREGROUND_SEARCH_RADIUS; offsetY <= FOREGROUND_SEARCH_RADIUS; offsetY++) {
      const sampleY = y + offsetY;
      if (sampleY < 0 || sampleY >= height) continue;
      for (let offsetX = -FOREGROUND_SEARCH_RADIUS; offsetX <= FOREGROUND_SEARCH_RADIUS; offsetX++) {
        const sampleX = x + offsetX;
        if (sampleX < 0 || sampleX >= width || (!offsetX && !offsetY)) continue;
        const samplePosition = sampleY * width + sampleX;
        if (matteCore[samplePosition]) continue;
        const sampleIndex = samplePosition * 4;
        if (source[sampleIndex + 3] <= 8) continue;

        const spatialDistance = offsetX * offsetX + offsetY * offsetY;
        const sampleColorDistance = pixelColorDistance(
          source[sampleIndex],
          source[sampleIndex + 1],
          source[sampleIndex + 2],
          matte
        );

        if (
          sampleColorDistance > fallbackColorDistance + 1
          || (
            Math.abs(sampleColorDistance - fallbackColorDistance) <= 1
            && spatialDistance < fallbackSpatialDistance
          )
        ) {
          fallbackSample = samplePosition;
          fallbackColorDistance = sampleColorDistance;
          fallbackSpatialDistance = spatialDistance;
        }

        if (
          distance[samplePosition] === 255
          && sampleColorDistance >= FOREGROUND_CORE_DISTANCE
          && (
            spatialDistance < cleanSpatialDistance
            || (
              spatialDistance === cleanSpatialDistance
              && sampleColorDistance > cleanColorDistance
            )
          )
        ) {
          cleanSample = samplePosition;
          cleanSpatialDistance = spatialDistance;
          cleanColorDistance = sampleColorDistance;
        }
      }
    }

    const samplePosition = cleanSample >= 0
      ? cleanSample
      : fallbackColorDistance >= FOREGROUND_CORE_DISTANCE
        ? fallbackSample
        : -1;
    const index = position * 4;
    if (samplePosition >= 0) {
      const sampleIndex = samplePosition * 4;
      data[index] = source[sampleIndex];
      data[index + 1] = source[sampleIndex + 1];
      data[index + 2] = source[sampleIndex + 2];
    } else {
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
    }
    data[index + 3] = Math.round(((layer - 0.5) / TRANSITION_DEPTH) * 255);
    changed++;
  }

  return changed;
};
