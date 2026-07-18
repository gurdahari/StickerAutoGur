import type { GeneratedListing, ImageSize, TrendResult, StylePreset, DiscoveredTrend, NicheVisualAnalysis, NicheType, NichePreflight } from "../types";

type JsonSchema = Record<string, unknown>;

interface BrainResult {
  text: string;
  sources: { title: string; uri: string }[];
}

export interface ProviderHealth {
  status: string;
  providers: {
    openai: { configured: boolean; model: string };
    seedream: { configured: boolean; model: string; maxConcurrency: number };
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
  images?: { dataUrl: string; detail?: 'low' | 'high' | 'original' | 'auto' }[];
}): Promise<BrainResult> => apiRequest<BrainResult>(options.chat ? '/api/brain/chat' : '/api/brain/generate', {
  method: 'POST',
  body: JSON.stringify(options)
});

export interface StickerVisionQaResult {
  id: number;
  decision: 'approve' | 'reject';
  issues: string[];
  coverScore: number;
}

export interface StickerVisionQaReport {
  results: StickerVisionQaResult[];
  duplicateGroups: number[][];
}

export interface QaContactSheetInput {
  dataUrl: string;
  stickerIds: number[];
}

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

export const assessNicheForProduction = async (niche: string): Promise<NichePreflight> => {
  const response = await generateBrainText({
    webSearch: true,
    prompt: `Perform a cautious pre-production assessment for an Etsy digital sticker bundle niche: "${niche}".

Use current public marketplace/search evidence where available. This is decision support, not legal advice.

Score:
- demandScore: buyer-interest potential from 0 to 100.
- variationScore: ability to support at least 100 genuinely different designs across 10 or more subject families, from 0 to 100.
- saturation: low, medium or high.
- ipRisk: low, medium or high. High means the phrase clearly depends on a protected brand, franchise, celebrity, character or trademark rather than a generic subject.
- recommendation: proceed, review or block. Use block only for high IP risk or variationScore below 45.

Do not promise sales, trademark clearance, or legal safety. Give concise evidence-based reasons.`,
    schemaName: 'sticker_niche_preflight',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        demandScore: { type: 'integer', minimum: 0, maximum: 100 },
        variationScore: { type: 'integer', minimum: 0, maximum: 100 },
        saturation: { type: 'string', enum: ['low', 'medium', 'high'] },
        ipRisk: { type: 'string', enum: ['low', 'medium', 'high'] },
        recommendation: { type: 'string', enum: ['proceed', 'review', 'block'] },
        summary: { type: 'string' },
        reasons: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 6
        }
      },
      required: ['demandScore', 'variationScore', 'saturation', 'ipRisk', 'recommendation', 'summary', 'reasons']
    }
  });

  const assessment = JSON.parse(response.text) as Omit<NichePreflight, 'sources'>;
  return { ...assessment, sources: response.sources };
};

export const generateStickerQualityReport = async (
  sheets: QaContactSheetInput[],
  candidates: { id: number; prompt: string }[]
): Promise<StickerVisionQaReport> => {
  if (!candidates.length) return { results: [], duplicateGroups: [] };
  const allowedIds = new Set(candidates.map(candidate => candidate.id));
  const candidateText = candidates
    .map(candidate => `${candidate.id}: ${candidate.prompt.replace(/\s+/g, ' ').trim().slice(0, 260)}`)
    .join('\n');

  const response = await generateBrainText({
    images: sheets.map(sheet => ({ dataUrl: sheet.dataUrl, detail: 'original' })),
    prompt: `You are an optional strict visual quality inspector for a paid Etsy digital sticker product.
The supplied images are numbered contact sheets. Inspect every numbered design listed below.

Reject only an unmistakable defect that makes the file unsafe to sell:
- subject is malformed, nonsensical, cropped or visibly unfinished;
- unexpected or misspelled text, fake logo, watermark or signature;
- obvious background rectangle, dirty gray halo, broken white cutline or unintended transparent damage;
- a physically expected opening is visibly filled when the concept explicitly requires an opening;
- any large solid-black void, wedge or patch inside a normally solid subject, including missing anatomy, broken animal bodies, empty faces, black clothing holes or corrupted object interiors;
- it is a practically identical duplicate of another supplied sticker.

Approve whenever uncertain. Do not reject for taste, minor anatomy quirks, minor text-like texture, a slightly different composition, an imperfect but usable cutline, subject variety, or small style variation. Transparent regions appear as a checkerboard. Small white die-cut borders are intentional. Return one result for every supplied ID. coverScore is 0-100 for usefulness on a small marketplace thumbnail. Duplicate groups must contain only practically identical designs.

EXPECTED CONCEPTS:
${candidateText}`,
    schemaName: 'sticker_visual_quality_report',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        results: {
          type: 'array',
          minItems: candidates.length,
          maxItems: candidates.length,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'integer' },
              decision: { type: 'string', enum: ['approve', 'reject'] },
              issues: { type: 'array', items: { type: 'string' }, maxItems: 5 },
              coverScore: { type: 'integer', minimum: 0, maximum: 100 }
            },
            required: ['id', 'decision', 'issues', 'coverScore']
          }
        },
        duplicateGroups: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ids: { type: 'array', items: { type: 'integer' }, minItems: 2 }
            },
            required: ['ids']
          }
        }
      },
      required: ['results', 'duplicateGroups']
    }
  });

  const parsed = JSON.parse(response.text) as {
    results: StickerVisionQaResult[];
    duplicateGroups: { ids: number[] }[];
  };
  const byId = new Map<number, StickerVisionQaResult>();
  parsed.results.forEach(result => {
    if (!allowedIds.has(result.id) || byId.has(result.id)) return;
    byId.set(result.id, {
      id: result.id,
      decision: result.decision,
      issues: result.issues.slice(0, 5),
      coverScore: Math.max(0, Math.min(100, result.coverScore))
    });
  });

  // A missing optional vision result must not trigger a paid regeneration.
  const results = candidates.map(candidate => byId.get(candidate.id) || ({
    id: candidate.id,
    decision: 'approve' as const,
    issues: ['Optional visual QA did not return a result; local technical checks remain authoritative.'],
    coverScore: 50
  }));
  const duplicateGroups = parsed.duplicateGroups
    .map(group => [...new Set(group.ids)].filter(id => allowedIds.has(id)))
    .filter(group => group.length >= 2);
  return { results, duplicateGroups };
};

export const generateReplacementStickerPrompts = async (
  niche: string,
  style: StylePreset,
  count: number,
  existingPrompts: string[],
  rejectedReasons: string[],
  analysis?: NicheVisualAnalysis
): Promise<string[]> => {
  const existingSubjects = existingPrompts
    .map(prompt => prompt.replace(/\s+/g, ' ').trim().slice(0, 220))
    .slice(-120)
    .join('\n');
  const response = await generateBrainText({
    prompt: `Create exactly ${count} replacement sticker concepts for "${niche}" in the locked style "${style.name}" (${style.prompt}).
Theme universe: ${analysis?.themeUniverse || niche}
Subject families: ${analysis?.subthemes || analysis?.safeGenerics || 'core objects, tools, accessories, places and symbols'}

The replacements must be visibly different from every existing concept and from each other. Preserve the pack's medium, palette logic, texture, line treatment and border treatment. Avoid the defects that caused rejection: ${rejectedReasons.join('; ') || 'quality failure'}.

EXISTING CONCEPTS — DO NOT REPEAT OR PARAPHRASE:
${existingSubjects}

Return prompts in exactly this format:
"TYPE: [Type] | SUBJECT: [one clear primary subject] | COMPOSITION: [layout] | TEXT: '[exact text or NONE]'"`,
    schemaName: 'replacement_sticker_concepts',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompts: {
          type: 'array',
          items: { type: 'string' },
          minItems: count,
          maxItems: count
        }
      },
      required: ['prompts']
    }
  });
  return (JSON.parse(response.text) as { prompts: string[] }).prompts.slice(0, count);
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

const imageUrlToDataUrl = async (url: string, maxDimension = 1024): Promise<string> => {
  const image = await loadCanvasImage(url);
  if (!image) throw new Error('Failed to prepare sticker reference.');
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

const finalizeGeneratedCover = async (source: string): Promise<string> => {
  const image = await loadCanvasImage(source);
  if (!image) throw new Error('Failed to load the full Seedream cover.');
  const canvas = document.createElement('canvas');
  canvas.width = 3000;
  canvas.height = 2400;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for final cover sizing.');

  const targetRatio = canvas.width / canvas.height;
  const sourceRatio = image.width / image.height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  if (sourceRatio > targetRatio) {
    sourceWidth = image.height * targetRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    sourceHeight = image.width / targetRatio;
    sourceY = (image.height - sourceHeight) / 2;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas.toDataURL('image/jpeg', 0.95);
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

const getCoverCopy = (rawNiche: string) => {
  const normalized = (rawNiche || 'Premium Sticker Collection').replace(/\s+/g, ' ').trim();
  const parenthetical = normalized.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const colon = !parenthetical ? normalized.match(/^([^:]+):\s*(.+)$/) : null;
  const rawTitle = (parenthetical?.[1] || colon?.[1] || normalized)
    .replace(/\b(?:digital\s+)?stickers?\s+bundle\b/gi, '')
    .replace(/\b(?:digital\s+)?stickers?\b/gi, '')
    .trim();
  const rawSubtitle = parenthetical?.[2] || colon?.[2] || 'Premium themed collection';
  return {
    title: (rawTitle || normalized).toUpperCase(),
    subtitle: rawSubtitle
      .replace(/[\/|]+/g, ' • ')
      .replace(/\s*•\s*/g, ' • ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase()
  };
};

const getCoverTitleLayout = (
  context: CanvasRenderingContext2D,
  title: string,
  maxWidth: number
) => {
  const words = title.split(' ');
  let lines = [title];

  if (title.length > 24 && words.length >= 3) {
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

  let fontSize = lines.length === 1 ? 210 : 168;
  const minimumFontSize = lines.length === 1 ? 92 : 78;
  while (fontSize > minimumFontSize) {
    context.font = `900 ${fontSize}px Inter, Arial, sans-serif`;
    if (lines.every(line => context.measureText(line).width <= maxWidth)) break;
    fontSize -= 4;
  }
  return { lines, fontSize };
};

const createCoverComposite = async (
  stickerUrls: string[],
  nicheName: string,
  totalStickerCount: number,
  variant = 0,
  artDirectedBackgroundUrl?: string
): Promise<string> => {
  const uniqueUrls = uniqueStickerUrls(stickerUrls).slice(0, 15);
  const [loadedImages, artDirectedBackground] = await Promise.all([
    Promise.all(uniqueUrls.map(loadCanvasImage)),
    artDirectedBackgroundUrl ? loadCanvasImage(artDirectedBackgroundUrl) : Promise.resolve(null)
  ]);
  const images = loadedImages
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
    { start: '#EADFC8', middle: '#A9B58E', end: '#66745A', accent: '#D96C4A', accent2: '#F0C75E', ink: '#263126' },
    { start: '#F7E7E1', middle: '#C6A6B6', end: '#745B75', accent: '#D95D75', accent2: '#F2C66D', ink: '#35263B' },
    { start: '#DCE8ED', middle: '#86A6B6', end: '#405B70', accent: '#E07A5F', accent2: '#F2CC8F', ink: '#1F3342' },
    { start: '#F4E6C8', middle: '#D49A6A', end: '#8C5D4B', accent: '#4F8A7B', accent2: '#F3CF6D', ink: '#3B2B25' }
  ];
  const nicheHash = [...(nicheName || 'sticker')]
    .reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 7);
  const coverVariant = Math.abs(variant) % 3;
  const natureNiche = /mushroom|fern|forest|nature|granola|hike|camp|botanical|garden|cottage|outdoor|mountain/i.test(nicheName);
  const palette = palettes[natureNiche ? 0 : (nicheHash + coverVariant) % palettes.length];
  const coverCopy = getCoverCopy(nicheName);
  const background = coverVariant === 1
    ? context.createLinearGradient(width, 0, 0, height)
    : coverVariant === 2
      ? context.createLinearGradient(0, height, width, 0)
      : context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, palette.start);
  background.addColorStop(0.50, palette.middle);
  background.addColorStop(1, palette.end);
  if (artDirectedBackground) {
    const scale = Math.max(width / artDirectedBackground.width, height / artDirectedBackground.height);
    const renderedWidth = artDirectedBackground.width * scale;
    const renderedHeight = artDirectedBackground.height * scale;
    context.drawImage(
      artDirectedBackground,
      (width - renderedWidth) / 2,
      (height - renderedHeight) / 2,
      renderedWidth,
      renderedHeight
    );
    context.globalAlpha = 0.10;
  }
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.globalAlpha = 1;

  const centerGlow = context.createRadialGradient(1500, 1320, 120, 1500, 1320, 1450);
  centerGlow.addColorStop(0, 'rgba(255, 250, 232, 0.26)');
  centerGlow.addColorStop(0.58, 'rgba(255, 250, 232, 0.07)');
  centerGlow.addColorStop(1, 'rgba(9, 15, 12, 0.10)');
  context.fillStyle = centerGlow;
  context.fillRect(0, 0, width, height);

  const headlineShade = context.createLinearGradient(0, 0, 0, 640);
  headlineShade.addColorStop(0, 'rgba(9, 14, 12, 0.78)');
  headlineShade.addColorStop(0.72, 'rgba(9, 14, 12, 0.48)');
  headlineShade.addColorStop(1, 'rgba(9, 14, 12, 0)');
  context.fillStyle = headlineShade;
  context.fillRect(0, 0, width, 660);

  // A subtle merchandising stage preserves the niche-specific Seedream art
  // while keeping every exact PNG readable and crop-safe.
  context.save();
  context.fillStyle = 'rgba(12, 20, 16, 0.20)';
  context.strokeStyle = 'rgba(255, 245, 216, 0.32)';
  context.lineWidth = 7;
  context.beginPath();
  context.roundRect(72, 620, 2856, 1400, 88);
  context.fill();
  context.stroke();
  context.restore();

  context.save();
  context.strokeStyle = 'rgba(255, 246, 222, 0.82)';
  context.lineWidth = 14;
  context.beginPath();
  context.roundRect(24, 24, width - 48, height - 48, 48);
  context.stroke();
  context.restore();

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.save();
  context.fillStyle = palette.accent2;
  context.shadowColor = 'rgba(0, 0, 0, 0.28)';
  context.shadowBlur = 14;
  context.shadowOffsetY = 7;
  context.beginPath();
  context.roundRect(125, 68, 1040, 98, 49);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = palette.ink;
  context.font = '900 39px Inter, Arial, sans-serif';
  context.fillText('DIGITAL STICKER BUNDLE', 645, 119);
  context.restore();

  const titleLayout = getCoverTitleLayout(context, coverCopy.title, 2150);
  const titleLineHeight = titleLayout.fontSize * 0.92;
  const titleCenterY = titleLayout.lines.length === 1 ? 320 : 328;
  const firstTitleY = titleCenterY - ((titleLayout.lines.length - 1) * titleLineHeight) / 2;
  context.font = `900 ${titleLayout.fontSize}px Inter, Arial, sans-serif`;
  context.lineJoin = 'round';
  context.lineWidth = Math.max(12, titleLayout.fontSize * 0.075);
  titleLayout.lines.forEach((line, index) => {
    const y = firstTitleY + index * titleLineHeight;
    context.save();
    context.fillStyle = '#FFF7E5';
    context.strokeStyle = 'rgba(10, 16, 13, 0.92)';
    context.shadowColor = 'rgba(0, 0, 0, 0.38)';
    context.shadowBlur = 18;
    context.shadowOffsetY = 9;
    context.strokeText(line, 1260, y);
    context.fillText(line, 1260, y);
    context.restore();
  });

  let subtitleFontSize = 48;
  while (subtitleFontSize > 30) {
    context.font = `900 ${subtitleFontSize}px Inter, Arial, sans-serif`;
    if (context.measureText(coverCopy.subtitle).width <= 1960) break;
    subtitleFontSize -= 2;
  }
  context.save();
  context.fillStyle = 'rgba(10, 16, 13, 0.78)';
  context.strokeStyle = palette.accent2;
  context.lineWidth = 5;
  context.beginPath();
  context.roundRect(250, 480, 2010, 76, 38);
  context.fill();
  context.stroke();
  context.fillStyle = '#FFF7E5';
  context.font = `900 ${subtitleFontSize}px Inter, Arial, sans-serif`;
  context.fillText(coverCopy.subtitle, 1255, 519);
  context.restore();

  const stickerCount = Math.max(images.length, totalStickerCount);
  const layoutSets = [
    [
      { x: 1500, y: 1390, w: 780, h: 780, r: 0.00, shadow: 1.60 },
      { x: 820, y: 1120, w: 555, h: 555, r: -0.08, shadow: 1.25 },
      { x: 2180, y: 1120, w: 555, h: 555, r: 0.08, shadow: 1.25 },
      { x: 830, y: 1660, w: 510, h: 510, r: 0.07, shadow: 1.20 },
      { x: 2170, y: 1660, w: 510, h: 510, r: -0.07, shadow: 1.20 },
      { x: 350, y: 980, w: 330, h: 330, r: -0.10, shadow: 0.95 },
      { x: 2650, y: 980, w: 330, h: 330, r: 0.10, shadow: 0.95 },
      { x: 350, y: 1450, w: 350, h: 350, r: 0.08, shadow: 0.95 },
      { x: 2650, y: 1450, w: 350, h: 350, r: -0.08, shadow: 0.95 },
      { x: 1180, y: 790, w: 315, h: 315, r: -0.05, shadow: 0.90 },
      { x: 1820, y: 790, w: 315, h: 315, r: 0.05, shadow: 0.90 },
      { x: 1190, y: 1850, w: 300, h: 300, r: -0.04, shadow: 0.90 },
      { x: 1810, y: 1850, w: 300, h: 300, r: 0.04, shadow: 0.90 },
      { x: 590, y: 1880, w: 280, h: 280, r: -0.07, shadow: 0.85 },
      { x: 2410, y: 1880, w: 280, h: 280, r: 0.07, shadow: 0.85 }
    ],
    [
      { x: 1500, y: 1370, w: 720, h: 720, r: -0.015, shadow: 1.55 },
      { x: 900, y: 1110, w: 530, h: 530, r: -0.06, shadow: 1.20 },
      { x: 2100, y: 1110, w: 530, h: 530, r: 0.06, shadow: 1.20 },
      { x: 900, y: 1650, w: 500, h: 500, r: 0.06, shadow: 1.15 },
      { x: 2100, y: 1650, w: 500, h: 500, r: -0.06, shadow: 1.15 },
      { x: 390, y: 900, w: 330, h: 330, r: -0.08, shadow: 0.90 },
      { x: 2610, y: 900, w: 330, h: 330, r: 0.08, shadow: 0.90 },
      { x: 370, y: 1340, w: 350, h: 350, r: 0.07, shadow: 0.90 },
      { x: 2630, y: 1340, w: 350, h: 350, r: -0.07, shadow: 0.90 },
      { x: 1180, y: 785, w: 300, h: 300, r: -0.04, shadow: 0.85 },
      { x: 1820, y: 785, w: 300, h: 300, r: 0.04, shadow: 0.85 },
      { x: 1180, y: 1850, w: 300, h: 300, r: 0.03, shadow: 0.85 },
      { x: 1820, y: 1850, w: 300, h: 300, r: -0.03, shadow: 0.85 },
      { x: 580, y: 1810, w: 285, h: 285, r: -0.07, shadow: 0.85 },
      { x: 2420, y: 1810, w: 285, h: 285, r: 0.07, shadow: 0.85 }
    ],
    [
      { x: 1500, y: 1420, w: 760, h: 760, r: 0.012, shadow: 1.60 },
      { x: 790, y: 1220, w: 520, h: 520, r: -0.09, shadow: 1.20 },
      { x: 2210, y: 1220, w: 520, h: 520, r: 0.09, shadow: 1.20 },
      { x: 880, y: 1700, w: 465, h: 465, r: 0.06, shadow: 1.10 },
      { x: 2120, y: 1700, w: 465, h: 465, r: -0.06, shadow: 1.10 },
      { x: 390, y: 1010, w: 325, h: 325, r: -0.08, shadow: 0.90 },
      { x: 2610, y: 1010, w: 325, h: 325, r: 0.08, shadow: 0.90 },
      { x: 370, y: 1510, w: 340, h: 340, r: 0.07, shadow: 0.90 },
      { x: 2630, y: 1510, w: 340, h: 340, r: -0.07, shadow: 0.90 },
      { x: 1120, y: 800, w: 310, h: 310, r: -0.04, shadow: 0.85 },
      { x: 1880, y: 800, w: 310, h: 310, r: 0.04, shadow: 0.85 },
      { x: 1210, y: 1880, w: 280, h: 280, r: -0.03, shadow: 0.85 },
      { x: 1790, y: 1880, w: 280, h: 280, r: 0.03, shadow: 0.85 },
      { x: 610, y: 1880, w: 270, h: 270, r: -0.06, shadow: 0.80 },
      { x: 2390, y: 1880, w: 270, h: 270, r: 0.06, shadow: 0.80 }
    ]
  ];
  const slots = layoutSets[coverVariant];
  for (let index = images.length - 1; index >= 1; index--) {
    const slot = slots[index];
    drawContainedSticker(context, images[index], slot.x, slot.y, slot.w, slot.h, slot.r, slot.shadow);
  }
  const hero = slots[0];
  drawContainedSticker(context, images[0], hero.x, hero.y, hero.w, hero.h, hero.r, hero.shadow);

  // Draw the quantity badge last so sticker art can never obscure its text.
  context.save();
  context.translate(2580, 330);
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = 30;
  context.fillStyle = palette.accent2;
  context.strokeStyle = '#FFF7E5';
  context.lineWidth = 16;
  context.beginPath();
  context.arc(0, 0, 190, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = palette.ink;
  context.font = '900 112px Inter, Arial, sans-serif';
  context.fillText(String(stickerCount), 0, -32);
  context.font = '900 39px Inter, Arial, sans-serif';
  context.fillText(stickerCount === 1 ? 'STICKER' : 'STICKERS', 0, 62);
  context.restore();

  context.save();
  context.fillStyle = 'rgba(8, 14, 11, 0.96)';
  context.strokeStyle = 'rgba(255, 246, 222, 0.78)';
  context.lineWidth = 8;
  context.shadowColor = 'rgba(0, 0, 0, 0.34)';
  context.shadowBlur = 18;
  context.beginPath();
  context.roundRect(120, 2075, 2760, 245, 54);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  const benefits = [
    ['TRANSPARENT PNG', 'CLEAN INDIVIDUAL FILES'],
    ['READY TO USE', 'DRAG • RESIZE • CREATE'],
    ['INSTANT DOWNLOAD', 'NO PHYSICAL ITEM']
  ];
  benefits.forEach(([heading, detail], index) => {
    const centerX = 570 + index * 930;
    if (index > 0) {
      context.strokeStyle = 'rgba(255, 246, 222, 0.28)';
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(centerX - 465, 2115);
      context.lineTo(centerX - 465, 2280);
      context.stroke();
    }
    context.fillStyle = palette.accent2;
    context.font = '900 43px Inter, Arial, sans-serif';
    context.fillText(heading, centerX, 2155);
    context.fillStyle = '#FFF7E5';
    context.font = '800 29px Inter, Arial, sans-serif';
    context.fillText(detail, centerX, 2243);
  });
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
  2A. **BACKGROUND VALIDATION**: All four canvas corners and every pixel outside the white die-cut border must be the same uniform #000000. Never render a white page, gray card, checkerboard, paper texture or photographic surface behind the sticker.
  3. **BORDER**: Add one clean MEDIUM-THIN white die-cut border surrounding the object. Target a consistent border width of approximately 2.5-3.5% of the sticker's shorter dimension. It must remain visible at thumbnail size but must not look chunky, puffy, or halo-like.
  3A. **EDGE QUALITY**: The outside of the white border must be perfectly clean, continuous, and crisp. NO gray rim, NO dotted/dashed cut line, NO glow, NO texture, NO drop shadow, and NO second outline.
  4. **NO CROPPING**: The object must be floating in the center with padding on all sides.
  5. **NO CARDS**: Do NOT place the sticker on a paper card or square backing. It must be floating in void.
  6. **NATURAL OPENINGS**: Preserve openings that physically belong to the subject, such as the center of a ring, frame, hose loop, chain link, wheel, handle or scissors. Fill every intended empty opening with the exact same flat pure black (#000000) as the outer background so post-processing can make it transparent. Do not invent decorative holes or break a normally solid object.
  7. **COLOR RULE**: Except for those intentional empty openings, NEVER use pure black (#000000) inside the sticker. Use dark gray (#1A1A1A) for outlines and dark details so artwork cannot be mistaken for removable background.
  8. **NO BLACK BLOBS**: Pure black is a removable matte color, not an artwork color. Do not place disconnected black spots, wedges, punctuation-like shapes or floating black islands anywhere inside the white border. Every pure-black interior area must be a clean physically meaningful opening bounded by the subject; otherwise render that area as normal colored artwork.
  
  ${strictConstraints}
  
  NEGATIVE PROMPT (AVOID): ${negativeKeywords}, sticker sheet, sticker set, grid, pattern, multiple items, collection, cropping, blurry, text watermark, white background, gray background, complex background, square crop, photo of a sticker on a table, realistic lighting on background, dark card backing, square paper behind sticker, accidental cutouts, unintended holes, random black blobs, floating black marks, broken silhouette, shadow, drop shadow, glow, oversized white border, extra-thick white outline, wide white halo, gray fringe, dotted outline, dashed cut line, textured edge.
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

const drawTransparencyGrid = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  size = 42
) => {
  for (let row = 0; row < Math.ceil(height / size); row++) {
    for (let column = 0; column < Math.ceil(width / size); column++) {
      context.fillStyle = (row + column) % 2 === 0 ? '#F8FAFC' : '#CBD5E1';
      context.fillRect(x + column * size, y + row * size, size, size);
    }
  }
};

const createQualityProofComposite = async (stickerUrls: string[], nicheName: string): Promise<string> => {
  const images = (await Promise.all(uniqueStickerUrls(stickerUrls).slice(0, 4).map(loadCanvasImage)))
    .filter((image): image is HTMLImageElement => Boolean(image?.width));
  if (!images.length) throw new Error('No valid stickers are available for the quality proof.');
  const canvas = document.createElement('canvas');
  canvas.width = 3000;
  canvas.height = 2400;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for the quality proof.');

  const background = context.createLinearGradient(0, 0, 3000, 2400);
  background.addColorStop(0, '#06172C');
  background.addColorStop(1, '#312E81');
  context.fillStyle = background;
  context.fillRect(0, 0, 3000, 2400);
  context.textAlign = 'center';
  context.fillStyle = '#67E8F9';
  context.font = '900 66px Inter, Arial, sans-serif';
  context.fillText('ACTUAL PNG QUALITY', 1500, 125);
  context.fillStyle = '#FFFFFF';
  context.font = '900 128px Inter, Arial, sans-serif';
  context.fillText('CLEAN TRANSPARENT EDGES', 1500, 275);
  context.fillStyle = '#CBD5E1';
  context.font = '700 42px Inter, Arial, sans-serif';
  context.fillText(`${nicheName.toUpperCase()} • ENLARGED DETAIL PREVIEW`, 1500, 365);

  const panels = [
    { x: 130, y: 500, w: 1320, h: 760, dark: false },
    { x: 1550, y: 500, w: 1320, h: 760, dark: true },
    { x: 130, y: 1360, w: 1320, h: 760, dark: true },
    { x: 1550, y: 1360, w: 1320, h: 760, dark: false }
  ];
  panels.forEach((panel, index) => {
    context.save();
    context.beginPath();
    context.roundRect(panel.x, panel.y, panel.w, panel.h, 70);
    context.clip();
    if (panel.dark) {
      context.fillStyle = '#020617';
      context.fillRect(panel.x, panel.y, panel.w, panel.h);
    } else {
      drawTransparencyGrid(context, panel.x, panel.y, panel.w, panel.h);
    }
    const image = images[index % images.length];
    const scale = Math.min((panel.w - 100) / image.width, (panel.h - 100) / image.height) * 1.12;
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, panel.x + (panel.w - width) / 2, panel.y + (panel.h - height) / 2, width, height);
    context.restore();
    context.strokeStyle = panel.dark ? '#38BDF8' : '#FFFFFF';
    context.lineWidth = 12;
    context.beginPath();
    context.roundRect(panel.x, panel.y, panel.w, panel.h, 70);
    context.stroke();
  });

  context.fillStyle = '#FFFFFF';
  context.font = '900 50px Inter, Arial, sans-serif';
  context.fillText('CHECKERBOARD = TRANSPARENCY  •  DARK PANELS REVEAL EDGE QUALITY', 1500, 2260);
  context.fillStyle = '#67E8F9';
  context.font = '800 38px Inter, Arial, sans-serif';
  context.fillText('ACTUAL FINISHED FILES SHOWN — NO REGENERATED PREVIEW ART', 1500, 2330);
  return canvas.toDataURL('image/jpeg', 0.94);
};

const createIncludedComposite = async (
  stickerUrls: string[],
  nicheName: string,
  totalStickerCount: number
): Promise<string> => {
  const images = (await Promise.all(uniqueStickerUrls(stickerUrls).slice(0, 8).map(loadCanvasImage)))
    .filter((image): image is HTMLImageElement => Boolean(image?.width));
  if (!images.length) throw new Error('No valid stickers are available for the included-files graphic.');
  const canvas = document.createElement('canvas');
  canvas.width = 3000;
  canvas.height = 2400;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for the included-files graphic.');
  const gradient = context.createLinearGradient(0, 0, 3000, 2400);
  gradient.addColorStop(0, '#0F766E');
  gradient.addColorStop(0.55, '#2563EB');
  gradient.addColorStop(1, '#7E22CE');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 3000, 2400);
  context.textAlign = 'center';
  context.fillStyle = '#FDE047';
  context.font = '900 62px Inter, Arial, sans-serif';
  context.fillText('EVERYTHING YOU RECEIVE', 1500, 135);
  context.fillStyle = '#FFFFFF';
  context.font = '900 128px Inter, Arial, sans-serif';
  context.fillText(`${totalStickerCount} INDIVIDUAL STICKERS`, 1500, 290);
  context.fillStyle = '#DBEAFE';
  context.font = '700 44px Inter, Arial, sans-serif';
  context.fillText(nicheName.toUpperCase(), 1500, 380);

  const facts = [
    [`${totalStickerCount}`, 'TRANSPARENT PNGS'],
    [`${Math.ceil(totalStickerCount / 20)}`, 'EASY ZIP DOWNLOADS'],
    ['20', 'PNG FILES PER ZIP'],
    ['READY', 'TO DRAG & RESIZE']
  ];
  facts.forEach(([value, label], index) => {
    const x = 150 + index * 710;
    context.fillStyle = 'rgba(255, 255, 255, 0.94)';
    context.beginPath();
    context.roundRect(x, 500, 610, 300, 58);
    context.fill();
    context.fillStyle = '#172554';
    context.font = '900 94px Inter, Arial, sans-serif';
    context.fillText(value, x + 305, 625);
    context.font = '900 32px Inter, Arial, sans-serif';
    context.fillText(label, x + 305, 730);
  });

  images.forEach((image, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const centerX = 470 + column * 690;
    const centerY = 1190 + row * 620;
    drawContainedSticker(context, image, centerX, centerY, 560, 520, (index % 2 ? 1 : -1) * 0.045, 1.1);
  });
  context.fillStyle = 'rgba(2, 6, 23, 0.86)';
  context.fillRect(0, 2220, 3000, 180);
  context.fillStyle = '#FFFFFF';
  context.font = '900 52px Inter, Arial, sans-serif';
  context.fillText('DIGITAL DOWNLOAD • INDIVIDUAL FILES • ACTUAL DESIGNS SHOWN', 1500, 2310);
  return canvas.toDataURL('image/jpeg', 0.94);
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
    if (type === 'cover') {
      const variant = id.endsWith('_b') ? 1 : id.endsWith('_c') ? 2 : 0;
      const coverCopy = getCoverCopy(niche);
      const stickerCount = Math.max(uniqueUrls.length, totalStickerCount);
      const artDirections = [
        'Create a cinematic luxury bestseller cover with a dominant central hero sticker, rich niche-matched atmosphere, dramatic depth and a dense but controlled supporting collage.',
        'Create a bright boutique editorial cover with tactile collage depth, sophisticated color contrast, energetic asymmetry and a premium handmade marketplace feel.',
        'Create a high-end modern catalog cover with elegant tonal depth, crisp hierarchy, balanced geometry and a polished commercial campaign finish.'
      ];
      const fullCoverPrompt = `Create the COMPLETE finished first-listing thumbnail for a premium Etsy digital sticker bundle. This is a final commercial cover, not a background template. Use the supplied 14 reference images as the actual sticker products.

PRODUCT THEME: ${niche}
ART DIRECTION: ${artDirections[variant]}

REFERENCE-STICKER RULES:
- Display all 14 supplied sticker references exactly once each.
- Make reference image 1 the largest central hero. Arrange the other 13 as a dense, exciting, professionally balanced supporting collage.
- Preserve each supplied sticker's recognizable subject, palette, internal artwork, white die-cut edge and proportions.
- Do not invent, duplicate, merge or substitute any sticker. Do not add background stickers, ghost stickers or partially hidden fake designs.
- Keep every sticker fully visible, uncropped and inside the composition.

RENDER THIS TEXT EXACTLY, LETTER FOR LETTER:
"DIGITAL STICKER BUNDLE"
"${coverCopy.title}"
"${coverCopy.subtitle}"
"${stickerCount} STICKERS"
"TRANSPARENT PNG • INSTANT DOWNLOAD"

TYPOGRAPHY AND SALES DESIGN:
- Seedream must create all typography, badges, panels, lighting, background and layout as one cohesive finished image.
- Make "${coverCopy.title}" the strongest headline, instantly readable at small marketplace-thumbnail size.
- Put "${stickerCount} STICKERS" in one clear premium quantity badge.
- Use excellent spacing, hierarchy and contrast. Typography must match the niche and feel expensive, not like a generic template.
- Do not add any other words, letters, prices, logos, watermarks, repeated headlines, faint background text or misspellings.

Landscape 4:3 render with all important text and products inside the central 90% safe area so it can be center-cropped slightly to 5:4. Outstanding high-conversion marketplace thumbnail, cohesive niche-specific art direction, polished professional advertising quality.`;
      try {
        const referenceImages = await Promise.all(
          uniqueUrls.slice(0, 14).map(url => imageUrlToDataUrl(url, 768))
        );
        const generatedCover = await generateSeedreamImage(fullCoverPrompt, '1K_LANDSCAPE', referenceImages);
        return finalizeGeneratedCover(generatedCover);
      } catch (error) {
        console.warn('Full Seedream cover generation failed; using the deterministic exact-pixel fallback.', error);
      }
      return createCoverComposite(uniqueUrls, niche, totalStickerCount, variant);
    }
    if (type === 'closeup' || id.includes('quality_proof')) return createQualityProofComposite(uniqueUrls, niche);
    if (type === 'included' || id.includes('included')) return createIncludedComposite(uniqueUrls, niche, totalStickerCount);
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

export const createListingPreviewVideo = async (
  imageUrls: string[]
): Promise<{ url: string; mimeType: string }> => {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot create a listing preview video.');
  const images = (await Promise.all(uniqueStickerUrls(imageUrls).slice(0, 5).map(loadCanvasImage)))
    .filter((image): image is HTMLImageElement => Boolean(image?.width));
  if (images.length < 2) throw new Error('At least two completed listing images are required for a preview video.');

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const context = canvas.getContext('2d');
  if (!context || !canvas.captureStream) throw new Error('Canvas video capture is unavailable in this browser.');
  const mimeType = [
    'video/mp4;codecs=avc1.42E01E',
    'video/webm;codecs=vp9',
    'video/webm'
  ].find(candidate => MediaRecorder.isTypeSupported(candidate)) || '';
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => {
    if (event.data.size) chunks.push(event.data);
  };
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('Browser video encoding failed.'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }));
  });

  const duration = 7200;
  const slideDuration = duration / images.length;
  const startedAt = performance.now();
  recorder.start(500);
  await new Promise<void>(resolve => {
    const draw = (timestamp: number) => {
      const elapsed = timestamp - startedAt;
      const slideIndex = Math.min(images.length - 1, Math.floor(elapsed / slideDuration));
      const slideProgress = (elapsed % slideDuration) / slideDuration;
      const image = images[slideIndex];
      context.fillStyle = '#020617';
      context.fillRect(0, 0, 1080, 1080);
      const coverScale = Math.max(1080 / image.width, 1080 / image.height) * (1 + slideProgress * 0.035);
      const width = image.width * coverScale;
      const height = image.height * coverScale;
      context.globalAlpha = Math.min(1, slideProgress * 5, (1 - slideProgress) * 5);
      context.drawImage(image, (1080 - width) / 2, (1080 - height) / 2, width, height);
      context.globalAlpha = 1;
      if (elapsed >= duration) {
        resolve();
        return;
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  });
  recorder.stop();
  const blob = await finished;
  stream.getTracks().forEach(track => track.stop());
  if (!blob.size) throw new Error('The listing preview video was empty.');
  return { url: URL.createObjectURL(blob), mimeType: blob.type || recorder.mimeType || 'video/webm' };
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
    prompt: `Research current Etsy and broader consumer trends for: ${query}.

Analyze two different opportunity lanes for a seller of 100-piece digital sticker bundles:
1. BROAD MONEY MARKETS: durable, recognizable buyer markets that can support at least 100 genuinely different designs, repeat purchases, and multiple product angles.
2. EMERGING MICRO TRENDS: timely, specific angles with visible momentum, each mapped to a broader parent market so the finished bundle does not become 100 repetitions of one tiny idea.

Use current public evidence such as marketplace activity, search interest, recent trend reports, social discovery signals, buyer use cases, and visible competition. Never invent sales figures, revenue, bestseller status, or trend evidence. Distinguish demand signals from guaranteed profit. Prefer generic, commercially usable subjects and flag trademark, fandom, celebrity, character, logo, or other IP risk. Summarize which broad markets look strongest, which micro angles can refresh them, who buys them, why they buy, competition pressure, and whether each has enough visual variety for 100 stickers.`,
    webSearch: true
  });
  return { answer: response.text || "No data.", sources: response.sources };
};

export const findViralNiche = async (): Promise<string> => {
  const response = await generateBrainText({
    prompt: `Research the strongest current production opportunity for a 100-piece digital sticker bundle.
Choose a BROAD buyer market with credible current demand signals, not a single meme, object, phrase, character, brand, or ultra-specific aesthetic. It must naturally support 100 distinct designs and multiple subthemes. It may include 3-5 timely micro-angles in parentheses to make the product current. Avoid protected brands, fandoms, celebrities, logos, and unsupported revenue claims. Return ONLY the concise production-ready niche name.`,
    webSearch: true
  });
  return response.text.trim().replace(/^["']|["']$/g, '') || "Trending";
};

export const discoverTopTrends = async (): Promise<DiscoveredTrend[]> => {
  const response = await generateBrainText({
    prompt: `Act as a cautious digital-product market researcher. Research current digital-sticker demand and return exactly 10 opportunities in this fixed balance:
- exactly 5 BROAD proven buyer markets
- exactly 5 EMERGING micro-trends

Broad markets must be recognizable shopping categories, have recurring buyer use cases, and comfortably support a coherent 100-sticker collection with high visual variety. Do not merely list five aesthetics.

Every micro-trend must name a broader parent niche and provide a productionNiche that expands the small trend into a sellable 100-design universe. For example, a single object, joke, phrase, or aesthetic is only one angle inside a broader buyer subject; it must not become the entire repetitive bundle.

Base demand on current public marketplace/search/trend evidence. evidenceSummary must state the observed signal without inventing unit sales, revenue, bestseller labels, or exact volume. Scores are comparative research judgments, not promises. Penalize saturated generic markets unless there is a distinct buyer/use-case angle. Exclude brands, copyrighted characters, celebrities, fandom names, logos, and unsafe trademark-dependent ideas.

For each opportunity:
- name is the concise trend or market label shown in the UI.
- scope is broad or micro.
- parentNiche is the durable umbrella buyer market (for broad items it may equal name).
- productionNiche is the exact rich niche passed to the 100-sticker generator; it must contain enough subthemes to prevent repetition.
- demandScore estimates strength of current evidence from 0-100.
- varietyScore estimates ability to create 100 distinct designs from 0-100; never return below 70.
- competition is low, medium, or high.
- whyItSells explains the buyer/use-case logic, not a guarantee.
- stylePrompt preserves one cohesive visual system while allowing varied subjects.

Order each lane from strongest opportunity to weakest.`,
    webSearch: true,
    schemaName: 'sticker_trends',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        trends: {
          type: 'array',
          minItems: 10,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              category: { type: 'string' },
              description: { type: 'string' },
              scope: { type: 'string', enum: ['broad', 'micro'] },
              parentNiche: { type: 'string' },
              productionNiche: { type: 'string' },
              targetBuyer: { type: 'string' },
              whyItSells: { type: 'string' },
              evidenceSummary: { type: 'string' },
              demandScore: { type: 'integer', minimum: 0, maximum: 100 },
              varietyScore: { type: 'integer', minimum: 70, maximum: 100 },
              competition: { type: 'string', enum: ['low', 'medium', 'high'] },
              styleName: { type: 'string' },
              stylePrompt: { type: 'string' }
            },
            required: ['name', 'category', 'description', 'scope', 'parentNiche', 'productionNiche', 'targetBuyer', 'whyItSells', 'evidenceSummary', 'demandScore', 'varietyScore', 'competition', 'styleName', 'stylePrompt']
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
