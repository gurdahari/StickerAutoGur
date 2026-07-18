import OpenAI from 'openai';
import type { BrainRequest, BrainResult, SourceLink } from '../contracts.js';

type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

const DEFAULT_SYSTEM = `You are the reasoning engine for StickerOS, an Etsy digital-sticker production application.
Be commercially useful, specific, honest about uncertainty, and follow the requested output format exactly.`;

const getApiKey = () => process.env.OPENAI_API_KEY?.trim();
export const getOpenAIModel = () => process.env.OPENAI_MODEL?.trim() || 'gpt-5.6';
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

export const generateBrainResponse = async (request: BrainRequest): Promise<BrainResult> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }

  if (!request.prompt && !request.messages?.length) {
    throw new Error('A prompt or at least one chat message is required.');
  }

  const client = new OpenAI({ apiKey });
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

  const response = await client.responses.create({
    model: getOpenAIModel(),
    reasoning: { effort: getReasoningEffort() },
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

  lastSuccessfulRequestAt = new Date().toISOString();

  return {
    text: response.output_text || '',
    sources: extractSources(response)
  };
};
