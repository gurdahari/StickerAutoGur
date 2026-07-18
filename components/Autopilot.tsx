
import React, { useState, useEffect, useRef } from 'react';
import { AutopilotState, NicheIdea, StylePreset, Sticker, MarketingAsset, TrendResult, DiscoveredTrend, NicheVisualAnalysis } from '../types';
import { NICHE_IDEAS, STYLE_PRESETS } from '../data/presets';
import { ensureProvidersConfigured, generateStickerPrompts, generateAutopilotSticker, generateAutopilotListing, generateSeedreamMockup, findViralNiche, getTrendAnalysis, discoverTopTrends, analyzeNicheVisuals, selectCoverStickerIds } from '../services/aiService';
import { processStickerImage } from '../services/stickerProcessing';
import { Play, Pause, RefreshCw, CheckCircle, Download, FileText, Image as ImageIcon, Box, Archive, Zap, Gauge, Copy, FastForward, RotateCcw, Beaker, DollarSign, AlertCircle, Scissors, Eye, Globe, Search, ExternalLink, X, ArrowRight, BarChart3, Plus, Palette, ShoppingBag, Loader2, Wand2, Laptop, Tablet, Grid, BookOpen, Layers } from 'lucide-react';
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

const buildStickerZip = async (
  batch: Sticker[],
  pngBlobs: Blob[],
  nicheName: string,
  startIndex: number
): Promise<Blob> => {
  const zip = new JSZip();
  const safeNiche = nicheName.replace(/[^a-zA-Z0-9]/g, '_');
  batch.forEach((sticker, index) => {
    zip.file(`${safeNiche}_${startIndex + index + 1}.png`, pngBlobs[index] || sticker.blob!);
  });
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
};

const buildEtsySizedStickerZip = async (
  batch: Sticker[],
  nicheName: string,
  startIndex: number
): Promise<{ blob: Blob; scale: number }> => {
  const originals = batch.map(sticker => sticker.blob!);
  const originalZip = await buildStickerZip(batch, originals, nicheName, startIndex);
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

  let zipBlob = await buildStickerZip(batch, best.blobs, nicheName, startIndex);
  if (zipBlob.size > ETSY_ZIP_MAX_BYTES) {
    const saferScale = Math.max(0.15, best.scale * 0.96);
    const saferBlobs = await Promise.all(originals.map(blob => resizePngBlob(blob, saferScale)));
    zipBlob = await buildStickerZip(batch, saferBlobs, nicheName, startIndex);
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
    progress: 0,
    stickers: [],
    zips: [],
    marketingAssets: [],
    listing: null,
    logs: []
  });
  
  // DEFAULT TO TURBO MODE (TRUE) FOR SPEED
  const [useTurbo, setUseTurbo] = useState(true); 
  const [needsZipUpdate, setNeedsZipUpdate] = useState(false);
  
  // Visual Analysis State to pass between stages
  const visualAnalysisRef = useRef<NicheVisualAnalysis | undefined>(undefined);

  const stopSignal = useRef(false);
  const skipToNextStageSignal = useRef(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const stickersRef = useRef<Sticker[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null); // For background keep-alive
  const usedStickerIdsRef = useRef<Set<number>>(new Set()); // Tracks used stickers to avoid redundancy
  const wakeLockRef = useRef<any>(null); // For Screen Wake Lock API

  const TARGET_STICKER_COUNT = 100;

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
      addLog("🔎 Scanning Etsy & Pinterest for top breakouts...");
      try {
          const viralNiche = await findViralNiche();
          applyCustomNiche(viralNiche);
          addLog(`✅ SUCCESS: Found best-seller: "${viralNiche}"`);
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
            getTrendAnalysis("What are the absolute hottest trending digital sticker aesthetics on Etsy and Pinterest right now? Be specific."),
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
      
      const newNiche: NicheIdea = {
          id: Date.now(),
          name: trend.name,
          category: `🚀 Detected ${dateStr}`,
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
      
      addLog(`Imported Trend: "${trend.name}" + Style: "${trend.styleName}"`);
      setShowTrendModal(false);
  };

  const handleAddAllTrends = () => {
      if (discoveredTrends.length === 0) return;
      
      const dateStr = new Date().toLocaleDateString();
      const newNiches: NicheIdea[] = [];
      const newStyles: StylePreset[] = [];

      discoveredTrends.forEach((trend, idx) => {
         const timestamp = Date.now() + idx; 
         
         const newNiche: NicheIdea = {
              id: timestamp,
              name: trend.name,
              category: `🚀 Detected ${dateStr}`,
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
      
      addLog(`Mass Import: Added ${newNiches.length} new trends to library.`);
      setShowTrendModal(false);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [state.logs]);

  const addLog = (msg: string) => {
    setState(prev => ({ ...prev, logs: [...prev.logs, `[${new Date().toLocaleTimeString()}] ${msg}`] }));
  };

  const checkApiKey = async () => {
     await ensureProvidersConfigured();
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

  const packageStickers = async (currentStickers: Sticker[], nicheName: string) => {
      const allSuccessfulStickers = currentStickers.filter(s => s.status === 'completed' && s.blob);
      const successfulStickers = allSuccessfulStickers.slice(0, TARGET_STICKER_COUNT);
      const zips: { name: string; blob: Blob }[] = [];
      const chunkSize = 20; 
      const numberOfZips = Math.ceil(successfulStickers.length / chunkSize);

      if (successfulStickers.length < TARGET_STICKER_COUNT) {
        addLog(`Publication check: ${successfulStickers.length}/100 finished stickers. This test package is not yet a complete 100-sticker product.`);
      } else if (allSuccessfulStickers.length > TARGET_STICKER_COUNT) {
        addLog(`${allSuccessfulStickers.length - TARGET_STICKER_COUNT} extra completed sticker(s) were excluded to keep the Etsy product at exactly 100 files.`);
      }

      for (let i = 0; i < numberOfZips; i++) {
        const start = i * chunkSize;
        const end = start + chunkSize;
        const batch = successfulStickers.slice(start, end);
        
        if (batch.length > 0) {
            const packaged = await buildEtsySizedStickerZip(batch, nicheName, start);
            const qualityNote = packaged.scale < 0.995
              ? ` • optimized at ${Math.round(packaged.scale * 100)}% dimensions`
              : ' • original PNG dimensions preserved';
            addLog(`ZIP Vol ${i + 1}: ${batch.length} PNG files • ${formatFileSizeMb(packaged.blob.size)}${qualityNote}`);
            zips.push({ name: `StickerPack_Vol${i+1}_${nicheName.replace(/[^a-zA-Z0-9]/g, '')}.zip`, blob: packaged.blob });
        }
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

  const handleRegenerateSticker = async (stickerId: number) => {
      if (!state.currentStyle || !state.currentNiche) return;
      
      const stickerIndex = state.stickers.findIndex(s => s.id === stickerId);
      if (stickerIndex === -1) return;

      const sticker = state.stickers[stickerIndex];
      const newRegenCount = (sticker.regenCount || 0) + 1;
      addLog(`Regenerating Sticker #${stickerId} (Attempt ${newRegenCount})...`);

      // SMART REGENERATION: If failed > 2 times, change prompt to avoid loop
      let promptToUse = sticker.prompt;
      if (newRegenCount >= 3) {
          promptToUse = `${sticker.prompt.split('|')[0]} | COMPOSITION: Minimal, Simple, Isolated on White | TEXT: NONE`;
          addLog(`⚠️ Attempt ${newRegenCount}: Simplifying prompt logic for Sticker #${stickerId}`);
      }

      setState(prev => {
          const newStickers = [...prev.stickers];
          newStickers[stickerIndex] = { ...sticker, status: 'generating', regenCount: newRegenCount, prompt: promptToUse };
          return { ...prev, stickers: newStickers };
      });

      try {
           const base64 = await generateAutopilotSticker(promptToUse, state.currentStyle.prompt, useTurbo, state.currentNiche.name, visualAnalysisRef.current);
           
           const processedBlob = await processStickerImage(base64, promptToUse);
           const finalUrl = URL.createObjectURL(processedBlob);

           setState(prev => {
               const newStickers = [...prev.stickers];
               newStickers[stickerIndex] = { ...sticker, url: finalUrl, blob: processedBlob, status: 'completed', regenCount: newRegenCount };
               stickersRef.current = newStickers; 
               return { ...prev, stickers: newStickers };
           });
           
           addLog(`Sticker #${stickerId} updated.`);
           setNeedsZipUpdate(true); 

      } catch (e: any) {
          addLog(`Error regenerating sticker #${stickerId}: ${e.message}`);
          setState(prev => {
              const newStickers = [...prev.stickers];
              newStickers[stickerIndex] = { ...sticker, status: 'error', regenCount: newRegenCount };
              return { ...prev, stickers: newStickers };
          });
      }
  };

  const handleRepairStickerTransparency = async (stickerId: number) => {
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
          const processedBlob = await processStickerImage(sticker.url, sticker.prompt);
          const finalUrl = URL.createObjectURL(processedBlob);
          const repairedSticker = { ...sticker, url: finalUrl, blob: processedBlob, status: 'completed' as const };

          setState(prev => {
              const nextStickers = [...prev.stickers];
              const index = nextStickers.findIndex(item => item.id === stickerId);
              if (index !== -1) nextStickers[index] = repairedSticker;
              return { ...prev, stickers: nextStickers };
          });
          stickersRef.current[stickerIndex] = repairedSticker;
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
        const prompts = await generateStickerPrompts(state.currentNiche.name, state.currentStyle, 1, visualAnalysisRef.current);
        const freshPrompt = prompts[0] || placeholder.prompt;
        
        // 2. Generate Image
        const base64 = await generateAutopilotSticker(freshPrompt, state.currentStyle.prompt, useTurbo, state.currentNiche.name, visualAnalysisRef.current);
        const processedBlob = await processStickerImage(base64, freshPrompt);
        const finalUrl = URL.createObjectURL(processedBlob);

        // 3. Update Result
        setState(prev => {
             const list = [...prev.stickers];
             const idx = list.findIndex(s => s.id === newId);
             if (idx !== -1) {
                 list[idx] = { ...list[idx], prompt: freshPrompt, url: finalUrl, blob: processedBlob, status: 'completed' };
             }
             return { ...prev, stickers: list };
        });
        
        // Update Ref
        const refIdx = stickersRef.current.findIndex(s => s.id === newId);
        if (refIdx !== -1) {
             stickersRef.current[refIdx] = { id: newId, prompt: freshPrompt, url: finalUrl, blob: processedBlob, status: 'completed', regenCount: 0 };
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
     const valid = pool.filter(s => s.status === 'completed' && s.url);
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

  const getModelSelectedCoverBatch = async (pool: Sticker[], count = 12): Promise<string[]> => {
     const valid = pool.filter(sticker => sticker.status === 'completed' && sticker.url);
     if (valid.length <= count) return valid.map(sticker => sticker.url!);

     try {
       addLog(`Choosing ${count} strongest real stickers for the main thumbnail...`);
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
       addLog('Cover selector unavailable; using a diverse fallback set.');
       return getUniqueBatchForMockup(valid, count);
     }
  };

  const getStickerRange = (stickers: Sticker[], start: number, end: number) => {
       const subset = stickers.slice(start, end);
       const valid = subset.filter(s => s.status === 'completed' && s.url);
       return [...new Set(valid.map(s => s.url!))];
  };

  const handleRegenerateMockup = async (assetId: string) => {
      const assetIndex = state.marketingAssets.findIndex(a => a.id === assetId);
      if (assetIndex === -1 || !state.currentNiche) return;

      const asset = state.marketingAssets[assetIndex];
      addLog(`Refining Mockup: ${asset.title}...`);
      
      setState(prev => {
          const nextAssets = [...prev.marketingAssets];
          nextAssets[assetIndex] = { ...asset, status: 'generating' };
          return { ...prev, marketingAssets: nextAssets };
      });

      try {
          const validStickers = stickersRef.current
            .filter(sticker => sticker.status === 'completed' && sticker.url)
            .slice(0, TARGET_STICKER_COUNT);
          let stickersForMockup: string[] = [];

          // Expanded Logic to slice 100 stickers into 6 grids
           if (asset.id === 'preview_1') stickersForMockup = getStickerRange(validStickers, 0, 17);
           else if (asset.id === 'preview_2') stickersForMockup = getStickerRange(validStickers, 17, 34);
           else if (asset.id === 'preview_3') stickersForMockup = getStickerRange(validStickers, 34, 51);
           else if (asset.id === 'preview_4') stickersForMockup = getStickerRange(validStickers, 51, 68);
           else if (asset.id === 'preview_5') stickersForMockup = getStickerRange(validStickers, 68, 85);
           else if (asset.id === 'preview_6') stickersForMockup = getStickerRange(validStickers, 85, 100);
           
           // Use Unique Batch Logic for Mockups to avoid repeats
           else if (asset.type === 'cover') stickersForMockup = await getModelSelectedCoverBatch(validStickers, 15);
           else if (asset.type === 'howto') stickersForMockup = getUniqueBatchForMockup(validStickers, 4);
           else stickersForMockup = getUniqueBatchForMockup(validStickers, 8); 

          const url = await generateSeedreamMockup(
             asset.id!, 
             asset.type, 
             stickersForMockup, 
             state.currentNiche.name,
             validStickers.filter(sticker => sticker.status === 'completed' && sticker.url).length
          );

          setState(prev => {
              const nextAssets = [...prev.marketingAssets];
              nextAssets[assetIndex] = { ...asset, url: url, status: 'completed' };
              return { ...prev, marketingAssets: nextAssets };
          });
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
      if (!state.currentNiche) return;
      addLog("Updating ZIP archives with new stickers...");
      setState(prev => ({...prev, status: 'zipping'})); 
      const zips = await packageStickers(stickersRef.current, state.currentNiche.name);
      setState(prev => ({ ...prev, zips, status: 'completed' }));
      setNeedsZipUpdate(false);
      addLog("ZIPs updated successfully.");
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
        const freshZips = await packageStickers(stickersRef.current, state.currentNiche.name);

        const stickersFolder = masterZip.folder("1_Sticker_Packs");
        freshZips.forEach(z => {
          stickersFolder?.file(z.name, z.blob);
        });

        const mockupsFolder = masterZip.folder("2_Listing_Images");
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
                   mockupsFolder?.file(`${safeName}.jpg`, blob);
               } catch (e) {
                   console.error("Failed to add asset to zip", e);
               }
           }
        }

        if (state.rawListing) {
           masterZip.file("3_SEO_Listing_Copy.txt", state.rawListing);
        }

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

  const runAutopilot = async () => {
    try {
      await checkApiKey();
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
      
      // --- CRITICAL FIX: RESET LISTING & ASSET STATE ---
      // This forces the "SEO Copywriting" stage to run again at the end, even if previous runs failed.
      setState(prev => ({ 
          ...prev, 
          status: 'researching', 
          progress: 5,
          listing: null,
          rawListing: undefined,
          // We keep stickers if they exist, but reset marketing assets to force regeneration for the new set
          marketingAssets: prev.marketingAssets.map(asset => ({
             ...asset,
             status: 'pending',
             url: null
          }))
      }));
      addLog(`Starting Production Run...`);
      
      const niche = availableNiches.find(n => n.id === selectedNicheId);
      const rawStyle = availableStyles.find(s => s.id === selectedStyleId) || availableStyles[0];

      if (!niche) throw new Error("Selected Niche not found");
      if (!rawStyle) throw new Error("Selected Style not found");

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

      // --- STEP 0: ANALYZE NICHE VISUALS ---
      addLog(`🧠 Analyzing buyer intent for "${niche.name}"...`);
      const analysis = await analyzeNicheVisuals(niche.name);
      visualAnalysisRef.current = analysis;
      addLog(`Visual Archetype Detected: ${analysis.archetype}`);

      addLog(`Brainstorming sticker concepts (${TARGET_STICKER_COUNT})...`);
      // Pass the analysis to prompt generation so it knows to make Frames if needed
      const prompts = await generateStickerPrompts(niche.name, style, TARGET_STICKER_COUNT, analysis);
      
      const stickerObjects: Sticker[] = prompts.map((p, i) => ({
        id: i + 1, prompt: p, url: null, status: 'pending', regenCount: 0
      }));
      
      setState(prev => ({ ...prev, stickers: stickerObjects, status: 'generating_stickers' }));
      stickersRef.current = stickerObjects;

      // WORKER QUEUE CONFIG
      // BytePlus currently allows up to 10 concurrent Seedream requests for an
      // individual account. Keep two slots of headroom for retries and manual
      // actions. Turbo renders 1K assets with 8 workers; Pro uses 6 workers.
      const CONCURRENCY = useTurbo ? 8 : 6;
      addLog(`Generating stickers with ${CONCURRENCY} parallel Seedream workers...`);
      
      await processWithQueue(stickerObjects, CONCURRENCY, async (s, index) => {
          if (stopSignal.current || skipToNextStageSignal.current) return;
          
          // AUTO-RETRY LOGIC
          let attempts = 0;
          const MAX_ATTEMPTS = 3;
          let success = false;
          let lastError = "";

          while(attempts < MAX_ATTEMPTS && !success) {
            try {
              // PASS ANALYSIS to generation so it renders frames correctly
              const base64 = await generateAutopilotSticker(s.prompt, style.prompt, useTurbo, niche.name, analysis);
              
              // PROCESS: 1. Remove BLACK BG -> 2. Add Shadow (White border comes from AI)
              const processedBlob = await processStickerImage(base64, s.prompt);
              const finalUrl = URL.createObjectURL(processedBlob);
              
              setState(prev => {
                  const nextStickers = [...prev.stickers];
                  nextStickers[index] = { ...s, url: finalUrl, blob: processedBlob, status: 'completed', regenCount: attempts, prompt: s.prompt }; // Preserve original prompt unless updated
                  const completedCount = nextStickers.filter(st => st.status === 'completed').length;
                  return { ...prev, stickers: nextStickers, progress: 10 + Math.round((completedCount / TARGET_STICKER_COUNT) * 60) };
              });
              stickersRef.current[index] = { ...s, url: finalUrl, blob: processedBlob, status: 'completed' };
              success = true;

            } catch (e: any) {
              attempts++;
              lastError = e.message || "Unknown error";
              if (attempts < MAX_ATTEMPTS) {
                 // Fast Retry
                 await new Promise(r => setTimeout(r, 1000 * attempts));
              }
            }
          }

          if (!success) {
            console.error(`Final failure for sticker ${s.id}: ${lastError}`);
            addLog(`Error Sticker #${s.id}: ${lastError.slice(0, 50)}`);
            setState(prev => {
                const nextStickers = [...prev.stickers];
                nextStickers[index] = { ...s, status: 'error' };
                return { ...prev, stickers: nextStickers };
            });
          }
      });

      if (stopSignal.current) throw new Error("Stopped by user");
      
      skipToNextStageSignal.current = false; 
      setState(prev => ({ ...prev, status: 'zipping', progress: 75 }));
      addLog(`Packaging ZIP files...`);
      const zips = await packageStickers(stickersRef.current, niche!.name);
      setState(prev => ({ ...prev, zips }));

      if (stopSignal.current) throw new Error("Stopped by user");
      setState(prev => ({ ...prev, status: 'marketing', progress: 85 }));
      addLog("Creating Mockups...");

      const availableStickerCount = Math.min(
        TARGET_STICKER_COUNT,
        stickersRef.current.filter(sticker => sticker.status === 'completed' && sticker.url).length
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
        { id: 'cover', type: 'cover', title: 'Main Cover (Digital Download Badge)', url: null, status: 'pending' },
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
      let finishedAssets = 0;
      await processWithQueue(assetsToGen, 6, async (asset, i) => {
        if (stopSignal.current) return;
        const assetStartedAt = Date.now();
        addLog(`Generating asset: ${asset.title}`);
        setState(prev => {
          const nextAssets = [...prev.marketingAssets];
          nextAssets[i] = { ...asset, status: 'generating' };
          return { ...prev, marketingAssets: nextAssets };
        });

        try {
          const validStickers = stickersRef.current
            .filter(sticker => sticker.status === 'completed' && sticker.url)
            .slice(0, TARGET_STICKER_COUNT);
          let stickersForMockup: string[] = [];

          if (asset.id === 'preview_1') stickersForMockup = getStickerRange(validStickers, 0, 17);
          else if (asset.id === 'preview_2') stickersForMockup = getStickerRange(validStickers, 17, 34);
          else if (asset.id === 'preview_3') stickersForMockup = getStickerRange(validStickers, 34, 51);
          else if (asset.id === 'preview_4') stickersForMockup = getStickerRange(validStickers, 51, 68);
          else if (asset.id === 'preview_5') stickersForMockup = getStickerRange(validStickers, 68, 85);
          else if (asset.id === 'preview_6') stickersForMockup = getStickerRange(validStickers, 85, 100);
          else if (asset.type === 'cover') stickersForMockup = await getModelSelectedCoverBatch(validStickers, 15);
          else if (asset.type === 'howto') stickersForMockup = getUniqueBatchForMockup(validStickers, 4);
          else stickersForMockup = getUniqueBatchForMockup(validStickers, 8);

          if (!stickersForMockup.length) {
            throw new Error('No completed stickers are available for this asset.');
          }

          const completedStickerCount = validStickers.filter(sticker => sticker.status === 'completed' && sticker.url).length;
          const url = await generateSeedreamMockup(asset.id!, asset.type, stickersForMockup, niche!.name, completedStickerCount);
          finishedAssets++;
          setState(prev => {
            const nextAssets = [...prev.marketingAssets];
            nextAssets[i] = { ...asset, url, status: 'completed' };
            return {
              ...prev,
              marketingAssets: nextAssets,
              progress: 85 + Math.round((finishedAssets / assetsToGen.length) * 9)
            };
          });
          const elapsedSeconds = Math.max(1, Math.round((Date.now() - assetStartedAt) / 1000));
          const elapsedLabel = elapsedSeconds >= 60
            ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
            : `${elapsedSeconds}s`;
          addLog(`Completed ${asset.title} in ${elapsedLabel}.`);
        } catch (e: any) {
          finishedAssets++;
          const elapsedSeconds = Math.max(1, Math.round((Date.now() - assetStartedAt) / 1000));
          addLog(`Failed asset ${asset.title} after ${elapsedSeconds}s. Error: ${e.message}`);
          setState(prev => {
            const nextAssets = [...prev.marketingAssets];
            nextAssets[i] = { ...asset, status: 'error' };
            return { ...prev, marketingAssets: nextAssets };
          });
        }
      });

      if (stopSignal.current) throw new Error("Stopped by user");
      setState(prev => ({ ...prev, status: 'copywriting', progress: 95 }));
      addLog("Generating SEO Listing Copy...");
      // PASS useTurbo to generate correct description
      const completedStickerCount = Math.min(
        TARGET_STICKER_COUNT,
        stickersRef.current.filter(sticker => sticker.status === 'completed').length
      );
      const rawListing = await generateAutopilotListing(niche!.name, style.name, useTurbo, completedStickerCount);
      setState(prev => ({ ...prev, rawListing, status: 'completed', progress: 100 }));
      addLog("PRODUCTION COMPLETE.");
      
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
                {useTurbo ? 'Fast Mode: 1K Generation' : 'Quality Mode: 2K Generation'} • Seedream 5.0 Pro
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
                    onClick={() => setUseTurbo(!useTurbo)}
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
                        100 stickers + listing + marketing assets
                     </span>
                 </div>
             </div>

             {state.status === 'idle' || state.status === 'completed' || state.status === 'error' ? (
               <div className="flex gap-2">
                 <button 
                   onClick={runAutopilot}
                   className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg flex items-center gap-2 hover:scale-105 transition-transform"
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
                           addLog("User requested skip. Finishing current batch and moving to packaging...");
                       }}
                       className="bg-amber-500 hover:bg-amber-400 text-black px-6 py-4 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2 animate-pulse"
                     >
                       <FastForward className="w-5 h-5 fill-black" /> FINISH NOW
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
                        {state.stickers.filter(s => s.status === 'completed').length} / {TARGET_STICKER_COUNT}
                      </div>
                    </div>
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
                    <div key={s.id} className="aspect-square bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-slate-700 rounded border border-slate-700 overflow-hidden relative group">
                       {s.status === 'completed' && s.url ? (
                         <>
                             <img src={s.url} className="w-full h-full object-contain p-1" />
                             {/* Hover Regenerate Button */}
                             <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                <button 
                                    onClick={() => handleRegenerateSticker(s.id)}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-full shadow-lg transform hover:scale-110 transition-all"
                                    title="Regenerate this sticker"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleRepairStickerTransparency(s.id)}
                                    className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white p-2 rounded-full shadow-lg transform hover:scale-110 transition-all"
                                    title="Repair transparent holes without regenerating"
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
                                            <img src={asset.url} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                                <button 
                                                  onClick={() => downloadAsset(asset.url!, `${asset.type}.jpg`)}
                                                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-full text-xs font-bold"
                                                >
                                                  Download JPG
                                                </button>
                                                <button 
                                                  onClick={() => handleRegenerateMockup(asset.id!)}
                                                  className="bg-slate-700 hover:bg-slate-600 text-white p-2 rounded-full"
                                                  title="Regenerate"
                                                >
                                                  <RefreshCw className="w-4 h-4" />
                                                </button>
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
            <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">
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
                            OpenAI web search will inspect current marketplace and social trend signals to discover 5 breakout sticker trends.
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
                                             Discovered Breakout Trends
                                         </h3>
                                         <button
                                            onClick={handleAddAllTrends}
                                            className="bg-white text-indigo-900 hover:bg-indigo-50 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1 transition-colors"
                                         >
                                            <Plus className="w-3 h-3" /> Import All ({discoveredTrends.length})
                                         </button>
                                     </div>
                                     <div className="grid grid-cols-1 gap-3">
                                         {discoveredTrends.map((trend, i) => (
                                             <div key={i} className="bg-slate-900 p-4 rounded-xl border border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-indigo-500/50 transition-colors">
                                                 <div className="flex-1">
                                                     <div className="flex items-center gap-2 mb-1">
                                                         <span className="text-lg font-bold text-white">{trend.name}</span>
                                                         <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">{trend.category}</span>
                                                     </div>
                                                     <p className="text-sm text-slate-400 mb-2">{trend.description}</p>
                                                     <div className="flex items-center gap-2 text-xs text-indigo-400">
                                                         <Palette className="w-3 h-3" />
                                                         <span>Suggested Style: {trend.styleName}</span>
                                                     </div>
                                                 </div>
                                                 <button 
                                                    onClick={() => handleAddTrend(trend)}
                                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg w-full sm:w-auto justify-center"
                                                 >
                                                     <Plus className="w-4 h-4" /> Add to Library
                                                 </button>
                                             </div>
                                         ))}
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
