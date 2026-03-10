import React from 'react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Palette, Box } from 'lucide-react';
import { ColorPicker } from './ColorPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface MaterialPanelProps {
  color: string;
  onColorChange: (color: string) => void;
  roughness: number;
  onRoughnessChange: (val: number) => void;
  metalness: number;
  onMetalnessChange: (val: number) => void;
}

export const MaterialPanel: React.FC<MaterialPanelProps> = ({
  color,
  onColorChange,
  roughness,
  onRoughnessChange,
  metalness,
  onMetalnessChange,
}) => {
  return (
    <div className="space-y-6 p-5 bg-[#09090b] rounded-xl border border-white/5 shadow-lg">
      <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase flex items-center gap-2">
        <Box className="w-4 h-4 text-zinc-400" />
        Shader / Material
      </h3>

      <div className="space-y-3">
        <Label className="text-zinc-500 text-[10px] uppercase tracking-wide flex items-center gap-1">
          <Palette className="w-3 h-3" />
          Base Color
        </Label>
        <div className="flex gap-3 items-center">
          <Popover>
            <PopoverTrigger asChild>
              <button 
                className="w-10 h-10 rounded-lg border border-white/10 shrink-0 shadow-inner overflow-hidden cursor-pointer active:scale-95 transition-transform"
                style={{ backgroundColor: color }}
              />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 border-none bg-transparent shadow-none" side="right" align="start">
              <ColorPicker color={color} onColorChange={onColorChange} />
            </PopoverContent>
          </Popover>
          <input 
            type="text" 
            value={color.toUpperCase()} 
            onChange={(e) => onColorChange(e.target.value)}
            className="flex-1 bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-300 outline-none focus:ring-1 focus:ring-zinc-600 font-mono uppercase"
          />
        </div>
      </div>

      <div className="space-y-4 pt-2 border-t border-white/5">
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-zinc-500 text-[10px] uppercase tracking-wide">Roughness</Label>
            <span className="text-zinc-500 font-mono text-[10px]">{Math.round(roughness * 100)}%</span>
          </div>
          <Slider
            value={[roughness]}
            onValueChange={([val]) => onRoughnessChange(val)}
            min={0}
            max={1}
            step={0.01}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-zinc-500 text-[10px] uppercase tracking-wide">Metallic</Label>
            <span className="text-zinc-500 font-mono text-[10px]">{Math.round(metalness * 100)}%</span>
          </div>
          <Slider
            value={[metalness]}
            onValueChange={([val]) => onMetalnessChange(val)}
            min={0}
            max={1}
            step={0.01}
            className="w-full"
          />
        </div>
      </div>
      

    </div>
  );
};
