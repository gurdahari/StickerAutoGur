
import React from 'react';

interface ClusterInfo {
  cluster: string;
  focus: string;
  driver: string;
  topNiches: string[];
  visualVibe: string;
}

const clusterData: ClusterInfo[] = [
  {
    cluster: "Cluster A: Professional Identity",
    focus: "ICU Nurses, Software Devs, SLPs, Baristas",
    driver: "Shared trauma and inside jokes. Buying a 'badge of honor'.",
    topNiches: ["Night Shift (Vampire motifs)", "Medical Coders (ICD-10)", "Cybersecurity (White Hat)"],
    visualVibe: "Technical specs, jargon-heavy, high-stress humor."
  },
  {
    cluster: "Cluster B: Neurodiversity",
    focus: "ADHD, Autism, Sensory Processing",
    driver: "Need for validation and community signaling. Functional tools for regulation.",
    topNiches: ["Neurospicy Labels", "Executive Dysfunction Trackers", "Time Blindness Jokes"],
    visualVibe: "Infinity symbols, 'Brain Bees', clinical but ironic."
  },
  {
    cluster: "Cluster C: Hyper-Specific Hobbies",
    focus: "Keyboards, D&D, Cozy Gaming, BookTok",
    driver: "The 'Riches are in the Niches'. High loyalty to niche-specific visual language.",
    topNiches: ["Mechanical Switches", "Dice Towers", "Yarn Chicken", "Spice Ratings"],
    visualVibe: "Pixel art, 'thock' visualizations, specialized diagrams."
  },
  {
    cluster: "Cluster D: Lifestyle & Identity",
    focus: "Van Life, Dark Academia, Goblincore",
    driver: "Signaling personal values and 'portable identity'.",
    topNiches: ["National Park Checklists", "Greek Busts", "Moss/Shinies/Rocks"],
    visualVibe: "Vintage paper textures, earth tones, forest floor aesthetics."
  },
  {
    cluster: "Cluster G: Social Identity",
    focus: "Subtle Pride, Trans Joy, Sapphic Culture",
    driver: "Mixing identity flags with hobbies or humor. Safety-focused signaling.",
    topNiches: ["Flag Palette Landscapes", "Carabiner Motifs", "Pronoun Badge Sets"],
    visualVibe: "Subtle gradients, minimalist icons, transformation themes."
  }
];

const NicheIntel: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      <div className="bg-indigo-900/20 border border-indigo-500/30 p-6 rounded-2xl mb-8">
         <h2 className="text-2xl font-bold text-white mb-2">2025-2026 Market Analysis Framework</h2>
         <p className="text-slate-300">Success in 2026 relies on granular audience segmentation and "Identity Stacking". Move away from broad designs to hyper-specific subcultures.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {clusterData.map((item, idx) => (
          <div key={idx} className="bg-slate-800 border border-slate-700 rounded-xl p-6 hover:border-indigo-500 transition-all shadow-lg group">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors">{item.cluster}</h3>
              <span className="bg-emerald-900/50 text-emerald-400 text-[10px] px-2 py-1 rounded font-mono uppercase tracking-tighter">High Growth</span>
            </div>
            
            <div className="space-y-4">
              <div>
                <h4 className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1">Consumer Driver</h4>
                <p className="text-sm text-slate-300">{item.driver}</p>
              </div>

              <div>
                <h4 className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1">Key Micro-Markets</h4>
                <div className="flex flex-wrap gap-2">
                  {item.topNiches.map((n, i) => (
                    <span key={i} className="bg-slate-900 text-indigo-300 text-[11px] px-2 py-1 rounded border border-slate-700">
                      {n}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1">Visual Trajectory</h4>
                <p className="text-xs text-slate-400 italic">"{item.visualVibe}"</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8">
         <h3 className="text-xl font-bold text-white mb-4">The "Portable Identity" Strategy</h3>
         <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-2">
               <div className="text-indigo-400 font-bold text-lg">01. Identity Stacking</div>
               <p className="text-sm text-slate-400">Consumers layer multiple niche stickers (e.g. 'Plant Parent' + 'Neurospicy' + 'ICU Nurse') on one surface.</p>
            </div>
            <div className="space-y-2">
               <div className="text-pink-400 font-bold text-lg">02. Sustainability Baseline</div>
               <p className="text-sm text-slate-400">Zero-waste packaging and PVC-free vinyl are now mandatory expectations for Gen Z/Millennials.</p>
            </div>
            <div className="space-y-2">
               <div className="text-amber-400 font-bold text-lg">03. Dopamine Luxuries</div>
               <p className="text-sm text-slate-400">Stickers ($3-$7) are the ultimate 'Lipstick Effect' product—affordable dopamine in a tight economy.</p>
            </div>
         </div>
      </div>
    </div>
  );
};

export default NicheIntel;
