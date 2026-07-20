import type { ImageSize, NicheVisualAnalysis, StylePreset } from '../types';
import * as legacy from './aiServiceLegacy';
import { appendStickerQualityGuidelines, STICKER_GENERATION_QUALITY_COMPACT } from './stickerQualityGuidelines';

export * from './aiServiceLegacy';

const imageRequest=async(path:'/api/images/generate'|'/api/images/openai-cover',prompt:string,size:ImageSize,images:string[]=[]):Promise<string>=>