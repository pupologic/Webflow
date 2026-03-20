import React, { useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Circle, Square, Save } from 'lucide-react';
import type { BrushSettings } from '@/hooks/useWebGLPaint';
import { BrushStrokePreview } from './BrushStrokePreview';

import pencil1 from '@/brushes/pencil_1.png';
import grunge from '@/brushes/grunge.png';
import spray from '@/brushes/spray.png';

interface BrushStudioProps {
  brushSettings: BrushSettings;
  onBrushSettingsChange: (settings: BrushSettings) => void;
  onSaveAsNew: (name: string) => void;
  onClose: () => void;
}

const SHAPES = [
  { id: 'circle', type: 'circle' as const, textureId: null, label: 'Round', icon: <Circle className="w-4 h-4" /> },
  { id: 'square', type: 'square' as const, textureId: null, label: 'Square', icon: <Square className="w-4 h-4" /> },
  { id: 'pencil', type: 'texture' as const, textureId: pencil1, label: 'Pencil', icon: <img src={pencil1} className="w-4 h-4 opacity-80 invert dark:invert-0" alt="pencil" /> },
  { id: 'spray', type: 'texture' as const, textureId: spray, label: 'Spray', icon: <img src={spray} className="w-4 h-4 opacity-80 invert dark:invert-0" alt="spray" /> },
  { id: 'grunge', type: 'texture' as const, textureId: grunge, label: 'Grunge', icon: <img src={grunge} className="w-4 h-4 opacity-80 invert dark:invert-0" alt="grunge" /> },
];

export const BrushStudio: React.FC<BrushStudioProps> = ({
  brushSettings,
  onBrushSettingsChange,
  onSaveAsNew,
  onClose
}) => {
  const [newBrushName, setNewBrushName] = useState(brushSettings.name + ' Copy');

  const update = (updates: Partial<BrushSettings>) => {
    onBrushSettingsChange({ ...brushSettings, ...updates });
  };

  return (
    <div className="flex bg-[#121214] rounded-xl border border-white/10 overflow-hidden shadow-2xl w-[600px] h-96 relative">
      {/* Sidebar / Preview */}
      <div className="w-1/3 bg-[#09090b] p-6 flex flex-col items-center justify-between border-r border-white/5">
        <div className="w-full space-y-4">
          <Label className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">Brush Preview</Label>
          <div className="w-full h-32 bg-zinc-900 border border-white/5 rounded-lg flex items-center justify-center overflow-hidden seamless-checkerboard">
            <BrushStrokePreview brush={brushSettings} width={180} height={100} />
          </div>
          <div className="space-y-1">
             <input 
               className="bg-transparent border-b border-white/10 text-white text-sm w-full py-1 focus:outline-none focus:border-blue-500"
               value={newBrushName}
               onChange={(e) => setNewBrushName(e.target.value)}
             />
             <p className="text-[10px] text-zinc-500 italic">Editing: {brushSettings.name}</p>
          </div>
        </div>

        <div className="w-full space-y-2">
           <button 
             onClick={() => onSaveAsNew(newBrushName)}
             className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-bold flex items-center justify-center gap-2"
           >
             <Save className="w-3 h-3" /> SAVE AS NEW
           </button>
           <button 
             onClick={onClose}
             className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-md text-xs"
           >
             CANCEL
           </button>
        </div>
      </div>

      {/* Main Settings */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="stroke" className="w-full h-full flex flex-col">
          <TabsList className="bg-[#121214] border-b border-white/5 rounded-none px-4 h-12 gap-0 justify-start">
            <TabsTrigger value="stroke" className="text-[10px] font-bold tracking-widest text-white/40 data-[state=active]:text-white data-[state=active]:bg-white/5 px-6 h-full uppercase border-none rounded-none">Stroke</TabsTrigger>
            <TabsTrigger value="shape" className="text-[10px] font-bold tracking-widest text-white/40 data-[state=active]:text-white data-[state=active]:bg-white/5 px-6 h-full uppercase border-none rounded-none">Shape</TabsTrigger>
            <TabsTrigger value="dynamics" className="text-[10px] font-bold tracking-widest text-white/40 data-[state=active]:text-white data-[state=active]:bg-white/5 px-6 h-full uppercase border-none rounded-none">Dynamics</TabsTrigger>
            <TabsTrigger value="jitter" className="text-[10px] font-bold tracking-widest text-white/40 data-[state=active]:text-white data-[state=active]:bg-white/5 px-6 h-full uppercase border-none rounded-none">Jitter</TabsTrigger>
          </TabsList>

          <TabsContent value="stroke" className="flex-1 p-6 space-y-6 mt-0">
             <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <span className="text-xs text-white font-medium">Spacing</span>
                  <span className="text-[10px] text-zinc-500">{(brushSettings.spacing * 100).toFixed(0)}%</span>
                </div>
                <Slider value={[brushSettings.spacing]} onValueChange={([v]) => update({spacing: v})} min={0.01} max={2} step={0.01} />

                <div className="flex justify-between items-center px-1">
                  <span className="text-xs text-white font-medium">Hardness</span>
                  <span className="text-[10px] text-zinc-500">{(brushSettings.hardness * 100).toFixed(0)}%</span>
                </div>
                <Slider value={[brushSettings.hardness]} onValueChange={([v]) => update({hardness: v})} min={0} max={1} step={0.01} />

                <div className="flex justify-between items-center px-1">
                  <span className="text-xs text-white font-medium">Default Opacity</span>
                  <span className="text-[10px] text-zinc-500">{(brushSettings.opacity * 100).toFixed(0)}%</span>
                </div>
                <Slider value={[brushSettings.opacity]} onValueChange={([v]) => update({opacity: v})} min={0.01} max={1} step={0.01} />
             </div>
          </TabsContent>

          <TabsContent value="shape" className="flex-1 p-6 space-y-4 mt-0">
             <Label className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest block mb-4">Shape Source</Label>
             <div className="grid grid-cols-2 gap-2">
                {SHAPES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => update({ type: s.type, textureId: s.textureId })}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      brushSettings.type === s.type && brushSettings.textureId === s.textureId 
                      ? 'bg-blue-600/10 border-blue-500/50 text-white' 
                      : 'bg-zinc-900 border-white/5 text-zinc-500 hover:border-white/20'
                    }`}
                  >
                    {s.icon}
                    <span className="text-[10px] font-bold">{s.label}</span>
                  </button>
                ))}
             </div>
          </TabsContent>

          <TabsContent value="dynamics" className="flex-1 p-6 space-y-6 mt-0">
             <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-zinc-900 rounded-lg border border-white/5 text-[10px]">
                  <div className="flex flex-col">
                    <span className="font-bold text-zinc-400">Follow Stroke Path</span>
                    <span className="text-[8px] text-zinc-600 uppercase">Orient brush to movement</span>
                  </div>
                  <button
                    onClick={() => update({ followPath: !brushSettings.followPath })}
                    className={`w-8 h-4 rounded-full relative transition-colors ${brushSettings.followPath ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${brushSettings.followPath ? 'left-4.5' : 'left-0.5'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 bg-zinc-900 rounded-lg border border-white/5 text-[10px]">
                  <div className="flex flex-col">
                    <span className="font-bold text-zinc-400">Screen Projection</span>
                    <span className="text-[8px] text-zinc-600 uppercase">Project from Viewport</span>
                  </div>
                  <button
                    onClick={() => update({ projectFromCamera: !brushSettings.projectFromCamera })}
                    className={`w-8 h-4 rounded-full relative transition-colors ${brushSettings.projectFromCamera ? 'bg-blue-500' : 'bg-zinc-700'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${brushSettings.projectFromCamera ? 'left-4.5' : 'left-0.5'}`} />
                  </button>
                </div>

                <div className="space-y-3">
                   <Label className="text-white text-[10px] uppercase font-bold tracking-widest block">Pressure Controls</Label>
                   <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => update({usePressureSize: !brushSettings.usePressureSize})} 
                        className={`p-2.5 rounded-lg border text-[10px] font-bold tracking-wider transition-all ${
                          brushSettings.usePressureSize 
                          ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_10px_rgba(37,99,235,0.3)]' 
                          : 'bg-zinc-900 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                        }`}
                      >
                        SIZE
                      </button>
                      <button 
                        onClick={() => update({usePressureOpacity: !brushSettings.usePressureOpacity})} 
                        className={`p-2.5 rounded-lg border text-[10px] font-bold tracking-wider transition-all ${
                          brushSettings.usePressureOpacity 
                          ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_10px_rgba(37,99,235,0.3)]' 
                          : 'bg-zinc-900 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                        }`}
                      >
                        OPACITY
                      </button>
                   </div>
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] text-white font-medium">Pressure Curve</span>
                    <span className="text-[10px] text-zinc-500">
                      {brushSettings.pressureCurve === 0.5 ? 'Soft' : brushSettings.pressureCurve === 1.0 ? 'Linear' : 'Firm'}
                    </span>
                  </div>
                  <Slider value={[brushSettings.pressureCurve || 1.0]} onValueChange={([v]) => update({pressureCurve: v})} min={0.4} max={2.5} step={0.1} />
                </div>
             </div>
          </TabsContent>

          <TabsContent value="jitter" className="flex-1 p-6 space-y-4 mt-0">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between"><span className="text-[10px] text-white font-medium">Size Jitter</span><span className="text-[10px] text-zinc-500">{((brushSettings.jitterSize || 0) * 100).toFixed(0)}%</span></div>
                  <Slider value={[brushSettings.jitterSize || 0]} onValueChange={([v]) => update({jitterSize: v})} min={0} max={1} step={0.01} />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between"><span className="text-[10px] text-white font-medium">Opacity Jitter</span><span className="text-[10px] text-zinc-500">{((brushSettings.jitterOpacity || 0) * 100).toFixed(0)}%</span></div>
                  <Slider value={[brushSettings.jitterOpacity || 0]} onValueChange={([v]) => update({jitterOpacity: v})} min={0} max={1} step={0.01} />
                </div>
                <div className="flex items-center justify-between p-3 bg-zinc-900 rounded-lg border border-white/5 mt-4">
                  <span className="text-[10px] font-bold text-white">Angle Jitter</span>
                  <button onClick={() => update({ jitterAngle: !brushSettings.jitterAngle })} className={`w-8 h-4 rounded-full relative transition-colors ${brushSettings.jitterAngle ? 'bg-emerald-500' : 'bg-zinc-700'}`}><div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${brushSettings.jitterAngle ? 'left-4.5' : 'left-0.5'}`} /></button>
                </div>
             </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
