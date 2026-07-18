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

// Helper to convert URL to efficient Base64 for AI Input (Resize + Compress)
const prepareImageForAI = async (url: string, maxDim: number = 1280): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      
      let w = img.width;
      let h = img.height;
      
      if (w > h) {
          if (w > maxDim) {
              h = Math.round(h * (maxDim / w));
              w = maxDim;
          }
      } else {
          if (h > maxDim) {
              w = Math.round(w * (maxDim / h));
              h = maxDim;
          }
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if(!ctx) {
          reject(new Error('Canvas ctx failed'));
          return;
      }
      
      // Preserve Transparency (No White Fill)
      ctx.clearRect(0, 0, w, h);
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      
      // Use PNG to keep alpha channel
      const dataUrl = canvas.toDataURL('image/png');
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = (e) => reject(new Error("Failed to load image for resizing"));
    img.src = url;
  });
};

// --- HYBRID COMPOSITOR ENGINE ---
// USES GEMINI 3 PRO GENERATED BACKGROUNDS + CODE COMPOSITED STICKERS
const createHybridMockup = async (backgroundBase64: string, stickerUrls: string[], type: string, nicheName: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error("No canvas")); return; }

        const bgImg = new Image();
        bgImg.src = `data:image/png;base64,${backgroundBase64}`;
        
        bgImg.onload = async () => {
            // Set canvas to high res 2K
            canvas.width = 2048;
            canvas.height = 2048;
            
            // Draw Background
            ctx.drawImage(bgImg, 0, 0, 2048, 2048);
            
            // Load all stickers
            const stickerImages = await Promise.all(stickerUrls.map(url => new Promise<HTMLImageElement>((res) => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => res(img);
                img.onerror = () => res(new Image()); // Skip broken
                img.src = url;
            })));

            const validStickers = stickerImages.filter(img => img.width > 0);
            if (validStickers.length === 0) {
                resolve(canvas.toDataURL('image/jpeg', 0.9));
                return;
            }

            // Compositing Logic based on Type
            if (type === 'goodnotes' || type === 'journal') {
                 // --- IPAD / JOURNAL LAYOUT ---
                 const centerX = 1024;
                 const centerY = 1024;
                 
                 validStickers.forEach((img, i) => {
                     const scale = 0.3 + (Math.random() * 0.1); // Random size
                     const w = img.width * scale;
                     const h = img.height * scale;
                     
                     // Spiral placement
                     const angle = i * 0.8; 
                     const radius = 200 + (i * 20); 
                     
                     const x = centerX + Math.cos(angle) * radius - (w/2);
                     const y = centerY + Math.sin(angle) * radius - (h/2);
                     const rot = (Math.random() - 0.5) * 0.5;

                     ctx.save();
                     ctx.translate(x + w/2, y + h/2);
                     ctx.rotate(rot);
                     ctx.shadowColor = "rgba(0,0,0,0.3)";
                     ctx.shadowBlur = 15;
                     ctx.shadowOffsetY = 10;
                     ctx.drawImage(img, -w/2, -h/2, w, h);
                     ctx.restore();
                 });

            } else if (type === 'laptop') {
                 // --- LAPTOP STICKER BOMB ---
                 const centerX = 1024;
                 const centerY = 1024;
                 
                 validStickers.forEach((img) => {
                     const scale = 0.25 + (Math.random() * 0.15);
                     const w = img.width * scale;
                     const h = img.height * scale;
                     
                     const x = centerX + (Math.random() - 0.5) * 800 - (w/2);
                     const y = centerY + (Math.random() - 0.5) * 600 - (h/2);
                     const rot = (Math.random() - 0.5) * 1.0; 

                     ctx.save();
                     ctx.translate(x + w/2, y + h/2);
                     ctx.rotate(rot);
                     ctx.shadowColor = "rgba(0,0,0,0.4)";
                     ctx.shadowBlur = 10;
                     ctx.drawImage(img, -w/2, -h/2, w, h);
                     ctx.restore();
                 });

            } else {
                 // --- MAIN COVER / MARKETING (CURATED SPREAD) ---
                 // IMPROVED: Not a random pile. A curated spread of the best 18 stickers.
                 
                 // 1. Select distinct stickers (limit to ~18 to prevent garbage look)
                 const coverStickers = validStickers.slice(0, 18);
                 // Shuffle them slightly to mix shapes
                 coverStickers.sort(() => 0.5 - Math.random());
                 
                 const centerX = 1024;
                 const centerY = 1024;

                 // "Fanned Ring" Layout
                 // Place stickers in a wide oval ring around the center to leave space for text
                 coverStickers.forEach((img, i) => {
                     const total = coverStickers.length;
                     const angle = (i / total) * Math.PI * 2; 
                     
                     // Radius: 700-850px from center (Wide ring)
                     const radiusX = 800 + (Math.random() * 150 - 75); 
                     const radiusY = 650 + (Math.random() * 150 - 75);
                     
                     const x = centerX + Math.cos(angle) * radiusX - (img.width/2);
                     const y = centerY + Math.sin(angle) * radiusY - (img.height/2);
                     
                     // Rotation: Random but slightly outward facing often looks dynamic
                     const rot = (Math.random() - 0.5) * 1.0;

                     // Scaling: Varied sizes
                     const scale = 0.6 + (Math.random() * 0.25); 
                     const w = img.width * scale;
                     const h = img.height * scale;

                     ctx.save();
                     ctx.translate(x + w/2, y + h/2);
                     ctx.rotate(rot);
                     
                     // High quality drop shadow for "pop"
                     ctx.shadowColor = "rgba(0,0,0,0.5)";
                     ctx.shadowBlur = 40;
                     ctx.shadowOffsetY = 20;
                     
                     ctx.drawImage(img, -w/2, -h/2, w, h);
                     ctx.restore();
                 });
                 
                 // --- COVER OVERLAY UI ---
                 if (type === 'cover') {
                     // 1. Central Title Box (Semi-transparent Glass)
                     const boxW = 1500;
                     const boxH = 500;
                     const boxX = (2048 - boxW) / 2;
                     const boxY = (2048 - boxH) / 2;
                     
                     ctx.shadowColor = "rgba(0,0,0,0.4)";
                     ctx.shadowBlur = 30;
                     
                     ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
                     ctx.strokeStyle = "#171717";
                     ctx.lineWidth = 6;
                     
                     ctx.beginPath();
                     try { ctx.roundRect(boxX, boxY, boxW, boxH, 40); } catch(e) { ctx.rect(boxX, boxY, boxW, boxH); }
                     ctx.fill();
                     ctx.stroke();

                     // 2. Title Text
                     ctx.shadowBlur = 0; // Reset shadow for text
                     ctx.fillStyle = "#171717";
                     ctx.textAlign = "center";
                     ctx.textBaseline = "middle";
                     
                     let fontSize = 150;
                     ctx.font = `900 ${fontSize}px Inter, sans-serif`;
                     // Dynamic font scaling to fit box
                     while (ctx.measureText(nicheName.toUpperCase()).width > (boxW - 100)) {
                         fontSize -= 10;
                         ctx.font = `900 ${fontSize}px Inter, sans-serif`;
                     }
                     ctx.fillText(nicheName.toUpperCase() + " STICKERS", 1024, 1024 - 50);
                     
                     // 3. Subtitle
                     ctx.font = "700 70px Inter, sans-serif";
                     ctx.fillStyle = "#E11D48"; // Rose Red
                     ctx.fillText("DIGITAL DOWNLOAD • 100+ PNGs", 1024, 1024 + 90);
                     
                     // 4. "100+ Stickers" Circular Badge (Top Right)
                     const badgeX = 1750;
                     const badgeY = 250;
                     ctx.fillStyle = "#FACC15"; // Yellow
                     ctx.beginPath();
                     ctx.arc(badgeX, badgeY, 160, 0, Math.PI * 2);
                     ctx.fill();
                     ctx.strokeStyle = "white";
                     ctx.lineWidth = 12;
                     ctx.stroke();
                     
                     ctx.fillStyle = "black";
                     ctx.font = "900 80px Inter, sans-serif";
                     ctx.fillText("100+", badgeX, badgeY - 20);
                     ctx.font = "700 50px Inter, sans-serif";
                     ctx.fillText("STICKERS", badgeX, badgeY + 50);
                     
                     // 5. "Pre-Cropped" Badge (Bottom Left)
                     const pillW = 500;
                     const pillH = 120;
                     const pillX = 100;
                     const pillY = 1800;
                     
                     ctx.fillStyle = "#ffffff";
                     ctx.strokeStyle = "black";
                     ctx.lineWidth = 4;
                     ctx.beginPath();
                     try { ctx.roundRect(pillX, pillY, pillW, pillH, 60); } catch(e) { ctx.rect(pillX, pillY, pillW, pillH); }
                     ctx.fill();
                     ctx.stroke();
                     
                     ctx.fillStyle = "black";
                     ctx.font = "800 50px Inter, sans-serif";
                     ctx.fillText("✅ PRE-CROPPED", pillX + pillW/2, pillY + pillH/2 + 5);

                     // 6. "Goodnotes Ready" Badge (Bottom Right)
                     const gnX = 1448;
                     ctx.fillStyle = "#ffffff";
                     ctx.beginPath();
                     try { ctx.roundRect(gnX, pillY, pillW, pillH, 60); } catch(e) { ctx.rect(gnX, pillY, pillW, pillH); }
                     ctx.fill();
                     ctx.stroke();
                     
                     ctx.fillStyle = "black";
                     ctx.fillText("📱 GOODNOTES", gnX + pillW/2, pillY + pillH/2 + 5);
                 }
            }
            resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        bgImg.onerror = () => reject(new Error("Failed to load generated background"));
    });
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

            const validUrls = stickerUrls.filter(u => !!u);
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
                ctx.fillText("100% VECTOR QUALITY • HIGH RES PNG", CTX_SIZE/2, CTX_SIZE - 180);

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
    2. VARIETY: Do not repeat the same object more than twice.
    3. STYLE CONSISTENCY: All items must look like they belong in the same pack.

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
      return parsed.prompts.slice(0, COUNT);
  } catch (e) {
      console.error(`Failed to parse prompts`, e);
      return Array(COUNT).fill(`TYPE: Object-Only | SUBJECT: ${niche} Item | COMPOSITION: Simple | TEXT: NONE`);
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

  const isFrame = cleanType.includes('FRAME') || (analysis?.archetype === 'FRAME_OVERLAY');
  
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

  const fullPrompt = `
  GENERATE A RAW VECTOR STICKER ASSET (NOT A PHOTO OF A STICKER).
  
  SUBJECT: ${visualDescription}
  NICHE CONTEXT: "${nicheContext}"
  
  ART STYLE INSTRUCTIONS (STRICT):
  - ${stylePrompt}
  - KEY AESTHETICS: ${aestheticKeywords}
  
  TECHNICAL RULES (DO NOT IGNORE):
  1. **SINGLE OBJECT ONLY**: Generate ONE single sticker subject in the center. Do NOT generate a sticker sheet, a grid, a pattern, or a collection of small items.
  2. **BACKGROUND**: SOLID BLACK HEX #000000. DO NOT USE DARK GRAY. DO NOT USE GRADIENTS. MUST BE FLAT BLACK.
  3. **BORDER**: MANDATORY THICK WHITE DIE-CUT BORDER surrounding the object. This border protects the sticker content.
  4. **NO CROPPING**: The object must be floating in the center with padding on all sides.
  5. **NO CARDS**: Do NOT place the sticker on a paper card or square backing. It must be floating in void.
  6. **NO INTERNAL HOLES**: The object MUST be completely solid. NO rings, NO chains, NO empty gaps inside. Fill any natural holes with solid white or a matching color.
  7. **COLOR RULE**: Inside the sticker, NEVER use pure black (#000000). Use dark gray (#1A1A1A) for dark details so it does not blend with the background.
  
  ${strictConstraints}
  
  NEGATIVE PROMPT (AVOID): ${negativeKeywords}, sticker sheet, sticker set, grid, pattern, multiple items, collection, cropping, blurry, text watermark, gray background, complex background, square crop, photo of a sticker on a table, realistic lighting on background, dark card backing, square paper behind sticker, holes, loops, empty space inside, transparent gaps, rings, chains.
  `;

  return generateSeedreamImage(fullPrompt, useTurbo ? '1K' : '2K');
};

export const generateMockupBackground = async (type: string, niche: string): Promise<string> => {
    return ""; // Deprecated
};

export const generateAutopilotListing = async (niche: string, styleName: string, useTurbo: boolean): Promise<string> => {
  const fileSpecs = useTurbo ? "High Resolution 1024px (300 DPI)" : "Ultra High Resolution 2048px (300 DPI)";

  const userPrompt = `
    You are an Etsy SEO Expert. Create a listing for a "100-Pack Digital Sticker Bundle".
    NICHE/THEME: "${niche}" (${styleName} style).
    
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
    niche: string
): Promise<string> => {
    const id = assetId.toLowerCase();
    const type = assetType.toLowerCase();

    // 1. FAST GRID PREVIEW
    if (type === 'preview' || id.includes('preview')) return createGridComposite(stickerUrls);

    // 2. GENERATE A HIGH-QUALITY COMPOSITE WITH SEEDREAM 5.0 PRO
    let bgPrompt = "";
    
    // Random Seed for Layout Variation
    const randomSeed = Math.floor(Math.random() * 1000);

    if (type === 'cover') {
        bgPrompt = `
        ACT AS A STRICT COMPOSITOR.
        CREATE AN OUTSTANDING, PREMIUM MAIN COVER IMAGE FOR ETSY.
        
        INPUTS: You are provided with ${stickerUrls.length} sticker images.
        THEME: "${niche}".
        
        CRITICAL COMPOSITING RULES (DO NOT IGNORE):
        1. **EXACT MATCH**: You MUST ONLY use the exact stickers provided in the input images. DO NOT invent, hallucinate, or generate any new stickers that are not in the inputs.
        2. **NO DUPLICATES**: Use each provided sticker asset exactly ONCE. DO NOT duplicate or clone any sticker.
        3. **ARRANGEMENT**: Arrange ALL input stickers in a highly aesthetic, dynamic floating composition. They should be well-spaced, clearly visible, and NOT messy. Do not overlap them heavily. Make it look premium and outstanding.
        4. **BADGE**: Overlay a large, high-contrast CIRCULAR WHITE BADGE in the top-right or center. Text inside badge: "100+ STICKERS".
        5. **TITLE**: Add a bold, readable title text overlay: "${niche.toUpperCase()}".
        6. **BACKGROUND**: Use a professional abstract gradient background that matches the sticker colors.
        7. **SHADOWS**: Add strong drop shadows to each sticker to make them pop off the screen.
        
        STYLE: High Saturation, Commercial Product Photography, 8K Resolution.
        Seed: ${randomSeed}
        `;
    } else if (type === 'goodnotes' || id.includes('goodnotes')) {
        bgPrompt = `
        ACT AS A STRICT COMPOSITOR.
        Create an iPad Mockup for Digital Planning.
        
        SCENE: A top-down view of an iPad Pro on a desk.
        SCREEN CONTENT: Display the provided sticker images arranged neatly on a digital planner page grid.
        
        CRITICAL COMPOSITING RULES:
        - **EXACT MATCH**: You MUST ONLY use the exact stickers provided in the inputs. DO NOT invent or hallucinate new stickers.
        - **NO DUPLICATES**: Use each provided sticker exactly ONCE. DO NOT duplicate or clone any sticker.
        - Arrange the stickers neatly, well-spaced, and NOT overlapping.
        - Add 'GoodNotes' UI elements (toolbar) to the screen.
        - Props: Coffee cup, Apple Pencil.
        `;
    } else if (type === 'laptop' || id.includes('laptop')) {
        bgPrompt = `
        ACT AS A STRICT COMPOSITOR.
        Create a Laptop Skin Mockup.
        
        SCENE: A MacBook lid covered in stickers.
        ACTION: Place the provided sticker images onto the laptop surface.
        
        CRITICAL COMPOSITING RULES:
        - **EXACT MATCH**: You MUST ONLY use the exact stickers provided in the inputs. DO NOT invent or hallucinate new stickers.
        - **NO DUPLICATES**: Use each provided sticker exactly ONCE. DO NOT duplicate or clone any sticker.
        - Arrange the stickers neatly, well-spaced, and NOT overlapping in a messy way.
        - Realistic placement (angles, but well-spaced).
        - Laptop is on a cafe table. Blurred background.
        `;
    } else if (type === 'journal' || id.includes('journal')) {
        bgPrompt = `
        ACT AS A STRICT COMPOSITOR.
        Create a Physical Journal Mockup.
        
        SCENE: An open notebook with stickers applied to the paper pages.
        
        CRITICAL COMPOSITING RULES:
        - **EXACT MATCH**: You MUST ONLY use the exact stickers provided in the inputs. DO NOT invent or hallucinate new stickers.
        - **NO DUPLICATES**: Use each provided sticker exactly ONCE. DO NOT duplicate or clone any sticker.
        - Arrange the stickers neatly, well-spaced, and NOT overlapping.
        - Stickers should look like they are adhered to the paper (paper texture overlay).
        - Warm, cozy lighting.
        `;
    } else {
        bgPrompt = `
        ACT AS A STRICT COMPOSITOR.
        Create a Professional Product Photography Mockup.
        
        SCENE: Clean, soft-textured white surface. Blurred background.
        
        CRITICAL COMPOSITING RULES:
        - **EXACT MATCH**: You MUST ONLY use the exact stickers provided in the inputs. DO NOT invent or hallucinate new stickers.
        - **NO DUPLICATES**: Use each provided sticker exactly ONCE. DO NOT duplicate or clone any sticker.
        - Arrange ALL input stickers neatly, well-spaced, and NOT overlapping.
        - Create a clean, organized layout (like a grid or spread).
        - Add soft drop shadows to the stickers.
        `;
    }

    try {
        // PREPARE IMAGE PARTS
        // Limit to prevent payload issues, but enough for a dense pile (10)
        const safeStickerUrls = stickerUrls.slice(0, 10);
        const parts: any[] = [{ text: bgPrompt }];

        for (const url of safeStickerUrls) {
            try {
                // Resize to 512px to prevent payload too large errors which cause the grid fallback
                const base64Data = await prepareImageForAI(url, 512);
                parts.push({
                    inlineData: {
                        data: base64Data,
                        mimeType: 'image/png' 
                    }
                });
            } catch (e) {
                console.warn("Skipping invalid image for mockup", e);
            }
        }

        const inputImages = parts
          .filter(part => part.inlineData?.data)
          .map(part => `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);

        return await generateSeedreamImage(bgPrompt, '2K', inputImages);

    } catch (e: any) {
        console.warn("Mockup gen failed, falling back to grid", e);
        return await createGridComposite(stickerUrls);
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
