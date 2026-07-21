const loadBlobImage = (blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to load cleaned sticker for residual matte repair.'));
  };
  image.src = url;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Failed to encode residual-matte repair.'));
  }, 'image/png');
});

const OPEN_GEOMETRY_HINT = /\b(bag|tote|purse|backpack|handle|strap|buckle|chair|seat|stool|bench|deck chair|lounge chair|lantern|lamp|cage|market stall|stall|stand|kiosk|cart|booth|awning|canopy|gazebo|pergola|swing|hammock|ladder|rack|shelf|fence|gate|railing|balcony|table|tripod|easel|hanger|sandal|shoe|glasses|sunglasses|scissors|ring|hoop|loop|chain|link|wheel|tire|basket|bucket|mug|cup|bottle|flask|vial|beaker|cauldron|kettle|door|arch|portal|tent|helmet|mask|visor|wreath|donut|doughnut|opening|cutout|negative space)\b/i;

const COMPLEX_SCENE_HINT = /\b(scene|scenery|landscape|panorama|forest|tree|grove|woodland|jungle|garden|meadow|field|mountain|valley|cottage|house|village|path|road|sky|night sky|starry|stars|galaxy|nebula|moon|sunset|sunrise|cosmic|fantasy landscape|storybook scene|detailed background)\b/i;

const PROTECTED_BLACK_ART = /\b(silhouette|solid black|black fur|black cat|black dog|black bear|black wolf|black raven|black crow|black bat|raven|crow|bat|shadow|ink drawing|charcoal|obsidian|vinyl record|tire|coal|void|black leather|black fabric)\b/i;

export const expectsResidualTransparentOpening = (prompt = '') => OPEN_GEOMETRY_HINT.test(prompt);

export const repairResidualEnclosedMatte = async (
  blob: Blob,
  prompt = '',
  force = false
): Promise<Blob> => {
  const image = await loadBlobImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for residual matte repair.');
  context.clearRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);

  const imageData = context.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;
  const width = image.width;
  const height = image.height;
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const member = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const removal = new Uint8Array(pixelCount);
  const openingHint = expectsResidualTransparentOpening(prompt);
  const complexScene = COMPLEX_SCENE_HINT.test(prompt) && !force;
  // A prompt can mention a backpack inside a detailed landscape. That must not
  // unlock aggressive cleanup for every dark region in the whole illustration.
  const promptAware = force || (openingHint && !complexScene);
  const protectBlack = PROTECTED_BLACK_ART.test(prompt) && !force;

  const isDarkNeutral = (position: number) => {
    const index = position * 4;
    if (data[index + 3] < 190) return false;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    return luma <= 66 && maximum - minimum <= 30;
  };

  /**
   * Detect opaque details completely trapped inside a candidate dark component.
   * Stars, highlights, leaves and texture islands are strong evidence that the
   * region is real artwork rather than a flat background matte.
   */
  const countEnclosedForeignOpaquePixels = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ) => {
    const localWidth = maxX - minX + 1;
    const localHeight = maxY - minY + 1;
    const localCount = localWidth * localHeight;
    if (localCount <= 0) return 0;
    // Very large candidates are unsafe to auto-repair and should be handled by
    // the explicit manual repair action instead.
    if (!force && localCount > pixelCount * 0.12) return Number.POSITIVE_INFINITY;

    const reachable = new Uint8Array(localCount);
    const localQueue = new Int32Array(localCount);
    let start = 0;
    let end = 0;

    const enqueue = (localX: number, localY: number) => {
      if (localX < 0 || localY < 0 || localX >= localWidth || localY >= localHeight) return;
      const localPosition = localY * localWidth + localX;
      if (reachable[localPosition]) return;
      const globalPosition = (minY + localY) * width + minX + localX;
      if (member[globalPosition]) return;
      reachable[localPosition] = 1;
      localQueue[end++] = localPosition;
    };

    for (let x = 0; x < localWidth; x++) {
      enqueue(x, 0);
      enqueue(x, localHeight - 1);
    }
    for (let y = 0; y < localHeight; y++) {
      enqueue(0, y);
      enqueue(localWidth - 1, y);
    }

    while (start < end) {
      const localPosition = localQueue[start++];
      const x = localPosition % localWidth;
      const y = Math.floor(localPosition / localWidth);
      enqueue(x - 1, y);
      enqueue(x + 1, y);
      enqueue(x, y - 1);
      enqueue(x, y + 1);
    }

    let enclosedOpaquePixels = 0;
    for (let localPosition = 0; localPosition < localCount; localPosition++) {
      if (reachable[localPosition]) continue;
      const x = localPosition % localWidth;
      const y = Math.floor(localPosition / localWidth);
      const globalPosition = (minY + y) * width + minX + x;
      if (member[globalPosition]) continue;
      if (data[globalPosition * 4 + 3] > 32) enclosedOpaquePixels++;
    }
    return enclosedOpaquePixels;
  };

  const minimumArea = Math.max(36, Math.round(pixelCount * 0.00012));
  const genericMaximumArea = Math.round(pixelCount * 0.025);
  const promptMaximumArea = Math.round(pixelCount * 0.08);
  const complexSceneMaximumArea = Math.round(pixelCount * 0.018);
  const forcedMaximumArea = Math.round(pixelCount * 0.38);
  let changed = false;
  let removedComponentCount = 0;
  let removedPixelCount = 0;

  for (let seed = 0; seed < pixelCount; seed++) {
    if (visited[seed] || !isDarkNeutral(seed)) continue;
    let start = 0;
    let end = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let lumaSum = 0;
    let lumaSquaredSum = 0;
    visited[seed] = 1;
    member[seed] = 1;
    queue[end++] = seed;

    const enqueue = (position: number) => {
      if (position < 0 || position >= pixelCount || visited[position] || !isDarkNeutral(position)) return;
      visited[position] = 1;
      member[position] = 1;
      queue[end++] = position;
    };

    while (start < end) {
      const position = queue[start++];
      const x = position % width;
      const y = Math.floor(position / width);
      const index = position * 4;
      const luma = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      lumaSum += luma;
      lumaSquaredSum += luma * luma;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x > 0) enqueue(position - 1);
      if (x + 1 < width) enqueue(position + 1);
      if (y > 0) enqueue(position - width);
      if (y + 1 < height) enqueue(position + width);
    }

    let perimeterEdges = 0;
    let transparentBoundaryEdges = 0;
    let lightBoundaryEdges = 0;
    let interiorCorePixels = 0;
    const inspectNeighbour = (position: number) => {
      if (position < 0 || position >= pixelCount || member[position]) return;
      perimeterEdges++;
      const index = position * 4;
      if (data[index + 3] <= 20) {
        transparentBoundaryEdges++;
      } else {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        if (minimum >= 168 && maximum - minimum <= 64) lightBoundaryEdges++;
      }
    };

    for (let index = 0; index < end; index++) {
      const position = queue[index];
      const x = position % width;
      const y = Math.floor(position / width);
      let insideNeighbours = 0;
      if (x > 0 && member[position - 1]) insideNeighbours++; else inspectNeighbour(position - 1);
      if (x + 1 < width && member[position + 1]) insideNeighbours++; else inspectNeighbour(position + 1);
      if (y > 0 && member[position - width]) insideNeighbours++; else inspectNeighbour(position - width);
      if (y + 1 < height && member[position + width]) insideNeighbours++; else inspectNeighbour(position + width);
      if (insideNeighbours === 4) interiorCorePixels++;
    }

    const area = end;
    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const density = area / Math.max(1, componentWidth * componentHeight);
    const interiorCoreRatio = interiorCorePixels / Math.max(1, area);
    const transparentBoundaryRatio = transparentBoundaryEdges / Math.max(1, perimeterEdges);
    const lightBoundaryRatio = lightBoundaryEdges / Math.max(1, perimeterEdges);
    const compactness = 4 * Math.PI * area / Math.max(1, perimeterEdges * perimeterEdges);
    const averageLuma = lumaSum / Math.max(1, area);
    const lumaVariance = Math.max(0, lumaSquaredSum / Math.max(1, area) - averageLuma * averageLuma);
    const lumaDeviation = Math.sqrt(lumaVariance);

    const maximumArea = force
      ? forcedMaximumArea
      : complexScene
        ? complexSceneMaximumArea
        : promptAware
          ? promptMaximumArea
          : genericMaximumArea;
    const fullyEnclosed = transparentBoundaryRatio <= (
      force ? 0.10 : complexScene ? 0.003 : promptAware ? 0.025 : 0.004
    );
    const thickFilledRegion = interiorCoreRatio >= (
      force ? 0.025 : complexScene ? 0.18 : promptAware ? 0.08 : 0.16
    ) && compactness >= (
      force ? 0.012 : complexScene ? 0.07 : promptAware ? 0.035 : 0.065
    ) && density >= (
      force ? 0.10 : complexScene ? 0.42 : promptAware ? 0.30 : 0.40
    );
    const uniformMatte = averageLuma <= (
      force ? 64 : complexScene ? 36 : promptAware ? 48 : 38
    ) && lumaDeviation <= (
      force ? 22 : complexScene ? 7.5 : promptAware ? 10.5 : 8
    );
    const boundaryEvidence = force
      ? lightBoundaryRatio >= 0.005 || interiorCoreRatio >= 0.08
      : complexScene
        ? lightBoundaryRatio >= 0.12
        : promptAware
          ? lightBoundaryRatio >= 0.04
          : lightBoundaryRatio >= 0.14;

    const preliminaryCandidate = !protectBlack
      && area >= minimumArea
      && area <= maximumArea
      && Math.min(componentWidth, componentHeight) >= 4
      && fullyEnclosed
      && thickFilledRegion
      && uniformMatte
      && boundaryEvidence;

    const enclosedForeignOpaquePixels = preliminaryCandidate && !force
      ? countEnclosedForeignOpaquePixels(minX, minY, maxX, maxY)
      : 0;
    const foreignDetailLimit = complexScene
      ? 0
      : promptAware
        ? Math.max(2, Math.floor(area * 0.0008))
        : 1;
    const preservesInternalDetail = force || enclosedForeignOpaquePixels <= foreignDetailLimit;
    const eligible = preliminaryCandidate && preservesInternalDetail;

    if (eligible) {
      changed = true;
      removedComponentCount++;
      removedPixelCount += area;
      for (let index = 0; index < end; index++) removal[queue[index]] = 1;
    }
    for (let index = 0; index < end; index++) member[queue[index]] = 0;
  }

  if (!changed) return blob;

  // Last-resort damage budget: automatic cleanup is cancelled completely when
  // several separate regions or too much of the illustration would disappear.
  if (!force) {
    const maximumComponents = complexScene ? 1 : promptAware ? 4 : 2;
    const maximumRemovedPixels = Math.round(pixelCount * (
      complexScene ? 0.012 : promptAware ? 0.06 : 0.025
    ));
    if (removedComponentCount > maximumComponents || removedPixelCount > maximumRemovedPixels) {
      return blob;
    }
  }

  for (let position = 0; position < pixelCount; position++) {
    if (removal[position]) data[position * 4 + 3] = 0;
  }

  for (let pass = 0; pass < 2; pass++) {
    const fringe = new Uint8Array(pixelCount);
    for (let position = 0; position < pixelCount; position++) {
      const index = position * 4;
      if (data[index + 3] === 0) continue;
      const x = position % width;
      const y = Math.floor(position / width);
      const touchesRemoved = (x > 0 && removal[position - 1])
        || (x + 1 < width && removal[position + 1])
        || (y > 0 && removal[position - width])
        || (y + 1 < height && removal[position + width]);
      if (!touchesRemoved) continue;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
      if (data[index + 3] < 225 && luma <= 74 && spread <= 36) fringe[position] = 1;
    }
    for (let position = 0; position < pixelCount; position++) {
      if (!fringe[position]) continue;
      data[position * 4 + 3] = 0;
      removal[position] = 1;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};
