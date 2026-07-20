import OpenAI, { toFile } from 'openai';
import type { ApiTokenUsage, ImageRequest, ImageResult } from '../contracts.js';

const getApiKey = () => process.env.OPENAI_API_KEY?.trim();
export const getOpenAIImageModel = () => process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2';

const createTrackedClient = (apiKey: string) => {
  let attempts = 0;
  const trackedFetch: typeof fetch = async (input, init) => {
    attempts += 1;
    return fetch(input, init);
  };
  return {
    client: new OpenAI({ apiKey, fetch: trackedFetch }),
    getAttempts: () => attempts
  };
};

const normalizeUsage = (value: unknown): ApiTokenUsage | undefined => {
  const usage = value as {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
    output_tokens_details?: { text_tokens?: number; image_tokens?: number };
  } | undefined;
  if (!usage) return undefined;
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(usage.total_tokens || inputTokens + outputTokens),
    inputTextTokens: Number(usage.input_tokens_details?.text_tokens || 0),
    inputImageTokens: Number(usage.input_tokens_details?.image_tokens || 0),
    outputTextTokens: Number(usage.output_tokens_details?.text_tokens || 0),
    outputImageTokens: Number(usage.output_tokens_details?.image_tokens || 0)
  };
};

const dataUrlToUpload = async (dataUrl: string, index: number) => {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw new Error(`OpenAI cover reference ${index + 1} is not a valid base64 data URL.`);
  const mimeType = match[1];
  const extension = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
  return toFile(Buffer.from(match[2], 'base64'), `sticker-${index + 1}.${extension}`, { type: mimeType });
};

const supportsInputFidelity = (model: string) => model === 'gpt-image-1';

export const generateOpenAICover = async (request: ImageRequest): Promise<ImageResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');
  if (!request.prompt?.trim()) throw new Error('An OpenAI cover prompt is required.');

  const tracked = createTrackedClient(apiKey);
  const model = getOpenAIImageModel();
  try {
    const references = (request.images || []).slice(0, 10);
    const response = references.length
      ? await (tracked.client.images.edit as any)({
          model,
          image: await Promise.all(references.map(dataUrlToUpload)),
          prompt: request.prompt,
          ...(supportsInputFidelity(model) ? { input_fidelity: 'high' } : {}),
          size: '2048x1152',
          quality: 'high',
          output_format: 'jpeg',
          output_compression: 94
        })
      : await (tracked.client.images.generate as any)({
          model,
          prompt: request.prompt,
          size: '2048x1152',
          quality: 'high',
          output_format: 'jpeg',
          output_compression: 94
        });
    const base64 = response.data?.[0]?.b64_json;
    if (!base64) throw new Error('OpenAI returned no cover image data.');
    return {
      dataUrl: `data:image/jpeg;base64,${base64}`,
      usage: normalizeUsage(response.usage),
      model,
      attempts: Math.max(1, tracked.getAttempts()),
      provider: 'openai'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} [provider_attempts=${Math.max(1, tracked.getAttempts())}]`);
  }
};
