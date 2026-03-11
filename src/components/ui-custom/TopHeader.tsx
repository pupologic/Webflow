import { Brush, Box, Boxes, Image as ImageIcon, Save, Columns2, Home, PaintBucket, Sun, Sparkles, Layers, Eclipse } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MeshSelector } from '@/components/ui-custom/MeshSelector';
import { TransformPanel } from '@/components/ui-custom/TransformPanel';
import { TexturePreview } from '@/components/ui-custom/TexturePreview';
import { BrushControls } from '@/components/ui-custom/BrushControls';
import { EnvironmentPanel } from '@/components/ui-custom/EnvironmentPanel';
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
  roughness: number;
  setRoughness: (v: number) => void;
  metalness: number;
  setMetalness: (v: number) => void;
  colorHistory: string[];
  layerControls: any;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  setIsDashboard, modelName, setModelName, handleObjUpload,
  showWireframe, setShowWireframe, flatShading, setFlatShading, modelParts, handleTogglePartVisibility,
  modelTransform, handleUpdateTransform,
  currentTexture, previewCanvas, handleExport, handleClear, handleImport, textureResolution, setTextureResolution,
  handleSaveProject, showUVPanel, setShowUVPanel, handleFill,
  brushSettings, setBrushSettings,
  matcapName, setMatcapName, lightSetup, setLightSetup, lightIntensity, setLightIntensity,
  showGrid, setShowGrid, focalLength, setFocalLength, envIntensity, setEnvIntensity,
  objectColor, setObjectColor, roughness, setRoughness, metalness, setMetalness,
  colorHistory, layerControls
}) => {
  return (
    <header className="bg-[#121214] border-b border-white/5 px-4 py-3 flex items-center justify-between z-10 shadow-md">
      {/* LEFT SIDE */}
      <div className="flex items-center gap-4">
        <button 
          onClick={() => setIsDashboard(true)}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors cursor-pointer text-zinc-400 hover:text-white"
          title="Voltar ao Dashboard"
        >
          <Home className="w-5 h-5" />
        </button>
        
        <div className="flex items-center gap-3 pr-4 border-r border-white/10">
          <div className="bg-white/5 p-2 rounded-lg border border-white/10">
            <Brush className="w-4 h-4 text-zinc-300" />
          </div>
          <div className="hidden sm:flex items-baseline gap-2">
            <h1 className="text-xs font-semibold text-zinc-100 tracking-wide">3D PAINTER</h1>
            <span className="text-[10px] text-zinc-500 font-medium">v1.4.1</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-2 rounded-md flex items-center justify-center cursor-pointer">
              <Box className="w-5 h-5" />
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
            <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-2 rounded-md flex items-center justify-center cursor-pointer">
              <Boxes className="w-5 h-5" />
            </PopoverTrigger>
            <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5 mt-2" align="start">
              <TransformPanel 
                modelTransform={modelTransform}
                onUpdateTransform={handleUpdateTransform}
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-2 rounded-md flex items-center justify-center cursor-pointer">
              <ImageIcon className="w-5 h-5" />
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
      <div className="flex items-center gap-1">
        <button
          onClick={handleSaveProject}
          className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10 transition-colors p-2 rounded-md cursor-pointer mr-2 flex items-center justify-center"
          title="Savar Projeto (Ctrl+S)"
        >
          <Save className="w-5 h-5" />
        </button>
        
        <button
          onClick={() => setShowUVPanel(!showUVPanel)}
          className={`transition-colors p-2 rounded-md flex items-center justify-center cursor-pointer ${showUVPanel ? 'text-zinc-100 bg-white/10' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'}`}
          title="Toggle UV View"
        >
          <Columns2 className="w-5 h-5" />
        </button>
        
        <button
          onClick={handleFill}
          className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-2 rounded-md cursor-pointer"
          title="Fill Layer (Paint Bucket)"
        >
          <PaintBucket className="w-5 h-5" />
        </button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <Popover>
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-2 rounded-md cursor-pointer">
            <Brush className="w-5 h-5" />
          </PopoverTrigger>
          <PopoverContent className="w-96 bg-[#121214] border-white/10 p-5 mt-2 shadow-2xl">
            <BrushControls brushSettings={brushSettings} onBrushSettingsChange={setBrushSettings} />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-2 rounded-md">
            <Sun className="w-5 h-5" />
          </PopoverTrigger>
          <PopoverContent className="w-96 bg-[#121214] border-white/10 p-5 mt-2 shadow-2xl">
            <EnvironmentPanel
              matcapName={matcapName}
              onMatcapChange={setMatcapName}
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
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-2 rounded-md">
            <Eclipse className="w-5 h-5" />
          </PopoverTrigger>
          <PopoverContent className="w-96 bg-[#121214] border-white/10 p-5 mt-2 shadow-2xl">
            <MaterialPanel
              color={objectColor}
              onColorChange={setObjectColor}
              roughness={roughness}
              onRoughnessChange={setRoughness}
              metalness={metalness}
              onMetalnessChange={setMetalness}
              colorHistory={colorHistory}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-2 rounded-md">
            <Sparkles className="w-5 h-5" />
          </PopoverTrigger>
          <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5 mt-2 shadow-2xl">
            <EssentialsPanel 
              brushSettings={brushSettings}
              onBrushSettingsChange={setBrushSettings}
            />
          </PopoverContent>
        </Popover>



        <Popover>
          <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-2 rounded-md">
            <Layers className="w-5 h-5" />
          </PopoverTrigger>
          <PopoverContent className="w-80 bg-[#121214] border-white/10 p-5 mt-2">
            <LayersPanel layerControls={layerControls} />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger className="p-1.5 focus:outline-none hover:scale-105 transition-transform">
            <div 
              className="w-7 h-7 rounded-full border-2 border-white/20 shadow-sm" 
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
