
import React, { useState, useEffect, useRef } from 'react';
import { AutopilotState, NicheIdea, StylePreset, Sticker, MarketingAsset, TrendResult, DiscoveredTrend, NicheVisualAnalysis, ProductionRunMode, QualityReport } from '../types';
import { NICHE_IDEAS, STYLE_PRESETS } from '../data/presets';
import { ensureProvidersConfigured, generateStickerPrompts, generateAutopilotSticker, generateAutopilotListing, generateSeedreamMockup, findViralNiche, getTrendAnalysis, discoverTopTrends, analyzeNicheVisuals, selectCoverStickerIds, assessNicheForProduction, generateReplacementStickerPrompts, createListingPreviewVideo } from '../services/aiService';
import { processStickerImage } from '../services/stickerProcessing';
import { findVisualDuplicateGroups, inspectStickerLocally } from '../services/qualityControl';
import { clearRunCheckpoint, loadRunCheckpoint, saveMarketingAssetCheckpoint, saveRunCheckpointMeta, saveStickerCheckpoint, saveStickerCheckpoints, type RunCheckpointMeta } from '../services/runPersistence';
import { Play, Pause, RefreshCw, CheckCircle, Download, FileText, Image as ImageIcon, Box, Archive, Zap, Gauge, Copy, FastForward, RotateCcw, Beaker, DollarSign, AlertCircle, Scissors, Eye, Globe, Search, ExternalLink, X, ArrowRight, BarChart3, Plus, Palette, ShoppingBag, Loader2, Wand2, Laptop, Tablet, Grid, BookOpen, Layers, ShieldCheck, Save, Video } from 'lucide-react';
import JSZip from 'jszip';

// --- SILENT AUDIO KEEP ALIVE ---
const SILENT_AUDIO_BASE64 = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

// --- HELPERS ---
const dataURLToBlob = (dataURL: string): Blob => {
  try {
    const arr = dataURL.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    console.error("Failed to convert Data URL to Blob", e);
    return new Blob([], { type: 'image/png' }); // Fallback empty blob
  }
};

const ETSY_ZIP_TARGET_BYTES = 18_600_000;
const ETSY_ZIP_MAX_BYTES = 19_000_000;
const PRODUCTION_STICKER_COUNT = 100;
const TEST_STICKER_COUNT = 10;
const PRODUCTION_REPLACEMENT_BUDGET = 25;
const TEST_REPLACEMENT_BUDGET = 5;

const getNicheGenerationBrief = (niche: NicheIdea) => niche.generationBrief?.trim() || niche.name;

const formatFileSizeMb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

const loadBlobImage = (blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to load a PNG while optimizing its Etsy ZIP.'));
  };
  image.src = url;
});

const resizePngBlob = async (blob: Blob, scale: number): Promise<Blob> => {
  if (scale >= 0.995) return blob;
  const image = await loadBlobImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for Etsy ZIP optimization.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(result => {
      if (result) resolve(result);
      else reject(new Error('Failed to encode an optimized sticker PNG.'));
    }, 'image/png');
  });
};

const stickerSubjectSlug = (prompt: string, fallback: string) => {
  const subject = prompt.match(/SUBJECT:\s*([^|]+)/i)?.[1] || fallback;
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 54) || fallback;
};

const sha256Hex = async (blob: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const createBuyerGuide = (nicheName: string, stickerCount: number) => `START HERE — ${nicheName}

WHAT YOU RECEIVED
- ${stickerCount} individual transparent PNG sticker files.
- ${Math.ceil(stickerCount / 20)} ZIP download${Math.ceil(stickerCount / 20) === 1 ? '' : 's'} with up to 20 PNG files in each ZIP.
- Every PNG is a separate design that can be moved and resized independently.

HOW TO DOWNLOAD FROM ETSY
1. Sign in to Etsy.com in a web browser.
2. Open Account > Purchases and Reviews.
3. Select Download Files beside your order.
4. Save all five ZIP files. The Etsy mobile app may not download digital files, so use a browser or computer if needed.

HOW TO OPEN THE FILES
1. Extract or unzip every ZIP file.
2. Open your planner, notes, presentation, design or creative app.
3. Import the individual PNG you want to use.
4. Drag, resize and arrange it in your project.

IMPORTANT
- This is a digital product; no physical item is shipped.
- Screen colors can vary slightly.
- Preview arrangements, devices and desk props are not included as separate files.
- Do not resell, share, redistribute or claim the original PNG files as your own.
`;

const buildStickerZip = async (
  batch: Sticker[],
  pngBlobs: Blob[],
  nicheName: string,
  startIndex: number,
  volume: number,
  productCount: number
): Promise<Blob> => {
  const zip = new JSZip();
  const safeNiche = nicheName.replace(/[^a-zA-Z0-9]/g, '_');
  const records = await Promise.all(batch.map(async (sticker, index) => {
    const blob = pngBlobs[index] || sticker.blob!;
    const number = String(startIndex + index + 1).padStart(3, '0');
    const filename = `${number}_${stickerSubjectSlug(sticker.prompt, `${safeNiche}_${number}`)}.png`;
    const image = await loadBlobImage(blob);
    zip.file(filename, blob);
    return {
      number,
      filename,
      width: image.width,
      height: image.height,
      bytes: blob.size,
      sha256: await sha256Hex(blob)
    };
  }));
  const manifest = [
    'number,filename,width,height,bytes,sha256',
    ...records.map(record => `${record.number},"${record.filename}",${record.width},${record.height},${record.bytes},${record.sha256}`)
  ].join('\n');
  zip.file(`MANIFEST_Vol${volume}.csv`, manifest);
  if (volume === 1) zip.file('START_HERE.txt', createBuyerGuide(nicheName, productCount));
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
};

const buildEtsySizedStickerZip = async (
  batch: Sticker[],
  nicheName: string,
  startIndex: number,
  productCount: number
): Promise<{ blob: Blob; scale: number }> => {
  const originals = batch.map(sticker => sticker.blob!);
  const volume = Math.floor(startIndex / 20) + 1;
  const originalZip = await buildStickerZip(batch, originals, nicheName, startIndex, volume, productCount);
  if (originalZip.size <= ETSY_ZIP_MAX_BYTES) return { blob: originalZip, scale: 1 };

  // Find the highest common pixel scale whose PNG payload lands near 18.6 MB.
  // We never pad a smaller archive with junk data; original quality is retained
  // whenever the source batch is already below Etsy's limit.
  let lowerScale = 0.24;
  let upperScale = 0.995;
  let best: { blobs: Blob[]; scale: number } | null = null;
  const payloadTarget = ETSY_ZIP_TARGET_BYTES - 120_000;

  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = (lowerScale + upperScale) / 2;
    const blobs = await Promise.all(originals.map(blob => resizePngBlob(blob, scale)));
    const payloadBytes = blobs.reduce((total, blob) => total + blob.size, 0);
    if (payloadBytes <= payloadTarget) {
      best = { blobs, scale };
      lowerScale = scale;
    } else {
      upperScale = scale;
    }
  }

  if (!best) {
    const emergencyScale = 0.18;
    const blobs = await Promise.all(originals.map(blob => resizePngBlob(blob, emergencyScale)));
    best = {
      blobs,
      scale: emergencyScale
    };
  }

  let zipBlob = await buildStickerZip(batch, best.blobs, nicheName, startIndex, volume, productCount);
  if (zipBlob.size > ETSY_ZIP_MAX_BYTES) {
    const saferScale = Math.max(0.15, best.scale * 0.96);
    const saferBlobs = await Promise.all(originals.map(blob => resizePngBlob(blob, saferScale)));
    zipBlob = await buildStickerZip(batch, saferBlobs, nicheName, startIndex, volume, productCount);
    best = {
      blobs: saferBlobs,
      scale: saferScale
    };
  }

  if (zipBlob.size > ETSY_ZIP_MAX_BYTES) {
    throw new Error(`A 20-sticker ZIP is still ${formatFileSizeMb(zipBlob.size)} after optimization.`);
  }
  return { blob: zipBlob, scale: best.scale };
};

const parseListingText = (text: string) => {
    const titleMatch = text.match(/<<<TITLE>>>([\s\S]*?)<<<END_TITLE>>>/);
    const tagsMatch = text.match(/<<<TAGS>>>([\s\S]*?)<<<END_TAGS>>>/);
    const descMatch = text.match(/<<<DESCRIPTION>>>([\s\S]*?)<<<END_DESCRIPTION>>>/);

    let description = descMatch ? descMatch[1].trim() : "Failed to generate description";
    description = description.replace(/\*\*/g, "");

    return {
        title: titleMatch ? titleMatch[1].trim() : "Failed to generate title",
        tags: tagsMatch ? tagsMatch[1].trim() : "Failed to generate tags",
        description: description
    };
};

interface AutopilotProps {
  initialNiche?: string | null;
}

const Autopilot: React.FC<AutopilotProps> = ({ initialNiche }) => {
  const [availableNiches, setAvailableNiches] = useState<NicheIdea[]>(NICHE_IDEAS);
  const [availableStyles, setAvailableStyles] = useState<StylePreset[]>(STYLE_PRESETS);
  
  const [selectedNicheId, setSelectedNicheId] = useState<number>(NICHE_IDEAS[0].id);
  // Default to AUTO style for "set and forget" usage
  const [selectedStyleId, setSelectedStyleId] = useState<string>('auto');
  
  const [isTrendSearching, setIsTrendSearching] = useState(false);
  
  // Trend Modal State
  const [showTrendModal, setShowTrendModal] = useState(false);
  const [trendResult, setTrendResult] = useState<TrendResult | null>(null);
  const [discoveredTrends, setDiscoveredTrends] = useState<DiscoveredTrend[]>([]);
  const [isAnalyzingTrend, setIsAnalyzingTrend] = useState(false);
  
  // Download Loading State
  const [isDownloading, setIsDownloading] = useState(false);

  const [state, setState] = useState<AutopilotState & { rawListing?: string }>({
    status: 'idle',
    currentNiche: null,
    currentStyle: null,
    runMode: 'production',
    targetCount: PRODUCTION_STICKER_COUNT,
    progress: 0,
    stickers: [],
    zips: [],
    marketingAssets: [],
    listing: null,
    logs: [],
    qualityReport: null,
    metrics: {
      seedreamRequests: 0,
      seedreamMockupRequests: 0,
      replacementImages: 0,
      rejectedImages: 0,
      qaRuns: 0,
      rateLimitEvents: 0,
      startedAt: null,
      finishedAt: null
    },
    preflight: null,
    checkpointUpdatedAt: null
  });
  
  // DEFAULT TO TURBO MODE (TRUE) FOR SPEED
  const [useTurbo, setUseTurbo] = useState(true); 
  const [seedreamWorkerLimit, setSeedreamWorkerLimit] = useState(10);
  const [needsZipUpdate, setNeedsZipUpdate] = useState(false);
  const [runMode, setRunMode] = useState<ProductionRunMode>('production');
  const [allowRiskyNiche, setAllowRiskyNiche] = useState(false);
  const [savedCheckpoint, setSavedCheckpoint] = useState<RunCheckpointMeta | null>(null);
  
  // Visual Analysis State to pass between stages
  const visualAnalysisRef = useRef<NicheVisualAnalysis | undefined>(undefined);

  const stopSignal = useRef(false);
  const skipToNextStageSignal = useRef(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const stickersRef = useRef<Sticker[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null); // For background keep-alive
  const usedStickerIdsRef = useRef<Set<number>>(new Set()); // Tracks used stickers to avoid redundancy
  const wakeLockRef = useRef<any>(null); // For Screen Wake Lock API
  const runIdRef = useRef<string | null>(null);
  const logsRef = useRef<string[]>([]);
  const metricsRef = useRef(state.metrics);
  const preflightRef = useRef(state.preflight);
  const turboModeRef = useRef(useTurbo);
  const seedreamWorkerLimitRef = useRef(10);
  const seedreamAvailableRef = useRef(true);
  const riskOverrideRef = useRef(allowRiskyNiche);
  const replacementInFlightRef = useRef<Set<number>>(new Set());

  const targetStickerCount = runMode === 'production' ? PRODUCTION_STICKER_COUNT : TEST_STICKER_COUNT;

  // --- SMART STYLE MATCHING LOGIC ---
  const recommendStyleForNiche = (nicheId: number): string | null => {
      const niche = availableNiches.find(n => n.id === nicheId);
      if (!niche) return null;
      
      const textToCheck = `${niche.name} ${niche.category}`.toLowerCase();
      
      // BRACKET EXTRACTION
      const bracketMatch = niche.name.match(/\((.*?)\)/);
      const bracketContent = bracketMatch ? bracketMatch[1].toLowerCase() : "";
      
      // Prioritize Bracket Content
      const fullSearch = (bracketContent + " " + textToCheck).toLowerCase();

      // 1. Direct Keyword Matching (Prioritize Brackets)
      if (fullSearch.includes('pixel') || fullSearch.includes('8-bit') || fullSearch.includes('game')) return 'pixel_high_bit';
      if (fullSearch.includes('goth') || fullSearch.includes('vampire') || fullSearch.includes('dark')) return 'gothic';
      if (fullSearch.includes('risograph') || fullSearch.includes('riso') || fullSearch.includes('zine') || fullSearch.includes('print')) return 'risograph_retro';
      if (fullSearch.includes('clay') || fullSearch.includes('3d') || fullSearch.includes('plastic')) return 'clay_3d';
      if (fullSearch.includes('chrome') || fullSearch.includes('cyber') || fullSearch.includes('y2k')) return 'y2k_cybercore';
      if (fullSearch.includes('collage') || fullSearch.includes('paper') || fullSearch.includes('scrapbook')) return 'paper_collage';
      if (fullSearch.includes('scientific') || fullSearch.includes('botanical') || fullSearch.includes('mushroom')) return 'vintage_science';
      if (fullSearch.includes('stained glass') || fullSearch.includes('church') || fullSearch.includes('mystical')) return 'stained_glass';
      if (fullSearch.includes('airbrush') || fullSearch.includes('graffiti') || fullSearch.includes('street') || fullSearch.includes('spray')) return 'airbrush_y2k';
      if (fullSearch.includes('hand-drawn') || fullSearch.includes('sketch') || fullSearch.includes('human')) return 'human_premium';
      if (fullSearch.includes('pastel') || fullSearch.includes('cute') || fullSearch.includes('kawaii')) return 'kawaii';
      if (fullSearch.includes('minimal') || fullSearch.includes('line') || fullSearch.includes('simple')) return 'minimal';
      if (fullSearch.includes('neon') || fullSearch.includes('glitter') || fullSearch.includes('dopamine')) return 'dopamine_design';
      if (fullSearch.includes('nature') || fullSearch.includes('calm') || fullSearch.includes('organic')) return 'modern_natural';
      if (fullSearch.includes('industrial') || fullSearch.includes('label') || fullSearch.includes('barcode')) return 'micro_industrial';
      if (fullSearch.includes('vaporwave') || fullSearch.includes('grid')) return 'vaporwave_grid';

      return null; 
  };

  const handleNicheChange = (newNicheId: number) => {
      setSelectedNicheId(newNicheId);
      
      // If user has manually selected "Auto-Detect", we DO NOT override it with Smart Match
      if (selectedStyleId === 'auto') {
          return;
      }

      // Otherwise, try to auto-select a specific preset style
      const recommendedStyleId = recommendStyleForNiche(newNicheId);
      if (recommendedStyleId) {
          const styleExists = availableStyles.find(s => s.id === recommendedStyleId);
          if (styleExists) {
             setSelectedStyleId(recommendedStyleId);
             addLog(`🤖 Smart Match: Auto-selected style "${styleExists.name}" based on niche.`);
          }
      }
  };

  const triggerSmartMatch = () => {
       const recommendedStyleId = recommendStyleForNiche(selectedNicheId);
       if (recommendedStyleId) {
           setSelectedStyleId(recommendedStyleId);
           const styleName = availableStyles.find(s => s.id === recommendedStyleId)?.name;
           addLog(`✨ Smart Match Triggered: Applied "${styleName}"`);
       } else {
           addLog(`⚠️ No specific smart match found. Try selecting manually.`);
       }
  };

  useEffect(() => {
    // Initialize silent audio
    audioRef.current = new Audio(SILENT_AUDIO_BASE64);
    audioRef.current.loop = true;
    audioRef.current.volume = 0.01; // Tiny volume just in case
    
    // Trigger initial smart match only if not auto
    if (selectedStyleId !== 'auto') {
        handleNicheChange(NICHE_IDEAS[0].id);
    }
  }, []);

  useEffect(() => {
    if (initialNiche) {
      applyCustomNiche(initialNiche);
    }
  }, [initialNiche]);

  useEffect(() => {
    loadRunCheckpoint()
      .then(checkpoint => {
        if (checkpoint?.stickers.length) setSavedCheckpoint(checkpoint.meta);
      })
      .catch(error => console.warn('Checkpoint discovery failed:', error));
  }, []);

  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        addLog("✅ Screen Wake Lock Active (Background protection enabled)");
      }
    } catch (err) {
      console.warn("Wake Lock failed:", err);
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
        wakeLockRef.current.release()
            .then(() => { wakeLockRef.current = null; })
            .catch((e: any) => console.log(e));
    }
  };

  const applyCustomNiche = (nicheName: string) => {
      const customId = 9999 + Math.floor(Math.random() * 1000);
      const customNiche: NicheIdea = {
        id: customId,
        name: nicheName,
        category: '🔥 Trending Now (AI Detected)',
        isNew: true
      };
      
      setAvailableNiches(prev => {
        return [customNiche, ...prev];
      });
      handleNicheChange(customId); // Use new handler for auto-style
      addLog(`Trend Applied: ${nicheName}`);
  };

  const handleAutoDetectTrend = async () => {
      await checkApiKey();
      setIsTrendSearching(true);
      addLog("🔎 Scanning current market signals for a broad 100-sticker opportunity...");
      try {
          const viralNiche = await findViralNiche();
          applyCustomNiche(viralNiche);
          addLog(`✅ Broad opportunity selected: "${viralNiche}"`);
      } catch (e: any) {
          addLog(`Trend Scan Failed: ${e.message}`);
          console.error(e);
      } finally {
          setIsTrendSearching(false);
      }
  };

  const handleManualTrendAnalyze = async () => {
    await checkApiKey();
    setIsAnalyzingTrend(true);
    setTrendResult(null);
    setDiscoveredTrends([]);
    
    try {
        const [analysis, trends] = await Promise.all([
            getTrendAnalysis("Which broad digital-sticker buyer markets and specific emerging angles show the strongest current demand signals?"),
            discoverTopTrends()
        ]);

        setTrendResult(analysis);
        setDiscoveredTrends(trends);
    } catch (e: any) {
        addLog(`Trend Analysis Failed: ${e.message}`);
    } finally {
        setIsAnalyzingTrend(false);
    }
  };

  const handleAddTrend = (trend: DiscoveredTrend) => {
      const dateStr = new Date().toLocaleDateString();
      const productionName = trend.productionNiche || trend.name;
      
      const newNiche: NicheIdea = {
          id: Date.now(),
          name: trend.name,
          generationBrief: productionName,
          category: `${trend.scope === 'broad' ? '💰 Broad Market' : '⚡ Micro Trend'} · ${dateStr}`,
          isNew: true
      };
      
      const styleId = `trend-style-${Date.now()}`;
      const newStyle: StylePreset = {
          id: styleId,
          name: `${trend.styleName} (from ${trend.name})`,
          prompt: trend.stylePrompt,
          isNew: true
      };

      setAvailableNiches(prev => [newNiche, ...prev]);
      setAvailableStyles(prev => [newStyle, ...prev]);
      
      setSelectedNicheId(newNiche.id);
      setSelectedStyleId(newStyle.id);
      
      addLog(`Imported ${trend.scope} opportunity: "${trend.name}" → production niche "${productionName}".`);
      setShowTrendModal(false);
  };

  const handleAddAllTrends = () => {
      if (discoveredTrends.length === 0) return;
      
      const dateStr = new Date().toLocaleDateString();
      const newNiches: NicheIdea[] = [];
      const newStyles: StylePreset[] = [];

      discoveredTrends.forEach((trend, idx) => {
         const timestamp = Date.now() + idx; 
         const productionName = trend.productionNiche || trend.name;
         
         const newNiche: NicheIdea = {
              id: timestamp,
              name: trend.name,
              generationBrief: productionName,
              category: `${trend.scope === 'broad' ? '💰 Broad Market' : '⚡ Micro Trend'} · ${dateStr}`,
              isNew: true
          };
          newNiches.push(newNiche);

          const newStyle: StylePreset = {
              id: `trend-style-${timestamp}`,
              name: `${trend.styleName} (from ${trend.name})`,
              prompt: trend.stylePrompt,
              isNew: true
          };
          newStyles.push(newStyle);
      });
      
      setAvailableNiches(prev => [...newNiches, ...prev]);
      setAvailableStyles(prev => [...newStyles, ...prev]);
      
      setSelectedNicheId(newNiches[0].id);
      setSelectedStyleId(newStyles[0].id);
      
      addLog(`Mass Import: Added ${newNiches.length} balanced broad and micro opportunities to the niche library.`);
      setShowTrendModal(false);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [state.logs]);

  const addLog = (msg: string) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logsRef.current = [...logsRef.current, entry].slice(-500);
    setState(prev => ({ ...prev, logs: [...prev.logs, entry] }));
  };

  const updateMetrics = (changes: Partial<typeof metricsRef.current>) => {
    metricsRef.current = { ...metricsRef.current, ...changes };
    setState(prev => ({ ...prev, metrics: metricsRef.current }));
  };

  const persistCheckpointMeta = async (
    niche: NicheIdea,
    style: StylePreset,
    mode: ProductionRunMode,
    targetCount: number,
    analysis?: NicheVisualAnalysis,
    preflight = preflightRef.current,
    qualityReport = state.qualityReport,
    rawListing = state.rawListing
  ) => {
    if (!runIdRef.current) return;
    const meta: RunCheckpointMeta = {
      id: runIdRef.current,
      updatedAt: new Date().toISOString(),
      currentNiche: niche,
      currentStyle: style,
      runMode: mode,
      targetCount,
      useTurbo: turboModeRef.current,
      allowRiskyNiche: riskOverrideRef.current,
      analysis,
      qualityReport,
      metrics: metricsRef.current,
      preflight,
      rawListing,
      logs: logsRef.current
    };
    await saveRunCheckpointMeta(meta);
    setSavedCheckpoint(meta);
    setState(prev => ({ ...prev, checkpointUpdatedAt: meta.updatedAt }));
  };

  const persistMarketingAsset = async (asset: MarketingAsset) => {
    if (!runIdRef.current || asset.status !== 'completed' || !asset.url) return;
    try {
      await saveMarketingAssetCheckpoint(runIdRef.current, asset);
    } catch (error) {
      console.warn(`Could not checkpoint marketing asset ${asset.id || asset.title}:`, error);
      addLog(`Checkpoint warning: ${asset.title} is still available in this tab, but could not be saved for a browser restart.`);
    }
  };

  const checkApiKey = async () => {
     const health = await ensureProvidersConfigured();
     if (!health.providers.openai.configured) {
       addLog('OpenAI is not configured. Production will continue with the built-in offline brain and listing templates.');
     }
     if (!health.providers.seedream.configured) {
       addLog('Seedream is unavailable. The run will preserve and package every PNG already generated; missing images and model-based mockups will be reported instead of blocking downloads.');
     }
     const configuredLimit = Number(health.providers.seedream.maxConcurrency);
     const safeLimit = Number.isFinite(configuredLimit) ? Math.max(1, Math.min(15, configuredLimit)) : 10;
     seedreamAvailableRef.current = health.providers.seedream.configured;
     seedreamWorkerLimitRef.current = safeLimit;
     setSeedreamWorkerLimit(safeLimit);
     return health;
  };

  const nichesByCategory = availableNiches.reduce((acc, niche) => {
    if (!acc[niche.category]) acc[niche.category] = [];
    acc[niche.category].push(niche);
    return acc;
  }, {} as Record<string, NicheIdea[]>);

  const sortedNicheCategories = (Object.entries(nichesByCategory) as [string, NicheIdea[]][]).sort((a, b) => {
      const aName = a[0];
      const bName = b[0];
      const aIsNew = aName.includes("Detected") || aName.includes("Trending");
      const bIsNew = bName.includes("Detected") || bName.includes("Trending");
      
      if (aIsNew && !bIsNew) return -1;
      if (!aIsNew && bIsNew) return 1;
      return 0;
  });

  const packageStickers = async (
    currentStickers: Sticker[],
    nicheName: string,
    mode: ProductionRunMode = runMode,
    targetCount = targetStickerCount
  ) => {
      const allSuccessfulStickers = currentStickers.filter(s => s.status === 'completed' && s.blob);
      const successfulStickers = allSuccessfulStickers.slice(0, targetCount);
      const zips: { name: string; blob: Blob }[] = [];
      const chunkSize = 20; 
      const numberOfZips = Math.ceil(successfulStickers.length / chunkSize);

      if (successfulStickers.length < targetCount) {
        addLog(`RECOVERY PACKAGE: ${successfulStickers.length}/${targetCount} generated PNGs are available. The download will use the real count and will not falsely claim ${targetCount}.`);
      } else if (allSuccessfulStickers.length > targetCount) {
        addLog(`${allSuccessfulStickers.length - targetCount} extra generated sticker(s) were excluded to keep the product count exact.`);
      }

      for (let i = 0; i < numberOfZips; i++) {
        const start = i * chunkSize;
        const end = start + chunkSize;
        const batch = successfulStickers.slice(start, end);
        
        if (batch.length > 0) {
          try {
            const packaged = await buildEtsySizedStickerZip(batch, nicheName, start, successfulStickers.length);
            const qualityNote = packaged.scale < 0.995
              ? ` • optimized at ${Math.round(packaged.scale * 100)}% dimensions`
              : ' • original PNG dimensions preserved';
            addLog(`ZIP Vol ${i + 1}: ${batch.length} PNG files • ${formatFileSizeMb(packaged.blob.size)}${qualityNote}`);
            zips.push({ name: `StickerPack_Vol${i+1}_${nicheName.replace(/[^a-zA-Z0-9]/g, '')}.zip`, blob: packaged.blob });
          } catch (error) {
            const recoveryZip = new JSZip();
            batch.forEach((sticker, batchIndex) => {
              if (!sticker.blob) return;
              const number = String(start + batchIndex + 1).padStart(3, '0');
              recoveryZip.file(`${number}_${stickerSubjectSlug(sticker.prompt, `sticker_${number}`)}.png`, sticker.blob);
            });
            recoveryZip.file('RECOVERY_NOTICE.txt', `This archive was created by the fail-open recovery path because normal ZIP optimization failed.\n\n${error instanceof Error ? error.message : String(error)}\n`);
            const recoveryBlob = await recoveryZip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
            addLog(`ZIP Vol ${i + 1} used raw recovery packaging: ${error instanceof Error ? error.message : String(error)}`);
            zips.push({ name: `RECOVERY_StickerPack_Vol${i+1}_${nicheName.replace(/[^a-zA-Z0-9]/g, '')}.zip`, blob: recoveryBlob });
          }
        }
      }
      if (mode === 'production' && successfulStickers.length === PRODUCTION_STICKER_COUNT) {
        const invalidZipCount = zips.length !== 5;
        const oversized = zips.find(zip => zip.blob.size > ETSY_ZIP_MAX_BYTES);
        if (invalidZipCount || oversized) {
          throw new Error(`Production preflight failed: expected five valid ZIPs under 19 MB${oversized ? `; ${oversized.name} is oversized` : ''}.`);
        }
        addLog('Package preflight passed: 100 approved PNGs • 5 ZIPs • 20 PNGs per ZIP • all below 19 MB.');
      } else if (mode === 'production') {
        addLog(`Production completed in recovery mode with ${successfulStickers.length} generated PNG file${successfulStickers.length === 1 ? '' : 's'}.`);
      }
      return zips;
  };

  async function processWithQueue<T>(
    items: T[], 
    concurrency: number, 
    processor: (item: T, index: number) => Promise<void>
  ) {
    const queue = items.map((item, index) => ({ item, index }));
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (queue.length > 0) {
            if (stopSignal.current || skipToNextStageSignal.current) break;
            const next = queue.shift();
            if (next) {
                await processor(next.item, next.index);
            }
        }
    });
    await Promise.all(workers);
  }

  async function processWithAdaptiveQueue<T>(
    items: T[],
    initialConcurrency: number,
    processor: (item: T, index: number) => Promise<void>
  ) {
    const queue = items.map((item, index) => ({ item, index }));
    const minimumConcurrency = Math.min(3, initialConcurrency);
    let activeLimit = Math.min(initialConcurrency, items.length);
    let consecutiveSuccesses = 0;
    const workers = Array.from({ length: Math.min(initialConcurrency, items.length) }, (_, workerId) => (async () => {
      while (queue.length > 0) {
        if (stopSignal.current || skipToNextStageSignal.current) break;
        while (workerId >= activeLimit && queue.length > 0 && !stopSignal.current && !skipToNextStageSignal.current) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        const next = queue.shift();
        if (!next) break;
        try {
          await processor(next.item, next.index);
          consecutiveSuccesses++;
          if (consecutiveSuccesses >= 8 && activeLimit < initialConcurrency) {
            activeLimit++;
            consecutiveSuccesses = 0;
            addLog(`Seedream queue recovered to ${activeLimit} parallel workers.`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/\b429\b|rate.?limit|too many requests|\b5\d\d\b/i.test(message)) {
            activeLimit = Math.max(minimumConcurrency, activeLimit - 1);
            consecutiveSuccesses = 0;
            updateMetrics({ rateLimitEvents: metricsRef.current.rateLimitEvents + 1 });
            addLog(`Seedream pressure detected; temporarily reducing to ${activeLimit} workers.`);
          }
        }
      }
    })());
    await Promise.all(workers);
  }

  const generateStickerQueue = async (
    items: Sticker[],
    niche: NicheIdea,
    style: StylePreset,
    analysis: NicheVisualAnalysis,
    mode: ProductionRunMode,
    targetCount: number,
    turboMode: boolean,
    isReplacement = false
  ) => {
    if (!seedreamAvailableRef.current) {
      const unavailable = items.map(sticker => ({
        ...sticker,
        status: 'error' as const,
        qaStatus: 'rejected' as const,
        qaIssues: ['Seedream is unavailable; no paid image request was attempted.']
      }));
      const unavailableById = new Map(unavailable.map(sticker => [sticker.id, sticker]));
      stickersRef.current = stickersRef.current.map(sticker => unavailableById.get(sticker.id) || sticker);
      setState(prev => ({ ...prev, stickers: [...stickersRef.current] }));
      if (runIdRef.current) await saveStickerCheckpoints(runIdRef.current, unavailable);
      addLog(`Skipped ${items.length} missing Seedream image request${items.length === 1 ? '' : 's'} and continued to recovery packaging.`);
      return;
    }
    const initialConcurrency = turboMode
      ? seedreamWorkerLimitRef.current
      : Math.min(seedreamWorkerLimitRef.current, 8);
    const replacementBudget = mode === 'production' ? PRODUCTION_REPLACEMENT_BUDGET : TEST_REPLACEMENT_BUDGET;
    const requestBudget = targetCount + replacementBudget;
    let fatalProviderError = '';
    addLog(`Generating ${items.length} sticker${items.length === 1 ? '' : 's'} with up to ${initialConcurrency} adaptive Seedream workers...`);

    await processWithAdaptiveQueue(items, initialConcurrency, async sticker => {
      if (stopSignal.current || skipToNextStageSignal.current) return;
      let attempts = 0;
      let lastError = '';
      while (attempts < 3) {
        if (fatalProviderError) {
          lastError = fatalProviderError;
          break;
        }
        if (metricsRef.current.seedreamRequests >= requestBudget) {
          throw new Error(`Seedream request budget reached (${requestBudget}).`);
        }
        attempts++;
        updateMetrics({
          seedreamRequests: metricsRef.current.seedreamRequests + 1,
          replacementImages: metricsRef.current.replacementImages + (isReplacement ? 1 : 0)
        });
        try {
          const base64 = await generateAutopilotSticker(sticker.prompt, style.prompt, turboMode, getNicheGenerationBrief(niche), analysis);
          const processedBlob = await processStickerImage(base64, sticker.prompt);
          const previous = stickersRef.current.find(item => item.id === sticker.id);
          if (previous?.url?.startsWith('blob:')) URL.revokeObjectURL(previous.url);
          const completed: Sticker = {
            ...sticker,
            url: URL.createObjectURL(processedBlob),
            blob: processedBlob,
            status: 'completed',
            regenCount: (sticker.regenCount || 0) + attempts - 1,
            qaStatus: 'pending',
            qaIssues: [],
            qaScore: undefined,
            perceptualHash: undefined,
            replacementCount: sticker.replacementCount || 0
          };
          const currentIndex = stickersRef.current.findIndex(item => item.id === sticker.id);
          if (currentIndex === -1) stickersRef.current.push(completed);
          else stickersRef.current[currentIndex] = completed;
          const completedCount = stickersRef.current.filter(item => item.status === 'completed').length;
          setState(prev => ({
            ...prev,
            stickers: [...stickersRef.current],
            progress: 10 + Math.round((Math.min(completedCount, targetCount) / targetCount) * 52)
          }));
          if (runIdRef.current) await saveStickerCheckpoint(runIdRef.current, completed);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          if (/\b(?:401|402|403)\b|invalid api key|incorrect api key|authentication|unauthorized|insufficient|quota|billing|credit/i.test(lastError)) {
            if (!fatalProviderError) {
              fatalProviderError = lastError;
              addLog(`Seedream provider is unavailable for the rest of this batch. Stopping paid retries and preserving completed PNGs: ${lastError.slice(0, 110)}`);
            }
            break;
          }
          if (/request budget reached/i.test(lastError)) break;
          if (attempts < 3) await new Promise(resolve => setTimeout(resolve, attempts * 900));
        }
      }

      const failed: Sticker = {
        ...sticker,
        status: 'error',
        url: null,
        blob: undefined,
        qaStatus: 'rejected',
        qaIssues: [`Generation failed: ${lastError.slice(0, 180)}`]
      };
      const currentIndex = stickersRef.current.findIndex(item => item.id === sticker.id);
      if (currentIndex === -1) stickersRef.current.push(failed);
      else stickersRef.current[currentIndex] = failed;
      setState(prev => ({ ...prev, stickers: [...stickersRef.current] }));
      if (runIdRef.current) await saveStickerCheckpoint(runIdRef.current, failed);
      addLog(`Sticker #${sticker.id} failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${lastError.slice(0, 90)}`);
    });
  };

  const runStickerQualityControl = async (
    currentStickers: Sticker[],
    niche: NicheIdea,
    style: StylePreset,
    analysis: NicheVisualAnalysis,
    mode: ProductionRunMode,
    targetCount: number
  ): Promise<{ stickers: Sticker[]; report: QualityReport }> => {
    setState(prev => ({ ...prev, status: 'quality_control', progress: 65 }));
    const candidates = currentStickers.filter(sticker => sticker.status === 'completed' && sticker.blob && sticker.qaStatus !== 'approved');
    addLog(`Fast seller QC: checking ${candidates.length} sticker${candidates.length === 1 ? '' : 's'} for technical defects and near-exact duplicates...`);
    updateMetrics({ qaRuns: metricsRef.current.qaRuns + 1 });
    const working = currentStickers.map(sticker => ({ ...sticker }));
    const localIssues = new Map<number, string[]>();

    for (let start = 0; start < candidates.length; start += 8) {
      const batch = candidates.slice(start, start + 8);
      const results = await Promise.all(batch.map(async sticker => {
        try {
          return await inspectStickerLocally(sticker);
        } catch (error) {
          addLog(`Local QA skipped Sticker #${sticker.id}: ${error instanceof Error ? error.message : String(error)}. Keeping the generated PNG.`);
          return { id: sticker.id, issues: [], perceptualHash: '' };
        }
      }));
      results.forEach(result => {
        const index = working.findIndex(sticker => sticker.id === result.id);
        if (index === -1) return;
        working[index].perceptualHash = result.perceptualHash;
        if (result.issues.length) localIssues.set(result.id, result.issues);
      });
    }

    // Compare pending replacements with the already-approved catalog as well as
    // with one another. Keep a previously approved image, otherwise keep the
    // lowest ID so the rule is deterministic.
    const localDuplicateGroups = findVisualDuplicateGroups(
      working.filter(sticker => sticker.status === 'completed' && sticker.perceptualHash),
      1
    );
    const locallyRejectedDuplicateIds = new Set<number>();
    localDuplicateGroups.forEach(group => {
      const approved = group.find(id => working.find(sticker => sticker.id === id)?.qaStatus === 'approved');
      const keeper = approved ?? Math.min(...group);
      group.filter(id => id !== keeper).forEach(id => locallyRejectedDuplicateIds.add(id));
    });

    const locallyApprovedCount = candidates.filter(candidate =>
      !localIssues.has(candidate.id) && !locallyRejectedDuplicateIds.has(candidate.id)
    ).length;
    if (locallyApprovedCount) {
      addLog(`Fast seller QC: ${locallyApprovedCount} locally valid design${locallyApprovedCount === 1 ? '' : 's'} approved without paid OpenAI vision or Seedream replacement.`);
    }

    candidates.forEach(candidate => {
      const index = working.findIndex(sticker => sticker.id === candidate.id);
      if (index === -1) return;
      const issues = [
        ...(localIssues.get(candidate.id) || []),
        ...(locallyRejectedDuplicateIds.has(candidate.id) ? ['Near-exact duplicate of another catalog sticker.'] : [])
      ];
      working[index] = {
        ...working[index],
        qaStatus: issues.length ? 'rejected' : 'approved',
        qaIssues: [...new Set(issues)],
        qaScore: working[index].qaScore ?? 50
      };
    });

    const approved = working.filter(sticker => sticker.status === 'completed' && sticker.qaStatus === 'approved').length;
    const rejected = working.filter(sticker => sticker.qaStatus === 'rejected').length;
    const newlyRejected = candidates.filter(candidate => working.find(sticker => sticker.id === candidate.id)?.qaStatus === 'rejected').length;
    updateMetrics({ rejectedImages: metricsRef.current.rejectedImages + newlyRejected });
    const report: QualityReport = {
      checked: working.filter(sticker => sticker.status === 'completed').length,
      approved,
      rejected,
      duplicateGroups: localDuplicateGroups,
      generatedAt: new Date().toISOString()
    };
    stickersRef.current = working;
    setState(prev => ({
      ...prev,
      stickers: working,
      qualityReport: report,
      progress: 70
    }));
    if (runIdRef.current) await saveStickerCheckpoints(runIdRef.current, working);
    await persistCheckpointMeta(niche, style, mode, targetCount, analysis, preflightRef.current, report);
    addLog(`Fast QC report: ${approved}/${targetCount} approved • ${rejected} severe technical failure${rejected === 1 ? '' : 's'}.`);
    return { stickers: working, report };
  };

  const ensureApprovedInventory = async (
    niche: NicheIdea,
    style: StylePreset,
    analysis: NicheVisualAnalysis,
    mode: ProductionRunMode,
    targetCount: number,
    turboMode: boolean
  ): Promise<{ stickers: Sticker[]; report: QualityReport }> => {
    let quality = await runStickerQualityControl(stickersRef.current, niche, style, analysis, mode, targetCount);
    const replacementBudget = mode === 'production' ? PRODUCTION_REPLACEMENT_BUDGET : TEST_REPLACEMENT_BUDGET;

    while (quality.report.approved < targetCount) {
      const remainingBudget = targetCount + replacementBudget - metricsRef.current.seedreamRequests;
      const rejectedSlots = quality.stickers
        .filter(sticker => sticker.qaStatus !== 'approved')
        .slice(0, targetCount - quality.report.approved);
      if (!rejectedSlots.length || remainingBudget < rejectedSlots.length) {
        const completed = quality.stickers.filter(sticker => sticker.status === 'completed' && sticker.blob && sticker.url).slice(0, targetCount);
        const completedIds = new Set(completed.map(sticker => sticker.id));
        const manuallyAccepted = quality.stickers.map(sticker => completedIds.has(sticker.id)
          ? {
              ...sticker,
              qaStatus: 'approved' as const,
              manuallyAccepted: sticker.qaStatus !== 'approved' || sticker.manuallyAccepted
            }
          : sticker
        );
        const report: QualityReport = {
          checked: completed.length,
          approved: completed.length,
          rejected: Math.max(0, targetCount - completed.length),
          duplicateGroups: quality.report.duplicateGroups,
          generatedAt: new Date().toISOString(),
          manualOverrideCount: completed.filter(sticker => sticker.qaStatus !== 'approved').length
        };
        stickersRef.current = manuallyAccepted;
        setState(prev => ({ ...prev, stickers: manuallyAccepted, qualityReport: report }));
        if (runIdRef.current) await saveStickerCheckpoints(runIdRef.current, manuallyAccepted);
        addLog(`Fail-open inventory: replacement loop ended at ${completed.length}/${targetCount} generated PNGs. Continuing automatically to packaging.`);
        return { stickers: completed.map(sticker => ({ ...sticker, qaStatus: 'approved' as const })), report };
      }

      addLog(`Creating ${rejectedSlots.length} distinct replacement concept${rejectedSlots.length === 1 ? '' : 's'}...`);
      const replacementPrompts = await generateReplacementStickerPrompts(
        getNicheGenerationBrief(niche),
        style,
        rejectedSlots.length,
        quality.stickers.map(sticker => sticker.prompt),
        rejectedSlots.flatMap(sticker => sticker.qaIssues || []),
        analysis
      );
      rejectedSlots.forEach((sticker, index) => {
        const currentIndex = stickersRef.current.findIndex(item => item.id === sticker.id);
        if (currentIndex === -1) return;
        if (stickersRef.current[currentIndex].url?.startsWith('blob:')) URL.revokeObjectURL(stickersRef.current[currentIndex].url!);
        stickersRef.current[currentIndex] = {
          ...stickersRef.current[currentIndex],
          prompt: replacementPrompts[index],
          url: null,
          blob: undefined,
          status: 'pending',
          qaStatus: 'pending',
          qaIssues: [],
          qaScore: undefined,
          perceptualHash: undefined,
          replacementCount: (stickersRef.current[currentIndex].replacementCount || 0) + 1
        };
      });
      setState(prev => ({ ...prev, status: 'generating_stickers', stickers: [...stickersRef.current] }));
      await generateStickerQueue(
        rejectedSlots.map(sticker => stickersRef.current.find(item => item.id === sticker.id)!),
        niche,
        style,
        analysis,
        mode,
        targetCount,
        turboMode,
        true
      );
      quality = await runStickerQualityControl(stickersRef.current, niche, style, analysis, mode, targetCount);
    }
    return {
      stickers: quality.stickers.filter(sticker => sticker.qaStatus === 'approved').slice(0, targetCount),
      report: quality.report
    };
  };

  const handleRegenerateSticker = async (stickerId: number) => {
      if (!state.currentStyle || !state.currentNiche) return;
      if (!['completed', 'error', 'paused'].includes(state.status)) {
          addLog(`Manual replacement for Sticker #${stickerId} was blocked while the production pipeline is active.`);
          return;
      }
      if (replacementInFlightRef.current.has(stickerId)) {
          addLog(`Sticker #${stickerId} already has a replacement request in progress.`);
          return;
      }
      const confirmed = window.confirm(
        `Replace Sticker #${stickerId}?\n\nThis permanently changes the concept and can use up to two paid Seedream image calls. Use the purple repair button instead when only transparency needs fixing.`
      );
      if (!confirmed) return;
      
      const stickerIndex = state.stickers.findIndex(s => s.id === stickerId);
      if (stickerIndex === -1) return;

      const sticker = state.stickers[stickerIndex];
      const newRegenCount = (sticker.regenCount || 0) + 1;
      replacementInFlightRef.current.add(stickerId);
      addLog(`Paid manual replacement confirmed for Sticker #${stickerId} (Attempt ${newRegenCount})...`);

      setState(prev => {
          const newStickers = [...prev.stickers];
          newStickers[stickerIndex] = { ...sticker, status: 'generating', regenCount: newRegenCount };
          return { ...prev, stickers: newStickers };
      });

      try {
           const replacementPrompts = await generateReplacementStickerPrompts(
             getNicheGenerationBrief(state.currentNiche),
             state.currentStyle,
             2,
             stickersRef.current.map(item => item.prompt),
             [...(sticker.qaIssues || []), 'Manual replacement requested because regenerating the same concept repeated the visual defect.'],
             visualAnalysisRef.current
           );
           let accepted: { prompt: string; blob: Blob; perceptualHash: string } | null = null;
           const localFailures: string[] = [];

           for (const freshPrompt of replacementPrompts.slice(0, 2)) {
             try {
               updateMetrics({
                 seedreamRequests: metricsRef.current.seedreamRequests + 1,
                 replacementImages: metricsRef.current.replacementImages + 1
               });
               const base64 = await generateAutopilotSticker(freshPrompt, state.currentStyle.prompt, useTurbo, getNicheGenerationBrief(state.currentNiche), visualAnalysisRef.current);
               const processedBlob = await processStickerImage(base64, freshPrompt);
               const localResult = await inspectStickerLocally({
                 ...sticker,
                 prompt: freshPrompt,
                 blob: processedBlob,
                 url: null,
                 status: 'completed'
               });
               if (!localResult.issues.length) {
                 accepted = { prompt: freshPrompt, blob: processedBlob, perceptualHash: localResult.perceptualHash };
                 break;
               }
               localFailures.push(...localResult.issues);
             } catch (candidateError) {
               localFailures.push(candidateError instanceof Error ? candidateError.message : String(candidateError));
             }
             addLog(`Replacement candidate for #${stickerId} failed local QA; trying a different concept.`);
           }

           if (!accepted) {
             throw new Error([...new Set(localFailures)].join(' ') || 'No locally valid replacement was generated.');
           }

           const finalUrl = URL.createObjectURL(accepted.blob);
           const updatedSticker: Sticker = {
             ...sticker,
             prompt: accepted.prompt,
             url: finalUrl,
             blob: accepted.blob,
             status: 'completed',
             regenCount: newRegenCount,
             qaStatus: 'pending',
             qaIssues: [],
             qaScore: undefined,
             perceptualHash: accepted.perceptualHash,
             replacementCount: (sticker.replacementCount || 0) + 1
           };
           if (sticker.url?.startsWith('blob:')) URL.revokeObjectURL(sticker.url);
           const refIndex = stickersRef.current.findIndex(item => item.id === stickerId);
           if (refIndex === -1) stickersRef.current.push(updatedSticker);
           else stickersRef.current[refIndex] = updatedSticker;

           setState(prev => {
               const newStickers = [...prev.stickers];
               const currentIndex = newStickers.findIndex(item => item.id === stickerId);
               if (currentIndex === -1) newStickers.push(updatedSticker);
               else newStickers[currentIndex] = updatedSticker;
               return { ...prev, stickers: newStickers };
           });
           
           addLog(`Sticker #${stickerId} replaced with a fresh concept and passed local QA.`);
           setNeedsZipUpdate(true); 
           if (runIdRef.current) await saveStickerCheckpoint(runIdRef.current, updatedSticker);

      } catch (e: any) {
          addLog(`Error regenerating sticker #${stickerId}: ${e.message}`);
          setState(prev => {
              const newStickers = [...prev.stickers];
              newStickers[stickerIndex] = { ...sticker, status: sticker.url ? 'completed' : 'error', regenCount: newRegenCount };
              return { ...prev, stickers: newStickers };
          });
      } finally {
          replacementInFlightRef.current.delete(stickerId);
      }
  };

  const handleRepairStickerTransparency = async (stickerId: number) => {
      if (!['completed', 'error', 'paused'].includes(state.status)) {
          addLog(`Transparency repair for Sticker #${stickerId} was blocked while the production pipeline is active.`);
          return;
      }
      const stickerIndex = stickersRef.current.findIndex(sticker => sticker.id === stickerId);
      if (stickerIndex === -1) return;
      const sticker = stickersRef.current[stickerIndex];
      if (!sticker.url || !sticker.blob) return;

      addLog(`Repairing transparent openings for Sticker #${stickerId} locally...`);
      setState(prev => {
          const nextStickers = [...prev.stickers];
          const index = nextStickers.findIndex(item => item.id === stickerId);
          if (index !== -1) nextStickers[index] = { ...nextStickers[index], status: 'generating' };
          return { ...prev, stickers: nextStickers };
      });

      try {
          const processedBlob = await processStickerImage(sticker.url, sticker.prompt, true);
          const finalUrl = URL.createObjectURL(processedBlob);
          const repairedSticker = { ...sticker, url: finalUrl, blob: processedBlob, status: 'completed' as const, qaStatus: 'pending' as const, qaIssues: [], qaScore: undefined, perceptualHash: undefined };

          setState(prev => {
              const nextStickers = [...prev.stickers];
              const index = nextStickers.findIndex(item => item.id === stickerId);
              if (index !== -1) nextStickers[index] = repairedSticker;
              return { ...prev, stickers: nextStickers };
          });
          stickersRef.current[stickerIndex] = repairedSticker;
          if (runIdRef.current) await saveStickerCheckpoint(runIdRef.current, repairedSticker);
          if (sticker.url.startsWith('blob:')) URL.revokeObjectURL(sticker.url);
          setNeedsZipUpdate(true);
          addLog(`Sticker #${stickerId} transparency repaired without regeneration.`);
      } catch (error: any) {
          setState(prev => {
              const nextStickers = [...prev.stickers];
              const index = nextStickers.findIndex(item => item.id === stickerId);
              if (index !== -1) nextStickers[index] = { ...sticker, status: 'completed' };
              return { ...prev, stickers: nextStickers };
          });
          addLog(`Could not repair Sticker #${stickerId}: ${error.message}`);
      }
  };

  const handleAddBonusSticker = async () => {
    if (!state.currentNiche || !state.currentStyle) return;

    await checkApiKey();
    
    // Create Placeholder
    const newId = state.stickers.length > 0 ? Math.max(...state.stickers.map(s => s.id)) + 1 : 1;
    addLog(`➕ Adding Bonus Sticker #${newId}...`);
    
    const placeholder: Sticker = { 
        id: newId, 
        prompt: `TYPE: Object | SUBJECT: Bonus ${state.currentNiche.name} Item | COMPOSITION: Simple | TEXT: NONE`, 
        url: null, 
        status: 'generating', 
        regenCount: 0 
    };
    
    // Update State & Ref Immediately
    setState(prev => ({
        ...prev,
        stickers: [...prev.stickers, placeholder]
    }));
    stickersRef.current.push(placeholder);

    try {
        // 1. Generate a new prompt on the fly (or just use a generic one based on niche)
        const prompts = await generateStickerPrompts(getNicheGenerationBrief(state.currentNiche), state.currentStyle, 1, visualAnalysisRef.current);
        const freshPrompt = prompts[0] || placeholder.prompt;
        
        // 2. Generate Image
        updateMetrics({ seedreamRequests: metricsRef.current.seedreamRequests + 1 });
        const base64 = await generateAutopilotSticker(freshPrompt, state.currentStyle.prompt, useTurbo, getNicheGenerationBrief(state.currentNiche), visualAnalysisRef.current);
        const processedBlob = await processStickerImage(base64, freshPrompt);
        const finalUrl = URL.createObjectURL(processedBlob);

        // 3. Update Result
        setState(prev => {
             const list = [...prev.stickers];
             const idx = list.findIndex(s => s.id === newId);
             if (idx !== -1) {
                 list[idx] = { ...list[idx], prompt: freshPrompt, url: finalUrl, blob: processedBlob, status: 'completed', qaStatus: 'pending', qaIssues: [], qaScore: undefined, perceptualHash: undefined };
             }
             return { ...prev, stickers: list };
        });
        
        // Update Ref
        const refIdx = stickersRef.current.findIndex(s => s.id === newId);
        if (refIdx !== -1) {
             stickersRef.current[refIdx] = { id: newId, prompt: freshPrompt, url: finalUrl, blob: processedBlob, status: 'completed', regenCount: 0, qaStatus: 'pending', qaIssues: [], replacementCount: 0 };
             if (runIdRef.current) await saveStickerCheckpoint(runIdRef.current, stickersRef.current[refIdx]);
        }
        
        setNeedsZipUpdate(true);
        addLog(`Bonus Sticker #${newId} Created.`);

    } catch (e: any) {
        addLog(`Failed to create bonus sticker: ${e.message}`);
         setState(prev => {
             const list = [...prev.stickers];
             const idx = list.findIndex(s => s.id === newId);
             if (idx !== -1) list[idx].status = 'error';
             return { ...prev, stickers: list };
        });
    }
  };

  // Helper: Get unique stickers for mockups to avoid redundancy across images
  const getUniqueBatchForMockup = (pool: Sticker[], count: number): string[] => {
     const valid = pool.filter(s => s.status === 'completed' && s.url && s.qaStatus === 'approved');
     const shuffled = [...valid].sort(() => 0.5 - Math.random());
     const selected: Sticker[] = [];
     const usedUrls = new Set<string>();
     const usedPrompts = new Set<string>();

     for(const s of shuffled) {
         if (selected.length >= count) break;
         const normalizedPrompt = s.prompt.toLowerCase().replace(/\s+/g, ' ').trim();
         if (!s.url || usedUrls.has(s.url) || usedPrompts.has(normalizedPrompt)) continue;
         usedUrls.add(s.url);
         usedPrompts.add(normalizedPrompt);
         selected.push(s);
     }

     return selected.map(s => s.url!);
  };

  const getSemanticCoverFallback = (pool: Sticker[], count: number): string[] => {
     const valid = pool
       .filter(sticker => sticker.status === 'completed' && sticker.url && sticker.qaStatus === 'approved')
       .sort((left, right) => (right.qaScore || 0) - (left.qaScore || 0) || left.id - right.id);
     if (valid.length <= count) return valid.map(sticker => sticker.url!);

     const subjectTokens = (sticker: Sticker) => {
       const subject = sticker.prompt.match(/SUBJECT:\s*([^|]+)/i)?.[1] || sticker.prompt;
       return new Set(subject.toLowerCase().match(/[a-z0-9]+/g)?.filter(token => token.length > 2) || []);
     };
     const distance = (left: Set<string>, right: Set<string>) => {
       const intersection = [...left].filter(token => right.has(token)).length;
       const union = new Set([...left, ...right]).size || 1;
       return 1 - intersection / union;
     };

     const selected: Sticker[] = [valid[0]];
     const remaining = valid.slice(1);
     while (selected.length < count && remaining.length) {
       let bestIndex = 0;
       let bestScore = -1;
       remaining.forEach((candidate, index) => {
         const candidateTokens = subjectTokens(candidate);
         const novelty = Math.min(...selected.map(chosen => distance(candidateTokens, subjectTokens(chosen))));
         const noTextBonus = /TEXT:\s*(?:NONE|NO TEXT)/i.test(candidate.prompt) ? 0.08 : 0;
         const score = novelty + noTextBonus + (candidate.qaScore || 0) / 1000;
         if (score > bestScore) {
           bestScore = score;
           bestIndex = index;
         }
       });
       selected.push(remaining.splice(bestIndex, 1)[0]);
     }
     return selected.map(sticker => sticker.url!);
  };

  const getModelSelectedCoverBatch = async (pool: Sticker[], count = 14): Promise<string[]> => {
     const valid = pool
       .filter(sticker => sticker.status === 'completed' && sticker.url && sticker.qaStatus === 'approved')
       .sort((left, right) => (right.qaScore || 0) - (left.qaScore || 0));
     if (valid.length <= count) return valid.map(sticker => sticker.url!);

     try {
       addLog(`Choosing ${count} strongest existing stickers for the main thumbnail (selection only; no images will be replaced)...`);
       const selectedIds = await selectCoverStickerIds(
         valid.map(sticker => ({ id: sticker.id, prompt: sticker.prompt })),
         count
       );
       const byId = new Map(valid.map(sticker => [sticker.id, sticker]));
       const selected: Sticker[] = [];
       const usedUrls = new Set<string>();

       selectedIds.forEach(id => {
         const sticker = byId.get(id);
         if (!sticker?.url || usedUrls.has(sticker.url)) return;
         usedUrls.add(sticker.url);
         selected.push(sticker);
       });
       for (const sticker of valid) {
         if (selected.length >= count) break;
         if (!sticker.url || usedUrls.has(sticker.url)) continue;
         usedUrls.add(sticker.url);
         selected.push(sticker);
       }
       return selected.slice(0, count).map(sticker => sticker.url!);
     } catch (error) {
       console.warn('Cover selection failed; using the diversity fallback.', error);
       const message = error instanceof Error ? error.message : String(error);
       addLog(`Cover selector unavailable: ${message} Using the free local semantic-diversity selector.`);
       return getSemanticCoverFallback(valid, count);
     }
  };

  const getStickerRange = (stickers: Sticker[], start: number, end: number) => {
       const subset = stickers.slice(start, end);
       const valid = subset.filter(s => s.status === 'completed' && s.url && s.qaStatus === 'approved');
       return [...new Set(valid.map(s => s.url!))];
  };

  const handleRegenerateMockup = async (assetId: string) => {
      const assetIndex = state.marketingAssets.findIndex(a => a.id === assetId);
      if (assetIndex === -1 || !state.currentNiche) return;

      const asset = state.marketingAssets[assetIndex];
      addLog(asset.type === 'cover'
        ? `Creating a fresh creative direction and full Seedream hero: ${asset.title}...`
        : `Refining Mockup: ${asset.title}...`);
      
      setState(prev => {
          const nextAssets = [...prev.marketingAssets];
          nextAssets[assetIndex] = { ...asset, status: 'generating' };
          return { ...prev, marketingAssets: nextAssets };
      });

      try {
          const validStickers = stickersRef.current
            .filter(sticker => sticker.status === 'completed' && sticker.url && sticker.qaStatus === 'approved')
            .slice(0, state.targetCount);
          let stickersForMockup: string[] = [];

          // Expanded Logic to slice 100 stickers into 6 grids
           if (asset.id === 'preview_1') stickersForMockup = getStickerRange(validStickers, 0, 17);
           else if (asset.id === 'preview_2') stickersForMockup = getStickerRange(validStickers, 17, 34);
           else if (asset.id === 'preview_3') stickersForMockup = getStickerRange(validStickers, 34, 51);
           else if (asset.id === 'preview_4') stickersForMockup = getStickerRange(validStickers, 51, 68);
           else if (asset.id === 'preview_5') stickersForMockup = getStickerRange(validStickers, 68, 85);
           else if (asset.id === 'preview_6') stickersForMockup = getStickerRange(validStickers, 85, 100);
           
           // Use Unique Batch Logic for Mockups to avoid repeats
           else if (asset.type === 'cover') stickersForMockup = await getModelSelectedCoverBatch(validStickers, 14);
           else if (asset.type === 'closeup') stickersForMockup = getUniqueBatchForMockup(validStickers, 4);
           else if (asset.type === 'included') stickersForMockup = getUniqueBatchForMockup(validStickers, 8);
           else if (asset.type === 'howto') stickersForMockup = getUniqueBatchForMockup(validStickers, 4);
           else stickersForMockup = getUniqueBatchForMockup(validStickers, 8); 

          if (['cover', 'goodnotes', 'laptop', 'journal', 'lifestyle'].includes(asset.type)) {
            updateMetrics({ seedreamMockupRequests: metricsRef.current.seedreamMockupRequests + 1 });
          }
          const url = await generateSeedreamMockup(
             asset.id!, 
             asset.type, 
             stickersForMockup, 
             state.currentNiche.name,
             validStickers.filter(sticker => sticker.status === 'completed' && sticker.url).length
          );
          const completedAsset: MarketingAsset = { ...asset, url, status: 'completed' };
          setState(prev => {
              const nextAssets = [...prev.marketingAssets];
              nextAssets[assetIndex] = completedAsset;
              return { ...prev, marketingAssets: nextAssets };
          });
          await persistMarketingAsset(completedAsset);
          addLog(`${asset.title} Updated.`);

      } catch (e: any) {
           addLog(`Failed to update mockup: ${e.message}`);
           setState(prev => {
              const nextAssets = [...prev.marketingAssets];
              nextAssets[assetIndex] = { ...asset, status: 'error' };
              return { ...prev, marketingAssets: nextAssets };
          });
      }
  };

  const handleUpdateZips = async () => {
      if (!state.currentNiche || !state.currentStyle || !visualAnalysisRef.current) return;
      try {
        addLog('Re-running quality control before updating ZIP archives...');
        const quality = await ensureApprovedInventory(
          state.currentNiche,
          state.currentStyle,
          visualAnalysisRef.current,
          state.runMode,
          state.targetCount,
          useTurbo
        );
        stickersRef.current = quality.stickers;
        setState(prev => ({...prev, status: 'zipping'}));
        const zips = await packageStickers(quality.stickers, state.currentNiche.name, state.runMode, state.targetCount);
        setState(prev => ({ ...prev, zips, status: 'completed', qualityReport: quality.report }));
        setNeedsZipUpdate(false);
        addLog('ZIPs updated and production preflight passed.');
      } catch (error) {
        addLog(`ZIP update blocked: ${error instanceof Error ? error.message : String(error)}`);
        setState(prev => ({ ...prev, status: 'error' }));
      }
  };

  const handleDownloadAll = async () => {
    if (!state.currentNiche) return;
    
    // IMMEDIATE LOADING STATE
    setIsDownloading(true);
    addLog("Preparing Master Kit Download...");
    
    // Yield to allow UI update
    await new Promise(r => setTimeout(r, 50));

    try {
        const masterZip = new JSZip();

        addLog("Packaging latest stickers into ZIPs...");
        const freshZips = await packageStickers(stickersRef.current, state.currentNiche.name, state.runMode, state.targetCount);
        const generatedCount = stickersRef.current.filter(sticker => sticker.status === 'completed' && sticker.blob).slice(0, state.targetCount).length;
        if (generatedCount < state.targetCount) {
          masterZip.file('RECOVERY_NOTICE.txt', `This run finished in fail-open recovery mode.\n\nGenerated PNGs: ${generatedCount}\nRequested PNGs: ${state.targetCount}\n\nOnly files that actually exist were packaged. The listing must not be published as a ${state.targetCount}-sticker product until the missing images are generated. Your saved checkpoint remains available for resume.\n`);
        }

        const stickersFolder = masterZip.folder("1_Sticker_Packs");
        freshZips.forEach(z => {
          stickersFolder?.file(z.name, z.blob);
        });

        const mockupsFolder = masterZip.folder("2_Listing_Assets");
        for (const asset of state.marketingAssets) {
           if (asset.url && asset.status === 'completed') {
               try {
                   // USE DIRECT BLOB CONVERSION INSTEAD OF FETCH TO AVOID "BODY USED" ERRORS
                   let blob: Blob;
                   if (asset.url.startsWith('data:')) {
                       blob = dataURLToBlob(asset.url);
                   } else {
                       const response = await fetch(asset.url);
                       blob = await response.blob();
                   }
                   
                   const safeName = asset.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                   const extension = asset.format === 'video'
                     ? (asset.mimeType?.includes('mp4') ? 'mp4' : 'webm')
                     : 'jpg';
                   mockupsFolder?.file(`${safeName}.${extension}`, blob);
               } catch (e) {
                   console.error("Failed to add asset to zip", e);
               }
           }
        }

        if (state.rawListing) {
           masterZip.file("3_SEO_Listing_Copy.txt", state.rawListing);
        }
        if (state.qualityReport) {
          masterZip.file('4_PRODUCTION_QA_REPORT.json', JSON.stringify({
            niche: state.currentNiche.name,
            runMode: state.runMode,
            targetCount: state.targetCount,
            quality: state.qualityReport,
            metrics: state.metrics,
            preflight: state.preflight
          }, null, 2));
        }
        masterZip.file('5_PERFORMANCE_TRACKER.csv', 'date,listing_url,cover_variant,impressions,clicks,favorites,orders,revenue,notes\n');

        const content = await masterZip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `COMPLETE_KIT_${state.currentNiche.name.replace(/[^a-z0-9]/gi, '_')}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        
        setState(prev => ({ ...prev, zips: freshZips }));
        setNeedsZipUpdate(false);
        addLog("Master Kit Downloaded.");
    } catch (e) {
        console.error("Download failed", e);
        addLog("Download failed. Please try again.");
    } finally {
        setIsDownloading(false);
    }
  };

  const copyImageToClipboard = async (blob?: Blob) => {
    if (!blob) return;
    try {
      const item = new ClipboardItem({ "image/png": blob });
      await navigator.clipboard.write([item]);
      addLog("Image copied to clipboard!");
    } catch (err) {
      console.error(err);
      addLog("Failed to copy image. Browser might not support it.");
    }
  };

  const finishRecoveredProduction = async (
    niche: NicheIdea,
    style: StylePreset,
    analysis: NicheVisualAnalysis,
    mode: ProductionRunMode,
    targetCount: number,
    turboMode: boolean,
    qualityReport: QualityReport,
    preflight: RunCheckpointMeta['preflight'],
    recoveredAssets: MarketingAsset[] = [],
    skipMissingMarketing = false,
    recoveredListing?: string
  ) => {
    setState(prev => ({ ...prev, status: 'zipping', progress: 75 }));
    addLog('Packaging recovered run after the final inventory decision...');
    const zips = await packageStickers(stickersRef.current, niche.name, mode, targetCount);
    setState(prev => ({ ...prev, zips, status: 'marketing', progress: 85 }));

    const previewCount = Math.min(6, Math.ceil(targetCount / 17));
    const previewAssets: MarketingAsset[] = Array.from({ length: previewCount }, (_, index) => ({
      id: `preview_${index + 1}`,
      type: 'preview',
      title: `Grid Preview (Vol ${index + 1})`,
      url: null,
      status: 'pending'
    }));
    const baseAssets: MarketingAsset[] = [
      { id: 'cover_a', type: 'cover', title: 'Main Cover A (Full Seedream Hero)', url: null, status: 'pending' },
      { id: 'cover_b', type: 'cover', title: 'Main Cover B (Full Seedream Editorial)', url: null, status: 'pending' },
      { id: 'cover_c', type: 'cover', title: 'Main Cover C (Full Seedream Catalog)', url: null, status: 'pending' },
      { id: 'included', type: 'included', title: 'What You Receive', url: null, status: 'pending' },
      { id: 'quality_proof', type: 'closeup', title: 'Transparent Edge Quality Proof', url: null, status: 'pending' },
      ...previewAssets,
      { id: 'mockup_goodnotes_1', type: 'goodnotes', title: 'GoodNotes UI View', url: null, status: 'pending' },
      { id: 'mockup_goodnotes_2', type: 'goodnotes', title: 'GoodNotes Spread', url: null, status: 'pending' },
      { id: 'mockup_laptop', type: 'laptop', title: 'Laptop Skin', url: null, status: 'pending' },
      { id: 'mockup_journal', type: 'journal', title: 'Journal/Planner', url: null, status: 'pending' },
      { id: 'howto', type: 'howto', title: 'How To Use', url: null, status: 'pending' }
    ];
    const recoveredById = new Map(
      recoveredAssets
        .filter(asset => asset.id && asset.status === 'completed' && asset.url)
        .map(asset => [asset.id!, asset])
    );
    const assets = baseAssets.map((asset, index) => {
      const numberedAsset = { ...asset, title: `${index + 1}. ${asset.title}` };
      const recovered = asset.id ? recoveredById.get(asset.id) : undefined;
      return recovered ? { ...numberedAsset, ...recovered, status: 'completed' as const } : numberedAsset;
    });
    const recoveredVideo = recoveredById.get('listing_video');
    if (recoveredVideo) assets.push(recoveredVideo);
    if (recoveredById.size) {
      await Promise.allSettled([...recoveredById.values()].map(asset => persistMarketingAsset(asset)));
    }
    setState(prev => ({ ...prev, marketingAssets: [...assets] }));
    if (recoveredById.size) {
      addLog(`Reusing ${recoveredById.size} completed marketing asset${recoveredById.size === 1 ? '' : 's'} from the saved run; no Seedream charge for those files.`);
    }
    const approved = stickersRef.current.filter(sticker => sticker.qaStatus === 'approved' && sticker.url).slice(0, targetCount);
    const imageAssetCount = baseAssets.length;
    const missingTasks = assets
      .map((asset, index) => ({ asset, index }))
      .filter(({ asset }) => asset.id !== 'listing_video' && (asset.status !== 'completed' || !asset.url));

    if (skipMissingMarketing && missingTasks.length) {
      missingTasks.forEach(({ asset, index }) => {
        assets[index] = { ...asset, status: 'error' };
      });
      addLog(`Resume protection: skipped ${missingTasks.length} missing mockup${missingTasks.length === 1 ? '' : 's'} because this run had already reached copywriting. Regenerate only a specific asset manually if you want it.`);
    }

    const tasksToGenerate = skipMissingMarketing ? [] : missingTasks;
    const needsCoverSelection = tasksToGenerate.some(({ asset }) => asset.type === 'cover');
    const coverUrls = needsCoverSelection ? await getModelSelectedCoverBatch(approved, 14) : [];
    let finished = assets.filter(asset => asset.id !== 'listing_video' && asset.status === 'completed').length;

    await processWithQueue(tasksToGenerate, 6, async ({ asset, index }) => {
      const valid = approved;
      let urls: string[] = [];
      if (asset.id?.startsWith('preview_')) {
        const page = Number(asset.id.split('_')[1]) - 1;
        urls = getStickerRange(valid, page * 17, Math.min(valid.length, page * 17 + 17));
      } else if (asset.type === 'cover') urls = coverUrls;
      else if (asset.type === 'closeup') urls = getUniqueBatchForMockup(valid, 4);
      else if (asset.type === 'included') urls = getUniqueBatchForMockup(valid, 8);
      else if (asset.type === 'howto') urls = getUniqueBatchForMockup(valid, 4);
      else urls = getUniqueBatchForMockup(valid, 8);
      try {
        if (['cover', 'goodnotes', 'laptop', 'journal', 'lifestyle'].includes(asset.type)) {
          updateMetrics({ seedreamMockupRequests: metricsRef.current.seedreamMockupRequests + 1 });
        }
        const url = await generateSeedreamMockup(asset.id!, asset.type, urls, niche.name, targetCount);
        const completedAsset: MarketingAsset = { ...asset, url, status: 'completed' };
        assets[index] = completedAsset;
        await persistMarketingAsset(completedAsset);
      } catch (error) {
        assets[index] = { ...asset, status: 'error' };
        addLog(`Recovered-run asset failed: ${asset.title}. ${error instanceof Error ? error.message : String(error)}`);
      }
      finished++;
      setState(prev => ({
        ...prev,
        marketingAssets: [...assets],
        progress: 85 + Math.round((finished / imageAssetCount) * 9)
      }));
    });

    if (skipMissingMarketing) {
      setState(prev => ({ ...prev, marketingAssets: [...assets], progress: 94 }));
    }

    const criticalIds = new Set(['cover_a', 'included', 'quality_proof', 'howto', 'preview_1']);
    const failedCritical = assets.filter(asset => criticalIds.has(asset.id || '') && asset.status !== 'completed');
    if (failedCritical.length) {
      addLog(`Recovery warning: these listing assets could not be created and were skipped: ${failedCritical.map(asset => asset.title).join(', ')}.`);
    }
    if (!recoveredVideo && !skipMissingMarketing) {
      try {
        const video = await createListingPreviewVideo(
          assets.filter(asset => asset.url && ['cover', 'closeup', 'included', 'howto'].includes(asset.type)).map(asset => asset.url!)
        );
        const videoAsset: MarketingAsset = {
          id: 'listing_video',
          type: 'social',
          title: 'Listing Preview Video',
          url: video.url,
          status: 'completed',
          format: 'video',
          mimeType: video.mimeType
        };
        assets.push(videoAsset);
        await persistMarketingAsset(videoAsset);
        setState(prev => ({ ...prev, marketingAssets: [...assets] }));
      } catch (error) {
        addLog(`Listing video skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    setState(prev => ({ ...prev, status: 'copywriting', progress: 95 }));
    addLog('Generating SEO Listing Copy...');
    const completedStickerCount = stickersRef.current.filter(sticker => sticker.status === 'completed' && sticker.blob).slice(0, targetCount).length;
    await persistCheckpointMeta(niche, style, mode, targetCount, analysis, preflight, qualityReport, recoveredListing || '');
    const rawListing = recoveredListing || await generateAutopilotListing(niche.name, style.name, turboMode, completedStickerCount);
    metricsRef.current = { ...metricsRef.current, finishedAt: new Date().toISOString() };
    await persistCheckpointMeta(niche, style, mode, targetCount, analysis, preflight, qualityReport, rawListing);
    setState(prev => ({
      ...prev,
      rawListing,
      status: 'completed',
      progress: 100,
      qualityReport,
      metrics: metricsRef.current
    }));
    addLog(`${mode === 'production' ? 'PRODUCTION' : 'TEST'} COMPLETE after checkpoint recovery with ${completedStickerCount}/${targetCount} generated PNGs.`);
  };

  const finishWithGeneratedInventory = async () => {
    if (!state.currentNiche || !state.currentStyle || !visualAnalysisRef.current) return;
    const completed = stickersRef.current
      .filter(sticker => sticker.status === 'completed' && sticker.blob && sticker.url)
      .slice(0, state.targetCount);
    if (completed.length < state.targetCount) {
      addLog(`Cannot continue yet: only ${completed.length}/${state.targetCount} generated PNGs exist.`);
      return;
    }

    const completedIds = new Set(completed.map(sticker => sticker.id));
    const manualOverrideCount = completed.filter(sticker => sticker.qaStatus !== 'approved').length;
    const overridden = stickersRef.current.map(sticker => completedIds.has(sticker.id)
      ? {
          ...sticker,
          qaStatus: 'approved' as const,
          manuallyAccepted: sticker.qaStatus !== 'approved' || sticker.manuallyAccepted,
          qaIssues: sticker.qaIssues || []
        }
      : sticker
    );
    const overrideReport: QualityReport = {
      checked: state.targetCount,
      approved: state.targetCount,
      rejected: 0,
      duplicateGroups: state.qualityReport?.duplicateGroups || [],
      generatedAt: new Date().toISOString(),
      manualOverrideCount
    };

    stickersRef.current = overridden;
    setState(prev => ({
      ...prev,
      status: 'zipping',
      progress: 75,
      stickers: overridden,
      qualityReport: overrideReport
    }));
    addLog(`Manual finish selected: continuing with ${state.targetCount} generated PNGs. ${manualOverrideCount} QA-rejected image${manualOverrideCount === 1 ? '' : 's'} kept for manual review; no more sticker replacements will run.`);
    if (runIdRef.current) await saveStickerCheckpoints(runIdRef.current, overridden);

    try {
      const alreadyReachedCopywriting = logsRef.current.some(entry => /Generating SEO Listing Copy|RESUME ERROR:.*(?:listing|tags|OpenAI)/i.test(entry));
      await finishRecoveredProduction(
        state.currentNiche,
        state.currentStyle,
        visualAnalysisRef.current,
        state.runMode,
        state.targetCount,
        useTurbo,
        overrideReport,
        state.preflight,
        state.marketingAssets,
        alreadyReachedCopywriting,
        state.rawListing
      );
      setNeedsZipUpdate(false);
    } catch (error) {
      addLog(`FINISH ERROR: ${error instanceof Error ? error.message : String(error)}`);
      setState(prev => ({ ...prev, status: 'error' }));
    } finally {
      audioRef.current?.pause();
      releaseWakeLock();
    }
  };

  const resumeSavedRun = async () => {
    try {
      await checkApiKey();
      const checkpoint = await loadRunCheckpoint();
      if (!checkpoint) throw new Error('No saved production checkpoint was found.');
      const { meta, stickers, marketingAssets: persistedAssets } = checkpoint;
      const sameVisibleRun = runIdRef.current === meta.id;
      const visibleAssets = sameVisibleRun
        ? state.marketingAssets.filter(asset => asset.status === 'completed' && asset.url)
        : [];
      const recoveredAssetMap = new Map<string, MarketingAsset>();
      persistedAssets.forEach(asset => {
        if (asset.id && asset.status === 'completed' && asset.url) recoveredAssetMap.set(asset.id, asset);
      });
      visibleAssets.forEach(asset => {
        if (asset.id && !recoveredAssetMap.has(asset.id)) recoveredAssetMap.set(asset.id, asset);
      });
      const recoveredAssets = [...recoveredAssetMap.values()];
      const recoveredLogs = sameVisibleRun
        ? [...new Set([...(meta.logs || []), ...state.logs])]
        : (meta.logs || []);
      const recoveredListing = meta.rawListing || (sameVisibleRun ? state.rawListing : undefined);
      const alreadyReachedCopywriting = recoveredLogs.some(entry => /Generating SEO Listing Copy|RESUME ERROR:.*(?:listing|tags|OpenAI)/i.test(entry));
      runIdRef.current = meta.id;
      logsRef.current = recoveredLogs;
      metricsRef.current = { rejectedImages: 0, seedreamMockupRequests: 0, ...meta.metrics };
      preflightRef.current = meta.preflight;
      setRunMode(meta.runMode);
      setUseTurbo(meta.useTurbo);
      setAllowRiskyNiche(meta.allowRiskyNiche);
      turboModeRef.current = meta.useTurbo;
      riskOverrideRef.current = meta.allowRiskyNiche;
      stopSignal.current = false;
      skipToNextStageSignal.current = false;
      stickersRef.current = stickers;
      visualAnalysisRef.current = meta.analysis;
      setState(prev => ({
        ...prev,
        status: 'generating_stickers',
        currentNiche: meta.currentNiche,
        currentStyle: meta.currentStyle,
        runMode: meta.runMode,
        targetCount: meta.targetCount,
        stickers,
        zips: [],
        marketingAssets: recoveredAssets,
        rawListing: recoveredListing,
        logs: recoveredLogs,
        qualityReport: meta.qualityReport,
        metrics: metricsRef.current,
        preflight: meta.preflight,
        checkpointUpdatedAt: meta.updatedAt,
        progress: Math.min(62, 10 + Math.round((stickers.filter(sticker => sticker.status === 'completed').length / meta.targetCount) * 52))
      }));
      addLog(`Resuming saved ${meta.runMode} run from ${new Date(meta.updatedAt).toLocaleString()}...`);
      if (recoveredAssets.length) {
        addLog(`Recovered ${recoveredAssets.length} completed marketing asset${recoveredAssets.length === 1 ? '' : 's'}; they will not be regenerated.`);
        await Promise.allSettled(recoveredAssets.map(asset => saveMarketingAssetCheckpoint(meta.id, asset)));
      } else if (alreadyReachedCopywriting) {
        addLog('This older checkpoint reached copywriting before mockup files were checkpointed. Automatic mockup regeneration is disabled to prevent another Seedream charge; ZIPs and listing copy will still finish.');
      }
      if (audioRef.current) audioRef.current.play().catch(error => console.warn('Audio play blocked', error));
      await requestWakeLock();
      const analysis = meta.analysis || await analyzeNicheVisuals(getNicheGenerationBrief(meta.currentNiche));
      visualAnalysisRef.current = analysis;
      const missing = stickersRef.current.filter(sticker => sticker.status !== 'completed' || !sticker.blob);
      if (missing.length) {
        await generateStickerQueue(missing, meta.currentNiche, meta.currentStyle, analysis, meta.runMode, meta.targetCount, meta.useTurbo);
      }
      if (stopSignal.current) throw new Error('Stopped by user');
      if (skipToNextStageSignal.current) {
        setState(prev => ({ ...prev, status: 'paused' }));
        addLog('Recovered run paused safely.');
        return;
      }
      const approvedCount = stickersRef.current.filter(sticker => sticker.status === 'completed' && sticker.blob && sticker.qaStatus === 'approved').length;
      const canReuseQuality = approvedCount >= meta.targetCount && Boolean(meta.qualityReport && meta.qualityReport.approved >= meta.targetCount);
      const quality = canReuseQuality
        ? { stickers: stickersRef.current, report: meta.qualityReport! }
        : await ensureApprovedInventory(meta.currentNiche, meta.currentStyle, analysis, meta.runMode, meta.targetCount, meta.useTurbo);
      if (canReuseQuality) addLog('Reusing the completed quality decision from the checkpoint; QC will not run again.');
      stickersRef.current = quality.stickers;
      await finishRecoveredProduction(
        meta.currentNiche,
        meta.currentStyle,
        analysis,
        meta.runMode,
        meta.targetCount,
        meta.useTurbo,
        quality.report,
        meta.preflight,
        recoveredAssets,
        alreadyReachedCopywriting,
        recoveredListing
      );
    } catch (error) {
      addLog(`RESUME ERROR: ${error instanceof Error ? error.message : String(error)}`);
      setState(prev => ({ ...prev, status: 'error' }));
    } finally {
      audioRef.current?.pause();
      releaseWakeLock();
    }
  };

  const discardSavedRun = async () => {
    await clearRunCheckpoint();
    setSavedCheckpoint(null);
    addLog('Saved checkpoint removed. Generated files currently visible in this tab were not deleted.');
  };

  const runAutopilot = async () => {
    try {
      await checkApiKey();
      const activeMode = runMode;
      const activeTarget = activeMode === 'production' ? PRODUCTION_STICKER_COUNT : TEST_STICKER_COUNT;
      turboModeRef.current = useTurbo;
      riskOverrideRef.current = allowRiskyNiche;
      stickersRef.current.forEach(sticker => {
        if (sticker.url?.startsWith('blob:')) URL.revokeObjectURL(sticker.url);
      });
      state.marketingAssets.forEach(asset => {
        if (asset.url?.startsWith('blob:')) URL.revokeObjectURL(asset.url);
      });
      runIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      logsRef.current = [];
      metricsRef.current = {
        seedreamRequests: 0,
        seedreamMockupRequests: 0,
        replacementImages: 0,
        rejectedImages: 0,
        qaRuns: 0,
        rateLimitEvents: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null
      };
      stopSignal.current = false;
      skipToNextStageSignal.current = false;
      setNeedsZipUpdate(false);
      usedStickerIdsRef.current.clear(); // Reset used sticker tracking for new run
      
      // START KEEP ALIVE AUDIO
      if (audioRef.current) {
          audioRef.current.play().catch(e => console.warn("Audio play blocked", e));
      }
      // START WAKE LOCK
      await requestWakeLock();
      
      setState(prev => ({
          ...prev,
          status: 'preflight',
          runMode: activeMode,
          targetCount: activeTarget,
          progress: 5,
          listing: null,
          rawListing: undefined,
          stickers: [],
          zips: [],
          marketingAssets: [],
          logs: [],
          qualityReport: null,
          preflight: null,
          metrics: metricsRef.current,
          checkpointUpdatedAt: null
      }));
      addLog(`Starting ${activeMode === 'production' ? '100-sticker production' : '10-sticker test'} run...`);
      addLog(`Seedream concurrency: up to ${useTurbo ? seedreamWorkerLimitRef.current : Math.min(seedreamWorkerLimitRef.current, 8)} adaptive workers (server cap ${seedreamWorkerLimitRef.current}).`);
      
      const niche = availableNiches.find(n => n.id === selectedNicheId);
      const rawStyle = availableStyles.find(s => s.id === selectedStyleId) || availableStyles[0];

      if (!niche) throw new Error("Selected Niche not found");
      if (!rawStyle) throw new Error("Selected Style not found");
      const generationBrief = getNicheGenerationBrief(niche);

      // --- AUTO-STYLE RESOLUTION ---
      let style = rawStyle;
      if (style.id === 'auto') {
          const match = niche.name.match(/\((.*?)\)/);
          const extracted = match ? match[1] : niche.name; // Fallback to name if no brackets
          
          style = {
               id: 'auto_resolved',
               name: `Auto: ${extracted}`,
               // Construct a versatile prompt based on the niche text
               // CHANGED: Removed "vector sticker" and "flat 2d" to allow for more styles (Realism, Painterly, etc.)
               prompt: `"${extracted} aesthetic"; high quality digital sticker art; white border; trending on etsy; commercial illustration`
           };
           addLog(`✨ Auto-Detect Active: Applying style "${extracted}"`);
      }

      setState(prev => ({ ...prev, currentNiche: niche!, currentStyle: style }));

      addLog(`Market and rights preflight for "${niche.name}"...`);
      const preflight = await assessNicheForProduction(generationBrief);
      preflightRef.current = preflight;
      setState(prev => ({ ...prev, preflight }));
      if (!preflight.sources.length && preflight.summary.includes('OpenAI')) {
        addLog('OpenAI market research is unavailable. Continuing with the conservative offline preflight.');
      }
      addLog(`Preflight: demand ${preflight.demandScore}/100 • variety ${preflight.variationScore}/100 • IP risk ${preflight.ipRisk}.`);
      if ((preflight.recommendation === 'block' || preflight.ipRisk === 'high') && !allowRiskyNiche) {
        throw new Error(`Niche preflight blocked this paid run: ${preflight.summary} Enable the manual rights-review override only if you have verified permission.`);
      }

      // --- STEP 0: ANALYZE NICHE VISUALS ---
      setState(prev => ({ ...prev, status: 'researching' }));
      addLog(`🧠 Analyzing buyer intent for "${niche.name}"...`);
      const analysis = await analyzeNicheVisuals(generationBrief);
      visualAnalysisRef.current = analysis;
      if (analysis.visualStyle === 'Cohesive commercial sticker illustration') {
        addLog('OpenAI art-direction analysis is unavailable. Continuing with the built-in broad-theme art direction.');
      }
      addLog(`Visual Archetype Detected: ${analysis.archetype}`);

      addLog(`Brainstorming sticker concepts (${activeTarget})...`);
      // Pass the analysis to prompt generation so it knows to make Frames if needed
      const prompts = await generateStickerPrompts(generationBrief, style, activeTarget, analysis);
      
      const stickerObjects: Sticker[] = prompts.map((p, i) => ({
        id: i + 1, prompt: p, url: null, status: 'pending', regenCount: 0, qaStatus: 'pending', qaIssues: [], replacementCount: 0
      }));
      
      setState(prev => ({ ...prev, stickers: stickerObjects, status: 'generating_stickers' }));
      stickersRef.current = stickerObjects;
      await saveStickerCheckpoints(runIdRef.current, stickerObjects);
      await persistCheckpointMeta(niche, style, activeMode, activeTarget, analysis, preflight, null);

      await generateStickerQueue(stickerObjects, niche, style, analysis, activeMode, activeTarget, useTurbo);

      if (stopSignal.current) throw new Error("Stopped by user");
      if (skipToNextStageSignal.current) {
        skipToNextStageSignal.current = false;
        await persistCheckpointMeta(niche, style, activeMode, activeTarget, analysis, preflight, null);
        setState(prev => ({ ...prev, status: 'paused' }));
        addLog('Run paused safely. Use RESUME SAVED RUN to continue the missing stickers.');
        return;
      }

      const qualityResult = await ensureApprovedInventory(niche, style, analysis, activeMode, activeTarget, useTurbo);
      stickersRef.current = qualityResult.stickers;
      skipToNextStageSignal.current = false; 
      setState(prev => ({ ...prev, status: 'zipping', progress: 75 }));
      addLog(`Packaging ZIP files...`);
      const zips = await packageStickers(stickersRef.current, niche!.name, activeMode, activeTarget);
      setState(prev => ({ ...prev, zips }));

      if (stopSignal.current) throw new Error("Stopped by user");
      setState(prev => ({ ...prev, status: 'marketing', progress: 85 }));
      addLog("Creating Mockups...");

      const availableStickerCount = Math.min(
        activeTarget,
        stickersRef.current.filter(sticker => sticker.status === 'completed' && sticker.url && sticker.qaStatus === 'approved').length
      );
      const previewCount = Math.min(6, Math.ceil(availableStickerCount / 17));
      const previewAssets: MarketingAsset[] = Array.from({ length: previewCount }, (_, index) => ({
        id: `preview_${index + 1}`,
        type: 'preview',
        title: `Grid Preview (Vol ${index + 1})`,
        url: null,
        status: 'pending'
      }));
      const baseAssets: MarketingAsset[] = [
        { id: 'cover_a', type: 'cover', title: 'Main Cover A (Full Seedream Hero)', url: null, status: 'pending' },
        { id: 'cover_b', type: 'cover', title: 'Main Cover B (Full Seedream Editorial)', url: null, status: 'pending' },
        { id: 'cover_c', type: 'cover', title: 'Main Cover C (Full Seedream Catalog)', url: null, status: 'pending' },
        { id: 'included', type: 'included', title: 'What You Receive', url: null, status: 'pending' },
        { id: 'quality_proof', type: 'closeup', title: 'Transparent Edge Quality Proof', url: null, status: 'pending' },
        ...previewAssets,
        { id: 'mockup_goodnotes_1', type: 'goodnotes', title: 'GoodNotes UI View', url: null, status: 'pending' },
        { id: 'mockup_goodnotes_2', type: 'goodnotes', title: 'GoodNotes Spread', url: null, status: 'pending' },
        { id: 'mockup_laptop', type: 'laptop', title: 'Laptop Skin', url: null, status: 'pending' },
        { id: 'mockup_journal', type: 'journal', title: 'Journal/Planner', url: null, status: 'pending' },
        { id: 'howto', type: 'howto', title: 'How To Use', url: null, status: 'pending' },
      ];
      const assetsToGen: MarketingAsset[] = baseAssets.map((asset, index) => ({
        ...asset,
        title: `${index + 1}. ${asset.title}`
      }));

      setState(prev => ({ ...prev, marketingAssets: assetsToGen }));
      const approvedForMarketing = stickersRef.current
        .filter(sticker => sticker.status === 'completed' && sticker.url && sticker.qaStatus === 'approved')
        .slice(0, activeTarget);
      const selectedCoverUrls = await getModelSelectedCoverBatch(approvedForMarketing, 14);
      let finishedAssets = 0;
      await processWithQueue(assetsToGen, 6, async (asset, i) => {
        if (stopSignal.current) return;
        const assetStartedAt = Date.now();
        addLog(`Generating asset: ${asset.title}`);
        if (asset.id === 'cover_a') addLog('Creative director: studying the real sticker set before Seedream composes the three hero directions...');
        setState(prev => {
          const nextAssets = [...prev.marketingAssets];
          nextAssets[i] = { ...asset, status: 'generating' };
          return { ...prev, marketingAssets: nextAssets };
        });

        try {
          const validStickers = stickersRef.current
            .filter(sticker => sticker.status === 'completed' && sticker.url && sticker.qaStatus === 'approved')
            .slice(0, activeTarget);
          let stickersForMockup: string[] = [];

          if (asset.id === 'preview_1') stickersForMockup = getStickerRange(validStickers, 0, 17);
          else if (asset.id === 'preview_2') stickersForMockup = getStickerRange(validStickers, 17, 34);
          else if (asset.id === 'preview_3') stickersForMockup = getStickerRange(validStickers, 34, 51);
          else if (asset.id === 'preview_4') stickersForMockup = getStickerRange(validStickers, 51, 68);
          else if (asset.id === 'preview_5') stickersForMockup = getStickerRange(validStickers, 68, 85);
          else if (asset.id === 'preview_6') stickersForMockup = getStickerRange(validStickers, 85, 100);
          else if (asset.type === 'cover') stickersForMockup = selectedCoverUrls;
          else if (asset.type === 'closeup') stickersForMockup = getUniqueBatchForMockup(validStickers, 4);
          else if (asset.type === 'included') stickersForMockup = getUniqueBatchForMockup(validStickers, 8);
          else if (asset.type === 'howto') stickersForMockup = getUniqueBatchForMockup(validStickers, 4);
          else stickersForMockup = getUniqueBatchForMockup(validStickers, 8);

          if (!stickersForMockup.length) {
            throw new Error('No completed stickers are available for this asset.');
          }

          const completedStickerCount = validStickers.filter(sticker => sticker.status === 'completed' && sticker.url).length;
          if (['cover', 'goodnotes', 'laptop', 'journal', 'lifestyle'].includes(asset.type)) {
            updateMetrics({ seedreamMockupRequests: metricsRef.current.seedreamMockupRequests + 1 });
          }
          const url = await generateSeedreamMockup(asset.id!, asset.type, stickersForMockup, niche!.name, completedStickerCount);
          finishedAssets++;
          const completedAsset: MarketingAsset = { ...asset, url, status: 'completed' };
          assetsToGen[i] = completedAsset;
          setState(prev => {
            const nextAssets = [...prev.marketingAssets];
            nextAssets[i] = completedAsset;
            return {
              ...prev,
              marketingAssets: nextAssets,
              progress: 85 + Math.round((finishedAssets / assetsToGen.length) * 9)
            };
          });
          await persistMarketingAsset(completedAsset);
          const elapsedSeconds = Math.max(1, Math.round((Date.now() - assetStartedAt) / 1000));
          const elapsedLabel = elapsedSeconds >= 60
            ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
            : `${elapsedSeconds}s`;
          addLog(`Completed ${asset.title} in ${elapsedLabel}.`);
        } catch (e: any) {
          finishedAssets++;
          assetsToGen[i] = { ...asset, status: 'error' };
          const elapsedSeconds = Math.max(1, Math.round((Date.now() - assetStartedAt) / 1000));
          addLog(`Failed asset ${asset.title} after ${elapsedSeconds}s. Error: ${e.message}`);
          setState(prev => {
            const nextAssets = [...prev.marketingAssets];
            nextAssets[i] = { ...asset, status: 'error' };
            return { ...prev, marketingAssets: nextAssets };
          });
        }
      });

      const criticalAssetIds = new Set(['cover_a', 'included', 'quality_proof', 'howto', 'preview_1']);
      const currentAssets = assetsToGen;
      const failedCritical = currentAssets.filter(asset => criticalAssetIds.has(asset.id || '') && asset.status !== 'completed');
      if (failedCritical.length) {
        addLog(`Listing asset warning: ${failedCritical.map(asset => asset.title).join(', ')} could not be created. Packaging and listing copy will continue.`);
      }

      try {
        addLog('Creating a short listing preview video from actual listing images...');
        const videoSourceUrls = currentAssets
          .filter(asset => asset.status === 'completed' && asset.url && ['cover', 'closeup', 'included', 'howto'].includes(asset.type))
          .map(asset => asset.url!);
        const video = await createListingPreviewVideo(videoSourceUrls);
        const videoAsset: MarketingAsset = {
          id: 'listing_video',
          type: 'social',
          title: 'Listing Preview Video',
          url: video.url,
          status: 'completed',
          format: 'video',
          mimeType: video.mimeType
        };
        await persistMarketingAsset(videoAsset);
        setState(prev => ({ ...prev, marketingAssets: [...prev.marketingAssets, videoAsset] }));
        addLog(`Listing preview video created (${video.mimeType || 'browser video'}).`);
      } catch (videoError) {
        addLog(`Listing video skipped: ${videoError instanceof Error ? videoError.message : String(videoError)}`);
      }

      if (stopSignal.current) throw new Error("Stopped by user");
      setState(prev => ({ ...prev, status: 'copywriting', progress: 95 }));
      addLog("Generating SEO Listing Copy...");
      await persistCheckpointMeta(niche, style, activeMode, activeTarget, analysis, preflight, qualityResult.report, '');
      // PASS useTurbo to generate correct description
      const completedStickerCount = Math.min(
        activeTarget,
        stickersRef.current.filter(sticker => sticker.status === 'completed' && sticker.qaStatus === 'approved').length
      );
      const rawListing = await generateAutopilotListing(niche!.name, style.name, useTurbo, completedStickerCount);
      metricsRef.current = { ...metricsRef.current, finishedAt: new Date().toISOString() };
      await persistCheckpointMeta(niche, style, activeMode, activeTarget, analysis, preflight, qualityResult.report, rawListing);
      setState(prev => ({ ...prev, rawListing, status: 'completed', progress: 100, metrics: metricsRef.current }));
      addLog(`${activeMode === 'production' ? 'PRODUCTION' : 'TEST'} COMPLETE: ${completedStickerCount} visually approved stickers.`);
      
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
      setState(prev => ({ ...prev, status: 'error' }));
    } finally {
        // STOP KEEP ALIVE AUDIO
        if (audioRef.current) {
            audioRef.current.pause();
        }
        // RELEASE WAKE LOCK
        releaseWakeLock();
    }
  };

  const parsedListing = state.rawListing ? parseListingText(state.rawListing) : null;

  const downloadFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAsset = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const getAssetIcon = (type: string) => {
      if (type.includes('cover')) return <Zap className="w-6 h-6 text-yellow-500" />;
      if (type.includes('laptop')) return <Laptop className="w-6 h-6 text-indigo-400" />;
      if (type.includes('goodnotes')) return <Tablet className="w-6 h-6 text-pink-400" />;
      if (type.includes('preview')) return <Grid className="w-6 h-6 text-emerald-400" />;
      if (type.includes('howto')) return <Layers className="w-6 h-6 text-blue-400" />;
      if (type.includes('social')) return <Video className="w-6 h-6 text-cyan-400" />;
      return <BookOpen className="w-6 h-6 text-orange-400" />;
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      
      {/* Header */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-2xl">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                <Zap className="w-8 h-8 text-yellow-400 fill-yellow-400" />
                StickerOS Autopilot
              </h2>
              <p className="text-slate-400 mt-1">
                {useTurbo ? 'Fast Mode: 1K Generation' : 'Quality Mode: 2K Generation'} • Seedream 5.0 Pro • up to {useTurbo ? seedreamWorkerLimit : Math.min(seedreamWorkerLimit, 8)} adaptive workers
              </p>
            </div>

            {/* CONFIGURATION PANEL */}
            <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
               <div className="flex flex-col">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-slate-500 uppercase font-bold">Target Niche</label>
                    <div className="flex gap-1">
                        <button 
                            onClick={handleAutoDetectTrend}
                            disabled={isTrendSearching || state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
                            className="text-[10px] bg-blue-900/50 hover:bg-blue-800 text-blue-300 px-2 py-0.5 rounded border border-blue-800 transition-colors"
                            title="Auto-find best seller"
                        >
                            {isTrendSearching ? "Scanning..." : "Auto-Trend"}
                        </button>
                        <button 
                            onClick={() => setShowTrendModal(true)}
                            disabled={state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
                            className="text-[10px] bg-purple-900/50 hover:bg-purple-800 text-purple-300 px-2 py-0.5 rounded border border-purple-800 transition-colors"
                            title="Analyze specific trend"
                        >
                            Deep Dive
                        </button>
                    </div>
                  </div>
                  <select 
                    value={selectedNicheId}
                    onChange={(e) => handleNicheChange(Number(e.target.value))}
                    className="bg-slate-900 border border-slate-700 text-white rounded-lg p-2 text-sm w-full md:w-64 outline-none focus:border-indigo-500"
                    disabled={state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
                  >
                    {sortedNicheCategories.map(([category, niches]) => (
                        <optgroup key={category} label={category}>
                            {niches.map(n => (
                                <option key={n.id} value={n.id}>
                                    {n.isNew ? "🆕 " : ""}{n.name}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                  </select>
               </div>
               
               <div className="flex flex-col">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-slate-500 uppercase font-bold">Art Style</label>
                    <button 
                        onClick={triggerSmartMatch}
                        className="text-[10px] text-indigo-400 flex items-center gap-1 hover:text-indigo-300 hover:bg-indigo-900/30 px-2 py-0.5 rounded transition-all cursor-pointer border border-indigo-500/20"
                        title="Auto-select best art style based on niche name"
                    >
                         <Wand2 className="w-3 h-3" />
                         Smart Match
                    </button>
                  </div>
                  <select 
                    value={selectedStyleId}
                    onChange={(e) => setSelectedStyleId(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-white rounded-lg p-2 text-sm w-full md:w-64 outline-none focus:border-indigo-500"
                    disabled={state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error'}
                  >
                    {availableStyles.map(s => (
                        <option key={s.id} value={s.id}>
                             {s.isNew ? "🆕 " : ""}{s.name}
                        </option>
                    ))}
                  </select>
               </div>
            </div>
          </div>
          
          <div className="flex justify-between items-center border-t border-slate-700 pt-6">
             <div className="flex flex-col items-start gap-1">
                 <div 
                    className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-700 cursor-pointer hover:bg-slate-800 transition-colors"
                    onClick={() => {
                      if (['idle', 'completed', 'error', 'paused'].includes(state.status)) {
                        turboModeRef.current = !useTurbo;
                        setUseTurbo(!useTurbo);
                      }
                    }}
                 >
                    <div className={`p-2 rounded-md transition-colors ${useTurbo ? 'bg-yellow-500 text-black shadow-lg' : 'text-slate-500'}`}>
                        <Zap className="w-4 h-4" />
                    </div>
                    <div className={`p-2 rounded-md transition-colors ${!useTurbo ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500'}`}>
                        <Gauge className="w-4 h-4" />
                    </div>
                    <div className="px-2 text-xs font-bold text-white uppercase hidden sm:block">
                        {useTurbo ? "Fast (1K)" : "Quality (2K)"}
                    </div>
                 </div>
                 <div className="flex items-center gap-1 ml-1">
                     <DollarSign className="w-3 h-3 text-emerald-400" />
                     <span className="text-[10px] text-slate-400 font-mono">
                        {targetStickerCount} base images • replacements only for severe technical failures
                     </span>
                 </div>
                 <div className="flex items-center gap-1 mt-2 bg-slate-900 border border-slate-700 rounded-lg p-1">
                   <button
                     onClick={() => setRunMode('production')}
                     disabled={!['idle', 'completed', 'error', 'paused'].includes(state.status)}
                     className={`px-3 py-1.5 rounded text-xs font-bold ${runMode === 'production' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                   >
                     PRODUCTION · 100
                   </button>
                   <button
                     onClick={() => setRunMode('test')}
                     disabled={!['idle', 'completed', 'error', 'paused'].includes(state.status)}
                     className={`px-3 py-1.5 rounded text-xs font-bold ${runMode === 'test' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                   >
                     TEST · 10
                   </button>
                 </div>
                 <label className="flex items-start gap-2 mt-2 max-w-md text-[10px] text-slate-400 cursor-pointer">
                   <input
                     type="checkbox"
                     checked={allowRiskyNiche}
                     onChange={event => {
                       riskOverrideRef.current = event.target.checked;
                       setAllowRiskyNiche(event.target.checked);
                     }}
                     disabled={!['idle', 'completed', 'error', 'paused'].includes(state.status)}
                     className="mt-0.5"
                   />
                   I manually reviewed rights for a high-risk branded niche. This override is not legal clearance.
                 </label>
             </div>

             {state.status === 'idle' || state.status === 'completed' || state.status === 'error' || state.status === 'paused' ? (
               <div className="flex flex-wrap justify-end gap-2">
                 {['error', 'paused'].includes(state.status)
                   && state.stickers.filter(sticker => sticker.status === 'completed' && sticker.blob && sticker.url).length >= state.targetCount
                   && state.currentNiche
                   && state.currentStyle
                   && (
                     <button
                       onClick={finishWithGeneratedInventory}
                       className="bg-amber-500 hover:bg-amber-400 text-black px-5 py-3 rounded-xl font-black shadow-lg flex items-center gap-2"
                       title="Skip any remaining QA replacement loop and continue with all generated PNGs"
                     >
                       <FastForward className="w-5 h-5 fill-black" /> FINISH WITH {state.targetCount} GENERATED
                     </button>
                   )}
                 {savedCheckpoint && (
                   <>
                     <button
                       onClick={resumeSavedRun}
                       className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-3 rounded-xl font-bold shadow-lg flex items-center gap-2"
                     >
                       <Save className="w-5 h-5" /> RESUME SAVED RUN
                     </button>
                     <button
                       onClick={discardSavedRun}
                       className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-3 rounded-xl text-xs font-bold"
                     >
                       DISCARD SAVE
                     </button>
                   </>
                 )}
                 <button 
                   onClick={runAutopilot}
                   disabled={Boolean(savedCheckpoint)}
                   title={savedCheckpoint ? 'Resume or discard the saved run before starting a new one.' : 'Start a new production run'}
                   className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg flex items-center gap-2 hover:scale-105 transition-transform disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                 >
                   <Play className="w-6 h-6 fill-white" /> START PRODUCTION
                 </button>
               </div>
             ) : (
                <div className="flex gap-2">
                  {state.status === 'generating_stickers' && (
                    <button 
                       onClick={() => { 
                           skipToNextStageSignal.current = true;
                           addLog("Pause requested. Finishing active requests and saving a checkpoint...");
                       }}
                       className="bg-amber-500 hover:bg-amber-400 text-black px-6 py-4 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2 animate-pulse"
                     >
                       <FastForward className="w-5 h-5 fill-black" /> PAUSE SAFELY
                     </button>
                  )}
                  <button 
                     onClick={() => { stopSignal.current = true; }}
                     className="bg-red-600 hover:bg-red-500 text-white px-6 py-4 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2"
                   >
                     <Pause className="w-5 h-5 fill-white" /> ABORT
                   </button>
                </div>
             )}
          </div>
        </div>
        
        {/* Progress */}
        <div className="mt-8">
           <div className="flex justify-between text-xs text-slate-400 mb-2 font-mono uppercase tracking-widest">
              <span>Status: {state.status.replace('_', ' ')}</span>
              <span>{state.progress}%</span>
           </div>
           <div className="w-full bg-slate-900 h-4 rounded-full overflow-hidden border border-slate-700">
              <div 
                className="bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 h-full transition-all duration-300 relative"
                style={{ width: `${state.progress}%` }}
              >
                 <div className="absolute inset-0 bg-white/20 animate-pulse" />
              </div>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         
         {/* Logs */}
         <div className="lg:col-span-1 space-y-6">
            <div className="bg-black/50 rounded-xl border border-slate-700 p-4 h-96 flex flex-col font-mono text-xs">
               <div className="flex items-center gap-2 text-slate-400 border-b border-slate-800 pb-2 mb-2">
                  <RefreshCw className="w-3 h-3 animate-spin" /> SYSTEM LOGS
               </div>
               <div ref={logContainerRef} className="flex-1 overflow-y-auto space-y-1 text-emerald-400/80">
                  {state.logs.map((log, i) => (
                    <div key={i}>{log}</div>
                  ))}
               </div>
            </div>
            
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
               <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                 <Box className="w-5 h-5 text-indigo-400" /> Current Job
               </h3>
               {state.currentNiche ? (
                 <div className="space-y-4">
                    <div>
                      <label className="text-xs text-slate-500 uppercase">Niche</label>
                      <div className="text-white font-medium">{state.currentNiche.name}</div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 uppercase">Style</label>
                      <div className="text-white font-medium">{state.currentStyle?.name}</div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 uppercase">Completed</label>
                      <div className="text-2xl font-bold text-emerald-400">
                        {state.stickers.filter(s => s.qaStatus === 'approved').length} / {state.targetCount}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="bg-slate-900 rounded p-3 border border-slate-700">
                        <div className="text-slate-500 uppercase">Seedream calls</div>
                        <div className="text-white font-bold text-lg">{state.metrics.seedreamRequests + state.metrics.seedreamMockupRequests}</div>
                        <div className="text-[9px] text-slate-500">{state.metrics.seedreamRequests} stickers + {state.metrics.seedreamMockupRequests} mockups</div>
                      </div>
                      <div className="bg-slate-900 rounded p-3 border border-slate-700">
                        <div className="text-slate-500 uppercase">Severe rejects</div>
                        <div className="text-amber-400 font-bold text-lg">{state.metrics.rejectedImages}</div>
                      </div>
                    </div>
                    {state.preflight && (
                      <div className="bg-slate-900 rounded p-3 border border-slate-700 text-xs space-y-1">
                        <div className="flex items-center gap-2 text-white font-bold">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" /> Market Preflight
                        </div>
                        <div className="text-slate-400">Demand {state.preflight.demandScore}/100 • Variety {state.preflight.variationScore}/100</div>
                        <div className={state.preflight.ipRisk === 'high' ? 'text-red-400' : state.preflight.ipRisk === 'medium' ? 'text-amber-400' : 'text-emerald-400'}>
                          IP risk: {state.preflight.ipRisk}
                        </div>
                      </div>
                    )}
                 </div>
               ) : (
                 <div className="text-slate-500 text-sm">Waiting to start...</div>
               )}
            </div>
         </div>

         {/* Visuals & Deliverables */}
         <div className="lg:col-span-2 space-y-6">
            
            {/* Live Feed - REGENERATE BUTTON ADDED */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
               <div className="flex justify-between items-center mb-4">
                   <h3 className="text-white font-bold flex items-center gap-2">
                     <ImageIcon className="w-5 h-5 text-pink-400" /> Sticker Output (Transparent PNG)
                   </h3>
                   {state.status === 'completed' && (
                       <button 
                            onClick={handleAddBonusSticker}
                            className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg flex items-center gap-1 font-bold shadow-lg"
                       >
                            <Plus className="w-3 h-3" /> Add Sticker
                       </button>
                   )}
               </div>
               <div className="grid grid-cols-5 md:grid-cols-6 gap-2">
                  {state.stickers.map((s) => (
                    <div
                      key={s.id}
                      title={s.qaIssues?.join(' • ') || `Sticker #${s.id}`}
                      className={`aspect-square bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-slate-700 rounded border overflow-hidden relative group ${s.manuallyAccepted ? 'border-amber-400' : s.qaStatus === 'approved' ? 'border-emerald-500/70' : s.qaStatus === 'rejected' ? 'border-red-500' : 'border-slate-700'}`}
                    >
                       <div className={`absolute top-1 left-1 z-10 text-[8px] font-black px-1.5 py-0.5 rounded ${s.manuallyAccepted ? 'bg-amber-500 text-black' : s.qaStatus === 'approved' ? 'bg-emerald-600 text-white' : s.qaStatus === 'rejected' ? 'bg-red-600 text-white' : 'bg-slate-900/80 text-slate-300'}`}>
                         #{s.id}{s.manuallyAccepted ? ' !' : s.qaStatus === 'approved' ? ' ✓' : s.qaStatus === 'rejected' ? ' ✕' : ''}
                       </div>
                       {s.status === 'completed' && s.url ? (
                         <>
                             <img src={s.url} className="w-full h-full object-contain p-1" />
                             {/* Hover Regenerate Button */}
                             <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                <button 
                                    onClick={() => handleRegenerateSticker(s.id)}
                                    disabled={!['completed', 'error', 'paused'].includes(state.status)}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-full shadow-lg transform hover:scale-110 transition-all disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:scale-100"
                                    title="Paid manual replacement — asks for confirmation and can use up to two Seedream calls"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleRepairStickerTransparency(s.id)}
                                    disabled={!['completed', 'error', 'paused'].includes(state.status)}
                                    className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white p-2 rounded-full shadow-lg transform hover:scale-110 transition-all disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:scale-100"
                                    title="Free local transparency and black-matte-hole repair"
                                >
                                    <Wand2 className="w-4 h-4" />
                                </button>
                                <button 
                                    onClick={() => copyImageToClipboard(s.blob)}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-full shadow-lg transform hover:scale-110 transition-all"
                                    title="Copy to Clipboard"
                                >
                                    <Scissors className="w-4 h-4" />
                                </button>
                             </div>
                         </>
                       ) : s.status === 'generating' ? (
                         <div className="w-full h-full flex items-center justify-center">
                            <RefreshCw className="w-6 h-6 text-yellow-400 animate-spin" />
                         </div>
                       ) : s.status === 'error' ? (
                         <div className="w-full h-full flex flex-col items-center justify-center bg-red-900/20 text-red-500 font-bold p-1">
                             <AlertCircle className="w-6 h-6 mb-1" />
                             <button 
                                onClick={() => handleRegenerateSticker(s.id)}
                                className="text-[10px] bg-red-800 hover:bg-red-700 text-white px-2 py-1 rounded"
                             >
                                RETRY
                             </button>
                         </div>
                       ) : (
                         <div className="w-full h-full flex items-center justify-center">
                           <div className="w-1 h-1 bg-slate-500 rounded-full" />
                         </div>
                       )}
                    </div>
                  ))}
               </div>
            </div>

            {/* DOWNLOADS SECTION */}
            {(state.zips.length > 0 || state.rawListing) && (
              <div className="space-y-6">
                
                {/* ETSY LISTING COPY - REDESIGNED */}
                {parsedListing && (
                  <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl animate-in slide-in-from-bottom-6">
                     <div className="bg-orange-600/10 p-4 border-b border-orange-600/20 flex justify-between items-center">
                        <h3 className="text-orange-500 font-bold flex items-center gap-2">
                            <ShoppingBag className="w-5 h-5" />
                            Etsy Seller Dashboard Copy
                        </h3>
                        <span className="text-xs text-orange-400 font-mono bg-orange-900/30 px-2 py-1 rounded border border-orange-900/50">
                            SEO OPTIMIZED
                        </span>
                     </div>
                     
                     <div className="p-6 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                             <div className="md:col-span-2">
                                 <CopyCard label="Listing Title (140 chars)" text={parsedListing.title} />
                                 <p className="text-[10px] text-slate-500 mt-1 ml-1">Paste this directly into the Etsy Title field. Includes top-ranking keywords.</p>
                             </div>
                             <div>
                                 <CopyCard label="Tags (Copy All)" text={parsedListing.tags} />
                                 <p className="text-[10px] text-slate-500 mt-1 ml-1">Copy and paste these 13 tags.</p>
                             </div>
                        </div>
                        
                        <div>
                             <CopyCard label="Product Description" text={parsedListing.description} multiline />
                             <p className="text-[10px] text-slate-500 mt-1 ml-1">Formatted for readability. Includes 'How to Download' instructions.</p>
                        </div>
                     </div>
                  </div>
                )}

                <div className="bg-emerald-900/10 border border-emerald-900 rounded-xl p-6 animate-in fade-in">
                   <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <CheckCircle className="w-6 h-6 text-emerald-400" /> Deliverable Files
                      </h2>
                      {state.status === 'completed' && (
                          <button 
                              onClick={handleDownloadAll}
                              disabled={isDownloading}
                              className="bg-white hover:bg-emerald-50 text-emerald-900 px-4 py-2 rounded-lg font-bold shadow-lg flex items-center gap-2 transition-colors disabled:opacity-70 disabled:cursor-not-allowed animate-bounce"
                          >
                              {isDownloading ? (
                                  <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Preparing...
                                  </>
                              ) : (
                                  <>
                                    <Archive className="w-4 h-4" /> 
                                    DOWNLOAD ALL ASSETS
                                  </>
                              )}
                          </button>
                      )}
                   </div>
                   
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* ZIP FILES */}
                      <div className="space-y-3">
                         <div className="flex justify-between items-center">
                             <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Product ZIPs</h4>
                             {needsZipUpdate && (
                                 <button 
                                   onClick={handleUpdateZips}
                                   className="text-xs bg-amber-500 text-black px-2 py-1 rounded font-bold flex items-center gap-1 animate-pulse"
                                 >
                                    <RotateCcw className="w-3 h-3" /> Update Files
                                 </button>
                             )}
                         </div>
                         {state.zips.map((zip, i) => (
                           <div key={i} className="flex justify-between items-center bg-slate-800 p-3 rounded-lg border border-slate-700">
                              <div className="min-w-0">
                                <div className="text-sm text-white truncate max-w-[220px]">{zip.name}</div>
                                <div className={`text-[11px] font-semibold ${zip.blob.size <= ETSY_ZIP_MAX_BYTES ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {formatFileSizeMb(zip.blob.size)} • Etsy-ready
                                </div>
                              </div>
                              <button 
                                onClick={() => downloadFile(zip.blob, zip.name)}
                                className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded flex items-center gap-1"
                              >
                                <Download className="w-3 h-3" /> DL
                              </button>
                           </div>
                         ))}
                      </div>

                      {/* MOCKUPS - UPDATED TO GRID VIEW WITH THUMBNAILS */}
                      <div className="space-y-3">
                         <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Listing Images</h4>
                         <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                          {state.marketingAssets.map((asset, i) => (
                            <div key={i} className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden group flex flex-col">
                                <div className={`${asset.type === 'cover' ? 'aspect-[5/4]' : 'aspect-square'} bg-slate-900 relative flex items-center justify-center`}>
                                     {asset.status === 'completed' && asset.url ? (
                                         <>
                                            {asset.format === 'video' ? (
                                              <video src={asset.url} className="w-full h-full object-cover" controls muted loop playsInline />
                                            ) : (
                                              <img src={asset.url} className="w-full h-full object-cover" />
                                            )}
                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                                <button 
                                                  onClick={() => downloadAsset(
                                                    asset.url!,
                                                    asset.format === 'video'
                                                      ? `listing_preview.${asset.mimeType?.includes('mp4') ? 'mp4' : 'webm'}`
                                                      : `${asset.id || asset.type}.jpg`
                                                  )}
                                                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-full text-xs font-bold"
                                                >
                                                  Download {asset.format === 'video' ? 'Video' : 'JPG'}
                                                </button>
                                                {asset.format !== 'video' && <button
                                                  onClick={() => handleRegenerateMockup(asset.id!)}
                                                  className="bg-slate-700 hover:bg-slate-600 text-white p-2 rounded-full"
                                                  title="Regenerate"
                                                >
                                                  <RefreshCw className="w-4 h-4" />
                                                </button>}
                                            </div>
                                         </>
                                     ) : (
                                         <div className="text-slate-600 flex flex-col items-center gap-2">
                                             {asset.status === 'generating' ? (
                                                 <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
                                             ) : asset.status === 'error' ? (
                                                 <div className="flex flex-col items-center gap-2">
                                                     <AlertCircle className="w-8 h-8 text-red-500" />
                                                     <button onClick={() => handleRegenerateMockup(asset.id!)} className="text-[10px] text-red-400 underline">Retry</button>
                                                 </div>
                                             ) : (
                                                 getAssetIcon(asset.type)
                                             )}
                                         </div>
                                     )}
                                </div>
                                <div className="p-2 bg-slate-800 border-t border-slate-700">
                                    <div className="text-[10px] font-bold text-white truncate text-center" title={asset.title}>{asset.title}</div>
                                </div>
                            </div>
                          ))}
                         </div>
                      </div>
                   </div>
                </div>
              </div>
            )}
         </div>
      </div>

      {/* TREND ANALYSIS MODAL */}
      {showTrendModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Globe className="w-6 h-6 text-purple-400" />
                        <h2 className="text-xl font-bold text-white">Trend Intelligence Deep Dive</h2>
                    </div>
                    <button 
                        onClick={() => setShowTrendModal(false)}
                        className="text-slate-400 hover:text-white"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    <div className="mb-6 bg-slate-900/50 p-6 rounded-xl border border-slate-700 text-center">
                        <div className="mb-4 text-slate-400 text-sm">
                            OpenAI web search will build two opportunity lanes: 5 broad buyer markets with room for 100 varied designs, plus 5 timely micro-trends mapped to broader production niches. Demand scores are signals, not guaranteed sales.
                        </div>
                        <button 
                            onClick={handleManualTrendAnalyze}
                            disabled={isAnalyzingTrend}
                            className="mx-auto bg-purple-600 hover:bg-purple-500 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-3 shadow-xl hover:scale-105 transition-all"
                        >
                            {isAnalyzingTrend ? (
                                <>
                                    <RefreshCw className="animate-spin w-6 h-6" />
                                    Analyzing Market Data...
                                </>
                            ) : (
                                <>
                                    <Zap className="w-6 h-6 fill-white" />
                                    START DEEP DIVE SCAN
                                </>
                            )}
                        </button>
                    </div>

                    {trendResult && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                             {/* DISCOVERED TRENDS LIST */}
                             {discoveredTrends.length > 0 && (
                                 <div>
                                     <div className="flex justify-between items-center mb-3">
                                         <h3 className="text-xs uppercase font-bold text-slate-500 flex items-center gap-2">
                                             <Zap className="w-4 h-4 text-yellow-500" /> 
                                             Balanced Market Opportunities
                                         </h3>
                                         <button
                                            onClick={handleAddAllTrends}
                                            className="bg-white text-indigo-900 hover:bg-indigo-50 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1 transition-colors"
                                         >
                                            <Plus className="w-3 h-3" /> Import All ({discoveredTrends.length})
                                         </button>
                                     </div>
                                     <div className="space-y-6">
                                         {([
                                             { scope: 'broad' as const, title: 'Broad Money Markets', subtitle: 'Durable buyer categories with enough range for a real 100-design collection.', accent: 'emerald' },
                                             { scope: 'micro' as const, title: 'Emerging Micro Trends', subtitle: 'Specific timely angles, expanded into a broader production universe before generation.', accent: 'amber' }
                                         ]).map((lane) => {
                                             const laneTrends = discoveredTrends.filter((trend) => trend.scope === lane.scope);
                                             if (laneTrends.length === 0) return null;
                                             return (
                                                 <section key={lane.scope}>
                                                     <div className="mb-2">
                                                         <div className={`text-sm font-bold ${lane.accent === 'emerald' ? 'text-emerald-300' : 'text-amber-300'}`}>{lane.title}</div>
                                                         <div className="text-xs text-slate-500">{lane.subtitle}</div>
                                                     </div>
                                                     <div className="grid grid-cols-1 gap-3">
                                                         {laneTrends.map((trend, i) => (
                                                             <div key={`${lane.scope}-${i}`} className={`bg-slate-900 p-4 rounded-xl border ${lane.scope === 'broad' ? 'border-emerald-900/80 hover:border-emerald-500/60' : 'border-amber-900/80 hover:border-amber-500/60'} transition-colors`}>
                                                                 <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                                                                     <div className="flex-1 min-w-0">
                                                                         <div className="flex flex-wrap items-center gap-2 mb-1">
                                                                             <span className="text-lg font-bold text-white">{trend.name}</span>
                                                                             <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${trend.scope === 'broad' ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-amber-950 text-amber-300 border-amber-800'}`}>{trend.scope}</span>
                                                                             <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">{trend.category}</span>
                                                                         </div>
                                                                         <p className="text-sm text-slate-400 mb-3">{trend.description}</p>
                                                                         <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                                                             <div className="bg-slate-950/70 rounded-lg p-2 border border-slate-800">
                                                                                 <span className="text-slate-500">Buyer: </span><span className="text-slate-200">{trend.targetBuyer}</span>
                                                                             </div>
                                                                             <div className="bg-slate-950/70 rounded-lg p-2 border border-slate-800">
                                                                                 <span className="text-slate-500">Why it can sell: </span><span className="text-slate-200">{trend.whyItSells}</span>
                                                                             </div>
                                                                             <div className="md:col-span-2 bg-indigo-950/30 rounded-lg p-2 border border-indigo-900/50">
                                                                                 <span className="text-indigo-400">100-sticker production niche: </span><span className="text-indigo-100">{trend.productionNiche}</span>
                                                                             </div>
                                                                         </div>
                                                                         <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
                                                                             <span className="text-slate-300">Demand <strong className="text-white">{trend.demandScore}/100</strong></span>
                                                                             <span className="text-slate-300">Variety <strong className="text-white">{trend.varietyScore}/100</strong></span>
                                                                             <span className="text-slate-300">Competition <strong className="text-white capitalize">{trend.competition}</strong></span>
                                                                             <span className="flex items-center gap-1 text-indigo-400"><Palette className="w-3 h-3" /> {trend.styleName}</span>
                                                                         </div>
                                                                         <p className="mt-2 text-[11px] text-slate-500">Signal: {trend.evidenceSummary}</p>
                                                                     </div>
                                                                     <button
                                                                        onClick={() => handleAddTrend(trend)}
                                                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg w-full sm:w-auto justify-center shrink-0"
                                                                     >
                                                                         <Plus className="w-4 h-4" /> Use Opportunity
                                                                     </button>
                                                                 </div>
                                                             </div>
                                                         ))}
                                                     </div>
                                                 </section>
                                             );
                                         })}
                                     </div>
                                 </div>
                             )}

                             <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 mt-6">
                                <h3 className="text-xs uppercase font-bold text-slate-500 mb-2">Market Summary</h3>
                                <p className="text-slate-200 leading-relaxed whitespace-pre-wrap text-sm">{trendResult.answer}</p>
                             </div>

                             {trendResult.sources.length > 0 && (
                                 <div>
                                    <h3 className="text-xs uppercase font-bold text-slate-500 mb-2">Verified Sources</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {(trendResult.sources || []).map((s, i) => (
                                            <a key={i} href={s.uri} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg transition-colors group">
                                                <ExternalLink className="w-3 h-3 text-purple-400" />
                                                <span className="text-xs text-slate-300 truncate group-hover:text-white">{s.title}</span>
                                            </a>
                                        ))}
                                    </div>
                                 </div>
                             )}
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-slate-700 bg-slate-900/50 flex justify-end gap-3 rounded-b-2xl">
                    <button 
                        onClick={() => setShowTrendModal(false)}
                        className="px-4 py-2 text-slate-400 hover:text-white font-medium"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

const CopyCard: React.FC<{ label: string; text: string; multiline?: boolean }> = ({ label, text, multiline }) => {
    const [copied, setCopied] = useState(false);
    
    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex flex-col gap-2 shadow-sm relative group hover:border-orange-500/50 transition-colors">
            <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400 uppercase">{label}</span>
                <button 
                    onClick={handleCopy}
                    className={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors font-bold ${
                        copied ? 'bg-green-900 text-green-400' : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                    }`}
                >
                    {copied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'COPIED' : 'COPY'}
                </button>
            </div>
            {multiline ? (
                <textarea 
                    readOnly 
                    className="w-full bg-slate-950 p-3 rounded text-slate-200 text-sm font-sans h-64 resize-none outline-none border border-slate-800 focus:border-orange-500/50"
                    value={text}
                />
            ) : (
                <input 
                    readOnly
                    className="w-full bg-slate-950 p-3 rounded text-slate-200 text-sm font-sans outline-none border border-slate-800 focus:border-orange-500/50"
                    value={text}
                />
            )}
        </div>
    );
};

export default Autopilot;
