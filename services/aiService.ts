import type { ImageSize, NicheVisualAnalysis, StylePreset } from '../types';
import * as legacy from './aiServiceLegacy';
import { appendStickerQualityGuidelines, STICKER_GENERATION_QUALITY_COMPACT } from './stickerQualityGuidelines';

export * from './aiServiceLegacy';

// Listing video is intentionally disabled. The legacy Autopilot catches this
// immediately and continues to listing copy, so browser video rendering can
// never stall either a new run or a resumed run.
export const createListingPreviewVideo: typeof legacy.createListingPreviewVideo = async () => {
  throw new Error('Listing preview video generation is disabled.');
};

const imageRequest=async(path:'/api/images/generate'|'/api/images/openai-cover',prompt:string,size:ImageSize,images:string[]=[]):Promise<string>=>{
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,size,images})});
  const payload=await response.json().catch(()=>({})) as {dataUrl?:string;error?:string};
  if(!response.ok||!payload.dataUrl)throw new Error(payload.error||`Image request failed with status ${response.status}.`);
  return payload.dataUrl;
};

const toDataUrl=async(url:string,maxDimension=1200):Promise<string>=>{
  if(url.startsWith('data:'))return url;
  const response=await fetch(url);if(!response.ok)throw new Error('Could not prepare a completed sticker reference.');
  const blob=await response.blob();
  const raw=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const candidate=new Image();candidate.onload=()=>resolve(candidate);candidate.onerror=()=>reject(new Error('Could not decode sticker reference.'));candidate.src=raw;});
  const scale=Math.min(1,maxDimension/Math.max(image.width,image.height));if(scale>=0.999)return raw;
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const context=canvas.getContext('2d');if(!context)return raw;context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');
};

export const generateStickerPrompts=(niche:string,style:StylePreset,count=30,analysis?:NicheVisualAnalysis)=>legacy.generateStickerPrompts(niche,{...style,prompt:appendStickerQualityGuidelines(style.prompt)},count,analysis);
export const generateReplacementStickerPrompts=(niche:string,style:StylePreset,count:number,existingPrompts:string[],rejectedReasons:string[],analysis?:NicheVisualAnalysis)=>legacy.generateReplacementStickerPrompts(niche,{...style,prompt:appendStickerQualityGuidelines(style.prompt)},count,existingPrompts,rejectedReasons,analysis);
export const generateAutopilotSticker=(itemPrompt:string,stylePrompt:string,useTurbo=false,nicheContext='',analysis?:NicheVisualAnalysis)=>legacy.generateAutopilotSticker(itemPrompt,`${stylePrompt}\n\n${STICKER_GENERATION_QUALITY_COMPACT}`,useTurbo,nicheContext,analysis);

const openAICover=async(stickerUrls:string[],niche:string,totalStickerCount:number)=>{
  const references=await Promise.all(stickerUrls.slice(0,10).map(url=>toDataUrl(url,1000)));
  const compactNiche=niche.replace(/\s*\([^)]*\)\s*/g,' ').replace(/\s+/g,' ').trim();
  const prompt=`Create a premium, scroll-stopping Etsy MAIN LISTING THUMBNAIL for this exact product:

PRODUCT: ${totalStickerCount} digital stickers in the niche "${compactNiche}".

Use only the supplied finished sticker references as the real products. Preserve their subjects, colors, proportions, linework and white die-cut outlines. Use every visible design once only. Do not invent, duplicate, merge, redraw or replace stickers.

This must look like a high-converting Etsy product-cover graphic, not a plain lifestyle photograph and not merely stickers scattered on fabric.

MANDATORY TEXT — render it accurately, clearly and with correct spelling:
1. Large primary headline: "${compactNiche.toUpperCase()} STICKERS"
2. Prominent quantity badge: "${totalStickerCount} STICKERS"
3. Short product descriptor: "DIGITAL STICKER BUNDLE"
4. Compact benefit labels: "TRANSPARENT PNG", "INSTANT DOWNLOAD", and "DIGITAL PRODUCT"

LAYOUT AND HIERARCHY:
- Use a bold editorial marketplace layout inspired by successful digital-product thumbnails.
- Make the primary headline immediately readable at small Etsy thumbnail size.
- Place the quantity badge near the top corner or another high-visibility location.
- Feature 5–8 supplied stickers prominently, including one or two strong hero stickers and supporting designs with varied silhouettes.
- Add a clean compact bottom information strip for the three benefit labels.
- Use a niche-specific premium background, lighting and atmosphere that supports "${compactNiche}" without overpowering the product.
- Keep strong contrast, clear separation, balanced visual weight and comfortable spacing.
- Keep all essential text and stickers safely inside the final crop.

VISUAL TARGET:
The cover should instantly answer: what is this product, how many items are included, what file/product type is it, and why should the shopper click. It should feel polished, trustworthy, valuable and exciting.

AVOID:
plain sticker mockup, stickers merely lying on cloth, empty cinematic scene, text-free hero art, generic brochure, weak tiny typography, excessive clutter, unreadable text, fake logos, watermarks, invented stickers, duplicated stickers, unrelated objects, misspellings or extra unsupported claims.`;
  return imageRequest('/api/images/openai-cover',prompt,'2K_LANDSCAPE',references);
};

const basePrompt=(type:'laptop'|'journal')=>type==='laptop'
?`Create a premium square commercial product photograph of a generic unbranded modern silver laptop in a believable warm contemporary interior. Show the outside lid facing the camera and occupying most of the frame as a large clean uninterrupted sticker surface. The entire lid boundary must be clearly visible, with realistic perspective, soft natural daylight and tasteful shallow background depth. The lid must be completely blank: no logo, sticker, decal, writing or illustration.`
:`Create a premium square top-down commercial product photograph of an open unbranded cream-paper journal on a warm natural wooden desk. Both pages and the center binding must be fully visible, large and unobstructed, with realistic paper texture, soft natural daylight and restrained props only near the outer frame. The pages must be completely blank: no sticker, handwriting, printed line, logo, label or illustration.`;
const editPrompt=(type:'laptop'|'journal',count:number)=>type==='laptop'
?`Preserve reference image 1 as the exact base photograph. Attach the ${count} supplied finished sticker references naturally across the visible outer laptop lid only. Preserve every sticker's exact art, colors, proportions and white die-cut outline. Use each sticker once, with varied but believable scale and rotation, accurate lid perspective, subtle contact shadows and balanced empty areas. Every sticker must remain fully inside the physical lid with comfortable margin. No floating, cropped, duplicated, merged, invented or redrawn sticker. Do not add branding, logo, writing or extra objects. The result must look like authentic premium Etsy product photography.`
:`Preserve reference image 1 as the exact base photograph. Attach the ${count} supplied finished sticker references naturally across both journal pages. Preserve every sticker's exact art, colors, proportions and white die-cut outline. Use each sticker once, with believable scale, page perspective and subtle contact shadows. Distribute them attractively across both pages while keeping the center binding natural and avoiding overlaps across the fold. Every sticker must remain fully inside a page. No floating, cropped, duplicated, merged, invented or redrawn sticker. Do not add handwriting, fake text, branding or extra illustrations. The result must look like authentic premium Etsy product photography.`;
const lifestyle=async(type:'laptop'|'journal',urls:string[])=>{
  const base=await imageRequest('/api/images/generate',basePrompt(type),'2K');const selected=urls.slice(0,7);
  const references=[await toDataUrl(base,1600),...await Promise.all(selected.map(url=>toDataUrl(url,900)))];
  return imageRequest('/api/images/generate',editPrompt(type,selected.length),'2K',references);
};

export const generateSeedreamMockup=async(assetId:string,assetType:string,stickerUrls:string[],niche:string,totalStickerCount=stickerUrls.length):Promise<string>=>{
  const type=assetType.toLowerCase(),id=assetId.toLowerCase(),unique=[...new Set(stickerUrls.filter(Boolean))];
  if(!unique.length)throw new Error('No completed sticker references are available for this asset.');
  if(type==='cover'||id.includes('cover'))return openAICover(unique,niche,Math.max(totalStickerCount,unique.length));
  if(type==='laptop'||id.includes('laptop'))return lifestyle('laptop',unique);
  if(type==='journal'||id.includes('journal'))return lifestyle('journal',unique);
  return legacy.generateSeedreamMockup(assetId,assetType,unique,niche,totalStickerCount);
};