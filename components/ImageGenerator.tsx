import React, { useState } from 'react';
import { ensureProvidersConfigured, generateStickerImage } from '../services/aiService';
import { ImageSize } from '../types';
import { Image, Download, Loader2, Wand2 } from 'lucide-react';

const ImageGenerator: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<ImageSize>('1K');
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      await ensureProvidersConfigured();
      const url = await generateStickerImage(prompt, size);
      setImageUrl(url);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : 'Failed to generate image.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-6">
          <Image className="w-6 h-6 text-pink-400" />
          <h2 className="text-2xl font-bold text-white">Seedream 5.0 Pro Studio</h2>
        </div>

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Describe your sticker (e.g., 'A cute holographic cat eating pizza')"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-pink-500 outline-none"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <select
            className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-pink-500 outline-none"
            value={size}
            onChange={(e) => setSize(e.target.value as ImageSize)}
          >
            <option value="1K">1K Resolution</option>
            <option value="2K">2K Resolution</option>
            <option value="4K">4K Resolution</option>
          </select>
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt}
            className={`px-6 py-3 rounded-lg font-bold text-white shadow-lg transition-all flex items-center gap-2 ${
              loading || !prompt
                ? 'bg-slate-700 cursor-not-allowed'
                : 'bg-pink-600 hover:bg-pink-500 active:scale-95'
            }`}
          >
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Wand2 className="w-5 h-5" />}
            Generate
          </button>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-700 min-h-[400px] flex items-center justify-center overflow-hidden relative">
          {imageUrl ? (
            <div className="relative group w-full h-full flex justify-center bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
              <img src={imageUrl} alt="Generated Sticker" className="max-h-[500px] object-contain shadow-2xl" />
              <a 
                href={imageUrl} 
                download={`sticker-${Date.now()}.png`}
                className="absolute bottom-4 right-4 bg-white text-slate-900 px-4 py-2 rounded-lg font-bold shadow-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2"
              >
                <Download className="w-4 h-4" /> Download PNG
              </a>
            </div>
          ) : (
            <div className="text-center text-slate-500">
              <Image className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>Enter a prompt to generate high-resolution sticker assets.</p>
            </div>
          )}
        </div>
        
        <div className="mt-4 text-xs text-slate-500 flex justify-between">
           <span>Model: Seedream 5.0 Pro</span>
           <span>Keys stay on the server</span>
        </div>
      </div>
    </div>
  );
};

export default ImageGenerator;
