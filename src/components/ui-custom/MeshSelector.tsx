import React from 'react';
import { Button } from '@/components/ui/button';
import { Box, PencilLine } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface MeshSelectorProps {
  modelName: string;
  onNameChange: (name: string) => void;
  onObjUpload?: (file: File) => void;
  showWireframe?: boolean;
  setShowWireframe?: (show: boolean) => void;
  flatShading?: boolean;
  setFlatShading?: (flat: boolean) => void;
  modelParts?: any[];
  onTogglePartVisibility?: (id: string) => void;
}

export const MeshSelector: React.FC<MeshSelectorProps> = ({
  modelName,
  onNameChange,
  onObjUpload,
  showWireframe = false,
  setShowWireframe,
  flatShading = false,
  setFlatShading,
  modelParts = [],
  onTogglePartVisibility,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onObjUpload) {
      onObjUpload(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 p-5 bg-[#09090b] rounded-xl border border-white/5 shadow-lg">
      <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase">MODEL</h3>
      
      <div className="relative">
        <Input 
          type="text"
          value={modelName}
          onChange={(e) => onNameChange(e.target.value)}
          className="bg-zinc-900 border-white/10 text-zinc-100 text-sm font-semibold pr-10 focus-visible:ring-1 focus-visible:ring-zinc-600 rounded-lg"
        />
        <PencilLine className="w-4 h-4 text-zinc-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      
      {setShowWireframe && setFlatShading && (
        <div className="flex items-center gap-4 pt-4 border-t border-white/10">
          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              id="wireframe-toggle"
              checked={showWireframe} 
              onChange={(e) => setShowWireframe(e.target.checked)} 
              className="accent-zinc-500 w-3.5 h-3.5"
            />
            <label htmlFor="wireframe-toggle" className="text-zinc-400 text-xs flex items-center gap-1 cursor-pointer hover:text-zinc-200 transition-colors">
              <Box className="w-3.5 h-3.5" />
              Wire
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              id="flatshading-toggle"
              checked={flatShading} 
              onChange={(e) => setFlatShading(e.target.checked)} 
              className="accent-zinc-500 w-3.5 h-3.5"
            />
            <label htmlFor="flatshading-toggle" className="text-zinc-400 text-xs flex items-center gap-1 cursor-pointer hover:text-zinc-200 transition-colors">
              <Box className="w-3.5 h-3.5" />
              Flat
            </label>
          </div>
        </div>
      )}

      {modelParts.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-white/10">
          <h4 className="text-zinc-400 text-xs tracking-wide">MODEL PARTS</h4>
          <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
            {modelParts.map((part) => (
              <div 
                key={part.id} 
                className="p-2 rounded-lg border flex flex-col gap-2 transition-colors bg-zinc-900 border-white/10 hover:border-white/20"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-zinc-300 truncate w-32" title={part.name}>{part.name}</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={part.visible}
                    onChange={() => onTogglePartVisibility?.(part.id)}
                    className="accent-zinc-500 w-3.5 h-3.5"
                    title="Toggle Visibility"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-6 border bg-zinc-800 border-zinc-500 text-zinc-100 shadow-md hover:bg-zinc-700"
        >
          <Box className="w-4 h-4" />
          <span className="text-xs font-medium tracking-wide">UPLOAD NEW MODEL</span>
        </Button>
        <input
          type="file"
          accept=".obj,.glb,.gltf,.fbx,.usdz"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
};
