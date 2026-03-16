import { useState, useEffect } from 'react';
import * as THREE from 'three';
import { Box, Boxes, Image as ImageIcon, Save, Columns2, Home, PaintBucket, Sun, Sparkles, Layers, Eclipse, Brush } from 'lucide-react';
import logoImg from '@/logo/logo.png';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MeshSelector } from '@/components/ui-custom/MeshSelector';
import { TransformPanel } from '@/components/ui-custom/TransformPanel';
import { TexturePreview } from '@/components/ui-custom/TexturePreview';
import { BrushLibrary } from '@/components/ui-custom/BrushLibrary';
import { BrushStudio } from '@/components/ui-custom/BrushStudio';
import { BrushControls } from '@/components/ui-custom/BrushControls';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EnvironmentPanel } from '@/components/ui-custom/EnvironmentPanel';
import { SlidersHorizontal } from 'lucide-react';
import { MaterialPanel } from '@/components/ui-custom/MaterialPanel';
import { EssentialsPanel } from '@/components/ui-custom/EssentialsPanel';
import { LayersPanel } from '@/components/ui-custom/LayersPanel';
import { ColorPicker } from '@/components/ui-custom/ColorPicker';
import type { BrushSettings } from '@/hooks/useWebGLPaint';

export interface TopHeaderProps {
  setIsDashboard: (v: boolean) => void;
  modelName: string;
  setModelName: (v: string) => void;
  handleObjUpload: (file: File) => void;
  showWireframe: boolean;
  setShowWireframe: (v: boolean) => void;
  flatShading: boolean;
  setFlatShading: (v: boolean) => void;
  modelParts: any[];
  handleTogglePartVisibility: (id: string) => void;
  
  modelTransform: any;
  handleUpdateTransform: (transformType: 'position' | 'rotation' | 'scale', axis: 0 | 1 | 2 | 'all', value: number) => void;
  
  currentTexture: any;
  previewCanvas: any;
  handleExport: () => void;
  handleClear: () => void;
  handleImport: (file: File) => void;
  textureResolution: number;
  setTextureResolution: (v: number) => void;
  
  handleSaveProject: () => void;
  showUVPanel: boolean;
  setShowUVPanel: (v: boolean) => void;
  handleFill: () => void;

  brushSettings: BrushSettings;
  setBrushSettings: (v: any) => void;
  
  matcapName: string | null;
  setMatcapName: (v: string | null) => void;
  lastMatcap: string;
  lightSetup: any;
  setLightSetup: (v: any) => void;
  lightIntensity: number;
  setLightIntensity: (v: number) => void;
  showGrid: boolean;
  setShowGrid: (v: boolean) => void;
  focalLength: number;
  setFocalLength: (v: number) => void;
  envIntensity: number;
  setEnvIntensity: (v: number) => void;

  objectColor: string;
  setObjectColor: (v: string) => void;
  colorHistory: string[];
  layerControls: any;
  saoEnabled: boolean;
  onSaoEnabledChange: (v: boolean) => void;
  saoIntensity: number;
  onSaoIntensityChange: (v: number) => void;
  saoScale: number;
  onSaoScaleChange: (v: number) => void;
  bumpScale: number;
  onBumpScaleChange: (v: number) => void;
  pbrMode: boolean;
  onPbrModeChange: (v: boolean) => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  setIsDashboard, modelName, setModelName, handleObjUpload,
  showWireframe, setShowWireframe, flatShading, setFlatShading, modelParts, handleTogglePartVisibility,
  modelTransform, handleUpdateTransform,
  currentTexture, previewCanvas, handleExport, handleClear, handleImport, textureResolution, setTextureResolution,
  handleSaveProject, showUVPanel, setShowUVPanel, handleFill,
  brushSettings, setBrushSettings,
  matcapName, setMatcapName, lastMatcap, lightSetup, setLightSetup, lightIntensity, setLightIntensity,
  showGrid, setShowGrid, focalLength, setFocalLength, envIntensity, setEnvIntensity,
  objectColor, setObjectColor,
  colorHistory, layerControls,
  saoEnabled, onSaoEnabledChange, saoIntensity, onSaoIntensityChange, saoScale, onSaoScaleChange,
  bumpScale, onBumpScaleChange,
  pbrMode, onPbrModeChange
}) => {
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [customBrushes, setCustomBrushes] = useState<BrushSettings[]>(() => {
    const saved = localStorage.getItem('custom_brushes_v2');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('custom_brushes_v2', JSON.stringify(customBrushes));
  }, [customBrushes]);

  const handleSaveAsNewBrush = (name: string) => {
    const newBrush = { ...brushSettings, name, id: THREE.MathUtils.generateUUID() };
    setCustomBrushes(prev => [...prev, newBrush]);
    setBrushSettings(newBrush);
    setIsStudioOpen(false);
  };

  const handleDuplicateBrush = (brush: BrushSettings) => {
    const newBrush = { ...brush, id: THREE.MathUtils.generateUUID(), name: `${brush.name} Copy` };
    setCustomBrushes((prev: BrushSettings[]) => [...prev, newBrush]);
  };

  const handleRenameBrush = (brushId: string, newName: string) => {
    setCustomBrushes((prev: BrushSettings[]) => prev.map(b => b.id === brushId ? { ...b, name: newName } : b));
    if (brushSettings.id === brushId) {
      setBrushSettings((prev: BrushSettings) => ({ ...prev, name: newName }));
    }
  };

  const handleRemoveBrush = (brushId: string) => {
    setCustomBrushes((prev: BrushSettings[]) => prev.filter(b => b.id !== brushId));
  };
  return (
    <header className="bg-[#121214] border-b border-white/5 px-2 md:px-4 py-2 md:py-3 flex items-center justify-between z-10 shadow-md">
      {/* LEFT SIDE */}
      <div className="flex items-center gap-1.5 md:gap-4">
        <button 
          onClick={() => setIsDashboard(true)}
          className="p-1.5 md:p-2 rounded-lg hover:bg-white/10 transition-colors cursor-pointer text-zinc-400 hover:text-white"
          title="Voltar ao Dashboard"
        >
          <Home className="w-4 h-4 md:w-5 h-5" />
        </button>
        
        <div className="flex items-center gap-1.5 md:gap-3 pr-2 md:pr-4 border-r border-white/10">
          <div className="bg-white/5 p-1 rounded-lg border border-white/10 w-7 h-7 md:w-9 h-9 flex items-center justify-center overflow-hidden">
            <img src={logoImg} alt="Logo" className="w-full h-full object-contain" />
          </div>
          <div className="hidden md:flex items-baseline gap-1.5 md:gap-2">
            <h1 className="text-[10px] md:text-xs font-semibold text-zinc-100 tracking-wide uppercase">Webflow</h1>
            <span className="text-[8px] md:text-[10px] text-zinc-500 font-medium whitespace-nowrap">v1.7.0</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-1.5 md:p-2 rounded-md flex items-center justify-center cursor-pointer">
              <Box className="w-4 h-4 md:w-5 h-5" />
            </PopoverTrigger>
            <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5 mt-2" align="start">
              <MeshSelector 
                modelName={modelName}
                onNameChange={setModelName}
                onObjUpload={handleObjUpload}
                showWireframe={showWireframe}
                setShowWireframe={setShowWireframe}
                flatShading={flatShading}
                setFlatShading={setFlatShading}
                modelParts={modelParts}
                onTogglePartVisibility={handleTogglePartVisibility}
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-1.5 md:p-2 rounded-md flex items-center justify-center cursor-pointer">
              <Boxes className="w-4 h-4 md:w-5 h-5" />
            </PopoverTrigger>
            <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5 mt-2" align="start">
              <TransformPanel 
                modelTransform={modelTransform}
                onUpdateTransform={handleUpdateTransform}
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-1.5 md:p-2 rounded-md flex items-center justify-center cursor-pointer">
              <ImageIcon className="w-4 h-4 md:w-5 h-5" />
            </PopoverTrigger>
            <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5 mt-2" align="start">
              <TexturePreview 
              texture={currentTexture}
              previewCanvas={previewCanvas}
              onExport={handleExport}
              onClear={handleClear}
              onImport={handleImport}
              resolution={textureResolution}
              onResolutionChange={setTextureResolution}
            />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      
      {/* RIGHT SIDE */}
      <div className="flex items-center gap-0.5 md:gap-1">
        <button
          onClick={handleSaveProject}
          className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10 transition-colors p-1.5 md:p-2 rounded-md cursor-pointer mr-0.5 md:mr-2 flex items-center justify-center"
          title="Savar Projeto (Ctrl+S)"
        >
          <Save className="w-4 h-4 md:w-5 h-5" />
        </button>
        
        <button
          onClick={() => setShowUVPanel(!showUVPanel)}
          className={`transition-colors p-1.5 md:p-2 rounded-md flex items-center justify-center cursor-pointer ${showUVPanel ? 'text-zinc-100 bg-white/10' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'}`}
          title="Toggle UV View"
        >
          <Columns2 className="w-4 h-4 md:w-5 h-5" />
        </button>
        
        <button
          onClick={handleFill}
          className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-1.5 md:p-2 rounded-md cursor-pointer"
          title="Fill Layer (Paint Bucket)"
        >
          <PaintBucket className="w-4 h-4 md:w-5 h-5" />
        </button>

        <div className="w-px h-5 md:h-6 bg-white/10 mx-0.5 md:mx-1" />

        <Popover>
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-1.5 md:p-2 rounded-md cursor-pointer flex items-center gap-1 md:gap-2 border border-white/5 bg-zinc-900/50">
            <Brush className="w-4 h-4" />
            <span className="text-[10px] hidden lg:inline font-bold text-zinc-300 uppercase tracking-tight max-w-[80px] truncate">{brushSettings.name}</span>
          </PopoverTrigger>
          <PopoverContent className="w-[450px] p-0 bg-transparent border-none mt-2 shadow-2xl overflow-hidden" align="end">
            <BrushLibrary 
              brushSettings={brushSettings} 
              onBrushSettingsChange={setBrushSettings} 
              onOpenStudio={() => setIsStudioOpen(true)}
              customPresets={customBrushes}
              onDuplicateBrush={handleDuplicateBrush}
              onRenameBrush={handleRenameBrush}
              onRemoveBrush={handleRemoveBrush}
            />
          </PopoverContent>
        </Popover>

        {/* Quick Settings */}
        <Popover>
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-1.5 md:p-2 rounded-md cursor-pointer border border-white/5 bg-zinc-900/50">
            <SlidersHorizontal className="w-4 h-4" />
          </PopoverTrigger>
          <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5 mt-2 shadow-2xl">
             <BrushControls brushSettings={brushSettings} onBrushSettingsChange={setBrushSettings} />
          </PopoverContent>
        </Popover>

        {/* Brush Studio Modal */}
        <Dialog open={isStudioOpen} onOpenChange={setIsStudioOpen}>
          <DialogContent className="max-w-fit p-0 bg-transparent border-none shadow-none" showCloseButton={false}>
            <BrushStudio 
               brushSettings={brushSettings}
               onBrushSettingsChange={setBrushSettings}
               onSaveAsNew={handleSaveAsNewBrush}
               onClose={() => setIsStudioOpen(false)}
            />
          </DialogContent>
        </Dialog>

        <Popover>
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-1.5 md:p-2 rounded-md">
            <Sun className="w-4 h-4 md:w-5 h-5" />
          </PopoverTrigger>
          <PopoverContent className="w-96 bg-[#121214] border-white/10 p-5 mt-2 shadow-2xl">
            <EnvironmentPanel
              matcapName={matcapName}
              onMatcapChange={setMatcapName}
              lastMatcap={lastMatcap}
              lightSetup={lightSetup}
              onLightSetupChange={setLightSetup}
              lightIntensity={lightIntensity}
              onLightIntensityChange={setLightIntensity}
              showGrid={showGrid}
              setShowGrid={setShowGrid}
              focalLength={focalLength}
              onFocalLengthChange={setFocalLength}
              envIntensity={envIntensity}
              onEnvIntensityChange={setEnvIntensity}
            />
        </PopoverContent>
      </Popover>

        <Popover>
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-1.5 md:p-2 rounded-md">
            <Eclipse className="w-4 h-4 md:w-5 h-5" />
          </PopoverTrigger>
          <PopoverContent className="w-96 bg-[#121214] border-white/10 p-5 mt-2 shadow-2xl">
            <MaterialPanel
              color={objectColor}
              onColorChange={setObjectColor}
              colorHistory={colorHistory}
              saoEnabled={saoEnabled}
              onSaoEnabledChange={onSaoEnabledChange}
              saoIntensity={saoIntensity}
              onSaoIntensityChange={onSaoIntensityChange}
              saoScale={saoScale}
              onSaoScaleChange={onSaoScaleChange}
              flatShading={flatShading}
              onFlatShadingChange={setFlatShading}
              pbrMode={pbrMode}
              onPbrModeChange={onPbrModeChange}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-1.5 md:p-2 rounded-md">
            <Sparkles className="w-4 h-4 md:w-5 h-5" />
          </PopoverTrigger>
          <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5 mt-2 shadow-2xl">
            <EssentialsPanel 
              brushSettings={brushSettings}
              onBrushSettingsChange={setBrushSettings}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-1.5 md:p-2 rounded-md">
            <Layers className="w-4 h-4 md:w-5 h-5" />
          </PopoverTrigger>
          <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5 mt-2">
            <LayersPanel 
              layerControls={layerControls} 
              pbrMode={pbrMode}
              bumpScale={bumpScale}
              onBumpScaleChange={onBumpScaleChange}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger className="p-1 md:p-1.5 focus:outline-none hover:scale-105 transition-transform">
            <div 
              className="w-6 h-6 md:w-7 h-7 rounded-full border-2 border-white/20 shadow-sm" 
              style={{ backgroundColor: brushSettings.color }} 
            />
          </PopoverTrigger>
          <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5 mt-2" align="end">
            <ColorPicker 
              color={brushSettings.color} 
              onColorChange={(color) => setBrushSettings({ ...brushSettings, color })} 
              recentColors={colorHistory}
            />
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
};
