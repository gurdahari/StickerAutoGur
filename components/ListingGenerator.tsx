
import React, { useState, useEffect, useRef } from 'react';
import { NicheType, GeneratedListing, StickerBatch, MarketingAsset, StylePreset } from '../types';
import { ensureProvidersConfigured, generateListingContent, generateStickerPrompts, generateStickerImage, generateMarketingImage } from '../services/aiService';
import { Copy, RefreshCw, Loader2, Check, Download, Package, Image as ImageIcon, FileText, AlertTriangle, Play, Pause } from 'lucide-react';
import JSZip from 'jszip';

// Helper to convert Base64 PNG to JPG Blob
const base64ToJpgBlob = async (base64: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 3000; // Requirement: 3000x3000
      canvas.height = 3000;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas context failed')); return; }
      
      // Draw White Background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw Image centered
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Export as JPG (0.9 quality)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Blob conversion failed'));
      }, 'image/jpeg', 0.9);
    };
    img.onerror = reject;
  });
};

const THEMES = [
  "Play Haus (Maximalist, Surreal)",
  "Gothmas Celestial (Dark Romantic)",
  "Coquette Bows (Balletcore)",
  "Nonna Holiday (Cozy Kitchen)",
  "Supper Club (Retro Glam)"
];

const ListingGenerator: React.FC = () => {
  const [listing, setListing] = useState<GeneratedListing | null>(null);
  const [batches, setBatches] = useState<StickerBatch[]>(
    THEMES.map(t => ({ themeName: t, status: 'pending', stickers: [], progress: 0 }))
  );
  const [marketingAssets, setMarketingAssets] = useState<MarketingAsset[]>([
    { type: 'cover', title: 'Main Cover Image', url: null, status: 'pending' },
    { type: 'howto', title: 'How to Download', url: null, status: 'pending' },
    { type: 'preview', title: 'Preview: Play Haus', url: null, status: 'pending' },
    { type: 'preview', title: 'Preview: Gothmas', url: null, status: 'pending' },
    { type: 'preview', title: 'Preview: Coquette', url: null, status: 'pending' },
    { type: 'preview', title: 'Preview: Nonna', url: null, status: 'pending' },
    { type: 'preview', title: 'Preview: Supper Club', url: null, status: 'pending' },
    { type: 'mockup', title: 'Laptop Mockup', url: null, status: 'pending' },
    { type: 'mockup', title: 'iPad Planner Mockup', url: null, status: 'pending' },
    { type: 'mockup', title: 'Journal Mockup', url: null, status: 'pending' },
  ]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'status' | 'downloads' | 'listing'>('status');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const stopSignal = useRef(false);

  // --- Production Logic ---

  const checkApiKey = async () => {
    await ensureProvidersConfigured();
  };

  const startProduction = async () => {
    try {
      await checkApiKey();
      setIsProcessing(true);
      stopSignal.current = false;
      setErrorMsg(null);

      // 1. Generate Listing Text (Fast)
      if (!listing) {
        const text = await generateListingContent(NicheType.OTHER, "Mega Bundle 2026", 50, true);
        setListing(text);
      }

      // 2. Generate Stickers (The Heavy Lifting)
      for (let i = 0; i < batches.length; i++) {
        if (stopSignal.current) break;
        const batch = batches[i];
        if (batch.status === 'completed') continue;

        updateBatchStatus(i, { status: 'generating' });

        // Get Prompts
        const stylePreset: StylePreset = {
             id: 'manual-theme',
             name: batch.themeName,
             prompt: batch.themeName
        };
        const prompts = await generateStickerPrompts(batch.themeName, stylePreset, 10);
        
        const zip = new JSZip();
        const stickersFolder = zip.folder(batch.themeName.split(' ')[0] + "_Stickers");
        
        const generatedStickers = [...batch.stickers];

        // Generate 10 Stickers sequentially to avoid rate limits
        for (let j = 0; j < 10; j++) {
           if (stopSignal.current) break;
           if (generatedStickers[j]) continue; // Skip if already done

           try {
             const base64 = await generateStickerImage(prompts[j]);
             generatedStickers[j] = { id: j, url: base64, prompt: prompts[j] };
             
             // Convert to JPG and add to ZIP immediately
             const jpgBlob = await base64ToJpgBlob(base64);
             stickersFolder?.file(`${batch.themeName.split(' ')[0]}_${j+1}.jpg`, jpgBlob);

             updateBatchStatus(i, { 
               stickers: [...generatedStickers], 
               progress: Math.round(((j + 1) / 10) * 100) 
             });

             // Increased delay to 3s to respect API Quota
             await new Promise(r => setTimeout(r, 3000));
           } catch (e: any) {
             console.error(`Failed sticker ${j} in batch ${i}`, e);
             if (e.message.includes('API_KEY')) {
                 setErrorMsg(e.message);
                 stopSignal.current = true;
                 break;
             }
           }
        }
        
        if (stopSignal.current) break;

        // Finalize Zip
        updateBatchStatus(i, { status: 'zipping' });
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        updateBatchStatus(i, { status: 'completed', zipBlob });
      }

      // 3. Generate Marketing Assets
      for (let i = 0; i < marketingAssets.length; i++) {
        if (stopSignal.current) break;
        if (marketingAssets[i].status === 'completed') continue;

        updateAssetStatus(i, 'generating');
        try {
          const detail = marketingAssets[i].type === 'preview' 
            ? marketingAssets[i].title.split(': ')[1] 
            : 'Mega Bundle';
          
          // Fixed: Removed third argument as generateMarketingImage only accepts 2 arguments
          const url = await generateMarketingImage(marketingAssets[i].type, detail);
          updateAssetStatus(i, 'completed', url);
        } catch (e) {
          console.error(`Failed asset ${i}`, e);
          updateAssetStatus(i, 'pending'); // Retry state
        }
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Production halted due to error.");
    } finally {
      setIsProcessing(false);
      setActiveTab('downloads');
    }
  };

  const stopProduction = () => {
    stopSignal.current = true;
    setIsProcessing(false);
  };

  // --- State Updaters ---

  const updateBatchStatus = (index: number, updates: Partial<StickerBatch>) => {
    setBatches(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  const updateAssetStatus = (index: number, status: MarketingAsset['status'], url?: string) => {
    setMarketingAssets(prev => {
      const next = [...prev];
      next[index] = { ...next[index], status };
      if (url) next[index].url = url;
      return next;
    });
  };

  // --- Render Helpers ---

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const overallProgress = () => {
    const stickerProgress = batches.reduce((acc, b) => acc + (b.status === 'completed' ? 100 : b.progress), 0) / batches.length;
    const assetProgress = (marketingAssets.filter(a => a.status === 'completed').length / marketingAssets.length) * 100;
    return Math.round((stickerProgress * 0.7) + (assetProgress * 0.3));
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      
      {/* Control Center */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-2xl">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Package className="w-6 h-6 text-indigo-400" />
              Mega Bundle Factory
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              50 Stickers • 5 Themes • JPG + ZIP • Marketing Assets
            </p>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="flex-1 md:w-64">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Production Status</span>
                <span className="text-indigo-400 font-bold">{overallProgress()}%</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full transition-all duration-300"
                  style={{ width: `${overallProgress()}%` }}
                />
              </div>
            </div>
            
            {!isProcessing ? (
              <button 
                onClick={startProduction}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 shadow-lg transition-transform active:scale-95"
              >
                <Play className="w-5 h-5 fill-current" />
                {overallProgress() > 0 && overallProgress() < 100 ? 'Resume' : 'Start Production'}
              </button>
            ) : (
              <button 
                onClick={stopProduction}
                className="bg-red-900/50 hover:bg-red-900 border border-red-700 text-red-200 px-6 py-3 rounded-lg font-bold flex items-center gap-2"
              >
                <Pause className="w-5 h-5 fill-current" /> Stop
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 p-4 bg-red-900/20 border border-red-800 rounded-lg flex items-center gap-2 text-red-300">
            <AlertTriangle className="w-5 h-5" />
            {errorMsg}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-800 overflow-x-auto">
        {[
          { id: 'status', label: 'Production Line', icon: RefreshCw },
          { id: 'downloads', label: 'Deliverables & ZIPs', icon: Download },
          { id: 'listing', label: 'Listing Copy', icon: FileText },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-6 py-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id 
                ? 'border-indigo-500 text-white' 
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="min-h-[500px]">
        
        {/* TAB: PRODUCTION STATUS */}
        {activeTab === 'status' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-pink-400" /> Sticker Batches
              </h3>
              {batches.map((batch, i) => (
                <div key={i} className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-medium text-white">{batch.themeName}</span>
                    <span className={`text-xs px-2 py-1 rounded font-bold ${
                      batch.status === 'completed' ? 'bg-emerald-900 text-emerald-300' : 
                      batch.status === 'generating' ? 'bg-indigo-900 text-indigo-300' :
                      'bg-slate-700 text-slate-400'
                    }`}>
                      {batch.status === 'generating' ? `Generating ${batch.stickers.length}/10` : batch.status}
                    </span>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-2 mb-3">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${batch.status === 'completed' ? 'bg-emerald-500' : 'bg-pink-500'}`}
                      style={{ width: `${batch.progress}%` }}
                    />
                  </div>
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {batch.stickers.map((s) => (
                      <img key={s.id} src={s.url} className="w-8 h-8 rounded border border-slate-600 bg-white object-contain" />
                    ))}
                    {Array.from({ length: 10 - batch.stickers.length }).map((_, idx) => (
                      <div key={idx} className="w-8 h-8 rounded border border-slate-700 bg-slate-900" />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4">
               <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-blue-400" /> Marketing Assets
              </h3>
              <div className="grid grid-cols-1 gap-3">
                {marketingAssets.map((asset, i) => (
                  <div key={i} className="bg-slate-800 p-3 rounded-lg border border-slate-700 flex items-center gap-4">
                    <div className="w-16 h-12 bg-slate-900 rounded overflow-hidden flex-shrink-0 flex items-center justify-center border border-slate-700">
                      {asset.status === 'completed' && asset.url ? (
                        <img src={asset.url} className="w-full h-full object-cover" />
                      ) : asset.status === 'generating' ? (
                        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-slate-700" />
                      )}
                    </div>
                    <div className="flex-1">
                       <div className="text-sm font-medium text-white">{asset.title}</div>
                       <div className="text-xs text-slate-500 capitalize">{asset.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB: DOWNLOADS */}
        {activeTab === 'downloads' && (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-emerald-900/10 border border-emerald-900 rounded-xl p-6">
               <h3 className="text-xl font-bold text-white mb-6">Product Files (The 5 ZIPs)</h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {batches.map((batch, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-800 p-4 rounded-lg border border-slate-700">
                      <div className="flex items-center gap-3">
                         <div className={`p-2 rounded-lg ${batch.zipBlob ? 'bg-emerald-500/20' : 'bg-slate-700'}`}>
                           <Package className={`w-5 h-5 ${batch.zipBlob ? 'text-emerald-400' : 'text-slate-500'}`} />
                         </div>
                         <div>
                           <div className="font-bold text-white">StickerPack_{i+1}_{batch.themeName.split(' ')[0]}.zip</div>
                           <div className="text-xs text-slate-400">{batch.stickers.length} / 10 JPG Files • 3000px</div>
                         </div>
                      </div>
                      <button 
                        onClick={() => batch.zipBlob && downloadBlob(batch.zipBlob, `StickerPack_${i+1}_${batch.themeName.split(' ')[0]}.zip`)}
                        disabled={!batch.zipBlob}
                        className={`px-4 py-2 rounded font-bold text-sm ${
                          batch.zipBlob 
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg' 
                          : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        Download
                      </button>
                    </div>
                  ))}
               </div>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
               <h3 className="text-xl font-bold text-white mb-6">Marketing Collateral</h3>
               <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {marketingAssets.map((asset, i) => (
                     <div key={i} className="group relative aspect-square bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
                        {asset.url ? (
                          <>
                            <img src={asset.url} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center flex-col gap-2 p-2 text-center">
                               <span className="text-xs font-bold text-white">{asset.title}</span>
                               <a 
                                 href={asset.url} 
                                 download={`ListingImage_${i+1}_${asset.type}.jpg`}
                                 className="bg-white text-slate-900 px-3 py-1 rounded text-xs font-bold"
                               >
                                 Save JPG
                               </a>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-center h-full text-slate-600 text-xs">Pending</div>
                        )}
                     </div>
                  ))}
               </div>
            </div>
          </div>
        )}

        {/* TAB: LISTING COPY */}
        {activeTab === 'listing' && listing && (
          <div className="animate-in fade-in space-y-6">
             <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                <div className="flex justify-between items-center mb-4">
                   <h3 className="text-lg font-bold text-white">Title Options</h3>
                   <button onClick={() => copyToClipboard(`${listing.title1}\n${listing.title2}\n${listing.title3}`)} className="text-indigo-400 hover:text-white text-xs">Copy All</button>
                </div>
                <div className="bg-slate-900 p-4 rounded-lg text-slate-300 font-mono text-sm leading-relaxed space-y-2">
                   <div>1. {listing.title1}</div>
                   <div>2. {listing.title2}</div>
                   <div>3. {listing.title3}</div>
                </div>
             </div>

             <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                <div className="flex justify-between items-center mb-4">
                   <h3 className="text-lg font-bold text-white">Description</h3>
                   <button onClick={() => copyToClipboard(listing.description)} className="text-indigo-400 hover:text-white text-xs">Copy</button>
                </div>
                <textarea 
                  readOnly 
                  className="w-full h-96 bg-slate-900 p-4 rounded-lg text-slate-300 font-mono text-sm leading-relaxed outline-none resize-none"
                  value={listing.description}
                />
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                   <h3 className="text-lg font-bold text-white mb-4">13 Etsy Tags</h3>
                   <div className="flex flex-wrap gap-2">
                      {listing.tags.map((tag, i) => (
                        <span key={i} className="bg-slate-900 border border-slate-700 px-3 py-1 rounded-full text-xs text-slate-300">
                          {tag}
                        </span>
                      ))}
                   </div>
                </div>
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                   <h3 className="text-lg font-bold text-white mb-4">SEO Keywords</h3>
                   <div className="text-sm text-slate-400">
                      {listing.keywords?.join(", ")}
                   </div>
                </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ListingGenerator;
