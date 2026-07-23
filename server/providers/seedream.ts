import type { ImageRequest, ImageResult, ImageSize } from '../contracts.js';

interface SeedreamImageData {
  url?: string;
  b64_json?: string;
  base64?: string;
}

interface SeedreamResponse {
  data?: SeedreamImageData[];
  error?: { message?: string };
}

interface StickerMatteChoice {
  hex: string;
  label: string;
  avoid: RegExp;
}

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
let lastSuccessfulRequestAt: string | null = null;

const STICKER_MATTE_CHOICES: StickerMatteChoice[] = [
  {
    hex: '#00FF3B',
    label: 'electric key green',
    avoid: /\b(green|lime|emerald|mint|forest|leaf|leaves|foliage|grass|plant|nature|frog|cactus)\b/i
  },
  {
    hex: '#FF00D4',
    label: 'electric key magenta',
    avoid: /\b(pink|magenta|fuchsia|purple|violet|rose|candy|princess|unicorn|pastel)\b/i
  },
  {
    hex: '#00E5FF',
    label: 'electric key cyan',
    avoid: /\b(blue|cyan|aqua|turquoise|teal|ocean|water|ice|sky|snow)\b/i
  },
  {
    hex: '#FF5A00',
    label: 'electric key orange',
    avoid: /\b(red|orange|coral|fire|sunset|autumn|warm|gold)\b/i
  }
];

const getApiKey = () => (process.env.SEEDREAM_API_KEY || process.env.ARK_API_KEY)?.trim();
export const getSeedreamModel = () => process.env.SEEDREAM_MODEL?.trim() || 'dola-seedream-5-0-pro-260628';
export const getSeedreamMaxConcurrency = () => {
  const configured = Number.parseInt(process.env.SEEDREAM_MAX_CONCURRENCY || '10', 10);
  return Number.isFinite(configured) ? Math.max(1, Math.min(15, configured)) : 10;
};
export const isSeedreamConfigured = () => Boolean(getApiKey());
export const getSeedreamKeyHint = () => {
  const key = getApiKey();
  return key ? `...${key.slice(-4)}` : null;
};
export const getSeedreamKeySource = () => process.env.SEEDREAM_API_KEY?.trim()
  ? 'SEEDREAM_API_KEY'
  : process.env.ARK_API_KEY?.trim()
    ? 'ARK_API_KEY'
    : null;
export const getSeedreamLastSuccessfulRequestAt = () => lastSuccessfulRequestAt;

const sizeToPixels = (size: ImageSize = '2K') => ({
  '1K': '1024x1024',
  '1K_LANDSCAPE': '1152x864',
  '2K': '2048x2048',
  '2K_LANDSCAPE': '2048x1536',
  '4K': '4096x4096'
}[size]);

const chooseStickerMatte = (prompt: string) => {
  const scored = STICKER_MATTE_CHOICES.map((choice, index) => ({
    choice,
    score: choice.avoid.test(prompt) ? 100 + index : index
  }));
  scored.sort((left, right) => left.score - right.score);
  return scored[0].choice;
};

/**
 * Gives every raw sticker request one exact, reserved matte key. The browser
 * removes enclosed pixels only after it verifies this same key in all four
 * corners, so ordinary black artwork never becomes a background candidate.
 */
export const applyStickerReservedMatte = (prompt: string) => {
  if (!/GENERATE A RAW (?:VECTOR|DIGITAL) STICKER ASSET/i.test(prompt)) return prompt;
  const matte = chooseStickerMatte(prompt);
  const matteUpper = matte.label.toUpperCase();
  const rewritten = prompt
    .replace(/\{\{STICKER_MATTE_HEX\}\}/g, matte.hex)
    .replace(/\{\{STICKER_MATTE_LABEL\}\}/g, matteUpper)
    .replace(
      /SOLID BLACK HEX #000000\. DO NOT USE DARK GRAY\. DO NOT USE GRADIENTS\. MUST BE FLAT BLACK\./gi,
      `SOLID ${matteUpper} HEX ${matte.hex}. Use this exact technical key color with no gradient or variation.`
    )
    .replace(
      /CENTER MUST BE PURE BLACK \(#000000\)\. NO CONTENT INSIDE FRAME\./gi,
      `THE CENTER OPENING MUST SHOW THE EXACT RESERVED BACKGROUND KEY ${matte.hex}. NO CONTENT INSIDE THE OPENING.`
    )
    .replace(
      /\*\*NO INTERNAL HOLES\*\*: The object MUST be completely solid\. NO rings, NO chains, NO empty gaps inside\. Fill any natural holes with solid white or a matching color\./gi,
      `**INTENTIONAL OPENINGS**: Preserve physically meaningful openings in frames, rings, handles, arches, windows, loops and small gaps between parts. Fill every intended opening with ${matte.hex}. Do not create accidental holes in solid surfaces, bodies or faces.`
    )
    .replace(
      /\*\*COLOR RULE\*\*: Inside the sticker, NEVER use pure black \(#000000\)\. Use dark gray \(#1A1A1A\) for dark details so it does not blend with the background\./gi,
      `**RESERVED COLOR RULE**: Never use ${matte.hex} inside the artwork. Black and dark gray are valid for legitimate outlines, details and shadows.`
    )
    .replace(
      /, holes, loops, empty space inside, transparent gaps, rings, chains,/gi,
      ', accidental holes, corrupted voids, missing solid surfaces,'
    )
    .replace(
      /fill natural openings with white or a matching artwork color so background removal never has to infer interior holes/gi,
      `preserve physically meaningful openings and fill them with the exact reserved matte key ${matte.hex}`
    );

  return `${rewritten}

FINAL RESERVED-MATTE CONTRACT — THIS OVERRIDES ANY EARLIER BACKGROUND WORDING:
- The entire canvas background must be one perfectly uniform ${matte.label} (${matte.hex}).
- Every intentional empty opening or negative-space hole must show that exact same ${matte.hex}, including doorways, arches, handles, rings, windows and small spaces between structural parts.
- ${matte.hex} is a technical removal key, not an artwork color. Never use it in the illustration, white die-cut border, outlines, highlights, shadows, decorations or texture.
- Black and dark colors are valid artwork colors. Never use black as the canvas background or as a substitute fill for an intended transparent opening.
- Keep all four corners identical ${matte.hex}; no gradient, lighting, texture, vignette, noise or color variation in the matte.`;
};

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

const retryAfterMilliseconds = (response: Response) => {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};

const fetchWithRetry = async (url: string, init: RequestInit, attempts = 4): Promise<{ response: Response; attempts: number }> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message} [provider_attempts=${attempt + 1}]`);
      }
      await sleep(Math.min(6_000, 750 * (2 ** attempt)) + Math.floor(Math.random() * 280));
      continue;
    }

    if (response.ok) return { response, attempts: attempt + 1 };

    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts - 1) {
      throw new Error(`Seedream API ${response.status}: ${body.slice(0, 500)} [provider_attempts=${attempt + 1}]`);
    }
    lastError = new Error(`Seedream API ${response.status}`);
    const serverDelay = retryAfterMilliseconds(response);
    const exponentialDelay = Math.min(6_000, 750 * (2 ** attempt));
    await sleep((serverDelay ?? exponentialDelay) + Math.floor(Math.random() * 280));
  }

  throw lastError instanceof Error ? lastError : new Error('Seedream request failed.');
};

const remoteImageToDataUrl = async (url: string): Promise<string> => {
  const { response } = await fetchWithRetry(url, {}, 3);
  const mimeType = response.headers.get('content-type') || 'image/png';
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
};

export const generateSeedreamImage = async (request: ImageRequest): Promise<ImageResult> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('SEEDREAM_API_KEY (or ARK_API_KEY) is not configured on the server.');
  }
  if (!request.prompt?.trim()) {
    throw new Error('An image prompt is required.');
  }

  const baseUrl = (process.env.SEEDREAM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const inputImages = (request.images || []).slice(0, 14);
  const body: Record<string, unknown> = {
    model: getSeedreamModel(),
    prompt: applyStickerReservedMatte(request.prompt),
    size: sizeToPixels(request.size),
    output_format: 'png',
    watermark: false
  };

  if (inputImages.length === 1) body.image = inputImages[0];
  if (inputImages.length > 1) body.image = inputImages;

  const generation = await fetchWithRetry(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const { response, attempts } = generation;

  const payload = await response.json() as SeedreamResponse;
  const image = payload.data?.[0];
  const base64 = image?.b64_json || image?.base64;

  if (base64) {
    lastSuccessfulRequestAt = new Date().toISOString();
    return { dataUrl: `data:image/png;base64,${base64}`, attempts, model: getSeedreamModel(), provider: 'seedream' };
  }
  if (image?.url) {
    const dataUrl = await remoteImageToDataUrl(image.url);
    lastSuccessfulRequestAt = new Date().toISOString();
    return { dataUrl, attempts, model: getSeedreamModel(), provider: 'seedream' };
  }

  throw new Error(`${payload.error?.message || 'Seedream returned no image data.'} [provider_attempts=${attempts}]`);
};
