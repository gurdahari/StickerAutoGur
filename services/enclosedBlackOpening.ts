const OPENING_GEOMETRY =
  /\b(basket|bag|tote|purse|backpack|handle|frame|window|tube|pipe|hose|ring|hoop|loop|chain|scissors|glasses|stethoscope|wheel|cage|lantern|arch|doorway|portal|opening|cutout|negative space)\b/i;

const SAFE_AUTOMATIC_OPENING =
  /\b(basket|bag|tote|purse|backpack|handle|frame|window|tube|pipe|hose|ring|hoop|loop|stethoscope|wheel|cage|lantern|arch|doorway|portal)\b/i;

const SIMPLE_OBJECT_TYPE =
  /\bTYPE:\s*(?:OBJECT(?:-ONLY)?|PROP|ICON|FUNCTIONAL_LABEL)\b/i;

const COMPLEX_SCENE =
  /\b(landscape|forest|woodland|tree|garden|mountain|house|building|street|city|sky|night|stars?|galaxy|space scene|crowd|pattern|collage)\b/i;

const PROTECTED_DARK_ART =
  /\b(silhouette|black cat|black bear|black dog|black raven|black crow|black bat|shadow figure|charcoal|obsidian|vinyl record|tire|coal|black leather|black fabric)\b/i;

export const expectsEnclosedOpening = (prompt = '') => OPENING_GEOMETRY.test(prompt);

const isSafeAutomaticPrompt = (prompt: string) =>
  SIMPLE_OBJECT_TYPE.test(prompt)
  && SAFE_AUTOMATIC_OPENING.test(prompt)
  && !COMPLEX_SCENE.test(prompt)
  && !PROTECTED_DARK_ART.test(prompt);

const lumaAt = (data: Uint8ClampedArray, pixelIndex: number) =>
  0.2126 * data[pixelIndex]
  + 0.7152 * data[pixelIndex + 1]
  + 0.0722 * data[pixelIndex + 2];

const channelSpreadAt = (data: Uint8ClampedArray, pixelIndex: number) =>
  Math.max(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2])
  - Math.min(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2]);

/**
 * Repairs a narrow failure mode that the reserved RGB contract cannot solve:
 * Seedream sometimes paints one intended opening pure black instead of using
 * the verified matte key. Automatic repair is enabled only for simple
 * opening-bearing objects and only for a compact, fully enclosed, flat-black
 * component surrounded by a light cutline. It never performs chroma removal.
 */
export const removeVerifiedEnclosedBlackOpenings = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  prompt: string,
  force = false
) => {
  if (!force && !isSafeAutomaticPrompt(prompt)) return 0;

  const pixelCount = width * height;
  const minimumArea = Math.max(48, Math.floor(pixelCount * 0.00008));
  const maximumArea = Math.floor(pixelCount * 0.06);
  const probeRadius = Math.max(2, Math.round(Math.min(width, height) / 512));
  const dark = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const candidates: number[][] = [];

  for (let position = 0; position < pixelCount; position++) {
    const pixelIndex = position * 4;
    if (
      data[pixelIndex + 3] >= 220
      && lumaAt(data, pixelIndex) <= 42
      && channelSpreadAt(data, pixelIndex) <= 22
    ) {
      dark[position] = 1;
    }
  }

  for (let seed = 0; seed < pixelCount; seed++) {
    if (!dark[seed] || visited[seed]) continue;

    let queueStart = 0;
    let queueEnd = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let corePixels = 0;
    let perimeterPixels = 0;
    let lightPerimeterPixels = 0;
    let touchesCanvasEdge = false;
    let touchesTransparency = false;
    const component: number[] = [];
    visited[seed] = 1;
    queue[queueEnd++] = seed;

    while (queueStart < queueEnd) {
      const position = queue[queueStart++];
      const x = position % width;
      const y = Math.floor(position / width);
      component.push(position);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesCanvasEdge = true;
      }

      let darkNeighbours = 0;
      let isPerimeter = false;
      for (const [offsetX, offsetY] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
          isPerimeter = true;
          continue;
        }
        const next = nextY * width + nextX;
        if (dark[next]) {
          darkNeighbours++;
          if (!visited[next]) {
            visited[next] = 1;
            queue[queueEnd++] = next;
          }
        } else {
          isPerimeter = true;
          if (data[next * 4 + 3] <= 8) touchesTransparency = true;
        }
      }
      if (darkNeighbours === 4) corePixels++;
      if (!isPerimeter) continue;

      perimeterPixels++;
      let hasNearbyLightCutline = false;
      for (let offsetY = -probeRadius; offsetY <= probeRadius && !hasNearbyLightCutline; offsetY++) {
        for (let offsetX = -probeRadius; offsetX <= probeRadius; offsetX++) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const nextPixelIndex = (nextY * width + nextX) * 4;
          if (
            data[nextPixelIndex + 3] >= 220
            && lumaAt(data, nextPixelIndex) >= 185
            && channelSpreadAt(data, nextPixelIndex) <= 65
          ) {
            hasNearbyLightCutline = true;
            break;
          }
        }
      }
      if (hasNearbyLightCutline) lightPerimeterPixels++;
    }

    if (component.length < minimumArea || component.length > maximumArea) continue;
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const density = component.length / Math.max(1, boxWidth * boxHeight);
    const coreRatio = corePixels / component.length;
    const lightBoundaryRatio = lightPerimeterPixels / Math.max(1, perimeterPixels);
    if (
      touchesCanvasEdge
      || touchesTransparency
      || Math.min(boxWidth, boxHeight) < 6
      || density < 0.34
      || coreRatio < 0.18
      || lightBoundaryRatio < 0.55
    ) {
      continue;
    }
    candidates.push(component);
  }

  // Multiple matches are much more likely to be dark artwork than one failed
  // opening. Manual repair remains available for ambiguous source images.
  if (candidates.length !== 1) return 0;

  const repaired = new Uint8Array(pixelCount);
  for (const position of candidates[0]) {
    repaired[position] = 1;
    data[position * 4 + 3] = 0;
  }

  // Reconstruct only neutral black-to-white antialias pixels touching the
  // repaired hole. This is alpha math, not color-key tolerance, so it cannot
  // introduce the green/magenta fringe produced by aggressive chroma cleanup.
  const edge = new Uint8Array(pixelCount);
  for (const position of candidates[0]) {
    const x = position % width;
    const y = Math.floor(position / width);
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (!repaired[next]) edge[next] = 1;
      }
    }
  }

  for (let position = 0; position < pixelCount; position++) {
    if (!edge[position]) continue;
    const pixelIndex = position * 4;
    const luma = lumaAt(data, pixelIndex);
    if (
      data[pixelIndex + 3] <= 8
      || luma < 28
      || luma > 242
      || channelSpreadAt(data, pixelIndex) > 28
    ) {
      continue;
    }
    data[pixelIndex] = 255;
    data[pixelIndex + 1] = 255;
    data[pixelIndex + 2] = 255;
    data[pixelIndex + 3] = Math.min(data[pixelIndex + 3], Math.round(luma));
  }

  return candidates[0].length;
};
