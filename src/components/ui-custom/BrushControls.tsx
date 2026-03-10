import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Circle, Square } from 'lucide-react';
import type { BrushSettings } from '@/hooks/use3DPaint';

const PRESET_BRUSHES = [
  { id: 'circle', type: 'circle' as const, label: 'Round', icon: <Circle className="w-4 h-4" /> },
  { id: 'square', type: 'square' as const, label: 'Square', icon: <Square className="w-4 h-4" /> },
];

interface BrushControlsProps {
  brushSettings: BrushSettings;
  onBrushSettingsChange: (settings: BrushSettings) => void;
}

export const BrushControls: React.FC<BrushControlsProps> = ({
  brushSettings,
  onBrushSettingsChange,
}) => {
  const handleSizeChange = (value: number[]) => {
    onBrushSettingsChange({ ...brushSettings, size: value[0] });
  };

  const handleOpacityChange = (value: number[]) => {
    onBrushSettingsChange({ ...brushSettings, opacity: value[0] });
  };

  const handleSpacingChange = (value: number[]) => {
    onBrushSettingsChange({ ...brushSettings, spacing: value[0] });
  };

  return (
    <div className="space-y-6 p-5 bg-[#09090b] rounded-xl border border-white/5 shadow-lg">
      <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase">Brush</h3>
      
      {/* Brush Type Selection */}
      <div className="space-y-3">
        <Label className="text-zinc-400 text-xs tracking-wide">SHAPE</Label>
        <div className="grid grid-cols-2 gap-2">
          {PRESET_BRUSHES.map((b) => {
            const isActive = brushSettings.type === b.type;
            return (
              <button
                key={b.id}
                onClick={() => onBrushSettingsChange({ 
                  ...brushSettings, 
                  type: b.type
                })}
                className={`w-full py-2 flex items-center justify-center rounded-md border transition-all bg-zinc-900 gap-2 ${
                  isActive ? 'border-white ring-2 ring-zinc-800' : 'border-white/10 text-zinc-500 hover:border-white/30'
                }`}
                title={b.label}
              >
                {b.icon}
                <span className="text-xs">{b.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      
      {/* Brush Size */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-zinc-400 text-xs tracking-wide">SIZE</Label>
          <span className="text-zinc-500 font-mono text-[10px]">{brushSettings.size}PX</span>
        </div>
        <Slider
          value={[brushSettings.size]}
          onValueChange={handleSizeChange}
          min={1}
          max={100}
          step={1}
          className="w-full"
        />
      </div>

      {/* Brush Opacity */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-zinc-400 text-xs tracking-wide">OPACITY</Label>
          <span className="text-zinc-500 font-mono text-[10px]">{Math.round(brushSettings.opacity * 100)}%</span>
        </div>
        <Slider
          value={[brushSettings.opacity]}
          onValueChange={handleOpacityChange}
          min={0.01}
          max={1}
          step={0.01}
          className="w-full"
        />
      </div>

      {/* Brush Spacing */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-zinc-400 text-xs tracking-wide">SPACING</Label>
          <span className="text-zinc-500 font-mono text-[10px]">{Math.round((brushSettings.spacing || 0.25) * 100)}%</span>
        </div>
        <Slider
          value={[brushSettings.spacing || 0.25]}
          onValueChange={handleSpacingChange}
          min={0.05}
          max={2}
          step={0.05}
          className="w-full"
        />
      </div>

      {/* Brush Preview */}
      <div className="mt-4 pt-4 border-t border-white/5">
        <Label className="text-zinc-400 text-xs tracking-wide mb-3 block">PREVIEW</Label>
        <div className="bg-[#09090b] rounded-xl border border-white/5 p-4 flex items-center justify-center h-24 seamless-checkerboard">
          {brushSettings.type === 'circle' && (
            <div
              className="rounded-full"
              style={{
                width: Math.min(brushSettings.size, 80),
                height: Math.min(brushSettings.size, 80),
                backgroundColor: brushSettings.color,
                opacity: brushSettings.opacity,
              }}
            />
          )}

          {brushSettings.type === 'square' && (
            <div
              className="rounded-none"
              style={{
                width: Math.min(brushSettings.size, 80),
                height: Math.min(brushSettings.size, 80),
                backgroundColor: brushSettings.color,
                opacity: brushSettings.opacity,
              }}
            />
          )}

        </div>
      </div>
    </div>
  );
};
