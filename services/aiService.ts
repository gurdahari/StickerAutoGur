import type { GeneratedListing, ImageSize, TrendResult, StylePreset, DiscoveredTrend, NicheVisualAnalysis, NicheType } from "../types";

type JsonSchema = Record<string, unknown>;

interface BrainResult {
  text: string;
  sources: { title: string; uri: string }[];
}

interface ProviderHealth {
  status: string;
  providers: {
    openai: { configured: boolean; model: string };
    seedream: { configured: boolean; model: string };
  };
}

const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `API request failed with status ${response.status}.`);
  }
  return payload;
};

const isProviderAuthenticationError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:401|403)\b|incorrect api key|invalid api key|authentication|unauthorized/i.test(message);
};

const generateBrainText = async (options: {
  prompt?: string;
  messages?: { role: 'user' | 'assistant'; content: string }[];
  schema?: JsonSchema;
  schemaName?: string;
  webSearch?: boolean;
  chat?: boolean;
}): Promise<BrainResult> => apiRequest<BrainResult>(options.chat ? '/api/brain/chat' : '/api/brain/generate', {
  method: 'POST',
  body: JSON.stringify(options)
});

const generateSeedreamImage = async (
  prompt: string,
  size: ImageSize = '2K',
  images: string[] = []
): Promise<string> => {
  const response = await apiRequest<{ dataUrl: string }>('/api/images/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, size, images })
  });
  return response.dataUrl;
};

export const ensureProvidersConfigured = async (): Promise<ProviderHealth> => {
  const health = await apiRequest<ProviderHealth>('/api/health');
  const missing = [
    !health.providers.openai.configured && 'OPENAI_API_KEY',
    !health.providers.seedream.configured && 'SEEDREAM_API_KEY'
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`Missing server configuration: ${missing.join(', ')}.`);
  }
  return health;
};

export const selectCoverStickerIds = async (
  candidates: { id: number; prompt: string }[],
  desiredCount = 12
): Promise<number[]> => {
  const available = candidates.filter(candidate => Number.isFinite(candidate.id) && candidate.prompt.trim());
  const count = Math.min(available.length, Math.max(10, Math.min(15, desiredCount)));
  if (!available.length) return [];
  if (available.length <= count) return available.map(candidate => candidate.id);

  const candidateList = available
    .map(candidate => `${candidate.id}: ${candidate.prompt.replace(/\s+/g, ' ').trim()}`)
    .join('\n');
  const response = await generateBrainText({
    prompt: `Act as an Etsy creative director choosing the real sticker designs for the first listing thumbnail.
Select exactly ${count} IDs from the candidates below and order them by visual importance.

SELECTION GOALS:
- ID #1 must be the strongest hero image: instantly understandable, iconic, high-contrast and representative of the full theme.
- IDs #2-5 must be strong supporting designs with clearly different silhouettes, subjects and color opportunities.
- The remaining IDs should add breadth and visual rhythm without repeating the same object, window, pose, phrase or composition.
- Favor designs that will remain readable at small marketplace-thumbnail size.
- Avoid overly detailed concepts, tiny text, weak filler, near-duplicates and concepts that represent only one narrow subtheme.
- Select only supplied IDs. Never invent an ID.

CANDIDATES:
${candidateList}`,
    schemaName: 'cover_sticker_selection',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        selectedIds: {
          type: 'array',
          items: { type: 'integer' },
          minItems: count,
          maxItems: count
        }
      },
      required: ['selectedIds']
    }
  });

  const parsed = JSON.parse(response.text) as { selectedIds: number[] };
  const allowedIds = new Set(available.map(candidate => candidate.id));
  return [...new Set(parsed.selectedIds)].filter(id => allowedIds.has(id)).slice(0, count);
};

const uniqueStickerUrls = (urls: string[]) => [...new Set(urls.filter(Boolean))];

const loadCanvasImage = (url: string): Promise<HTMLImageElement | null> => new Promise(resolve => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = url;
});

const imageUrlToDataUrl = async (url: string): Promise<string> => {
  const image = await loadCanvasImage(url);
  if (!image) throw new Error('Failed to prepare sticker reference.');
  const maxDimension = 1024;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for sticker reference preparation.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
};

const upscaleMockupTo2K = async (source: string): Promise<string> => {
  const image = await loadCanvasImage(source);
  if (!image) throw new Error('Failed to load generated mockup for final rendering.');
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 2048;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for final mockup rendering.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.93);
};

const drawContainedSticker = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  centerX: number,
  centerY: number,
  maxWidth: number,
  maxHeight: number,
  rotation = 0,
  shadowScale = 1
) => {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.save();
  context.translate(centerX, centerY);
  context.rotate(rotation);
  context.shadowColor = 'rgba(3, 7, 18, 0.42)';
  context.shadowBlur = 34 * shadowScale;
  context.shadowOffsetY = 18 * shadowScale;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, -width / 2, -height / 2, width, height);
  context.restore();
};

const getCoverTitleLayout = (
  context: CanvasRenderingContext2D,
  rawTitle: string,
  maxWidth: number
) => {
  const title = (rawTitle || 'Premium Sticker Collection').replace(/\s+/g, ' ').trim().toUpperCase();
  const words = title.split(' ');
  let lines = [title];

  // Strong marketplace covers use a compact two-level headline. Choose the
  // most visually balanced word break instead of shrinking a long niche name
  // into one weak line.
  if (words.length >= 3 || title.length > 22) {
    context.font = '900 120px Inter, Arial, sans-serif';
    let best: { lines: string[]; score: number } | null = null;
    for (let split = 1; split < words.length; split++) {
      const candidate = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
      const widths = candidate.map(line => context.measureText(line).width);
      const score = Math.max(...widths) + Math.abs(widths[0] - widths[1]) * 0.32;
      if (!best || score < best.score) best = { lines: candidate, score };
    }
    if (best) lines = best.lines;
  }

  let fontSize = lines.length === 1 ? 190 : 164;
  const minimumFontSize = lines.length === 1 ? 92 : 78;
  while (fontSize > minimumFontSize) {
    context.font = `900 ${fontSize}px Inter, Arial, sans-serif`;
    if (lines.every(line => context.measureText(line).width <= maxWidth)) break;
    fontSize -= 4;
  }
  return { lines, fontSize };
};

const createCoverComposite = async (stickerUrls: string[], nicheName: string, totalStickerCount: number): Promise<string> => {
  const uniqueUrls = uniqueStickerUrls(stickerUrls).slice(0, 15);
  const images = (await Promise.all(uniqueUrls.map(loadCanvasImage)))
    .filter((image): image is HTMLImageElement => Boolean(image?.width));
  if (!images.length) throw new Error('No valid stickers are available for the cover.');

  const canvas = document.createElement('canvas');
  const width = 3000;
  const height = 2400;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for cover generation.');

  const palettes = [
    { start: '#14B8A6', middle: '#3B82F6', end: '#A855F7', accent: '#FB7185', accent2: '#FDE047', ink: '#071A2D' },
    { start: '#EC4899', middle: '#8B5CF6', end: '#06B6D4', accent: '#FB7185', accent2: '#FDE68A', ink: '#2E1065' },
    { start: '#0EA5E9', middle: '#6366F1', end: '#D946EF', accent: '#F97316', accent2: '#A3E635', ink: '#082F49' },
    { start: '#F59E0B', middle: '#EF4444', end: '#9333EA', accent: '#22D3EE', accent2: '#FDE047', ink: '#3F0D12' }
  ];
  const nicheHash = [...(nicheName || 'sticker')]
    .reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 7);
  const palette = palettes[nicheHash % palettes.length];
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, palette.start);
  background.addColorStop(0.50, palette.middle);
  background.addColorStop(1, palette.end);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const centerGlow = context.createRadialGradient(1500, 1280, 120, 1500, 1280, 1500);
  centerGlow.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
  centerGlow.addColorStop(0.55, 'rgba(255, 255, 255, 0.09)');
  centerGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = centerGlow;
  context.fillRect(0, 0, width, height);

  // Retail-style burst and confetti create energy without adding generated
  // product art. All product imagery below remains exact completed PNG pixels.
  context.save();
  context.translate(width / 2, 1390);
  for (let ray = 0; ray < 24; ray++) {
    context.rotate((Math.PI * 2) / 24);
    context.fillStyle = ray % 2 === 0 ? 'rgba(255, 255, 255, 0.045)' : 'rgba(255, 255, 255, 0.018)';
    context.beginPath();
    context.moveTo(240, -34);
    context.lineTo(1760, -108);
    context.lineTo(1760, 108);
    context.closePath();
    context.fill();
  }
  context.restore();

  for (let index = 0; index < 48; index++) {
    const x = 70 + ((index * 547 + nicheHash) % (width - 140));
    const y = 70 + ((index * 311 + nicheHash * 3) % (height - 140));
    const radius = 5 + (index % 4) * 3;
    context.fillStyle = index % 3 === 0 ? 'rgba(253, 224, 71, 0.36)' : 'rgba(255, 255, 255, 0.18)';
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  context.lineWidth = 24;
  context.strokeRect(34, 34, width - 68, height - 68);

  context.save();
  context.fillStyle = 'rgba(7, 18, 45, 0.20)';
  context.strokeStyle = 'rgba(255, 255, 255, 0.34)';
  context.lineWidth = 7;
  context.beginPath();
  context.roundRect(105, 805, 2790, 1195, 110);
  context.fill();
  context.stroke();
  context.restore();

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.save();
  context.fillStyle = palette.accent2;
  context.shadowColor = 'rgba(0, 0, 0, 0.28)';
  context.shadowBlur = 22;
  context.beginPath();
  context.roundRect(820, 66, 1360, 150, 75);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = palette.ink;
  context.font = '900 58px Inter, Arial, sans-serif';
  context.fillText('THE ULTIMATE DIGITAL STICKER BUNDLE', width / 2, 142);
  context.restore();

  const titleLayout = getCoverTitleLayout(context, nicheName, 2360);
  const titleLineHeight = titleLayout.fontSize * 0.92;
  const titleCenterY = titleLayout.lines.length === 1 ? 415 : 430;
  const firstTitleY = titleCenterY - ((titleLayout.lines.length - 1) * titleLineHeight) / 2;
  context.font = `900 ${titleLayout.fontSize}px Inter, Arial, sans-serif`;
  context.lineJoin = 'round';
  context.lineWidth = Math.max(18, titleLayout.fontSize * 0.12);
  titleLayout.lines.forEach((line, index) => {
    const y = firstTitleY + index * titleLineHeight;
    context.save();
    context.fillStyle = palette.accent;
    context.strokeStyle = palette.ink;
    context.shadowColor = 'rgba(0, 0, 0, 0.34)';
    context.shadowBlur = 26;
    context.strokeText(line, width / 2 + 12, y + 15);
    context.fillText(line, width / 2 + 12, y + 15);
    context.shadowBlur = 0;
    context.fillStyle = '#FFFFFF';
    context.strokeStyle = palette.ink;
    context.strokeText(line, width / 2, y);
    context.fillText(line, width / 2, y);
    context.restore();
  });

  context.save();
  context.fillStyle = 'rgba(255, 255, 255, 0.94)';
  context.strokeStyle = palette.ink;
  context.lineWidth = 8;
  context.beginPath();
  context.roundRect(790, 664, 1420, 112, 56);
  context.fill();
  context.stroke();
  context.fillStyle = palette.ink;
  context.font = '900 44px Inter, Arial, sans-serif';
  context.fillText(`${images.length} ACTUAL STICKER DESIGNS SHOWN`, width / 2, 722);
  context.restore();

  const stickerCount = Math.max(images.length, totalStickerCount);
  // Ordered visual hierarchy: the OpenAI selector puts the strongest concept
  // first, then supporting designs, then accents. Draw accents first so the
  // hero remains unmistakable at small Etsy thumbnail sizes.
  const slots = [
    { x: 1500, y: 1410, w: 760, h: 760, r: 0.01, shadow: 1.65 },
    { x: 905, y: 1200, w: 570, h: 570, r: -0.11, shadow: 1.35 },
    { x: 2095, y: 1195, w: 570, h: 570, r: 0.11, shadow: 1.35 },
    { x: 880, y: 1695, w: 545, h: 545, r: 0.09, shadow: 1.30 },
    { x: 2120, y: 1685, w: 545, h: 545, r: -0.09, shadow: 1.30 },
    { x: 405, y: 1015, w: 390, h: 390, r: -0.14, shadow: 1.0 },
    { x: 2595, y: 1035, w: 390, h: 390, r: 0.14, shadow: 1.0 },
    { x: 405, y: 1480, w: 415, h: 415, r: 0.11, shadow: 1.0 },
    { x: 2595, y: 1480, w: 415, h: 415, r: -0.11, shadow: 1.0 },
    { x: 1180, y: 940, w: 355, h: 355, r: -0.07, shadow: 0.95 },
    { x: 1820, y: 940, w: 355, h: 355, r: 0.07, shadow: 0.95 },
    { x: 1180, y: 1880, w: 335, h: 335, r: -0.04, shadow: 1.0 },
    { x: 1820, y: 1880, w: 335, h: 335, r: 0.04, shadow: 1.0 },
    { x: 545, y: 1870, w: 310, h: 310, r: -0.10, shadow: 0.9 },
    { x: 2455, y: 1860, w: 310, h: 310, r: 0.10, shadow: 0.9 }
  ];
  for (let index = images.length - 1; index >= 1; index--) {
    const slot = slots[index];
    drawContainedSticker(context, images[index], slot.x, slot.y, slot.w, slot.h, slot.r, slot.shadow);
  }
  const hero = slots[0];
  drawContainedSticker(context, images[0], hero.x, hero.y, hero.w, hero.h, hero.r, hero.shadow);

  // Draw the quantity badge last so sticker art can never obscure its text.
  context.save();
  context.translate(2370, 890);
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = 30;
  context.fillStyle = palette.accent2;
  context.strokeStyle = '#FFFFFF';
  context.lineWidth = 18;
  context.beginPath();
  context.arc(0, 0, 184, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = palette.ink;
  context.font = '900 108px Inter, Arial, sans-serif';
  context.fillText(String(stickerCount), 0, -32);
  context.font = '900 43px Inter, Arial, sans-serif';
  context.fillText(stickerCount === 1 ? 'STICKER' : 'STICKERS', 0, 62);
  context.restore();

  context.save();
  context.fillStyle = palette.accent;
  context.shadowColor = 'rgba(0, 0, 0, 0.32)';
  context.shadowBlur = 28;
  context.beginPath();
  context.roundRect(260, 2040, 2480, 285, 110);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = '#FFFFFF';
  context.font = '900 70px Inter, Arial, sans-serif';
  context.fillText(`${stickerCount} INDIVIDUAL PNG STICKERS`, width / 2, 2125);
  context.font = '800 43px Inter, Arial, sans-serif';
  context.fillText('TRANSPARENT • PRE-CROPPED • INSTANT DOWNLOAD', width / 2, 2225);
  context.restore();

  return canvas.toDataURL('image/jpeg', 0.94);
};

// Seedream creates only the empty lifestyle scene. Exact sticker pixels are
// composited afterward in Canvas so the model cannot redraw or duplicate them.
const createHybridMockup = async (backgroundUrl: string, stickerUrls: string[], type: string): Promise<string> => {
  const [backgroundImage, loadedStickers] = await Promise.all([
    loadCanvasImage(backgroundUrl),
    Promise.all(uniqueStickerUrls(stickerUrls).map(loadCanvasImage))
  ]);
  if (!backgroundImage) throw new Error('Failed to load the mockup background.');

  const stickers = loadedStickers.filter((image): image is HTMLImageElement => Boolean(image?.width));
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 2048;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for mockup generation.');

  const backgroundScale = Math.max(canvas.width / backgroundImage.width, canvas.height / backgroundImage.height);
  const backgroundWidth = backgroundImage.width * backgroundScale;
  const backgroundHeight = backgroundImage.height * backgroundScale;
  context.drawImage(
    backgroundImage,
    (canvas.width - backgroundWidth) / 2,
    (canvas.height - backgroundHeight) / 2,
    backgroundWidth,
    backgroundHeight
  );

  // Build the product surface in Canvas instead of trusting a generative model
  // to place the device. This gives us a known, clip-safe area every time.
  context.save();
  context.shadowColor = 'rgba(15, 23, 42, 0.34)';
  context.shadowBlur = 70;
  context.shadowOffsetY = 36;

  let region: { x: number; y: number; width: number; height: number; columns: number; radius: number };
  if (type === 'laptop') {
    context.fillStyle = '#D6D3D1';
    context.strokeStyle = '#78716C';
    context.lineWidth = 12;
    context.beginPath();
    context.roundRect(230, 285, 1588, 1160, 92);
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = '#A8A29E';
    context.beginPath();
    context.roundRect(170, 1440, 1708, 115, 58);
    context.fill();
    region = { x: 330, y: 410, width: 1388, height: 885, columns: 3, radius: 55 };
  } else if (type === 'journal') {
    context.fillStyle = '#FFFBEB';
    context.strokeStyle = '#D6C7A1';
    context.lineWidth = 10;
    context.beginPath();
    context.roundRect(155, 285, 1738, 1395, 62);
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = 'rgba(120, 92, 58, 0.28)';
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(1024, 325);
    context.lineTo(1024, 1640);
    context.stroke();
    region = { x: 245, y: 405, width: 1558, height: 1110, columns: 4, radius: 28 };
  } else if (type === 'goodnotes') {
    context.fillStyle = '#111827';
    context.beginPath();
    context.roundRect(280, 170, 1488, 1708, 118);
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = '#FFFEF8';
    context.beginPath();
    context.roundRect(350, 255, 1348, 1518, 58);
    context.fill();
    context.fillStyle = '#F1F5F9';
    context.fillRect(350, 255, 1348, 145);
    ['#FB7185', '#FBBF24', '#34D399'].forEach((color, index) => {
      context.fillStyle = color;
      context.beginPath();
      context.arc(425 + index * 58, 328, 17, 0, Math.PI * 2);
      context.fill();
    });
    region = { x: 425, y: 455, width: 1198, height: 1160, columns: 3, radius: 34 };
  } else {
    context.fillStyle = '#FFFFFF';
    context.strokeStyle = '#E2E8F0';
    context.lineWidth = 10;
    context.beginPath();
    context.roundRect(210, 255, 1628, 1445, 74);
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    region = { x: 310, y: 390, width: 1428, height: 1130, columns: Math.min(3, Math.max(1, stickers.length)), radius: 42 };
  }
  context.restore();

  const rows = Math.max(1, Math.ceil(stickers.length / region.columns));
  const cellWidth = region.width / region.columns;
  const cellHeight = region.height / rows;
  const rotations = [-0.045, 0.025, 0.04, -0.03, 0.015];

  context.save();
  context.beginPath();
  context.roundRect(region.x, region.y, region.width, region.height, region.radius);
  context.clip();
  stickers.forEach((sticker, index) => {
    const column = index % region.columns;
    const row = Math.floor(index / region.columns);
    drawContainedSticker(
      context,
      sticker,
      region.x + cellWidth * (column + 0.5),
      region.y + cellHeight * (row + 0.5),
      cellWidth * 0.76,
      cellHeight * 0.74,
      rotations[index % rotations.length],
      0.42
    );
  });
  context.restore();

  return canvas.toDataURL('image/jpeg', 0.92);
};

const createHowToComposite = async (stickerUrls: string[]): Promise<string> => {
  const images = (await Promise.all(uniqueStickerUrls(stickerUrls).slice(0, 4).map(loadCanvasImage)))
    .filter((image): image is HTMLImageElement => Boolean(image?.width));
  if (!images.length) throw new Error('No valid stickers are available for the how-to image.');

  const canvas = document.createElement('canvas');
  canvas.width = 3000;
  canvas.height = 3000;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for the how-to image.');

  const background = context.createLinearGradient(0, 0, 3000, 3000);
  background.addColorStop(0, '#FFF7ED');
  background.addColorStop(0.52, '#FDF2F8');
  background.addColorStop(1, '#ECFEFF');
  context.fillStyle = background;
  context.fillRect(0, 0, 3000, 3000);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#172554';
  context.font = '900 142px Inter, Arial, sans-serif';
  context.fillText('HOW YOUR DOWNLOAD WORKS', 1500, 155);
  context.fillStyle = '#475569';
  context.font = '700 58px Inter, Arial, sans-serif';
  context.fillText('PURCHASE → DOWNLOAD → UNZIP → IMPORT', 1500, 315);

  const cardWidth = 1320;
  const cardHeight = 900;
  const cards = [
    { x: 130, y: 465, color: '#F97316', title: 'DOWNLOAD FROM ETSY', line1: 'ETSY.COM → ACCOUNT → PURCHASES', line2: 'Select “Download Files” in a browser' },
    { x: 1550, y: 465, color: '#8B5CF6', title: 'UNZIP YOUR FILES', line1: 'OPEN EACH DOWNLOADED ZIP', line2: 'Choose Extract All / Uncompress' },
    { x: 130, y: 1465, color: '#0891B2', title: 'IMPORT A PNG', line1: 'OPEN YOUR PLANNER OR DESIGN APP', line2: 'Choose Import, Insert Image or Upload' },
    { x: 1550, y: 1465, color: '#EC4899', title: 'DECORATE & CREATE', line1: 'DRAG • RESIZE • ROTATE • LAYER', line2: 'Arrange the stickers in your project' }
  ];

  cards.forEach((card, index) => {
    const { x, y } = card;
    context.save();
    context.shadowColor = 'rgba(30, 41, 59, 0.17)';
    context.shadowBlur = 45;
    context.shadowOffsetY = 24;
    context.fillStyle = '#FFFFFF';
    context.beginPath();
    context.roundRect(x, y, cardWidth, cardHeight, 70);
    context.fill();
    context.restore();

    context.fillStyle = card.color;
    context.beginPath();
    context.arc(x + 105, y + 105, 68, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#FFFFFF';
    context.font = '900 62px Inter, Arial, sans-serif';
    context.fillText(String(index + 1), x + 105, y + 105);

    context.fillStyle = '#172554';
    context.textAlign = 'left';
    context.font = '900 62px Inter, Arial, sans-serif';
    context.fillText(card.title, x + 205, y + 90);
    context.fillStyle = '#64748B';
    context.font = '700 35px Inter, Arial, sans-serif';
    context.fillText(card.line1, x + 205, y + 155);
    context.font = '600 35px Inter, Arial, sans-serif';
    context.fillText(card.line2, x + 205, y + 205);
    context.textAlign = 'center';

    if (index === 0) {
      // A simplified Etsy Purchases screen makes the retrieval path obvious.
      context.fillStyle = '#F8FAFC';
      context.strokeStyle = '#CBD5E1';
      context.lineWidth = 6;
      context.beginPath();
      context.roundRect(x + 100, y + 285, 1120, 500, 38);
      context.fill();
      context.stroke();
      context.fillStyle = '#E2E8F0';
      context.fillRect(x + 100, y + 285, 1120, 88);
      ['#FB7185', '#FBBF24', '#34D399'].forEach((color, dotIndex) => {
        context.fillStyle = color;
        context.beginPath();
        context.arc(x + 155 + dotIndex * 52, y + 330, 14, 0, Math.PI * 2);
        context.fill();
      });
      context.textAlign = 'left';
      context.fillStyle = '#334155';
      context.font = '800 42px Inter, Arial, sans-serif';
      context.fillText('Your account  ›  Purchases', x + 155, y + 440);
      context.fillStyle = '#FFFFFF';
      context.strokeStyle = '#E2E8F0';
      context.beginPath();
      context.roundRect(x + 155, y + 500, 1010, 205, 30);
      context.fill();
      context.stroke();
      context.fillStyle = '#0F172A';
      context.font = '800 38px Inter, Arial, sans-serif';
      context.fillText('Your digital sticker order', x + 205, y + 560);
      context.fillStyle = '#F97316';
      context.beginPath();
      context.roundRect(x + 760, y + 590, 335, 78, 39);
      context.fill();
      context.textAlign = 'center';
      context.fillStyle = '#FFFFFF';
      context.font = '900 32px Inter, Arial, sans-serif';
      context.fillText('DOWNLOAD FILES', x + 927, y + 630);
    } else if (index === 1) {
      // ZIP files flow into an extracted PNG folder.
      [0, 1, 2].forEach(fileIndex => {
        const fileX = x + 145 + fileIndex * 285;
        context.fillStyle = fileIndex === 1 ? '#EDE9FE' : '#F5F3FF';
        context.strokeStyle = '#8B5CF6';
        context.lineWidth = 6;
        context.beginPath();
        context.roundRect(fileX, y + 330 + fileIndex * 18, 225, 285, 28);
        context.fill();
        context.stroke();
        context.fillStyle = '#8B5CF6';
        context.fillRect(fileX + 102, y + 350 + fileIndex * 18, 22, 155);
        context.fillStyle = '#4C1D95';
        context.font = '900 38px Inter, Arial, sans-serif';
        context.fillText('ZIP', fileX + 112, y + 560 + fileIndex * 18);
      });
      context.fillStyle = '#8B5CF6';
      context.beginPath();
      context.roundRect(x + 380, y + 690, 560, 92, 46);
      context.fill();
      context.fillStyle = '#FFFFFF';
      context.font = '900 38px Inter, Arial, sans-serif';
      context.fillText('EXTRACT ALL FILES', x + 660, y + 736);
    } else if (index === 2) {
      // A generic app import surface avoids promising one specific app.
      context.fillStyle = '#0F172A';
      context.beginPath();
      context.roundRect(x + 210, y + 285, 900, 525, 58);
      context.fill();
      context.fillStyle = '#FFFFFF';
      context.beginPath();
      context.roundRect(x + 255, y + 335, 810, 425, 32);
      context.fill();
      context.strokeStyle = '#CBD5E1';
      context.lineWidth = 5;
      context.stroke();
      context.fillStyle = '#0891B2';
      context.beginPath();
      context.roundRect(x + 355, y + 400, 610, 105, 52);
      context.fill();
      context.fillStyle = '#FFFFFF';
      context.font = '900 40px Inter, Arial, sans-serif';
      context.fillText('+  IMPORT / INSERT IMAGE', x + 660, y + 453);
      drawContainedSticker(context, images[0], x + 660, y + 650, 330, 235, -0.035, 0.55);
    } else {
      context.fillStyle = '#FFFEF7';
      context.strokeStyle = '#FBCFE8';
      context.lineWidth = 7;
      context.beginPath();
      context.roundRect(x + 145, y + 285, 1030, 530, 44);
      context.fill();
      context.stroke();
      context.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      context.lineWidth = 4;
      for (let line = 0; line < 5; line++) {
        context.beginPath();
        context.moveTo(x + 220, y + 410 + line * 72);
        context.lineTo(x + 1095, y + 410 + line * 72);
        context.stroke();
      }
      drawContainedSticker(context, images[1 % images.length], x + 510, y + 560, 430, 390, -0.09, 0.60);
      drawContainedSticker(context, images[2 % images.length], x + 875, y + 595, 390, 360, 0.08, 0.60);
    }
  });

  context.fillStyle = '#172554';
  context.textAlign = 'center';
  context.font = '900 48px Inter, Arial, sans-serif';
  context.fillText('DIGITAL DOWNLOAD • USE A MOBILE BROWSER OR COMPUTER • NO PHYSICAL ITEM', 1500, 2605);
  context.fillStyle = '#475569';
  context.font = '700 42px Inter, Arial, sans-serif';
  context.fillText('After unzipping, import any individual transparent PNG into an app that supports images.', 1500, 2705);
  return canvas.toDataURL('image/jpeg', 0.93);
};

// --- GRID PREVIEW ---
// UPDATED: 3000x3000px Ultra HD + Smart Centering for Last Row
const createGridComposite = async (stickerUrls: string[]): Promise<string> => {
    return new Promise((resolve) => {
        try {
            const canvas = document.createElement('canvas');
            const CTX_SIZE = 3000; // Ultra High Res
            canvas.width = CTX_SIZE;
            canvas.height = CTX_SIZE;
            const ctx = canvas.getContext('2d');
            
            if (!ctx) { 
                console.error("No canvas context");
                resolve(""); 
                return; 
            }

            // White Background
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, CTX_SIZE, CTX_SIZE);

            const validUrls = uniqueStickerUrls(stickerUrls);
            const count = validUrls.length;

            if (count === 0) {
                // Placeholder
                ctx.fillStyle = "#F3F4F6";
                ctx.fillRect(0,0,CTX_SIZE,CTX_SIZE);
                ctx.fillStyle = "#9CA3AF";
                ctx.font = "100px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("NO STICKERS SELECTED", CTX_SIZE/2, CTX_SIZE/2);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
                return;
            }

            // DYNAMIC GRID CALCULATION
            const COLS = Math.ceil(Math.sqrt(count));
            const ROWS = Math.ceil(count / COLS);
            
            // Calculate Cell Size
            const CELL_WIDTH = CTX_SIZE / COLS;
            const CELL_HEIGHT = CTX_SIZE / ROWS;
            
            // Tight Padding to make stickers HUGE
            const PADDING = 30; 

            const loadPromises = validUrls.map(url => {
                return new Promise<HTMLImageElement>((res) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => res(img);
                    img.onerror = () => res(new Image()); 
                    img.src = url;
                });
            });

            Promise.all(loadPromises).then(images => {
                images.forEach((img, i) => {
                    if (!img.width) return;
                    
                    const col = i % COLS;
                    const row = Math.floor(i / COLS);
                    
                    // SMART CENTERING FOR LAST ROW
                    // If this is the last row, and it's not full, calculate offset
                    let xOffset = 0;
                    if (row === ROWS - 1) {
                         const itemsInLastRow = count % COLS || COLS;
                         if (itemsInLastRow < COLS) {
                             const totalRowWidth = itemsInLastRow * CELL_WIDTH;
                             const emptySpace = CTX_SIZE - totalRowWidth;
                             xOffset = emptySpace / 2;
                         }
                    }

                    const x = col * CELL_WIDTH + PADDING + xOffset;
                    const y = row * CELL_HEIGHT + PADDING;
                    
                    const maxW = CELL_WIDTH - (PADDING * 2);
                    const maxH = CELL_HEIGHT - (PADDING * 2);

                    // Scale to fit within the cell
                    const scale = Math.min(maxW / img.width, maxH / img.height);
                    const w = img.width * scale;
                    const h = img.height * scale;
                    
                    // Center in cell (Vertical + Horizontal within cell)
                    const cellOffsetX = (maxW - w) / 2;
                    const cellOffsetY = (maxH - h) / 2;

                    ctx.save();
                    // Softer shadow for grid view
                    ctx.shadowColor = "rgba(0,0,0,0.15)";
                    ctx.shadowBlur = 20;
                    ctx.shadowOffsetX = 5;
                    ctx.shadowOffsetY = 10;
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, x + cellOffsetX, y + cellOffsetY, w, h);
                    ctx.restore();
                });

                // Footer Text
                ctx.fillStyle = "rgba(0,0,0,0.8)";
                ctx.font = "bold 80px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("PREMIUM STICKER COLLECTION", CTX_SIZE/2, CTX_SIZE - 80);
                
                ctx.fillStyle = "rgba(0,0,0,0.4)";
                ctx.font = "50px Inter, sans-serif";
                ctx.fillText("HIGH-RES TRANSPARENT PNG • INSTANT DOWNLOAD", CTX_SIZE/2, CTX_SIZE - 180);

                resolve(canvas.toDataURL('image/jpeg', 0.90));
            }).catch(e => {
                console.error("Grid generation failed", e);
                resolve(""); 
            });
        } catch (e) {
            console.error("Canvas crash", e);
            resolve("");
        }
    });
};

// --- Autopilot Logic ---

export const analyzeNichePotential = async (nicheName: string): Promise<number> => {
  try {
      const response = await generateBrainText({
        prompt: `Analyze the Etsy sales potential for digital stickers in the niche: "${nicheName}".
        Return a single integer score from 0 to 100 based on Demand, Competition, and Trendiness.
        0 = Terrible, 100 = Guaranteed Bestseller.
        Return ONLY the number.`,
      });
      const score = parseInt(response.text.trim() || "50");
      return isNaN(score) ? 50 : score;
  } catch (e) {
      if (isProviderAuthenticationError(e)) throw e;
      return 50;
  }
};

export const analyzeNicheVisuals = async (nicheName: string): Promise<NicheVisualAnalysis> => {
  // CRITICAL UPDATE: DEEP VISUAL INVESTIGATION
  // Removed "cute/kawaii" bias. Added logic to detect specific aesthetics like Analog, Grunge, Corporate, etc.
  const prompt = `
  ACT AS A SENIOR ART DIRECTOR FOR ETSY.
  
  TASK: Perform a deep visual audit of the niche: "${nicheName}".
  
  OBJECTIVE: Determine the EXACT visual aesthetic that real buyers in this niche want.
  ALSO: Understand deeply what customers search for in this niche, and the different intents and uses of the stickers (not just visual).
  IMPORTANT: Interpret the submitted niche as an entry point into a broader visual universe, not as the only object to repeat.
  
  SCENARIO EXAMPLES:
  - If niche is "Kodak Portra" -> Aesthetic is "Analog Film, Grainy, Retro, Realistic, Muted". NOT Kawaii.
  - If niche is "Cyberpunk" -> Aesthetic is "Neon, Glitch, High-Tech, Dark". NOT Pastel.
  - If niche is "Kindergarten Teacher" -> Aesthetic is "Cute, Crayon, Primary Colors".
  - If niche is "Retro Windows Error (Anxiety.exe)" -> Theme universe is retro desktop computing and operating-system nostalgia. Error dialogs are only one subtheme alongside folders, cursors, control panels, loading states, desktop icons, files, software tools, floppy disks, monitors, keyboards, settings, wallpapers, and startup/shutdown moments.
  
  JSON RESPONSE REQUIRED:
  {
    "archetype": "OBJECT" | "CHARACTER" | "FRAME_OVERLAY" | "FUNCTIONAL_LABEL" | "TEXT_QUOTE",
    "visualStyle": "A short, punchy phrase describing the art style (e.g. 'Vintage Film Grain' or 'Flat Vector Kawaii')",
    "keywords": "Comma-separated visual adjectives (e.g. 'grainy, analog, muted' or 'pastel, cute, round')",
    "negativeKeywords": "What to AVOID? (e.g. 'vector, cartoon, flat' if analog, or 'realistic, dark' if kawaii)",
    "safeGenerics": "5 generic items that fit this theme",
    "themeUniverse": "The broad parent world behind the submitted niche. Do not simply repeat the niche wording.",
    "subthemes": "10-12 comma-separated, visually distinct subject families that belong to that broader world",
    "intentAndUse": "Describe the different intents and practical uses for these stickers (e.g., planner decoration, laptop decals, functional tracking, emotional expression).",
    "customerSearchBehavior": "What specific terms and concepts do customers search for when looking for this?"
  }
  `;

  try {
      const response = await generateBrainText({
        prompt,
        schemaName: 'niche_visual_analysis',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            archetype: { type: 'string', enum: ['CHARACTER', 'FRAME_OVERLAY', 'FUNCTIONAL_LABEL', 'TEXT_QUOTE', 'OBJECT'] },
            visualStyle: { type: 'string' },
            keywords: { type: 'string' },
            negativeKeywords: { type: 'string' },
            safeGenerics: { type: 'string' },
            themeUniverse: { type: 'string' },
            subthemes: { type: 'string' },
            intentAndUse: { type: 'string' },
            customerSearchBehavior: { type: 'string' }
          },
          required: ['archetype', 'visualStyle', 'keywords', 'negativeKeywords', 'safeGenerics', 'themeUniverse', 'subthemes', 'intentAndUse', 'customerSearchBehavior']
        }
      });
      return JSON.parse(response.text.trim());
  } catch (e) {
      if (isProviderAuthenticationError(e)) throw e;
      console.error("Failed to parse visual analysis", e);
      return { 
          archetype: 'OBJECT', 
          keywords: 'aesthetic, sticker', 
          negativeKeywords: 'ugly', 
          safeGenerics: 'star, heart',
          visualStyle: 'Standard Vector',
          themeUniverse: nicheName,
          subthemes: 'core objects, tools, accessories, symbols, environments, functional elements'
      };
  }
};

export const generateStickerPrompts = async (niche: string, style: StylePreset, count: number = 30, analysis?: NicheVisualAnalysis): Promise<string[]> => {
  const COUNT = count;
  const themeUniverse = analysis?.themeUniverse?.trim() || niche;
  const fallbackFamilies = (analysis?.subthemes || analysis?.safeGenerics || 'core objects, tools, accessories, symbols, environments, functional elements')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  
  let analysisContext = "";
  if (analysis) {
      // ENFORCE ANALYSIS: If analysis says "Analog", we MUST NOT generate cartoons.
      analysisContext = `
      STRICT VISUAL DIRECTION (DO NOT IGNORE):
      - Visual Style: ${analysis['visualStyle']}
      - Must Include Keywords: ${analysis.keywords}
      - STRICTLY AVOID: ${analysis.negativeKeywords}
      - BROAD THEME UNIVERSE: ${themeUniverse}
      - REQUIRED SUBJECT FAMILIES: ${analysis.subthemes || analysis.safeGenerics}
      - Intent and Use: ${analysis.intentAndUse || 'General decoration'}
      - Customer Search Behavior: ${analysis.customerSearchBehavior || 'General sticker search'}
      `;
  }

  // MASTER PROMPT: DYNAMIC "BEST SELLER" LOGIC
  const prompt = `
    ACT AS A SENIOR ART DIRECTOR.
    TASK: Generate exactly ${COUNT} distinct commercial sticker design concepts inspired by: "${niche}".
    BASE STYLE PRESET: ${style.name}
    BASE STYLE RULES: ${style.prompt}
    
    ${analysisContext}

    CRITICAL RULES:
    1. **ONE PRIMARY CONCEPT**: Describe one clear standalone sticker design. A primary subject may have small supporting details, but never create a sheet or collection inside one image.
    2. **NO COLLECTIONS**: Do NOT write prompts for "sticker sheets", "sets", "packs", or "collections".
    3. **BE SPECIFIC**: Instead of "medical equipment", say "A blue stethoscope".
    4. **UMBRELLA INTERPRETATION**: The input phrase is a creative doorway into its larger world. Do not turn every design into a literal illustration of the phrase.
    5. **DIRECT MOTIF CAP**: At most 15% of concepts may use the most literal motif or wording from "${niche}". The remaining concepts must explore the broader theme universe and its adjacent features.
    
    GOAL: Create a high-value sticker pack that EXACTLY matches the target aesthetic AND the customer's intent. 
    If the style is "Analog Film", generate film strips, cameras, light leaks.
    If the style is "Kawaii", generate cute characters.
    Make sure the stickers reflect the "Intent and Use" and "Customer Search Behavior" provided above.
    
    SUBJECT DISTRIBUTION ACROSS THE WHOLE PACK:
    - 15% DIRECT/LITERAL MOTIFS from the submitted phrase
    - 25% CORE OBJECTS AND ICONS from the broader theme universe
    - 20% TOOLS, ACTIONS, WORKFLOWS, AND SYSTEM FEATURES
    - 15% HARDWARE, ACCESSORIES, PLACES, OR SUPPORTING ENVIRONMENT
    - 15% FUNCTIONAL AND DECORATIVE ELEMENTS that fit the theme
    - 10% EMOTIONAL OR TEXT-BASED DESIGNS; use TEXT: NONE for everything else

    For a 100-design pack, cover at least 10 distinct subject families and do not let any family exceed 15 designs.

    DESIGN RULES:
    1. RELEVANCE: Every item must belong to the broader theme universe, even when it is not a literal rendering of "${niche}".
    2. VARIETY: Every concept must have a different primary subject. Do not repeat the same object, character, quote, pose, or composition.
    3. SEMANTIC UNIQUENESS: Rewording an existing idea does not make it new. Each design must be visibly distinguishable at thumbnail size.
    4. STYLE LOCK: Subjects and compositions must vary, but visual medium, line treatment, palette logic, shading, texture, border treatment, and overall art direction must remain consistent across the entire pack. Never introduce a different art style as a way to create variety.

    OUTPUT FORMAT:
    Return a JSON object with a "prompts" array containing exactly ${COUNT} strings.
    Each string must follow this structure exactly:
    "TYPE: [Type] | SUBJECT: [Subject Description] | COMPOSITION: [Layout] | TEXT: '[Text]'"
  `;

  try {
      const response = await generateBrainText({
        prompt,
        schemaName: 'sticker_concepts',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prompts: {
              type: 'array',
              items: { type: 'string' },
              minItems: COUNT,
              maxItems: COUNT
            }
          },
          required: ['prompts']
        }
      });
      const parsed = JSON.parse(response.text.trim()) as { prompts: string[] };
      const seen = new Set<string>();
      const uniquePrompts = parsed.prompts.filter(candidate => {
        const normalized = candidate.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
      while (uniquePrompts.length < COUNT) {
        const variation = uniquePrompts.length + 1;
        const family = fallbackFamilies[(variation - 1) % fallbackFamilies.length] || 'thematic object';
        uniquePrompts.push(`TYPE: Object-Only | SUBJECT: A distinct ${family} concept from ${themeUniverse}, variation ${variation}, with a primary subject not used elsewhere | COMPOSITION: Centered isolated design | TEXT: NONE`);
      }
      return uniquePrompts.slice(0, COUNT);
  } catch (e) {
      if (isProviderAuthenticationError(e)) throw e;
      console.error(`Failed to parse prompts`, e);
      return Array.from({ length: COUNT }, (_, index) => {
        const family = fallbackFamilies[index % fallbackFamilies.length] || 'thematic object';
        return `TYPE: Object-Only | SUBJECT: A distinct ${family} concept from ${themeUniverse}, variation ${index + 1} | COMPOSITION: Centered isolated design | TEXT: NONE`;
      });
  }
};

export const generate50StickerPrompts = async (niche: string, style: StylePreset) => {
    return generateStickerPrompts(niche, style);
};

export const generateAutopilotSticker = async (
  itemPrompt: string,
  stylePrompt: string,
  useTurbo: boolean = false,
  nicheContext: string = "",
  analysis?: NicheVisualAnalysis
): Promise<string> => {
  // --- SMART PROMPT PARSER ---
  let cleanSubject = itemPrompt;
  let cleanType = "";
  let cleanComp = "";
  let cleanText = "";

  if (itemPrompt.includes("|")) {
      const parts = itemPrompt.split("|").map(s => s.trim());
      parts.forEach(p => {
          if (p.startsWith("TYPE:")) cleanType = p.replace("TYPE:", "").trim();
          else if (p.startsWith("SUBJECT:")) cleanSubject = p.replace("SUBJECT:", "").trim();
          else if (p.startsWith("COMPOSITION:")) cleanComp = p.replace("COMPOSITION:", "").trim();
          else if (p.startsWith("TEXT:")) cleanText = p.replace("TEXT:", "").replace(/['"]/g, "").trim();
      });
  }

  // --- DYNAMIC VISUAL DESCRIPTION (REPLACES HARDCODED 'CUTE') ---
  let visualDescription = "";
  let strictConstraints = "";

  // The niche-level archetype is only an art-direction hint. It must never
  // force every item into the same form (for example, 100 window frames).
  const isFrame = cleanType.toUpperCase().includes('FRAME');
  
  if (isFrame) {
      // IF FRAME: Force center to be PURE WHITE. The Luma Keyer (set to > 65) will NOT delete white.
      // BUT, we actually want the center to be REMOVED.
      // TRICK: We tell AI to make the center a specific "Key Color" or just rely on Black background.
      visualDescription = `A TOP-DOWN view of a ${cleanSubject} frame overlay.`;
      strictConstraints = `CENTER MUST BE PURE BLACK (#000000). NO CONTENT INSIDE FRAME.`;
  } else {
      visualDescription = `A SINGLE, ISOLATED digital sticker design of ${cleanSubject}.`;
  }

  // Determine aesthetic vibe from analysis or default
  const aestheticKeywords = analysis ? analysis.keywords : "clean, vector, commercial";
  const negativeKeywords = analysis ? analysis.negativeKeywords : "blurry, low quality";
  const textInstruction = cleanText && cleanText.toUpperCase() !== 'NONE'
    ? `Render exactly this text and no other words: "${cleanText}". Spelling must be exact.`
    : 'NO TEXT: Do not render any words, letters, numbers, labels, logos, signatures, or watermarks anywhere in the sticker.';

  const fullPrompt = `
  GENERATE A RAW DIGITAL STICKER ASSET (NOT A PHOTO OF A STICKER).
  
  SUBJECT: ${visualDescription}
  BROAD THEME UNIVERSE: "${analysis?.themeUniverse || nicheContext}"
  COMPOSITION: ${cleanComp || 'Centered, isolated, and fully visible'}
  TEXT REQUIREMENT: ${textInstruction}
  
  ART STYLE INSTRUCTIONS (STRICT):
  - ${stylePrompt}
  - KEY AESTHETICS: ${aestheticKeywords}
  
  TECHNICAL RULES (DO NOT IGNORE):
  1. **SINGLE STICKER DESIGN ONLY**: Generate one clear primary subject in the center. Small supporting details named in the subject are allowed, but do not generate a sticker sheet, grid, pattern, or collection.
  2. **BACKGROUND**: SOLID BLACK HEX #000000. DO NOT USE DARK GRAY. DO NOT USE GRADIENTS. MUST BE FLAT BLACK.
  3. **BORDER**: Add one clean MEDIUM-THIN white die-cut border surrounding the object. Target a consistent border width of approximately 2.5-3.5% of the sticker's shorter dimension. It must remain visible at thumbnail size but must not look chunky, puffy, or halo-like.
  3A. **EDGE QUALITY**: The outside of the white border must be perfectly clean, continuous, and crisp. NO gray rim, NO dotted/dashed cut line, NO glow, NO texture, NO drop shadow, and NO second outline.
  4. **NO CROPPING**: The object must be floating in the center with padding on all sides.
  5. **NO CARDS**: Do NOT place the sticker on a paper card or square backing. It must be floating in void.
  6. **NATURAL OPENINGS**: Preserve openings that physically belong to the subject, such as the center of a ring, frame, hose loop, chain link, wheel, handle or scissors. Fill every intended empty opening with the exact same flat pure black (#000000) as the outer background so post-processing can make it transparent. Do not invent decorative holes or break a normally solid object.
  7. **COLOR RULE**: Except for those intentional empty openings, NEVER use pure black (#000000) inside the sticker. Use dark gray (#1A1A1A) for outlines and dark details so artwork cannot be mistaken for removable background.
  
  ${strictConstraints}
  
  NEGATIVE PROMPT (AVOID): ${negativeKeywords}, sticker sheet, sticker set, grid, pattern, multiple items, collection, cropping, blurry, text watermark, gray background, complex background, square crop, photo of a sticker on a table, realistic lighting on background, dark card backing, square paper behind sticker, accidental cutouts, unintended holes, broken silhouette, shadow, drop shadow, glow, oversized white border, extra-thick white outline, wide white halo, gray fringe, dotted outline, dashed cut line, textured edge.
  `;

  return generateSeedreamImage(fullPrompt, useTurbo ? '1K' : '2K');
};

export const generateMockupBackground = async (type: string, niche: string): Promise<string> => {
    return ""; // Deprecated
};

export const generateAutopilotListing = async (niche: string, styleName: string, useTurbo: boolean, stickerCount = 100): Promise<string> => {
  const sourceResolution = useTurbo
    ? 'high-resolution transparent PNG files created from 1K source artwork'
    : 'ultra-high-resolution transparent PNG files created from 2K source artwork';
  const zipCount = Math.ceil(stickerCount / 20);

  const userPrompt = `
    Act as a conversion-focused Etsy copywriter who follows current buyer-friendly title and description practices.
    Create a complete listing for a digital sticker bundle containing exactly ${stickerCount} finished stickers.

    PRODUCT FACTS — NEVER CONTRADICT OR EMBELLISH:
    - Theme: "${niche}"
    - Visual style: "${styleName}"
    - Delivery: ${zipCount} ZIP file${zipCount === 1 ? '' : 's'}, with up to 20 separate PNG stickers per ZIP
    - File type: ${sourceResolution}
    - Transparent backgrounds and individual, separately usable designs
    - Instant digital download; no physical item is shipped
    - Buyers download on Etsy.com from Account > Purchases > Download Files. The Etsy app does not currently download digital files, so buyers should use a mobile browser or computer.

    TITLE RULES:
    - Clear, natural and buyer-friendly; ideally fewer than 15 words and always under 140 characters.
    - State the item once and put the theme plus the most important objective traits first.
    - Do not keyword-stuff, repeat words, add price/shipping language, or use unsupported claims such as "best seller".

    TAG RULES:
    - Exactly 13 unique, relevant Etsy search phrases.
    - Each tag must be 20 characters or fewer, including spaces.
    - Mix specific long-tail intent, theme, format, use case and audience phrases. Avoid irrelevant traffic bait.

    DESCRIPTION RULES:
    - Write a detailed, persuasive, easy-to-scan description of roughly 450-700 words.
    - Start with two concise sentences that immediately state what the buyer receives and the strongest practical/emotional benefit.
    - Then use short paragraphs and clearly labeled sections with plain-text bullets:
      WHAT YOU RECEIVE
      WHY YOU'LL LOVE IT
      GREAT FOR
      HOW TO DOWNLOAD
      HOW TO USE
      IMPORTANT DETAILS
    - Explain the variety within the broader theme instead of promising 100 versions of one object.
    - Include practical uses such as digital planning, journaling, note-taking, presentations, mood boards and creative projects when relevant.
    - Explain: download the ZIP files, extract/unzip them, import individual PNGs into an app that supports PNG images, then drag, resize and arrange.
    - Say that colors may vary by screen and that the preview arrangement/mockup props are not additional files.
    - Allow use in the buyer's own creative projects, but clearly prohibit reselling, redistributing, sharing or claiming the original PNG files as their own.
    - Do not invent app guarantees, printable dimensions, DPI metadata, physical materials, bonuses, editable vectors, refunds, medical benefits or commercial-license rights.
  `;

  const response = await generateBrainText({
    prompt: userPrompt,
    schemaName: 'etsy_autopilot_listing',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          minItems: 13,
          maxItems: 13
        },
        description: { type: 'string' }
      },
      required: ['title', 'tags', 'description']
    }
  });
  const listing = JSON.parse(response.text) as { title: string; tags: string[]; description: string };
  const title = listing.title.replace(/\s+/g, ' ').trim();
  const tags: string[] = [];
  const seenTags = new Set<string>();
  listing.tags.forEach(rawTag => {
    const tag = rawTag.trim();
    const normalizedTag = tag.toLocaleLowerCase('en-US');
    if (tag && !seenTags.has(normalizedTag) && tags.length < 13) {
      seenTags.add(normalizedTag);
      tags.push(tag);
    }
  });
  const description = listing.description.trim();
  const descriptionWordCount = description.split(/\s+/).filter(Boolean).length;
  if (!title || title.length > 140) {
    throw new Error('OpenAI returned an invalid Etsy title. Please regenerate the listing copy.');
  }
  if (tags.length !== 13 || tags.some(tag => tag.length > 20)) {
    throw new Error('OpenAI returned invalid Etsy tags. Please regenerate the listing copy.');
  }
  if (descriptionWordCount < 300) {
    throw new Error('OpenAI returned a description that is too short. Please regenerate the listing copy.');
  }

  return `<<<TITLE>>>${title}<<<END_TITLE>>>\n<<<TAGS>>>${tags.join(', ')}<<<END_TAGS>>>\n<<<DESCRIPTION>>>${description}<<<END_DESCRIPTION>>>`;
};

export const generateSeedreamMockup = async (
    assetId: string,
    assetType: string,
    stickerUrls: string[], 
    niche: string,
    totalStickerCount = stickerUrls.length
): Promise<string> => {
    const id = assetId.toLowerCase();
    const type = assetType.toLowerCase();
    const uniqueUrls = uniqueStickerUrls(stickerUrls);

    if (!uniqueUrls.length) throw new Error('No unique stickers are available for this marketing asset.');
    if (type === 'preview' || id.includes('preview')) return createGridComposite(uniqueUrls);
    if (type === 'cover') return createCoverComposite(uniqueUrls, niche, totalStickerCount);
    if (type === 'howto' || id.includes('howto')) return createHowToComposite(uniqueUrls);

    const placement = type === 'goodnotes' || id.includes('goodnotes')
      ? id.endsWith('_2')
        ? 'an elegant close three-quarter view of a tablet on a modern desk, with a large blank digital-planner page visible on the screen'
        : 'a premium straight top-down view of a tablet on a tidy modern desk, with a large blank digital-planner page visible on the screen'
      : type === 'laptop' || id.includes('laptop')
        ? 'a premium lifestyle photograph of a modern laptop on a clean desk, with the outer laptop lid as a large clearly visible sticker surface'
        : type === 'journal' || id.includes('journal')
          ? 'a premium top-down lifestyle photograph of an open cream-paper journal on a warm wooden desk, with both pages clearly visible'
          : 'a premium top-down product scene showing a clean digital-planner workspace with a large usable central surface';

    const referencePrompt = `Use every supplied reference image as a finished sticker design. Create ${placement}. Place the supplied sticker designs naturally and professionally on the visible product surface. Preserve each reference design's subject, colors, line work, proportions, spelling, and white die-cut border as closely as possible. Keep every placed sticker fully inside the laptop, screen, page, or product boundary with comfortable margin; no sticker may float outside or be cropped. Use each supplied reference once. Do not invent, redraw, merge, replace, or add any sticker design. Do not add headings, captions, badges, labels, logos, watermarks, marketing copy, or extra readable text. The result must look like convincing commercial Etsy product photography, square composition, soft natural light, realistic scale and shadows.`;

    try {
      const referenceImages = await Promise.all(uniqueUrls.slice(0, 5).map(imageUrlToDataUrl));
      const generatedMockup = await generateSeedreamImage(referencePrompt, '1K', referenceImages);
      return await upscaleMockupTo2K(generatedMockup);
    } catch (e: any) {
      console.warn('Reference-based Seedream mockup failed; using the clipped exact-pixel fallback.', e);
    }

    // The generated image is scenery only. Do not mention the niche here: when
    // the model sees it, it may paint fake thematic stickers into the photo.
    // Canvas adds the device and the exact completed sticker files afterward.
    const backgroundPrompt = `Create a premium square top-down lifestyle photograph of a clean warm-neutral desk surface. Leave the central 80 percent completely empty and unobstructed. Place at most two subtle realistic props only at the extreme outer edges, such as a coffee cup corner or a small plant. Do not include any tablet, laptop, notebook, journal, paper, screen, frame, sticker, decal, illustration, icon, logo, label, badge, UI, writing, letters, or numbers. Soft natural daylight, realistic commercial product photography.`;

    try {
        // The scenery is intentionally soft-focus; 1K is enough because the
        // exact sticker pixels and product frame are rendered locally at 2K.
        const backgroundUrl = await generateSeedreamImage(backgroundPrompt, '1K');
        return await createHybridMockup(backgroundUrl, uniqueUrls, type);
    } catch (e: any) {
        console.warn('Lifestyle mockup generation failed; falling back to an exact grid.', e);
        return await createGridComposite(uniqueUrls);
    }
};

export const generateMarketingAsset = async (type: string, niche: string, styleName: string): Promise<string> => {
  return "";
};

export const generateMarketingImage = async (type: string, detail: string): Promise<string> => {
    return generateSeedreamImage(`Professional photography of ${detail} stickers. Type: ${type}. High resolution, square composition.`, '2K');
};

export const generateStickerImage = async (prompt: string, size: ImageSize = '2K'): Promise<string> => {
  return generateSeedreamImage(prompt, size);
};

export const getTrendAnalysis = async (query: string): Promise<TrendResult> => {
  const response = await generateBrainText({
    prompt: `Research current Etsy and broader consumer trends for: ${query}. Focus on evidence useful for a digital sticker seller.`,
    webSearch: true
  });
  return { answer: response.text || "No data.", sources: response.sources };
};

export const findViralNiche = async (): Promise<string> => {
  const response = await generateBrainText({
    prompt: "Research the hottest current viral digital-sticker niche with credible demand signals. Return ONLY the niche name.",
    webSearch: true
  });
  return response.text.trim().replace(/^["']|["']$/g, '') || "Trending";
};

export const discoverTopTrends = async (): Promise<DiscoveredTrend[]> => {
  const response = await generateBrainText({
    prompt: "Research and identify exactly 5 breakout digital-sticker trends with current demand evidence. Give each trend a production-ready art direction.",
    webSearch: true,
    schemaName: 'sticker_trends',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        trends: {
          type: 'array',
          minItems: 5,
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              category: { type: 'string' },
              description: { type: 'string' },
              styleName: { type: 'string' },
              stylePrompt: { type: 'string' }
            },
            required: ['name', 'category', 'description', 'styleName', 'stylePrompt']
          }
        },
      },
      required: ['trends']
    }
  });
  try { return (JSON.parse(response.text) as { trends: DiscoveredTrend[] }).trends; } catch { return []; }
};

export interface ChatSession {
  sendMessage(input: { message: string }): Promise<{ text: string }>;
}

export const createChat = (): ChatSession => {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];

  return {
    async sendMessage({ message }) {
      messages.push({ role: 'user', content: message });
      const response = await generateBrainText({ messages, chat: true });
      messages.push({ role: 'assistant', content: response.text });
      return { text: response.text };
    }
  };
};

export const generateListingContent = async (niche: NicheType, productName: string, count: number, isBundle: boolean): Promise<GeneratedListing> => {
  const response = await generateBrainText({
    prompt: `Create a complete Etsy listing for ${productName}. Niche: ${niche}. Sticker count: ${count}. Bundle: ${isBundle ? 'yes' : 'no'}.
Use exactly 13 Etsy tags, each no longer than 20 characters. Make the claims accurate for a digital-download product.`,
    schemaName: 'etsy_listing',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title1: { type: 'string' },
        title2: { type: 'string' },
        title3: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 13, maxItems: 13 },
        description: { type: 'string' },
        price: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        category: { type: 'string' },
        materials: { type: 'string' },
        whatsIncluded: { type: 'array', items: { type: 'string' } },
        howToDownload: { type: 'array', items: { type: 'string' } },
        license: { type: 'string' }
      },
      required: ['title1', 'title2', 'title3', 'tags', 'description', 'price', 'keywords', 'category', 'materials', 'whatsIncluded', 'howToDownload', 'license']
    }
  });

  return JSON.parse(response.text) as GeneratedListing;
};
