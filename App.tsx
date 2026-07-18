
import React, { useState } from 'react';
import Autopilot from './components/Autopilot';
import NicheIntel from './components/NicheIntel';
import Roadmap from './components/Roadmap';
import ImageGenerator from './components/ImageGenerator';
import ChatBot from './components/ChatBot';
import { LayoutDashboard, TrendingUp, Calendar, Zap, Globe, Image } from 'lucide-react';

enum View {
  AUTOPILOT = 'autopilot',
  STUDIO = 'studio',
  NICHES = 'niches',
  ROADMAP = 'roadmap',
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>(View.AUTOPILOT);

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Navigation Bar */}
      <nav className="border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="bg-yellow-500 p-1.5 rounded-lg shadow-lg shadow-yellow-500/20">
                <Zap className="w-5 h-5 text-black fill-black" />
              </div>
              <span className="font-bold text-xl tracking-tight text-white hidden md:block">Sticker<span className="text-yellow-400">OS</span></span>
            </div>
            
            <div className="flex space-x-1 overflow-x-auto no-scrollbar">
              <NavButton 
                active={currentView === View.AUTOPILOT} 
                onClick={() => setCurrentView(View.AUTOPILOT)}
                icon={<Zap className="w-4 h-4" />}
                label="Autopilot"
              />
              <NavButton 
                active={currentView === View.STUDIO} 
                onClick={() => setCurrentView(View.STUDIO)}
                icon={<Image className="w-4 h-4" />}
                label="Studio"
              />
              <NavButton 
                active={currentView === View.NICHES} 
                onClick={() => setCurrentView(View.NICHES)}
                icon={<TrendingUp className="w-4 h-4" />}
                label="Idea Bank"
              />
              <NavButton 
                active={currentView === View.ROADMAP} 
                onClick={() => setCurrentView(View.ROADMAP)}
                icon={<Calendar className="w-4 h-4" />}
                label="30-Day Plan"
              />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="py-8 px-2 md:px-0">
        {/* AUTOPILOT - Always mounted (hidden via CSS) to preserve background processing */}
        <div 
          style={{ display: currentView === View.AUTOPILOT ? 'block' : 'none' }} 
          className={currentView === View.AUTOPILOT ? "animate-in fade-in slide-in-from-bottom-4 duration-500" : ""}
        >
          <Autopilot />
        </div>

        {currentView === View.STUDIO && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="text-center mb-8">
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Seedream 5.0 Pro Studio</h1>
              <p className="text-slate-400">Manual generation for specific one-off sticker concepts (1K-4K).</p>
            </div>
            <ImageGenerator />
          </div>
        )}

        {currentView === View.NICHES && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="text-center mb-8">
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Market Intelligence</h1>
              <p className="text-slate-400">Top revenue verticals extracted from 2026 market analysis.</p>
            </div>
            <NicheIntel />
          </div>
        )}

        {currentView === View.ROADMAP && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Roadmap />
          </div>
        )}
      </main>

      <ChatBot />

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-12 py-8 text-center text-slate-600 text-sm">
        <p>StickerOS 2026 • Optimized for High-Velocity Etsy Sellers</p>
        <p className="mt-1">Based on the "Best Money Maker" Strategy</p>
      </footer>
    </div>
  );
};

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

const NavButton: React.FC<NavButtonProps> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
      active 
        ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20' 
        : 'text-slate-400 hover:text-white hover:bg-slate-800'
    }`}
  >
    {icon}
    {label}
  </button>
);

export default App;
