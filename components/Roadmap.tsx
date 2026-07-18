import React, { useState } from 'react';
import { RoadmapStep } from '../types';
import { CheckCircle2, Circle } from 'lucide-react';

const initialSteps: RoadmapStep[] = [
  { day: '1-2', phase: 'Build', title: 'Infrastructure Setup', description: 'Setup AI Studio. Test Python removal scripts (rembg).', completed: false },
  { day: '3-4', phase: 'Build', title: 'Niche Selection', description: 'Finalize top 3 niches (e.g., Medical, Dark Academia). Create prompt lists.', completed: false },
  { day: '5-7', phase: 'Build', title: 'Mass Production', description: 'Generate 150 stickers (50/niche). Package into 5 ZIPs per listing.', completed: false },
  { day: '8-10', phase: 'Storefront', title: 'Mockup Factory', description: 'Create "Hero Shot", "Lifestyle Shot", and "Close Up" for all listings.', completed: false },
  { day: '11-12', phase: 'Storefront', title: 'SEO Research', description: 'Draft titles using 15-word rule. Find low-competition keywords.', completed: false },
  { day: '13-14', phase: 'Storefront', title: 'Upload & Compliance', description: 'Upload listings. Check "AI Generated" disclosure. Price at $5.00.', completed: false },
  { day: '15', phase: 'Traffic', title: 'Launch Day', description: 'Publish all listings simultaneously.', completed: false },
  { day: '16-18', phase: 'Traffic', title: 'Social Signal', description: 'Post "Process" videos on TikTok/Pinterest.', completed: false },
  { day: '19-21', phase: 'Traffic', title: 'Data Review', description: 'Check Etsy Stats. Adjust main photo if CTR is low.', completed: false },
  { day: '22-25', phase: 'Scale', title: 'Expansion', description: 'Double down on the best performing niche (Vol. 2).', completed: false },
  { day: '26-28', phase: 'Scale', title: 'Bundling', description: 'Create "Mega Bundle" ($20). Combine packs.', completed: false },
  { day: '29-30', phase: 'Scale', title: 'Review', description: 'Assess profitability. Plan next month roadmap.', completed: false },
];

const Roadmap: React.FC = () => {
  const [steps, setSteps] = useState(initialSteps);

  const toggleStep = (index: number) => {
    const newSteps = [...steps];
    newSteps[index].completed = !newSteps[index].completed;
    setSteps(newSteps);
  };

  const progress = Math.round((steps.filter(s => s.completed).length / steps.length) * 100);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8 bg-slate-800 p-6 rounded-xl border border-slate-700">
        <div className="flex justify-between items-end mb-4">
           <div>
              <h2 className="text-2xl font-bold text-white">30-Day Launch Strategy</h2>
              <p className="text-slate-400">From software initialization to market dominance.</p>
           </div>
           <div className="text-right">
              <span className="text-4xl font-bold text-indigo-400">{progress}%</span>
              <p className="text-xs uppercase text-slate-500 font-bold tracking-wider">Complete</p>
           </div>
        </div>
        <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
          <div 
            className="bg-indigo-500 h-full transition-all duration-500" 
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="space-y-4">
        {steps.map((step, index) => (
          <div 
            key={index}
            onClick={() => toggleStep(index)}
            className={`group flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
              step.completed 
                ? 'bg-emerald-900/10 border-emerald-900/50 hover:bg-emerald-900/20' 
                : 'bg-slate-800 border-slate-700 hover:border-indigo-500'
            }`}
          >
            <div className={`mt-1 ${step.completed ? 'text-emerald-500' : 'text-slate-600 group-hover:text-indigo-400'}`}>
              {step.completed ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
            </div>
            
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
                  step.phase === 'Build' ? 'bg-blue-900 text-blue-300' :
                  step.phase === 'Storefront' ? 'bg-purple-900 text-purple-300' :
                  step.phase === 'Traffic' ? 'bg-amber-900 text-amber-300' :
                  'bg-pink-900 text-pink-300'
                }`}>
                  Phase: {step.phase}
                </span>
                <span className="text-xs font-mono text-slate-500">Days {step.day}</span>
              </div>
              <h3 className={`font-semibold ${step.completed ? 'text-slate-500 line-through' : 'text-white'}`}>
                {step.title}
              </h3>
              <p className={`text-sm ${step.completed ? 'text-slate-600' : 'text-slate-400'}`}>
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Roadmap;