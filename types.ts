
export enum NicheType {
  MEDICAL = 'Medical & Nursing',
  TEACHER = 'Teacher Planning',
  DARK_ACADEMIA = 'Dark Academia',
  COQUETTE = 'Coquette/Hyper-Feminine',
  CYBERPUNK = 'Cyberpunk/Synthwave',
  NEURODIVERGENT = 'Neurodivergent Support',
  OTHER = 'Other'
}

export interface GeneratedListing {
  title1: string;
  title2: string;
  title3: string;
  tags: string[];
  description: string;
  price: string;
  keywords: string[];
  category: string;
  materials: string;
  whatsIncluded: string[];
  howToDownload: string[];
  license: string;
}

export interface StylePreset {
  id: string;
  name: string;
  prompt: string;
  isNew?: boolean;
}

export interface NicheIdea {
  id: number;
  name: string;
  category: string;
  score?: number;
  status?: 'planned' | 'generated' | 'skipped';
  isNew?: boolean;
}

export interface Sticker {
  id: number;
  prompt: string;
  url: string | null;
  status: 'pending' | 'generating' | 'completed' | 'error';
  blob?: Blob; // JPG/PNG blob
  regenCount?: number; // Track how many times this specific sticker has been retried
}

export interface AutopilotState {
  status: 'idle' | 'researching' | 'generating_stickers' | 'zipping' | 'marketing' | 'copywriting' | 'completed' | 'error';
  currentNiche: NicheIdea | null;
  currentStyle: StylePreset | null;
  progress: number;
  stickers: Sticker[];
  zips: { name: string; blob: Blob }[];
  marketingAssets: MarketingAsset[];
  listing: GeneratedListing | null;
  logs: string[];
}

export interface MarketingAsset {
  id?: string;
  type: 'cover' | 'preview' | 'mockup' | 'goodnotes' | 'howto' | 'laptop' | 'phone' | 'journal' | 'lifestyle' | 'closeup' | 'social' | 'included' | 'thankyou';
  title: string;
  url: string | null;
  status: 'pending' | 'generating' | 'completed' | 'error';
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  isThinking?: boolean;
}

export interface TrendResult {
  answer: string;
  sources: { title: string; uri: string }[];
}

export interface DiscoveredTrend {
  name: string;
  category: string;
  description: string;
  styleName: string;
  stylePrompt: string;
}

export type ImageSize = '1K' | '2K' | '4K';

export interface RoadmapStep {
  day: string;
  phase: string;
  title: string;
  description: string;
  completed: boolean;
}

export interface NicheInfo {
  id: NicheType;
  title: string;
  description: string;
  keywords: string[];
  visuals: string;
  bundleStrategy: string;
}

export interface StickerBatch {
  themeName: string;
  status: 'pending' | 'generating' | 'zipping' | 'completed';
  stickers: { id: number; url: string; prompt: string }[];
  progress: number;
  zipBlob?: Blob;
}

export interface NicheVisualAnalysis {
  archetype: 'CHARACTER' | 'FRAME_OVERLAY' | 'FUNCTIONAL_LABEL' | 'TEXT_QUOTE' | 'OBJECT';
  visualStyle: string;
  keywords: string;
  negativeKeywords: string;
  safeGenerics: string;
  themeUniverse?: string;
  subthemes?: string;
  intentAndUse?: string;
  customerSearchBehavior?: string;
}
