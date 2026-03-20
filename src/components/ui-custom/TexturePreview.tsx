import React, { useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface TexturePreviewProps {
  previewCanvas: HTMLCanvasElement | null;
  onClear: () => void;
  resolution: number;
  onResolutionChange: (res: number) => void;
}

export const TexturePreview: React.FC<TexturePreviewProps> = ({
  previewCanvas,
  onClear,
  resolution,
  onResolutionChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && previewCanvas) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Clear canvas
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw texture preview from the provided preview canvas
        const scale = Math.min(
          canvas.width / previewCanvas.width,
          canvas.height / previewCanvas.height
        );
        const x = (canvas.width - previewCanvas.width * scale) / 2;
        const y = (canvas.height - previewCanvas.height * scale) / 2;
        
        ctx.drawImage(previewCanvas, x, y, previewCanvas.width * scale, previewCanvas.height * scale);
      }
    }
  }, [previewCanvas]);

  return (
    <div className="space-y-6 p-5 bg-[#09090b] rounded-xl border border-white/5 shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase">Texture</h3>
        <select 
          className="bg-transparent border border-white/10 focus:ring-1 focus:ring-zinc-600 rounded text-[10px] text-zinc-400 uppercase font-mono px-2 py-1"
          value={resolution.toString()}
          onChange={(e) => onResolutionChange(parseInt(e.target.value, 10))}
        >
          <option value="512">512x512</option>
          <option value="1024">1024x1024</option>
          <option value="2048">2048x2048</option>
          <option value="4096">4096x4096</option>
        </select>
      </div>
      
      {/* Preview Canvas */}
      <div className="aspect-square w-full rounded-lg border border-white/5 bg-zinc-950/50 overflow-hidden relative group">
        <canvas 
          ref={canvasRef}
          width={512}
          height={512}
          className="w-full h-full object-contain"
        />
        {!previewCanvas && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-[10px] uppercase tracking-widest font-mono">
            No Texture
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
          className="bg-transparent hover:bg-red-950/50 hover:text-red-300 text-zinc-300 border-white/10 hover:border-red-900/50 text-[10px] uppercase tracking-wider py-5 flex-1"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1 text-red-500/70" />
          Clean
        </Button>
      </div>
    </div>
  );
};
