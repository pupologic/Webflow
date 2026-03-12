import React from 'react';
import { Brush, Eraser, Undo2, Redo2, ArrowRightLeft, Layers } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorPicker } from '@/components/ui-custom/ColorPicker';
import type { BrushSettings } from '@/hooks/useWebGLPaint';

export interface LeftShortcutBarProps {
  brushSettings: BrushSettings;
  setBrushSettings: (v: BrushSettings) => void;
  layerControls: any;
  isMaskEditing: boolean;
  setIsMaskEditing: (v: boolean) => void;
  primaryColor: string;
  setPrimaryColor: (v: string) => void;
  secondaryColor: string;
  setSecondaryColor: (v: string) => void;
  colorHistory: string[];
}

export const LeftShortcutBar: React.FC<LeftShortcutBarProps> = ({
  brushSettings,
  setBrushSettings,
  layerControls,
  isMaskEditing,
  setIsMaskEditing,
  primaryColor,
  setPrimaryColor,
  secondaryColor,
  setSecondaryColor,
  colorHistory
}) => {
  const layerColorsRef = React.useRef({ primary: primaryColor, secondary: secondaryColor });

  const handleSwapColors = () => {
    const temp = primaryColor;
    setPrimaryColor(secondaryColor);
    setSecondaryColor(temp);
    setBrushSettings({ ...brushSettings, color: secondaryColor });
  };

  const handleColorChange = (newColor: string, isPrimary: boolean) => {
    if (isPrimary) {
      setPrimaryColor(newColor);
      setBrushSettings({ ...brushSettings, color: newColor });
    } else {
      setSecondaryColor(newColor);
    }
  };

  return (
    <div className="absolute top-1/2 -translate-y-1/2 left-4 bg-[#121214]/90 backdrop-blur-md rounded-2xl py-6 px-2.5 border border-white/10 shadow-3xl flex flex-col items-center gap-3 z-20">
      
      {/* Layer/Mask Toggle */}
      <div className="flex flex-col items-center gap-1 group">
        <div className="relative w-10 h-10">
          {/* Mask Square (Back) */}
          <div 
            className={`absolute right-0 bottom-0 w-7 h-7 rounded shadow-sm border cursor-pointer hover:scale-110 transition-all duration-200 overflow-hidden ${isMaskEditing ? 'z-10 border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'border-white/10 opacity-70 hover:opacity-100'}`}
            onClick={() => {
              if (isMaskEditing) return;
              
              const activeLayer = layerControls?.layers?.find((l: any) => l.id === layerControls.activeLayerId);
              if (activeLayer) {
                // Save current layer colors before switching to mask
                layerColorsRef.current = { primary: primaryColor, secondary: secondaryColor };
                
                if (!activeLayer.maskTarget) {
                  layerControls.createLayerMask?.(activeLayer.id);
                }
                layerControls.setEditingMask?.(activeLayer.id, true);
                setIsMaskEditing(true);
                
                // Set mask colors (White/Black)
                setPrimaryColor('#ffffff');
                setSecondaryColor('#000000');
                setBrushSettings({ ...brushSettings, color: '#ffffff' });
              }
            }}
            title="Mask"
          >
            <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
              <div className="w-3 h-3 bg-white rounded-full opacity-60" />
            </div>
          </div>
          {/* Layer Square (Front) */}
          <div 
            className={`absolute left-0 top-0 w-7 h-7 rounded shadow-md border cursor-pointer hover:scale-110 transition-all duration-200 overflow-hidden ${!isMaskEditing ? 'z-10 border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'border-white/10 opacity-70 hover:opacity-100'}`}
            onClick={() => {
              if (!isMaskEditing) return;

              if (layerControls?.activeLayerId) {
                layerControls.setEditingMask?.(layerControls.activeLayerId, false);
                setIsMaskEditing(false);
                
                // Restore layer colors
                setPrimaryColor(layerColorsRef.current.primary);
                setSecondaryColor(layerColorsRef.current.secondary);
                setBrushSettings({ ...brushSettings, color: layerColorsRef.current.primary });
              }
            }}
            title="Layer"
          >
            <div className="w-full h-full bg-zinc-700 flex items-center justify-center">
              <Layers className="w-4 h-4 text-white/70" />
            </div>
          </div>
        </div>
      </div>

      {/* Dual Color Swatches */}
      <div className="flex flex-col items-center gap-1 relative mt-1">
        <div className="relative w-10 h-10">
          <Popover>
            <PopoverTrigger className="absolute right-0 bottom-0 z-0">
              <div 
                className="w-7 h-7 rounded-sm shadow-sm border border-white/20 cursor-pointer hover:scale-110 transition-transform"
                style={{ backgroundColor: secondaryColor }}
                title="Cor Secundária"
              />
            </PopoverTrigger>
            <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5" side="right" align="start">
              <ColorPicker 
                color={secondaryColor} 
                onColorChange={(c) => handleColorChange(c, false)} 
                recentColors={colorHistory}
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger className="absolute left-0 top-0 z-10">
              <div 
                className="w-7 h-7 rounded-sm shadow-md border border-white/40 cursor-pointer hover:scale-110 transition-transform"
                style={{ backgroundColor: primaryColor }}
                title="Cor Primária"
              />
            </PopoverTrigger>
            <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5" side="right" align="start">
              <ColorPicker 
                color={primaryColor} 
                onColorChange={(c) => handleColorChange(c, true)} 
                recentColors={colorHistory}
              />
            </PopoverContent>
          </Popover>
        </div>
        
        <button 
          onClick={handleSwapColors}
          className="absolute -top-1.5 -right-1.5 p-0.5 bg-[#1a1a1c] border border-white/10 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors z-20"
          title="Alternar Cores (X)"
        >
          <ArrowRightLeft className="w-3 h-3" />
        </button>
      </div>

      <div className="w-full h-px bg-white/10 my-1"/>

      {/* Tools */}
      <button 
        onClick={() => setBrushSettings({...brushSettings, mode: 'paint'})}
        className={`p-2 rounded-xl transition-all ${brushSettings.mode !== 'erase' ? 'bg-zinc-700 text-zinc-100 shadow-md scale-105' : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'}`}
        title="Paint"
      >
        <Brush className="w-5 h-5" />
      </button>
      <button 
        onClick={() => setBrushSettings({...brushSettings, mode: 'erase'})}
        className={`p-2 rounded-xl transition-all ${brushSettings.mode === 'erase' ? 'bg-zinc-700 text-zinc-100 shadow-md scale-105' : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'}`}
        title="Erase"
      >
        <Eraser className="w-5 h-5" />
      </button>
      
      {/* Sliders */}
      <div className="w-6 h-36 py-2 flex justify-center" title="Brush Size">
        <Slider 
          orientation="vertical"
          value={[brushSettings.size]}
          onValueChange={([val]) => setBrushSettings({...brushSettings, size: val})}
          min={2}
          max={150}
          step={1}
          className="h-full"
        />
      </div>
      
      <div className="w-6 h-28 py-2 flex justify-center" title="Brush Opacity">
        <Slider 
          orientation="vertical"
          value={[brushSettings.opacity]}
          onValueChange={([val]) => setBrushSettings({...brushSettings, opacity: val})}
          min={0.01}
          max={1}
          step={0.01}
          className="h-full"
        />
      </div>

      <div className="w-full h-px bg-white/10 my-1"/>

      <button 
        onClick={() => layerControls?.undo?.()}
        className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-xl transition-colors"
        title="Undo"
      >
        <Undo2 className="w-5 h-5" />
      </button>
      <button 
        onClick={() => layerControls?.redo?.()}
        className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-xl transition-colors"
        title="Redo"
      >
        <Redo2 className="w-5 h-5" />
      </button>

    </div>
  );
};
