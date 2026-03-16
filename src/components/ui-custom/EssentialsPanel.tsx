import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { BrushSettings } from '@/hooks/useWebGLPaint';

interface EssentialsPanelProps {
  brushSettings: BrushSettings;
  onBrushSettingsChange: (settings: BrushSettings) => void;
}

export const EssentialsPanel: React.FC<EssentialsPanelProps> = ({
  brushSettings,
  onBrushSettingsChange,
}) => {
  // Temporary fix: Reset symmetry if it was set to radial while we have it locked
  React.useEffect(() => {
    if (brushSettings.symmetryMode === 'radial') {
      onBrushSettingsChange({ ...brushSettings, symmetryMode: 'none' });
    }
  }, [brushSettings.symmetryMode, onBrushSettingsChange, brushSettings]);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase">Estabilização</h3>
        
        <div className="flex items-center justify-between">
          <Label className="text-zinc-400 text-xs">Lazy Mouse</Label>
          <Switch 
            checked={brushSettings.lazyMouse}
            onCheckedChange={(checked) => onBrushSettingsChange({ ...brushSettings, lazyMouse: checked })}
          />
        </div>

        {brushSettings.lazyMouse && (
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-zinc-400 text-xs">Raio de Estabilização</Label>
              <span className="text-zinc-500 font-mono text-[10px]">{brushSettings.lazyRadius}</span>
            </div>
            <Slider
              value={[brushSettings.lazyRadius || 0.1]}
              onValueChange={([val]) => onBrushSettingsChange({ ...brushSettings, lazyRadius: val })}
              min={0.01}
              max={1.0}
              step={0.01}
            />
          </div>
        )}
      </div>

      <div className="space-y-4 pt-4 border-t border-white/5">
        <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase">Simetria</h3>
        
        <div className="grid grid-cols-3 gap-2">
          {(['none', 'mirror', 'radial'] as const).map((mode) => {
            const isDisabled = mode === 'radial';
            return (
              <button
                key={mode}
                disabled={isDisabled}
                onClick={() => !isDisabled && onBrushSettingsChange({ ...brushSettings, symmetryMode: mode })}
                className={`py-2 text-[10px] rounded border transition-all ${
                  brushSettings.symmetryMode === mode 
                  ? 'bg-zinc-800 border-white text-white' 
                  : isDisabled
                  ? 'bg-zinc-950 border-white/5 text-zinc-700 cursor-not-allowed grayscale'
                  : 'bg-zinc-900 border-white/5 text-zinc-500 hover:border-white/20'
                }`}
              >
                {mode.toUpperCase()}
                {isDisabled && <span className="block text-[8px] opacity-50">(Lock)</span>}
              </button>
            );
          })}
        </div>

        {brushSettings.symmetryMode !== 'none' && (
          <>
            <div className="space-y-2">
              <Label className="text-zinc-400 text-xs">Eixo</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <button
                    key={axis}
                    onClick={() => onBrushSettingsChange({ ...brushSettings, symmetryAxis: axis })}
                    className={`py-1.5 text-[10px] rounded border transition-all ${
                      brushSettings.symmetryAxis === axis 
                      ? 'bg-zinc-800 border-white text-white' 
                      : 'bg-zinc-900 border-white/5 text-zinc-500 hover:border-white/20'
                    }`}
                  >
                    {axis.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {brushSettings.symmetryMode === 'radial' && (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-zinc-400 text-xs">Pontos Radiais</Label>
                  <span className="text-zinc-500 font-mono text-[10px]">{brushSettings.radialPoints}</span>
                </div>
                <Slider
                  value={[brushSettings.radialPoints || 4]}
                  onValueChange={([val]) => onBrushSettingsChange({ ...brushSettings, radialPoints: val })}
                  min={2}
                  max={24}
                  step={1}
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-4 pt-4 border-t border-white/5">
        <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase">Dynamics (Jitter)</h3>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-zinc-400 text-xs">Size Jitter</Label>
              <span className="text-zinc-500 font-mono text-[10px]">{Math.round((brushSettings.jitterSize || 0) * 100)}%</span>
            </div>
            <Slider
              value={[brushSettings.jitterSize || 0]}
              onValueChange={([val]) => onBrushSettingsChange({ ...brushSettings, jitterSize: val })}
              min={0}
              max={1}
              step={0.01}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-zinc-400 text-xs">Opacity Jitter</Label>
              <span className="text-zinc-500 font-mono text-[10px]">{Math.round((brushSettings.jitterOpacity || 0) * 100)}%</span>
            </div>
            <Slider
              value={[brushSettings.jitterOpacity || 0]}
              onValueChange={([val]) => onBrushSettingsChange({ ...brushSettings, jitterOpacity: val })}
              min={0}
              max={1}
              step={0.01}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-zinc-400 text-xs">Random Angle</Label>
            <Switch 
              checked={brushSettings.jitterAngle}
              onCheckedChange={(checked) => onBrushSettingsChange({ ...brushSettings, jitterAngle: checked })}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
