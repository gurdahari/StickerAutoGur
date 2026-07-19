export type JsonSchema = Record<string, unknown>;

export interface SourceLink {
  title: string;
  uri: string;
}

export interface BrainMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BrainImageInput {
  dataUrl: string;
  detail?: 'low' | 'high' | 'original' | 'auto';
}

export interface BrainRequest {
  prompt?: string;
  messages?: BrainMessage[];
  system?: string;
  tier?: 'standard' | 'light';
  schema?: JsonSchema;
  schemaName?: string;
  webSearch?: boolean;
  images?: BrainImageInput[];
}

export interface ApiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTextTokens?: number;
  inputImageTokens?: number;
  outputTextTokens?: number;
  outputImageTokens?: number;
}

export interface BrainResult {
  text: string;
  sources: SourceLink[];
  usage?: ApiTokenUsage;
  model?: string;
  attempts?: number;
}

export type ImageSize = '1K' | '1K_LANDSCAPE' | '2K' | '2K_LANDSCAPE' | '4K';

export interface ImageRequest {
  prompt: string;
  size?: ImageSize;
  images?: string[];
}

export interface ImageResult {
  dataUrl: string;
  usage?: ApiTokenUsage;
  model?: string;
  attempts?: number;
  provider?: 'openai' | 'seedream';
}
