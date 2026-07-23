import * as ort from 'onnxruntime-web/wasm';

const MODEL_SIZE = 320;
const MASK_OUTPUT_SIZE = 640;
const MODEL_URL = '/models/u2netp.onnx';
const MODEL_SHA256 = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';
const CORE_THRESHOLD = 0.48;
const SOFT_ALPHA_START = 0.16;
const SOFT_ALPHA_END = 0.72;
const GROUP_BRIDGE_RADIUS = 14;
const GROUP_SOFT_MARGIN = 8;

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let inferenceQueue: Promise<void> = Promise.resolve();

export interface StickerForegroundMask {
  size: number;
  subjectAlpha: Uint8ClampedArray;
  borderAlpha: Uint8ClampedArray;
}

const smoothstep = (start: number, end: number, value: number) => {
  const normalized = Math.max(0, Math.min(1, (value - start) / Math.max(1e-6, end - start)));
  return normalized * normalized * (3 - 2 * normalized);
};

const dilate = (
  source: Uint8Array,
  width: number,
  height: number,
  radius: number
) => {
  let current = source.slice();
  for (let pass = 0; pass < radius; pass++) {
    const next = current.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const position = y * width + x;
        if (current[position]) continue;
        for (let offsetY = -1; offsetY <= 1 && !next[position]; offsetY++) {
          const nextY = y + offsetY;
          if (nextY < 0 || nextY >= height) continue;
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            if (!offsetX && !offsetY) continue;
            const nextX = x + offsetX;
            if (nextX < 0 || nextX >= width) continue;
            if (current[nextY * width + nextX]) {
              next[position] = 1;
              break;
            }
          }
        }
      }
    }
    current = next;
  }
  return current;
};

interface MaskComponent {
  label: number;
  area: number;
  coreArea: number;
  centerPixels: number;
  touchesEdge: boolean;
  centerX: number;
  centerY: number;
}

const chooseCenteredSubjectGroup = (
  normalized: Float32Array,
  width: number,
  height: number
) => {
  const pixelCount = width * height;
  const core = new Uint8Array(pixelCount);
  for (let position = 0; position < pixelCount; position++) {
    if (normalized[position] >= CORE_THRESHOLD) core[position] = 1;
  }

  const bridged = dilate(core, width, height, GROUP_BRIDGE_RADIUS);
  const labels = new Int32Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: MaskComponent[] = [];
  const centerLeft = Math.floor(width * 0.40);
  const centerRight = Math.ceil(width * 0.60);
  const centerTop = Math.floor(height * 0.40);
  const centerBottom = Math.ceil(height * 0.60);
  let nextLabel = 0;

  for (let seed = 0; seed < pixelCount; seed++) {
    if (!bridged[seed] || labels[seed]) continue;
    nextLabel++;
    let start = 0;
    let end = 0;
    let area = 0;
    let coreArea = 0;
    let centerPixels = 0;
    let sumX = 0;
    let sumY = 0;
    let touchesEdge = false;
    labels[seed] = nextLabel;
    queue[end++] = seed;

    while (start < end) {
      const position = queue[start++];
      const x = position % width;
      const y = Math.floor(position / width);
      area++;
      coreArea += core[position];
      sumX += x;
      sumY += y;
      if (x >= centerLeft && x < centerRight && y >= centerTop && y < centerBottom) centerPixels++;
      if (x <= 2 || y <= 2 || x >= width - 3 || y >= height - 3) touchesEdge = true;

      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (!bridged[next] || labels[next]) continue;
          labels[next] = nextLabel;
          queue[end++] = next;
        }
      }
    }

    components.push({
      label: nextLabel,
      area,
      coreArea,
      centerPixels,
      touchesEdge,
      centerX: sumX / Math.max(1, area),
      centerY: sumY / Math.max(1, area)
    });
  }

  if (!components.length) throw new Error('The local subject segmenter could not find foreground artwork.');

  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const diagonal = Math.hypot(width, height);
  components.sort((left, right) => {
    const score = (component: MaskComponent) => {
      const distance = Math.hypot(component.centerX - centerX, component.centerY - centerY) / diagonal;
      const centered = 1.35 - Math.min(1, distance * 2.2);
      const centerBonus = 1 + Math.min(4, component.centerPixels / Math.max(1, component.area) * 18);
      const edgePenalty = component.touchesEdge ? 0.08 : 1;
      return component.coreArea * centered * centerBonus * edgePenalty;
    };
    return score(right) - score(left);
  });

  const selectedLabel = components[0].label;
  const selected = new Uint8Array(pixelCount);
  for (let position = 0; position < pixelCount; position++) {
    if (labels[position] === selectedLabel) selected[position] = 1;
  }
  return dilate(selected, width, height, GROUP_SOFT_MARGIN);
};

const resizePrediction = (
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
) => {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return source;
  const target = new Float32Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = targetHeight === 1 ? 0 : y * (sourceHeight - 1) / (targetHeight - 1);
    const top = Math.floor(sourceY);
    const bottom = Math.min(sourceHeight - 1, top + 1);
    const fractionY = sourceY - top;
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = targetWidth === 1 ? 0 : x * (sourceWidth - 1) / (targetWidth - 1);
      const left = Math.floor(sourceX);
      const right = Math.min(sourceWidth - 1, left + 1);
      const fractionX = sourceX - left;
      const topValue = source[top * sourceWidth + left] * (1 - fractionX)
        + source[top * sourceWidth + right] * fractionX;
      const bottomValue = source[bottom * sourceWidth + left] * (1 - fractionX)
        + source[bottom * sourceWidth + right] * fractionX;
      target[y * targetWidth + x] = topValue * (1 - fractionY) + bottomValue * fractionY;
    }
  }
  return target;
};

export const buildStickerForegroundMask = (
  prediction: Float32Array,
  width = MODEL_SIZE,
  height = MODEL_SIZE,
  backgroundExclusion?: Float32Array
): StickerForegroundMask => {
  const pixelCount = width * height;
  if (prediction.length < pixelCount) throw new Error('The local subject segmenter returned an invalid mask.');

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let position = 0; position < pixelCount; position++) {
    minimum = Math.min(minimum, prediction[position]);
    maximum = Math.max(maximum, prediction[position]);
  }
  const range = Math.max(1e-6, maximum - minimum);
  const normalizedSource = new Float32Array(pixelCount);
  for (let position = 0; position < pixelCount; position++) {
    normalizedSource[position] = Math.max(0, Math.min(1, (prediction[position] - minimum) / range));
  }

  const maskWidth = MASK_OUTPUT_SIZE;
  const maskHeight = MASK_OUTPUT_SIZE;
  const maskPixelCount = maskWidth * maskHeight;
  const normalized = resizePrediction(normalizedSource, width, height, maskWidth, maskHeight);
  if (backgroundExclusion?.length === pixelCount) {
    const exclusion = resizePrediction(backgroundExclusion, width, height, maskWidth, maskHeight);
    for (let position = 0; position < maskPixelCount; position++) {
      normalized[position] *= 1 - Math.max(0, Math.min(1, exclusion[position]));
    }
  }
  const selected = chooseCenteredSubjectGroup(normalized, maskWidth, maskHeight);
  const subjectAlpha = new Uint8ClampedArray(maskPixelCount);
  const subjectCore = new Uint8Array(maskPixelCount);
  let minimumX = maskWidth;
  let minimumY = maskHeight;
  let maximumX = -1;
  let maximumY = -1;

  for (let position = 0; position < maskPixelCount; position++) {
    if (!selected[position]) continue;
    const alpha = Math.round(smoothstep(SOFT_ALPHA_START, SOFT_ALPHA_END, normalized[position]) * 255);
    subjectAlpha[position] = alpha;
    if (alpha < 24) continue;
    subjectCore[position] = 1;
    const x = position % maskWidth;
    const y = Math.floor(position / maskWidth);
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
  }

  if (maximumX < minimumX || maximumY < minimumY) {
    throw new Error('The local subject segmenter found no usable foreground artwork.');
  }

  const subjectShortSide = Math.min(maximumX - minimumX + 1, maximumY - minimumY + 1);
  const borderRadius = Math.max(10, Math.min(22, Math.round(subjectShortSide * 0.035)));
  const borderCore = dilate(subjectCore, maskWidth, maskHeight, borderRadius);
  const borderSoftEdge = dilate(borderCore, maskWidth, maskHeight, 1);
  const borderAlpha = new Uint8ClampedArray(maskPixelCount);
  for (let position = 0; position < maskPixelCount; position++) {
    borderAlpha[position] = borderCore[position] ? 255 : borderSoftEdge[position] ? 96 : 0;
  }

  return { size: maskWidth, subjectAlpha, borderAlpha };
};

const getSession = () => {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = '/models/onnxruntime/';
    sessionPromise = fetch(MODEL_URL, { cache: 'force-cache' })
      .then(async response => {
        if (!response.ok) throw new Error(`Local sticker mask model could not be loaded (${response.status}).`);
        return response.arrayBuffer();
      })
      .then(model => ort.InferenceSession.create(model, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      }))
      .catch(error => {
        sessionPromise = null;
        throw error;
      });
  }
  return sessionPromise;
};

const runSerialized = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = inferenceQueue.then(operation, operation);
  inferenceQueue = result.then(() => undefined, () => undefined);
  return result;
};

export const inferStickerForegroundMask = async (
  sourceImage: CanvasImageSource
): Promise<StickerForegroundMask> => runSerialized(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = MODEL_SIZE;
  canvas.height = MODEL_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for local sticker segmentation.');

  context.fillStyle = '#ececec';
  context.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(sourceImage, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const rgba = context.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  const cornerSize = 8;
  const cornerSamples: number[][] = [[], [], []];
  for (let y = 0; y < MODEL_SIZE; y++) {
    for (let x = 0; x < MODEL_SIZE; x++) {
      const inCornerX = x < cornerSize || x >= MODEL_SIZE - cornerSize;
      const inCornerY = y < cornerSize || y >= MODEL_SIZE - cornerSize;
      if (!inCornerX || !inCornerY) continue;
      const index = (y * MODEL_SIZE + x) * 4;
      cornerSamples[0].push(rgba[index]);
      cornerSamples[1].push(rgba[index + 1]);
      cornerSamples[2].push(rgba[index + 2]);
    }
  }
  const cornerMedian = cornerSamples.map(samples => {
    samples.sort((left, right) => left - right);
    return samples[Math.floor(samples.length / 2)] || 236;
  });
  const backgroundExclusion = new Float32Array(MODEL_SIZE * MODEL_SIZE);
  for (let position = 0; position < backgroundExclusion.length; position++) {
    const index = position * 4;
    const distance = Math.hypot(
      rgba[index] - cornerMedian[0],
      rgba[index + 1] - cornerMedian[1],
      rgba[index + 2] - cornerMedian[2]
    );
    backgroundExclusion[position] = 1 - smoothstep(12, 28, distance);
  }

  let maximumChannel = 1;
  for (let index = 0; index < rgba.length; index += 4) {
    maximumChannel = Math.max(maximumChannel, rgba[index], rgba[index + 1], rgba[index + 2]);
  }
  const means = [0.485, 0.456, 0.406];
  const deviations = [0.229, 0.224, 0.225];
  const planeSize = MODEL_SIZE * MODEL_SIZE;
  const input = new Float32Array(planeSize * 3);
  for (let position = 0; position < planeSize; position++) {
    const sourceIndex = position * 4;
    for (let channel = 0; channel < 3; channel++) {
      const value = rgba[sourceIndex + channel] / maximumChannel;
      input[channel * planeSize + position] = (value - means[channel]) / deviations[channel];
    }
  }

  const session = await getSession();
  const result = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE])
  });
  const prediction = result[session.outputNames[0]]?.data;
  if (!(prediction instanceof Float32Array)) {
    throw new Error('The local subject segmenter returned an unsupported mask format.');
  }
  return buildStickerForegroundMask(prediction, MODEL_SIZE, MODEL_SIZE, backgroundExclusion);
});

export const stickerMaskModelMetadata = {
  model: 'U2NETP',
  modelUrl: MODEL_URL,
  sha256: MODEL_SHA256,
  inputSize: MODEL_SIZE
} as const;
