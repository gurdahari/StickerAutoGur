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

const getApiKey = () => (process.env.SEEDREAM_API_KEY || process.env.ARK_API_KEY)?.trim();
export const getSeedreamModel = () => process.env.SEEDREAM_MODEL?.trim() || 'dola-seedream-5-0-pro-260628';
export const isSeedreamConfigured = () => Boolean(getApiKey());

const sizeToPixels = (size: ImageSize = '2K') => ({
  '1K': '1024x1024',
  '2K': '2048x2048',
  '4K': '4096x4096'
}[size]);

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

const fetchWithRetry = async (url: string, init: RequestInit, attempts = 5): Promise<Response> => {
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
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }

    await sleep(1000 * (2 ** attempt));
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
  const inputImages = (request.images || []).slice(0, 10);
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

  if (base64) return { dataUrl: `data:image/png;base64,${base64}` };
  if (image?.url) return { dataUrl: await remoteImageToDataUrl(image.url) };

  throw new Error(payload.error?.message || 'Seedream returned no image data.');
};
