import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Label } from '@/components/ui/label';

interface ColorPickerProps {
  color: string;
  onColorChange: (color: string) => void;
}

// Helper functions for color conversion
function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;

  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, v };
}

function hsvToRgb(h: number, s: number, v: number) {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  color,
  onColorChange,
}) => {
  const [hsv, setHsv] = useState(() => {
    const rgb = hexToRgb(color);
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  });

  const svRef = useRef<HTMLDivElement>(null);
  const isDraggingSV = useRef(false);

  // Update HSV when external color prop changes (e.g. from preset)
  useEffect(() => {
    const rgb = hexToRgb(color);
    const newHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    // Only update if it's significantly different to avoid feedback loops
    const currentHex = rgbToHex(...Object.values(hsvToRgb(hsv.h, hsv.s, hsv.v)) as [number, number, number]);
    if (color.toLowerCase() !== currentHex.toLowerCase()) {
      setHsv(newHsv);
    }
  }, [color]);

  const updateColor = useCallback((newHsv: { h: number; s: number; v: number }) => {
    setHsv(newHsv);
    const rgb = hsvToRgb(newHsv.h, newHsv.s, newHsv.v);
    onColorChange(rgbToHex(rgb.r, rgb.g, rgb.b));
  }, [onColorChange]);

  const handleSVMouse = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!svRef.current) return;
    const rect = svRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    updateColor({ ...hsv, s: x, v: y });
  }, [hsv, updateColor]);

  const handleHueMouse = useCallback((e: MouseEvent | React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    updateColor({ ...hsv, h: x });
  }, [hsv, updateColor]);

  useEffect(() => {
    const handleMouseUp = () => {
      isDraggingSV.current = false;
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSV.current) handleSVMouse(e);
    };
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [handleSVMouse]);

  // Pure CSS background for the Hue slider
  const hueBackground = 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';
  
  // Base color for the SV square (full saturation/value for current hue)
  const baseRgb = hsvToRgb(hsv.h, 1, 1);
  const baseHex = rgbToHex(baseRgb.r, baseRgb.g, baseRgb.b);

  return (
    <div className="space-y-4 p-4 bg-[#09090b] rounded-xl border border-white/5 shadow-2xl w-64 select-none">
      <div className="flex justify-between items-center mb-1">
        <Label className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">Color Picker</Label>
        <span className="text-zinc-500 font-mono text-[10px] uppercase">{color}</span>
      </div>

      {/* Saturation & Value Square */}
      <div 
        ref={svRef}
        className="relative w-full aspect-square rounded-lg overflow-hidden cursor-crosshair border border-white/10"
        style={{ backgroundColor: baseHex }}
        onMouseDown={(e) => {
          isDraggingSV.current = true;
          handleSVMouse(e);
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        
        {/* Cursor */}
        <div 
          className="absolute w-4 h-4 -ml-2 -mb-2 border-2 border-white rounded-full shadow-lg pointer-events-none"
          style={{ 
            left: `${hsv.s * 100}%`, 
            bottom: `${hsv.v * 100}%`,
            backgroundColor: color 
          }}
        />
      </div>

      {/* Hue Slider */}
      <div className="space-y-2">
        <div 
          className="relative h-4 w-full rounded-full cursor-pointer border border-white/10 shadow-inner"
          style={{ background: hueBackground }}
          onMouseDown={(e) => {
             handleHueMouse(e);
             const moveHandler = (me: MouseEvent) => handleHueMouse(me);
             const upHandler = () => {
               window.removeEventListener('mousemove', moveHandler);
               window.removeEventListener('mouseup', upHandler);
             };
             window.addEventListener('mousemove', moveHandler);
             window.addEventListener('mouseup', upHandler);
          }}
        >
          {/* Hue Handle */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 bg-white rounded-full shadow-md border border-zinc-300 pointer-events-none"
            style={{ left: `${hsv.h * 100}%` }}
          />
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <div className="w-10 h-10 rounded-lg border border-white/10 shadow-inner" style={{ backgroundColor: color }} />
        <div className="flex-1 grid grid-cols-3 gap-1">
          <div className="bg-zinc-900/50 rounded p-1.5 text-center">
            <div className="text-[8px] text-zinc-600 uppercase">H</div>
            <div className="text-[10px] text-zinc-300 font-mono">{Math.round(hsv.h * 360)}°</div>
          </div>
          <div className="bg-zinc-900/50 rounded p-1.5 text-center">
            <div className="text-[8px] text-zinc-600 uppercase">S</div>
            <div className="text-[10px] text-zinc-300 font-mono">{Math.round(hsv.s * 100)}%</div>
          </div>
          <div className="bg-zinc-900/50 rounded p-1.5 text-center">
            <div className="text-[8px] text-zinc-600 uppercase">V</div>
            <div className="text-[10px] text-zinc-300 font-mono">{Math.round(hsv.v * 100)}%</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-2 mt-2">
        {['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00'].map(p => (
           <button 
             key={p} 
             className="w-full aspect-square rounded-md border border-white/5 hover:scale-110 transition-transform"
             style={{ backgroundColor: p }}
             onClick={() => onColorChange(p)}
           />
        ))}
      </div>
    </div>
  );
};
