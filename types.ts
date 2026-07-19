
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
  generationBrief?: string;
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
  qaStatus?: 'pending' | 'approved' | 'rejected';
  qaIssues?: string[];
  qaScore?: number;
  perceptualHash?: string;
  replacementCount?: number;
  manuallyAccepted?: boolean;
}

export type ProductionRunMode = 'production' | 'test';

export interface StickerQaMetrics {
  width: number;
  height: number;
  transparentRatio: number;
  artworkRatio: number;
  softAlphaRatio: number;
  largestSolidBlackRatio: number;
  touchesCanvasEdge: boolean;
}

export interface QualityReport {
  checked: number;
  approved: number;
  rejected: number;
  duplicateGroups: number[][];
  generatedAt: string;
  manualOverrideCount?: number;
}

export interface AiUsageStageMetrics {
  openaiTextRequests: number;
  openaiImageRequests: number;
  openaiInputTokens: number;
  openaiOutputTokens: number;
  openaiTotalTokens: number;
  seedreamImageRequests: number;
  retryAttempts: number;
  failedRequests: number;
}

export interface ProductionMetrics {
  seedreamRequests: number;
  seedreamMockupRequests: number;
  replacementImages: number;
  rejectedImages: number;
  qaRuns: number;
  rateLimitEvents: number;
  openaiTextRequests: number;
  openaiImageRequests: number;
  openaiInputTokens: number;
  openaiOutputTokens: number;
  openaiTotalTokens: number;
  seedreamApiAttempts: number;
  retryAttempts: number;
  failedApiRequests: number;
  usageByStage: Record<string, AiUsageStageMetrics>;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface NichePreflight {
  demandScore: number;
  variationScore: number;
  saturation: 'low' | 'medium' | 'high';
  ipRisk: 'low' | 'medium' | 'high';
  recommendation: 'proceed' | 'review' | 'block';
  summary: string;
  reasons: string[];
  sources: { title: string; uri: string }[];
}

export interface AutopilotState {
  status: 'idle' | 'preflight' | 'researching' | 'generating_stickers' | 'quality_control' | 'zipping' | 'marketing' | 'copywriting' | 'paused' | 'completed' | 'error';
  currentNiche: NicheIdea | null;
  currentStyle: StylePreset | null;
  runMode: ProductionRunMode;
  targetCount: number;
  progress: number;
  stickers: Sticker[];
  zips: { name: string; blob: Blob }[];
  marketingAssets: MarketingAsset[];
  listing: GeneratedListing | null;
  logs: string[];
  qualityReport: QualityReport | null;
  metrics: ProductionMetrics;
  preflight: NichePreflight | null;
  checkpointUpdatedAt: string | null;
}

export interface MarketingAsset {
  id?: string;
  type: 'cover' | 'preview' | 'mockup' | 'goodnotes' | 'howto' | 'laptop' | 'phone' | 'journal' | 'lifestyle' | 'closeup' | 'social' | 'included' | 'thankyou';
  title: string;
  url: string | null;
  status: 'pending' | 'generating' | 'completed' | 'error';
  format?: 'image' | 'video';
  mimeType?: string;
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
  scope: 'broad' | 'micro';
  parentNiche: string;
  productionNiche: string;
  targetBuyer: string;
  whyItSells: string;
  evidenceSummary: string;
  demandScore: number;
  varietyScore: number;
  competition: 'low' | 'medium' | 'high';
  styleName: string;
  stylePrompt: string;
}

export type ImageSize = '1K' | '1K_LANDSCAPE' | '2K' | '2K_LANDSCAPE' | '4K';

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
