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

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
let lastSuccessfulRequestAt: string | null = null;

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
  '4K': '4096x4096'
}[size]);

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

const retryAfterMilliseconds = (response: Response) => {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};

const fetchWithRetry = async (url: string, init: RequestInit, attempts = 4): Promise<Response> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      const body = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts - 1) {
        throw new Error(`Seedream API ${response.status}: ${body.slice(0, 500)}`);
      }
      lastError = new Error(`Seedream API ${response.status}`);
      const serverDelay = retryAfterMilliseconds(response);
      const exponentialDelay = Math.min(6_000, 750 * (2 ** attempt));
      await sleep((serverDelay ?? exponentialDelay) + Math.floor(Math.random() * 280));
      continue;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }

    await sleep(Math.min(6_000, 750 * (2 ** attempt)) + Math.floor(Math.random() * 280));
  }

  throw lastError instanceof Error ? lastError : new Error('Seedream request failed.');
};

const remoteImageToDataUrl = async (url: string): Promise<string> => {
  const response = await fetchWithRetry(url, {}, 3);
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
  // Seedream 5 Pro accepts up to 14 reference images when producing one output
  // image (15 total input + output images per request).
  const inputImages = (request.images || []).slice(0, 14);
  const body: Record<string, unknown> = {
    model: getSeedreamModel(),
    prompt: request.prompt,
    size: sizeToPixels(request.size),
    output_format: 'png',
    watermark: false
  };

  if (inputImages.length === 1) body.image = inputImages[0];
  if (inputImages.length > 1) body.image = inputImages;

  const response = await fetchWithRetry(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json() as SeedreamResponse;
  const image = payload.data?.[0];
  const base64 = image?.b64_json || image?.base64;

  if (base64) {
    lastSuccessfulRequestAt = new Date().toISOString();
    return { dataUrl: `data:image/png;base64,${base64}` };
  }
  if (image?.url) {
    const dataUrl = await remoteImageToDataUrl(image.url);
    lastSuccessfulRequestAt = new Date().toISOString();
    return { dataUrl };
  }

  throw new Error(payload.error?.message || 'Seedream returned no image data.');
};
