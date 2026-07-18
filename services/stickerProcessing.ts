const loadImage = (source: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Failed to load image for sticker processing.'));
  image.src = source;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Failed to encode processed sticker PNG.'));
  }, 'image/png');
});

const median = (values: number[]) => {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] || 0;
};

const estimateBackground = (data: Uint8ClampedArray, width: number, height: number) => {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const sampleSize = Math.max(3, Math.floor(Math.min(width, height) * 0.018));
  const corners = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize]
  ];

  for (const [startX, startY] of corners) {
    for (let y = startY; y < startY + sampleSize; y += 2) {
      for (let x = startX; x < startX + sampleSize; x += 2) {
        const index = (y * width + x) * 4;
        if (data[index + 3] === 0) continue;
        reds.push(data[index]);
        greens.push(data[index + 1]);
        blues.push(data[index + 2]);
      }
    }
  }

  return { r: median(reds), g: median(greens), b: median(blues) };
};

/**
 * Turns Seedream's flat matte background into a clean transparent PNG.
 * Exterior background is removed first. A second conservative pass removes
 * only solid, background-colored enclosed regions that are large/dense enough
 * to be genuine openings rather than dark illustration details.
 */
export const processStickerImage = async (source: string, itemPrompt = ''): Promise<Blob> => {
  const image = await loadImage(source);
  const workingCanvas = document.createElement('canvas');
  workingCanvas.width = image.width;
  workingCanvas.height = image.height;
  const context = workingCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for sticker processing.');

  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;
  const width = image.width;
  const height = image.height;
  const pixelCount = width * height;
  const background = estimateBackground(data, width, height);
  const backgroundLuma = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b;
  const floodTolerance = backgroundLuma < 70 ? 205 : 105;
  const haloTolerance = backgroundLuma < 70 ? 305 : 145;

  const distanceFromBackground = (pixelIndex: number) => {
    const red = data[pixelIndex] - background.r;
    const green = data[pixelIndex + 1] - background.g;
    const blue = data[pixelIndex + 2] - background.b;
    return Math.sqrt(red * red + green * green + blue * blue);
  };

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  const tryQueue = (x: number, y: number) => {
    const position = y * width + x;
    if (visited[position]) return;
    const pixelIndex = position * 4;
    if (data[pixelIndex + 3] === 0 || distanceFromBackground(pixelIndex) <= floodTolerance) {
      visited[position] = 1;
      queue[queueEnd++] = position;
    }
  };

  for (let x = 0; x < width; x++) {
    tryQueue(x, 0);
    tryQueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryQueue(0, y);
    tryQueue(width - 1, y);
  }

  while (queueStart < queueEnd) {
    const position = queue[queueStart++];
    const x = position % width;
    const y = Math.floor(position / width);
    data[position * 4 + 3] = 0;

    if (x > 0) tryQueue(x - 1, y);
    if (x + 1 < width) tryQueue(x + 1, y);
    if (y > 0) tryQueue(x, y - 1);
    if (y + 1 < height) tryQueue(x, y + 1);
  }

  // Edge flood-fill intentionally cannot reach a hose loop, ring, frame or
  // similar enclosed opening. Detect those separately using a strict matte-
  // color component test. The high density/core-ratio requirements protect
  // black outlines, lettering, eyes and textured dark artwork.
  const expectsNaturalOpening = /\b(frame|window|tube|hose|ring|hoop|loop|coil|chain|link|scissors|glasses|eyeglasses|stethoscope|wheel|tire|bracelet|necklace|keyring|carabiner)\b/i.test(itemPrompt);
  const holeSeedTolerance = backgroundLuma < 70 ? 24 : 20;
  const holeGrowTolerance = backgroundLuma < 70 ? 80 : 58;
  const holeVisited = new Uint8Array(pixelCount);
  const minimumHoleArea = Math.max(
    expectsNaturalOpening ? 220 : 1200,
    Math.round(pixelCount * (expectsNaturalOpening ? 0.0012 : 0.006))
  );
  const minimumHoleSpan = Math.max(
    expectsNaturalOpening ? 8 : 18,
    Math.round(Math.min(width, height) * (expectsNaturalOpening ? 0.01 : 0.025))
  );

  const queueHolePixel = (position: number) => {
    if (holeVisited[position]) return;
    const pixelIndex = position * 4;
    if (data[pixelIndex + 3] === 0 || distanceFromBackground(pixelIndex) > holeGrowTolerance) return;
    holeVisited[position] = 1;
    queue[queueEnd++] = position;
  };

  for (let seed = 0; seed < pixelCount; seed++) {
    const seedIndex = seed * 4;
    if (
      holeVisited[seed]
      || data[seedIndex + 3] === 0
      || distanceFromBackground(seedIndex) > holeSeedTolerance
    ) continue;

    queueStart = 0;
    queueEnd = 0;
    queueHolePixel(seed);
    let corePixels = 0;
    let minHoleX = width;
    let minHoleY = height;
    let maxHoleX = -1;
    let maxHoleY = -1;
    let touchesCanvasEdge = false;

    while (queueStart < queueEnd) {
      const position = queue[queueStart++];
      const x = position % width;
      const y = Math.floor(position / width);
      const pixelIndex = position * 4;
      if (distanceFromBackground(pixelIndex) <= holeSeedTolerance) corePixels++;
      minHoleX = Math.min(minHoleX, x);
      minHoleY = Math.min(minHoleY, y);
      maxHoleX = Math.max(maxHoleX, x);
      maxHoleY = Math.max(maxHoleY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesCanvasEdge = true;

      if (x > 0) queueHolePixel(position - 1);
      if (x + 1 < width) queueHolePixel(position + 1);
      if (y > 0) queueHolePixel(position - width);
      if (y + 1 < height) queueHolePixel(position + width);
    }

    const componentArea = queueEnd;
    const componentWidth = maxHoleX - minHoleX + 1;
    const componentHeight = maxHoleY - minHoleY + 1;
    const density = componentArea / Math.max(1, componentWidth * componentHeight);
    const coreRatio = corePixels / Math.max(1, componentArea);
    const isConfidentHole = !touchesCanvasEdge
      && componentArea >= minimumHoleArea
      && Math.min(componentWidth, componentHeight) >= minimumHoleSpan
      && density >= (expectsNaturalOpening ? 0.45 : 0.62)
      && coreRatio >= (expectsNaturalOpening ? 0.72 : 0.88);

    if (isConfidentHole) {
      for (let index = 0; index < queueEnd; index++) {
        data[queue[index] * 4 + 3] = 0;
      }
    }
  }

  const hasTransparentNeighbor = (x: number, y: number) => {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
    return data[((y * width + x - 1) * 4) + 3] === 0
      || data[((y * width + x + 1) * 4) + 3] === 0
      || data[(((y - 1) * width + x) * 4) + 3] === 0
      || data[(((y + 1) * width + x) * 4) + 3] === 0;
  };

  // Peel away two exterior halo layers. This removes matte contamination and
  // model-created gray/dotted edge noise without touching protected interior art.
  for (let pass = 0; pass < 2; pass++) {
    const remove = new Uint8Array(pixelCount);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const position = y * width + x;
        const pixelIndex = position * 4;
        if (data[pixelIndex + 3] === 0 || !hasTransparentNeighbor(x, y)) continue;
        if (distanceFromBackground(pixelIndex) <= haloTolerance) remove[position] = 1;
      }
    }
    for (let position = 0; position < pixelCount; position++) {
      if (remove[position]) data[position * 4 + 3] = 0;
    }
  }

  // Reconstruct a short anti-aliased white cutline instead of keeping a dirty
  // gray fringe that was blended against Seedream's black matte.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      const pixelIndex = position * 4;
      if (data[pixelIndex + 3] === 0 || !hasTransparentNeighbor(x, y)) continue;

      const channelSpread = Math.max(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2])
        - Math.min(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2]);
      const distance = distanceFromBackground(pixelIndex);
      if (channelSpread <= 32 && distance < 405) {
        const alpha = Math.max(70, Math.min(255, Math.round(((distance - haloTolerance) / (405 - haloTolerance)) * 255)));
        data[pixelIndex] = 255;
        data[pixelIndex + 1] = 255;
        data[pixelIndex + 2] = 255;
        data[pixelIndex + 3] = Math.min(data[pixelIndex + 3], alpha);
      }
    }
  }

  // Remove the barely-visible alpha veil left by matte reconstruction. Those
  // pixels look like a gray halo on dark surfaces even though they appear
  // transparent in an editor. Preserve only a short, clean antialiased edge.
  for (let position = 0; position < pixelCount; position++) {
    const alphaIndex = position * 4 + 3;
    const alpha = data[alphaIndex];
    if (alpha > 0 && alpha < 104) {
      data[alphaIndex] = 0;
    } else if (alpha >= 104 && alpha < 240) {
      data[alphaIndex] = Math.min(255, Math.round((alpha - 104) * 1.88));
    }
  }

  context.putImageData(imageData, 0, 0);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) throw new Error('Sticker cleanup removed the entire image.');

  // Export a tight aspect-ratio crop. A square canvas creates large invisible
  // bands above/below wide stickers (or beside tall ones), which feels like a
  // transparent halo in Canva and makes mockup placement inaccurate.
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const padding = Math.max(4, Math.round(Math.max(cropWidth, cropHeight) * 0.008));
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = cropWidth + padding * 2;
  outputCanvas.height = cropHeight + padding * 2;
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) throw new Error('Canvas is unavailable for sticker normalization.');

  outputContext.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  outputContext.drawImage(
    workingCanvas,
    minX,
    minY,
    cropWidth,
    cropHeight,
    padding,
    padding,
    cropWidth,
    cropHeight
  );

  return canvasToBlob(outputCanvas);
};
