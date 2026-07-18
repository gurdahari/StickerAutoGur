export type JsonSchema = Record<string, unknown>;

export interface SourceLink {
  title: string;
  uri: string;
}

export interface BrainMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BrainRequest {
  prompt?: string;
  messages?: BrainMessage[];
  system?: string;
  schema?: JsonSchema;
  schemaName?: string;
  webSearch?: boolean;
}

export interface BrainResult {
  text: string;
  sources: SourceLink[];
}

export type ImageSize = '1K' | '2K' | '4K';

export interface ImageRequest {
  prompt: string;
  size?: ImageSize;
  images?: string[];
}

export interface ImageResult {
  dataUrl: string;
}
