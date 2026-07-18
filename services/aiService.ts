import type { GeneratedListing, ImageSize, TrendResult, StylePreset, DiscoveredTrend, NicheVisualAnalysis, NicheType } from "../types";

type JsonSchema = Record<string, unknown>;

interface BrainResult {
  text: string;
  sources: { title: string; uri: string }[];
}

interface ProviderHealth {
  status: string;
  providers: {
    openai: { configured: boolean; model: string };
    seedream: { configured: boolean; model: string };
  };
}

const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `API request failed with status ${response.status}.`);
  }
  return payload;
};

const generateBrainText = async (options: {
  prompt?: string;
  messages?: { role: 'user' | 'assistant'; content: string }[];
  schema?: JsonSchema;
  schemaName?: string;
  webSearch?: boolean;
  chat?: boolean;
}): Promise<BrainResult> => apiRequest<BrainResult>(options.chat ? '/api/brain/chat' : '/api/brain/generate', {
  method: 'POST',
  body: JSON.stringify(options)
});

const generateSeedreamImage = async (
  prompt: string,
  size: ImageSize = '2K',
  images: string[] = []
): Promise<string> => {
  const response = await apiRequest<{ dataUrl: string }>('/api/images/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, size, images })
  });
  return response.dataUrl;
};

export const ensureProvidersConfigured = async (): Promise<ProviderHealth> => {
  const health = await apiRequest<ProviderHealth>('/api/health');
  const missing = [
    !health.providers.openai.configured && 'OPENAI_API_KEY',
    !health.providers.seedream.configured && 'SEEDREAM_API_KEY'
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`Missing server configuration: ${missing.join(', ')}.`);
  }
  return health;
};

const uniqueStickerUrls = (urls: string[]) => [...new Set(urls.filter(Boolean))];

const loadCanvasImage = (url: string): Promise<HTMLImageElement | null> => new Promise(resolve => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = url;
});

const drawContainedSticker = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  centerX: number,
  centerY: number,
  maxWidth: number,
  maxHeight: number,
  rotation = 0,
  shadowScale = 1
) => {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.save();
  context.translate(centerX, centerY);
  context.rotate(rotation);
  context.shadowColor = 'rgba(3, 7, 18, 0.42)';
  context.shadowBlur = 34 * shadowScale;
  context.shadowOffsetY = 18 * shadowScale;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, -width / 2, -height / 2, width, height);
  context.restore();
};

const fitText = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxFontSize: number,
  minFontSize: number,
  weight = 900
) => {
  let fontSize = maxFontSize;
  do {
    context.font = `${weight} ${fontSize}px Inter, Arial, sans-serif`;
    fontSize -= 4;
  } while (fontSize > minFontSize && context.measureText(text).width > maxWidth);
};

const createCoverComposite = async (stickerUrls: string[], nicheName: string, totalStickerCount: number): Promise<string> => {
  const uniqueUrls = uniqueStickerUrls(stickerUrls).slice(0, 15);
  const images = (await Promise.all(uniqueUrls.map(loadCanvasImage)))
    .filter((image): image is HTMLImageElement => Boolean(image?.width));
  if (!images.length) throw new Error('No valid stickers are available for the cover.');

  const canvas = document.createElement('canvas');
  const size = 3000;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for cover generation.');

  const background = context.createLinearGradient(0, 0, size, size);
  background.addColorStop(0, '#071827');
  background.addColorStop(0.52, '#123b55');
  background.addColorStop(1, '#321b4d');
  context.fillStyle = background;
  context.fillRect(0, 0, size, size);

  const glowLeft = context.createRadialGradient(400, 1200, 0, 400, 1200, 1200);
  glowLeft.addColorStop(0, 'rgba(34, 211, 238, 0.25)');
  glowLeft.addColorStop(1, 'rgba(34, 211, 238, 0)');
  context.fillStyle = glowLeft;
  context.fillRect(0, 0, size, size);

  const glowRight = context.createRadialGradient(2600, 1500, 0, 2600, 1500, 1300);
  glowRight.addColorStop(0, 'rgba(244, 114, 182, 0.22)');
  glowRight.addColorStop(1, 'rgba(244, 114, 182, 0)');
  context.fillStyle = glowRight;
  context.fillRect(0, 0, size, size);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#F8FAFC';
  const title = (nicheName || 'Premium').trim().toUpperCase();
  fitText(context, title, 2600, 220, 92);
  context.shadowColor = 'rgba(0, 0, 0, 0.45)';
  context.shadowBlur = 24;
  context.fillText(title, size / 2, 220);
  context.shadowBlur = 0;
  context.fillStyle = '#67E8F9';
  context.font = '800 105px Inter, Arial, sans-serif';
  context.fillText('DIGITAL STICKER BUNDLE', size / 2, 430);

  const stickerCount = Math.max(images.length, totalStickerCount);
  if (images.length <= 6) {
    const slots = [
      { x: 1500, y: 1660, w: 1160, h: 1160, r: 0 },
      { x: 590, y: 1110, w: 760, h: 760, r: -0.12 },
      { x: 2380, y: 1110, w: 760, h: 760, r: 0.12 },
      { x: 630, y: 2150, w: 760, h: 760, r: 0.1 },
      { x: 2370, y: 2150, w: 760, h: 760, r: -0.1 },
      { x: 1500, y: 2380, w: 650, h: 650, r: 0.05 }
    ];
    for (let index = images.length - 1; index >= 1; index--) {
      const slot = slots[index];
      drawContainedSticker(context, images[index], slot.x, slot.y, slot.w, slot.h, slot.r, 1.25);
    }
    const hero = slots[0];
    drawContainedSticker(context, images[0], hero.x, hero.y, hero.w, hero.h, hero.r, 1.45);
  } else {
    const columns = images.length >= 13 ? 5 : 4;
    const rows = Math.ceil(images.length / columns);
    const regionX = 190;
    const regionY = 690;
    const regionWidth = 2620;
    const regionHeight = 1840;
    const cellWidth = regionWidth / columns;
    const cellHeight = regionHeight / rows;
    const rotations = [-0.1, 0.06, -0.04, 0.09, -0.07];
    images.forEach((image, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      drawContainedSticker(
        context,
        image,
        regionX + cellWidth * (column + 0.5),
        regionY + cellHeight * (row + 0.5),
        cellWidth * 0.94,
        cellHeight * 0.94,
        rotations[index % rotations.length],
        1.05
      );
    });
  }

  // Draw the quantity badge last so sticker art can never obscure its text.
  context.save();
  context.translate(2570, 655);
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = 24;
  context.fillStyle = '#FDE047';
  context.strokeStyle = '#FFFFFF';
  context.lineWidth = 18;
  context.beginPath();
  context.arc(0, 0, 225, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = '#111827';
  context.font = '900 130px Inter, Arial, sans-serif';
  context.fillText(String(stickerCount), 0, -35);
  context.font = '800 54px Inter, Arial, sans-serif';
  context.fillText(stickerCount === 1 ? 'STICKER' : 'STICKERS', 0, 70);
  context.restore();

  context.fillStyle = 'rgba(2, 6, 23, 0.88)';
  context.fillRect(0, 2700, size, 300);
  context.fillStyle = '#FFFFFF';
  context.font = '900 74px Inter, Arial, sans-serif';
  context.fillText('ACTUAL DESIGNS SHOWN • NO DUPLICATES', size / 2, 2790);
  context.fillStyle = '#CBD5E1';
  context.font = '700 56px Inter, Arial, sans-serif';
  context.fillText('HIGH-RES TRANSPARENT PNG • INSTANT DOWNLOAD', size / 2, 2900);

  return canvas.toDataURL('image/jpeg', 0.94);
};

// Seedream creates only the empty lifestyle scene. Exact sticker pixels are
// composited afterward in Canvas so the model cannot redraw or duplicate them.
const createHybridMockup = async (backgroundUrl: string, stickerUrls: string[], type: string): Promise<string> => {
  const [backgroundImage, loadedStickers] = await Promise.all([
    loadCanvasImage(backgroundUrl),
    Promise.all(uniqueStickerUrls(stickerUrls).map(loadCanvasImage))
  ]);
  if (!backgroundImage) throw new Error('Failed to load the mockup background.');

  const stickers = loadedStickers.filter((image): image is HTMLImageElement => Boolean(image?.width));
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 2048;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for mockup generation.');

  const backgroundScale = Math.max(canvas.width / backgroundImage.width, canvas.height / backgroundImage.height);
  const backgroundWidth = backgroundImage.width * backgroundScale;
  const backgroundHeight = backgroundImage.height * backgroundScale;
  context.drawImage(
    backgroundImage,
    (canvas.width - backgroundWidth) / 2,
    (canvas.height - backgroundHeight) / 2,
    backgroundWidth,
    backgroundHeight
  );

  const region = type === 'laptop'
    ? { x: 500, y: 620, width: 1040, height: 760, columns: 3 }
    : type === 'goodnotes' || type === 'journal'
      ? { x: 470, y: 500, width: 1110, height: 1050, columns: 3 }
      : { x: 300, y: 360, width: 1448, height: 1320, columns: 3 };
  const rows = Math.max(1, Math.ceil(stickers.length / region.columns));
  const cellWidth = region.width / region.columns;
  const cellHeight = region.height / rows;
  const rotations = [-0.08, 0.04, 0.09, -0.05, 0.02];

  stickers.forEach((sticker, index) => {
    const column = index % region.columns;
    const row = Math.floor(index / region.columns);
    drawContainedSticker(
      context,
      sticker,
      region.x + cellWidth * (column + 0.5),
      region.y + cellHeight * (row + 0.5),
      cellWidth * 0.88,
      cellHeight * 0.88,
      rotations[index % rotations.length],
      0.55
    );
  });

  context.fillStyle = 'rgba(15, 23, 42, 0.78)';
  context.fillRect(0, 1900, 2048, 148);
  context.fillStyle = '#FFFFFF';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '800 48px Inter, Arial, sans-serif';
  context.fillText('ACTUAL STICKER DESIGNS', 1024, 1974);

  return canvas.toDataURL('image/jpeg', 0.92);
};

// --- GRID PREVIEW ---
// UPDATED: 3000x3000px Ultra HD + Smart Centering for Last Row
const createGridComposite = async (stickerUrls: string[]): Promise<string> => {
    return new Promise((resolve) => {
        try {
            const canvas = document.createElement('canvas');
            const CTX_SIZE = 3000; // Ultra High Res
            canvas.width = CTX_SIZE;
            canvas.height = CTX_SIZE;
            const ctx = canvas.getContext('2d');
            
            if (!ctx) { 
                console.error("No canvas context");
                resolve(""); 
                return; 
            }

            // White Background
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, CTX_SIZE, CTX_SIZE);

            const validUrls = uniqueStickerUrls(stickerUrls);
            const count = validUrls.length;

            if (count === 0) {
                // Placeholder
                ctx.fillStyle = "#F3F4F6";
                ctx.fillRect(0,0,CTX_SIZE,CTX_SIZE);
                ctx.fillStyle = "#9CA3AF";
                ctx.font = "100px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("NO STICKERS SELECTED", CTX_SIZE/2, CTX_SIZE/2);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
                return;
            }

            // DYNAMIC GRID CALCULATION
            const COLS = Math.ceil(Math.sqrt(count));
            const ROWS = Math.ceil(count / COLS);
            
            // Calculate Cell Size
            const CELL_WIDTH = CTX_SIZE / COLS;
            const CELL_HEIGHT = CTX_SIZE / ROWS;
            
            // Tight Padding to make stickers HUGE
            const PADDING = 30; 

            const loadPromises = validUrls.map(url => {
                return new Promise<HTMLImageElement>((res) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => res(img);
                    img.onerror = () => res(new Image()); 
                    img.src = url;
                });
            });

            Promise.all(loadPromises).then(images => {
                images.forEach((img, i) => {
                    if (!img.width) return;
                    
                    const col = i % COLS;
                    const row = Math.floor(i / COLS);
                    
                    // SMART CENTERING FOR LAST ROW
                    // If this is the last row, and it's not full, calculate offset
                    let xOffset = 0;
                    if (row === ROWS - 1) {
                         const itemsInLastRow = count % COLS || COLS;
                         if (itemsInLastRow < COLS) {
                             const totalRowWidth = itemsInLastRow * CELL_WIDTH;
                             const emptySpace = CTX_SIZE - totalRowWidth;
                             xOffset = emptySpace / 2;
                         }
                    }

                    const x = col * CELL_WIDTH + PADDING + xOffset;
                    const y = row * CELL_HEIGHT + PADDING;
                    
                    const maxW = CELL_WIDTH - (PADDING * 2);
                    const maxH = CELL_HEIGHT - (PADDING * 2);

                    // Scale to fit within the cell
                    const scale = Math.min(maxW / img.width, maxH / img.height);
                    const w = img.width * scale;
                    const h = img.height * scale;
                    
                    // Center in cell (Vertical + Horizontal within cell)
                    const cellOffsetX = (maxW - w) / 2;
                    const cellOffsetY = (maxH - h) / 2;

                    ctx.save();
                    // Softer shadow for grid view
                    ctx.shadowColor = "rgba(0,0,0,0.15)";
                    ctx.shadowBlur = 20;
                    ctx.shadowOffsetX = 5;
                    ctx.shadowOffsetY = 10;
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, x + cellOffsetX, y + cellOffsetY, w, h);
                    ctx.restore();
                });

                // Footer Text
                ctx.fillStyle = "rgba(0,0,0,0.8)";
                ctx.font = "bold 80px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("PREMIUM STICKER COLLECTION", CTX_SIZE/2, CTX_SIZE - 80);
                
                ctx.fillStyle = "rgba(0,0,0,0.4)";
                ctx.font = "50px Inter, sans-serif";
                ctx.fillText("HIGH-RES TRANSPARENT PNG • INSTANT DOWNLOAD", CTX_SIZE/2, CTX_SIZE - 180);

                resolve(canvas.toDataURL('image/jpeg', 0.90));
            }).catch(e => {
                console.error("Grid generation failed", e);
                resolve(""); 
            });
        } catch (e) {
            console.error("Canvas crash", e);
            resolve("");
        }
    });
};

// --- Autopilot Logic ---

export const analyzeNichePotential = async (nicheName: string): Promise<number> => {
  try {
      const response = await generateBrainText({
        prompt: `Analyze the Etsy sales potential for digital stickers in the niche: "${nicheName}".
        Return a single integer score from 0 to 100 based on Demand, Competition, and Trendiness.
        0 = Terrible, 100 = Guaranteed Bestseller.
        Return ONLY the number.`,
      });
      const score = parseInt(response.text.trim() || "50");
      return isNaN(score) ? 50 : score;
  } catch (e) {
      return 50;
  }
};

export const analyzeNicheVisuals = async (nicheName: string): Promise<NicheVisualAnalysis> => {
  // CRITICAL UPDATE: DEEP VISUAL INVESTIGATION
  // Removed "cute/kawaii" bias. Added logic to detect specific aesthetics like Analog, Grunge, Corporate, etc.
  const prompt = `
  ACT AS A SENIOR ART DIRECTOR FOR ETSY.
  
  TASK: Perform a deep visual audit of the niche: "${nicheName}".
  
  OBJECTIVE: Determine the EXACT visual aesthetic that real buyers in this niche want.
  ALSO: Understand deeply what customers search for in this niche, and the different intents and uses of the stickers (not just visual).
  
  SCENARIO EXAMPLES:
  - If niche is "Kodak Portra" -> Aesthetic is "Analog Film, Grainy, Retro, Realistic, Muted". NOT Kawaii.
  - If niche is "Cyberpunk" -> Aesthetic is "Neon, Glitch, High-Tech, Dark". NOT Pastel.
  - If niche is "Kindergarten Teacher" -> Aesthetic is "Cute, Crayon, Primary Colors".
  
  JSON RESPONSE REQUIRED:
  {
    "archetype": "OBJECT" | "CHARACTER" | "FRAME_OVERLAY" | "FUNCTIONAL_LABEL" | "TEXT_QUOTE",
    "visualStyle": "A short, punchy phrase describing the art style (e.g. 'Vintage Film Grain' or 'Flat Vector Kawaii')",
    "keywords": "Comma-separated visual adjectives (e.g. 'grainy, analog, muted' or 'pastel, cute, round')",
    "negativeKeywords": "What to AVOID? (e.g. 'vector, cartoon, flat' if analog, or 'realistic, dark' if kawaii)",
    "safeGenerics": "5 generic items that fit this theme",
    "intentAndUse": "Describe the different intents and practical uses for these stickers (e.g., planner decoration, laptop decals, functional tracking, emotional expression).",
    "customerSearchBehavior": "What specific terms and concepts do customers search for when looking for this?"
  }
  `;

  try {
      const response = await generateBrainText({
        prompt,
        schemaName: 'niche_visual_analysis',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            archetype: { type: 'string', enum: ['CHARACTER', 'FRAME_OVERLAY', 'FUNCTIONAL_LABEL', 'TEXT_QUOTE', 'OBJECT'] },
            visualStyle: { type: 'string' },
            keywords: { type: 'string' },
            negativeKeywords: { type: 'string' },
            safeGenerics: { type: 'string' },
            intentAndUse: { type: 'string' },
            customerSearchBehavior: { type: 'string' }
          },
          required: ['archetype', 'visualStyle', 'keywords', 'negativeKeywords', 'safeGenerics', 'intentAndUse', 'customerSearchBehavior']
        }
      });
      return JSON.parse(response.text.trim());
  } catch (e) {
      console.error("Failed to parse visual analysis", e);
      return { 
          archetype: 'OBJECT', 
          keywords: 'aesthetic, sticker', 
          negativeKeywords: 'ugly', 
          safeGenerics: 'star, heart',
          visualStyle: 'Standard Vector' // Fallback
      } as any;
  }
};

export const generateStickerPrompts = async (niche: string, style: StylePreset, count: number = 30, analysis?: NicheVisualAnalysis): Promise<string[]> => {
  const COUNT = count;
  
  let analysisContext = "";
  if (analysis) {
      // ENFORCE ANALYSIS: If analysis says "Analog", we MUST NOT generate cartoons.
      analysisContext = `
      STRICT VISUAL DIRECTION (DO NOT IGNORE):
      - Visual Style: ${analysis['visualStyle']}
      - Must Include Keywords: ${analysis.keywords}
      - STRICTLY AVOID: ${analysis.negativeKeywords}
      - Intent and Use: ${analysis.intentAndUse || 'General decoration'}
      - Customer Search Behavior: ${analysis.customerSearchBehavior || 'General sticker search'}
      `;
  }

  // MASTER PROMPT: DYNAMIC "BEST SELLER" LOGIC
  const prompt = `
    ACT AS A SENIOR ART DIRECTOR.
    TASK: Generate exactly ${COUNT} distinct commercial sticker design concepts for: "${niche}".
    BASE STYLE PRESET: ${style.name}
    
    ${analysisContext}

    CRITICAL RULES:
    1. **SINGLE OBJECTS ONLY**: Describe ONE specific, standalone item per sticker.
    2. **NO COLLECTIONS**: Do NOT write prompts for "sticker sheets", "sets", "packs", or "collections".
    3. **BE SPECIFIC**: Instead of "medical equipment", say "A blue stethoscope".
    
    GOAL: Create a high-value sticker pack that EXACTLY matches the target aesthetic AND the customer's intent. 
    If the style is "Analog Film", generate film strips, cameras, light leaks.
    If the style is "Kawaii", generate cute characters.
    Make sure the stickers reflect the "Intent and Use" and "Customer Search Behavior" provided above.
    
    CRITICAL RATIOS:
    - 40% CORE OBJECTS (The "Meat" of the pack: Tools, Symbols, Items)
    - 20% THEMATIC ELEMENTS (Background textures, abstract shapes if applicable)
    - 20% FUNCTIONAL/DECORATIVE (Frames, Washi tape, functional labels, trackers, etc. that match the style and intent)
    - 20% EMOTIONAL/EXPRESSIVE (Quotes, text snippets, character expressions, mood indicators)

    DESIGN RULES:
    1. RELEVANCE: Generate items highly specific to "${niche}".
    2. VARIETY: Every concept must have a different primary subject. Do not repeat the same object, character, quote, pose, or composition.
    3. SEMANTIC UNIQUENESS: Rewording an existing idea does not make it new. Each design must be visibly distinguishable at thumbnail size.
    4. STYLE CONSISTENCY: All items must look like they belong in the same pack.

    OUTPUT FORMAT:
    Return a JSON object with a "prompts" array containing exactly ${COUNT} strings.
    Each string must follow this structure exactly:
    "TYPE: [Type] | SUBJECT: [Subject Description] | COMPOSITION: [Layout] | TEXT: '[Text]'"
  `;

  try {
      const response = await generateBrainText({
        prompt,
        schemaName: 'sticker_concepts',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prompts: {
              type: 'array',
              items: { type: 'string' },
              minItems: COUNT,
              maxItems: COUNT
            }
          },
          required: ['prompts']
        }
      });
      const parsed = JSON.parse(response.text.trim()) as { prompts: string[] };
      const seen = new Set<string>();
      const uniquePrompts = parsed.prompts.filter(candidate => {
        const normalized = candidate.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
      while (uniquePrompts.length < COUNT) {
        const variation = uniquePrompts.length + 1;
        uniquePrompts.push(`TYPE: Object-Only | SUBJECT: A unique ${niche} concept number ${variation} with a primary subject not used elsewhere | COMPOSITION: Centered isolated design | TEXT: NONE`);
      }
      return uniquePrompts.slice(0, COUNT);
  } catch (e) {
      console.error(`Failed to parse prompts`, e);
      return Array.from({ length: COUNT }, (_, index) => `TYPE: Object-Only | SUBJECT: A unique ${niche} concept number ${index + 1} | COMPOSITION: Centered isolated design | TEXT: NONE`);
  }
};

export const generate50StickerPrompts = async (niche: string, style: StylePreset) => {
    return generateStickerPrompts(niche, style);
};

export const generateAutopilotSticker = async (
  itemPrompt: string,
  stylePrompt: string,
  useTurbo: boolean = false,
  nicheContext: string = "",
  analysis?: NicheVisualAnalysis
): Promise<string> => {
  // --- SMART PROMPT PARSER ---
  let cleanSubject = itemPrompt;
  let cleanType = "";
  let cleanComp = "";
  let cleanText = "";

  if (itemPrompt.includes("|")) {
      const parts = itemPrompt.split("|").map(s => s.trim());
      parts.forEach(p => {
          if (p.startsWith("TYPE:")) cleanType = p.replace("TYPE:", "").trim();
          else if (p.startsWith("SUBJECT:")) cleanSubject = p.replace("SUBJECT:", "").trim();
          else if (p.startsWith("COMPOSITION:")) cleanComp = p.replace("COMPOSITION:", "").trim();
          else if (p.startsWith("TEXT:")) cleanText = p.replace("TEXT:", "").replace(/['"]/g, "").trim();
      });
  }

  // --- DYNAMIC VISUAL DESCRIPTION (REPLACES HARDCODED 'CUTE') ---
  let visualDescription = "";
  let strictConstraints = "";

  const isFrame = cleanType.toUpperCase().includes('FRAME') || (analysis?.archetype === 'FRAME_OVERLAY');
  
  if (isFrame) {
      // IF FRAME: Force center to be PURE WHITE. The Luma Keyer (set to > 65) will NOT delete white.
      // BUT, we actually want the center to be REMOVED.
      // TRICK: We tell AI to make the center a specific "Key Color" or just rely on Black background.
      visualDescription = `A TOP-DOWN view of a ${cleanSubject} frame overlay.`;
      strictConstraints = `CENTER MUST BE PURE BLACK (#000000). NO CONTENT INSIDE FRAME.`;
  } else {
      visualDescription = `A SINGLE, ISOLATED vector sticker design of ${cleanSubject}.`;
  }

  // Determine aesthetic vibe from analysis or default
  const aestheticKeywords = analysis ? analysis.keywords : "clean, vector, commercial";
  const negativeKeywords = analysis ? analysis.negativeKeywords : "blurry, low quality";
  const textInstruction = cleanText && cleanText.toUpperCase() !== 'NONE'
    ? `Render exactly this text and no other words: "${cleanText}". Spelling must be exact.`
    : 'NO TEXT: Do not render any words, letters, numbers, labels, logos, signatures, or watermarks anywhere in the sticker.';

  const fullPrompt = `
  GENERATE A RAW VECTOR STICKER ASSET (NOT A PHOTO OF A STICKER).
  
  SUBJECT: ${visualDescription}
  NICHE CONTEXT: "${nicheContext}"
  COMPOSITION: ${cleanComp || 'Centered, isolated, and fully visible'}
  TEXT REQUIREMENT: ${textInstruction}
  
  ART STYLE INSTRUCTIONS (STRICT):
  - ${stylePrompt}
  - KEY AESTHETICS: ${aestheticKeywords}
  
  TECHNICAL RULES (DO NOT IGNORE):
  1. **SINGLE OBJECT ONLY**: Generate ONE single sticker subject in the center. Do NOT generate a sticker sheet, a grid, a pattern, or a collection of small items.
  2. **BACKGROUND**: SOLID BLACK HEX #000000. DO NOT USE DARK GRAY. DO NOT USE GRADIENTS. MUST BE FLAT BLACK.
  3. **BORDER**: MANDATORY THICK WHITE DIE-CUT BORDER surrounding the object. This border protects the sticker content.
  3A. **EDGE QUALITY**: The outside of the white border must be perfectly clean, continuous, and crisp. NO gray rim, NO dotted/dashed cut line, NO glow, NO texture, NO drop shadow, and NO second outline.
  4. **NO CROPPING**: The object must be floating in the center with padding on all sides.
  5. **NO CARDS**: Do NOT place the sticker on a paper card or square backing. It must be floating in void.
  6. **NO INTERNAL HOLES**: The object MUST be completely solid. NO rings, NO chains, NO empty gaps inside. Fill any natural holes with solid white or a matching color.
  7. **COLOR RULE**: Inside the sticker, NEVER use pure black (#000000). Use dark gray (#1A1A1A) for dark details so it does not blend with the background.
  
  ${strictConstraints}
  
  NEGATIVE PROMPT (AVOID): ${negativeKeywords}, sticker sheet, sticker set, grid, pattern, multiple items, collection, cropping, blurry, text watermark, gray background, complex background, square crop, photo of a sticker on a table, realistic lighting on background, dark card backing, square paper behind sticker, holes, loops, empty space inside, transparent gaps, rings, chains, shadow, drop shadow, glow, gray fringe, dotted outline, dashed cut line, textured edge.
  `;

  return generateSeedreamImage(fullPrompt, useTurbo ? '1K' : '2K');
};

export const generateMockupBackground = async (type: string, niche: string): Promise<string> => {
    return ""; // Deprecated
};

export const generateAutopilotListing = async (niche: string, styleName: string, useTurbo: boolean, stickerCount = 100): Promise<string> => {
  const fileSpecs = useTurbo ? "High Resolution 1024px (300 DPI)" : "Ultra High Resolution 2048px (300 DPI)";

  const userPrompt = `
    You are an Etsy SEO Expert. Create a listing for a digital sticker bundle containing exactly ${stickerCount} finished stickers.
    NICHE/THEME: "${niche}" (${styleName} style).
    
    ACCURACY RULE: Never claim that the bundle contains more than ${stickerCount} stickers.

    OUTPUT FORMAT REQUIREMENTS:
    <<<TITLE>>> [SEO Title] <<<END_TITLE>>>
    <<<TAGS>>> [13 Tags] <<<END_TAGS>>>
    <<<DESCRIPTION>>> [Description including "${fileSpecs}"] <<<END_DESCRIPTION>>>
  `;

  const response = await generateBrainText({ prompt: userPrompt });
  return response.text;
};

export const generateSeedreamMockup = async (
    assetId: string,
    assetType: string,
    stickerUrls: string[], 
    niche: string,
    totalStickerCount = stickerUrls.length
): Promise<string> => {
    const id = assetId.toLowerCase();
    const type = assetType.toLowerCase();
    const uniqueUrls = uniqueStickerUrls(stickerUrls);

    if (!uniqueUrls.length) throw new Error('No unique stickers are available for this marketing asset.');
    if (type === 'preview' || id.includes('preview')) return createGridComposite(uniqueUrls);
    if (type === 'cover') return createCoverComposite(uniqueUrls, niche, totalStickerCount);

    let backgroundPrompt: string;
    if (type === 'goodnotes' || id.includes('goodnotes')) {
      backgroundPrompt = `Create a premium square product photo of a tablet on a tidy modern desk, viewed directly from above. The tablet screen must be a large blank warm-white planner page with no UI, no writing, no icons, no logos, no images, and no stickers. Keep the central screen fully unobstructed. Soft daylight, subtle coffee cup and stylus near the outer edges. Theme mood: ${niche}.`;
    } else if (type === 'laptop' || id.includes('laptop')) {
      backgroundPrompt = `Create a premium square product photo of an open laptop viewed from a slightly elevated angle in a stylish cafe. The back of the laptop lid must be a large blank matte neutral surface, completely empty: no logo, no text, no art, no decals, and absolutely no stickers. Keep the lid centered and unobstructed. Soft realistic lighting and shallow depth of field. Theme mood: ${niche}.`;
    } else if (type === 'journal' || id.includes('journal')) {
      backgroundPrompt = `Create a premium square top-down product photo of an open journal on a warm wooden desk. Both pages must be completely blank and unobstructed: no text, no drawings, no photos, no labels, and absolutely no stickers. Keep a large clean page area in the center. Cozy natural lighting with minimal props only at the outer edges. Theme mood: ${niche}.`;
    } else {
      backgroundPrompt = `Create a premium square product-photo background for a digital sticker bundle. Use a clean softly textured neutral surface with a large empty central area. Do not include stickers, labels, illustrations, text, logos, badges, icons, or product artwork. Theme mood: ${niche}.`;
    }

    try {
        const backgroundUrl = await generateSeedreamImage(backgroundPrompt, '2K');
        return await createHybridMockup(backgroundUrl, uniqueUrls, type);
    } catch (e: any) {
        console.warn('Lifestyle mockup generation failed; falling back to an exact grid.', e);
        return await createGridComposite(uniqueUrls);
    }
};

export const generateMarketingAsset = async (type: string, niche: string, styleName: string): Promise<string> => {
  return "";
};

export const generateMarketingImage = async (type: string, detail: string): Promise<string> => {
    return generateSeedreamImage(`Professional photography of ${detail} stickers. Type: ${type}. High resolution, square composition.`, '2K');
};

export const generateStickerImage = async (prompt: string, size: ImageSize = '2K'): Promise<string> => {
  return generateSeedreamImage(prompt, size);
};

export const getTrendAnalysis = async (query: string): Promise<TrendResult> => {
  const response = await generateBrainText({
    prompt: `Research current Etsy and broader consumer trends for: ${query}. Focus on evidence useful for a digital sticker seller.`,
    webSearch: true
  });
  return { answer: response.text || "No data.", sources: response.sources };
};

export const findViralNiche = async (): Promise<string> => {
  const response = await generateBrainText({
    prompt: "Research the hottest current viral digital-sticker niche with credible demand signals. Return ONLY the niche name.",
    webSearch: true
  });
  return response.text.trim().replace(/^["']|["']$/g, '') || "Trending";
};

export const discoverTopTrends = async (): Promise<DiscoveredTrend[]> => {
  const response = await generateBrainText({
    prompt: "Research and identify exactly 5 breakout digital-sticker trends with current demand evidence. Give each trend a production-ready art direction.",
    webSearch: true,
    schemaName: 'sticker_trends',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        trends: {
          type: 'array',
          minItems: 5,
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              category: { type: 'string' },
              description: { type: 'string' },
              styleName: { type: 'string' },
              stylePrompt: { type: 'string' }
            },
            required: ['name', 'category', 'description', 'styleName', 'stylePrompt']
          }
        },
      },
      required: ['trends']
    }
  });
  try { return (JSON.parse(response.text) as { trends: DiscoveredTrend[] }).trends; } catch { return []; }
};

export interface ChatSession {
  sendMessage(input: { message: string }): Promise<{ text: string }>;
}

export const createChat = (): ChatSession => {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];

  return {
    async sendMessage({ message }) {
      messages.push({ role: 'user', content: message });
      const response = await generateBrainText({ messages, chat: true });
      messages.push({ role: 'assistant', content: response.text });
      return { text: response.text };
    }
  };
};

export const generateListingContent = async (niche: NicheType, productName: string, count: number, isBundle: boolean): Promise<GeneratedListing> => {
  const response = await generateBrainText({
    prompt: `Create a complete Etsy listing for ${productName}. Niche: ${niche}. Sticker count: ${count}. Bundle: ${isBundle ? 'yes' : 'no'}.
Use exactly 13 Etsy tags, each no longer than 20 characters. Make the claims accurate for a digital-download product.`,
    schemaName: 'etsy_listing',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title1: { type: 'string' },
        title2: { type: 'string' },
        title3: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 13, maxItems: 13 },
        description: { type: 'string' },
        price: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        category: { type: 'string' },
        materials: { type: 'string' },
        whatsIncluded: { type: 'array', items: { type: 'string' } },
        howToDownload: { type: 'array', items: { type: 'string' } },
        license: { type: 'string' }
      },
      required: ['title1', 'title2', 'title3', 'tags', 'description', 'price', 'keywords', 'category', 'materials', 'whatsIncluded', 'howToDownload', 'license']
    }
  });

  return JSON.parse(response.text) as GeneratedListing;
};
