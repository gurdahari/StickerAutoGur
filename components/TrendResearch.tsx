
import React, { useState } from 'react';
import { getTrendAnalysis } from '../services/aiService';
import { TrendResult } from '../types';
import { Globe, Search, Loader2, ExternalLink, Zap, ArrowRight } from 'lucide-react';

interface TrendResearchProps {
  onUseTrend: (trend: string) => void;
}

const TrendResearch: React.FC<TrendResearchProps> = ({ onUseTrend }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrendResult | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;
    setLoading(true);
    try {
      const data = await getTrendAnalysis(query);
      setResult(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-6">
          <Globe className="w-6 h-6 text-blue-400" />
          <h2 className="text-2xl font-bold text-white">Trend Radar (Live Data)</h2>
        </div>

        <form onSubmit={handleSearch} className="flex gap-4 mb-8">
          <input 
            type="text"
            placeholder="e.g. 'Coquette sticker trends 2024' or 'Best selling nursing stickers'"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button 
             type="submit"
             disabled={loading}
             className="bg-blue-600 hover:bg-blue-500 text-white px-6 rounded-lg font-bold flex items-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Search className="w-5 h-5" />}
            Analyze
          </button>
        </form>

        {result && (
          <div className="animate-in fade-in slide-in-from-bottom-2">
            <div className="flex justify-between items-center mb-4">
               <h3 className="text-sm uppercase font-bold text-slate-500 tracking-wider">Analysis</h3>
               <button 
                  onClick={() => onUseTrend(query)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm shadow-lg hover:scale-105 transition-transform"
               >
                  <Zap className="w-4 h-4 fill-white" />
                  Create Sticker Pack from Trend
                  <ArrowRight className="w-4 h-4" />
               </button>
            </div>
            
            <div className="bg-slate-900 rounded-lg p-6 border border-slate-700 mb-6">
              <p className="text-slate-200 whitespace-pre-line leading-relaxed">{result.answer}</p>
            </div>

            {result.sources.length > 0 && (
              <div>
                <h3 className="text-sm uppercase font-bold text-slate-500 mb-3 tracking-wider">Sources</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {result.sources.map((source, i) => (
                    <a 
                      key={i} 
                      href={source.uri} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 bg-slate-800/50 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors group"
                    >
                      <ExternalLink className="w-4 h-4 text-blue-400 group-hover:text-blue-300" />
                      <span className="text-sm text-slate-300 group-hover:text-white truncate">{source.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrendResearch;
