import OpenAI from 'openai';
import type { ApiTokenUsage, BrainRequest, BrainResult, SourceLink } from '../contracts.js';

type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

const DEFAULT_SYSTEM = `You are the reasoning engine for StickerOS, an Etsy digital-sticker production application.
Be commercially useful, specific, honest about uncertainty, and follow the requested output format exactly.`;

const getApiKey = () => process.env.OPENAI_API_KEY?.trim();
export const getOpenAIModel = () => process.env.OPENAI_MODEL?.trim() || 'gpt-5.6-terra';
export const getOpenAILightModel = () => process.env.OPENAI_LIGHT_MODEL?.trim() || 'gpt-5.6-luna';
export const isOpenAIConfigured = () => Boolean(getApiKey());
export const getOpenAIKeyHint = () => {
  const apiKey = getApiKey();
  return apiKey ? `...${apiKey.slice(-4)}` : null;
};
export const getOpenAIKeySource = () => process.env.OPENAI_API_KEY?.trim()
  ? 'OPENAI_API_KEY'
  : null;
let lastSuccessfulRequestAt: string | null = null;
export const getOpenAILastSuccessfulRequestAt = () => lastSuccessfulRequestAt;

const getReasoningEffort = (): ReasoningEffort => {
  const value = process.env.OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value || '')
    ? value as ReasoningEffort
    : 'low';
};

const extractSources = (response: unknown): SourceLink[] => {
  const links = new Map<string, SourceLink>();
  const output = (response as { output?: unknown[] })?.output || [];

  for (const item of output) {
    const content = (item as { content?: unknown[] })?.content || [];
    for (const part of content) {
      const annotations = (part as { annotations?: unknown[] })?.annotations || [];
      for (const annotation of annotations) {
        const citation = annotation as { type?: string; url?: string; title?: string };
        if (citation.type === 'url_citation' && citation.url) {
          links.set(citation.url, {
            title: citation.title || citation.url,
            uri: citation.url
          });
        }
      }
    }
  }

  return [...links.values()];
};

const normalizeUsage = (value: unknown): ApiTokenUsage | undefined => {
  const usage = value as {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | undefined;
  if (!usage) return undefined;
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const totalTokens = Number(usage.total_tokens || inputTokens + outputTokens);
  return { inputTokens, outputTokens, totalTokens };
};

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

export const generateBrainResponse = async (request: BrainRequest): Promise<BrainResult> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }

  if (!request.prompt && !request.messages?.length) {
    throw new Error('A prompt or at least one chat message is required.');
  }

  const tracked = createTrackedClient(apiKey);
  const imageInputs = (request.images || []).slice(0, 20);
  const input = imageInputs.length
    ? [
        ...(request.messages || []).map(message => ({ role: message.role, content: message.content })),
        {
          role: 'user' as const,
          content: [
            { type: 'input_text' as const, text: request.prompt || 'Analyze the supplied images.' },
            ...imageInputs.map(image => ({
              type: 'input_image' as const,
              image_url: image.dataUrl,
              detail: image.detail || 'original'
            }))
          ]
        }
      ]
    : request.messages?.length
      ? request.messages.map(message => ({ role: message.role, content: message.content }))
      : request.prompt!;

  const useLightTier = request.tier === 'light';
  let response;
  try {
    response = await tracked.client.responses.create({
      model: useLightTier ? getOpenAILightModel() : getOpenAIModel(),
      reasoning: { effort: useLightTier ? 'minimal' : getReasoningEffort() },
      instructions: request.system || DEFAULT_SYSTEM,
      input,
      tools: request.webSearch ? [{ type: 'web_search' }] : undefined,
      text: request.schema ? {
        format: {
          type: 'json_schema',
          name: request.schemaName || 'sticker_os_response',
          schema: request.schema,
          strict: true
        }
      } : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} [provider_attempts=${Math.max(1, tracked.getAttempts())}]`);
  }

  lastSuccessfulRequestAt = new Date().toISOString();

  return {
    text: response.output_text || '',
    sources: extractSources(response),
    usage: normalizeUsage(response.usage),
    model: response.model,
    attempts: Math.max(1, tracked.getAttempts())
  };
};
