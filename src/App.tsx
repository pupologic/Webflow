import { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Scene3D } from '@/components/3d/Scene3D';
import { BrushControls } from '@/components/ui-custom/BrushControls';
import { ColorPicker } from '@/components/ui-custom/ColorPicker';
import { TexturePreview } from '@/components/ui-custom/TexturePreview';
import { MeshSelector } from '@/components/ui-custom/MeshSelector';
import { LayersPanel } from '@/components/ui-custom/LayersPanel';
import { EnvironmentPanel } from '@/components/ui-custom/EnvironmentPanel';
import { MaterialPanel } from '@/components/ui-custom/MaterialPanel';
import type { BrushSettings } from '@/hooks/use3DPaint';
import { Brush, Box, Layers, Image as ImageIcon, Sun, Eraser, Undo2, Redo2, Columns2, Boxes, PaintBucket } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Toaster, toast } from 'sonner';
import { UVOverlayPanel } from '@/components/ui-custom/UVOverlayPanel';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import suzanneObjStr from '@/models/Suzanne.obj?raw';
import './App.css';

function App() {
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    size: 20,
    color: '#ff0000',
    opacity: 1,
    spacing: 0.25,
    type: 'circle',
    mode: 'paint',
  });

  const [modelName, setModelName] = useState<string>('Suzanne');
  const [showUVPanel, setShowUVPanel] = useState<boolean>(false);
  const [uvPanelWidth, setUvPanelWidth] = useState<number>(50); // percent
  const isDraggingDividerRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [customGeometry, setCustomGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [flatShading, setFlatShading] = useState(false);
  const [textureResolution, setTextureResolution] = useState<number>(2048);
  const [currentTexture, setCurrentTexture] = useState<THREE.CanvasTexture | null>(null);
  const [layerControls, setLayerControls] = useState<any>(null);
  
  // Environment controls
  const [matcapName, setMatcapName] = useState<string | null>(null);
  const [lightSetup, setLightSetup] = useState<'3point' | 'directional' | 'ambient'>('3point');
  const [lightIntensity, setLightIntensity] = useState(1);
  const [focalLength, setFocalLength] = useState(35);
  const [envIntensity, setEnvIntensity] = useState(1);
  const [envRotation, setEnvRotation] = useState(0);

  // Material / Shader controls
  const [objectColor, setObjectColor] = useState('#e5e5e5');
  const [roughness, setRoughness] = useState(0.8);
  const [metalness, setMetalness] = useState(0.1);

  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    try {
      const loader = new OBJLoader();
      const object = loader.parse(suzanneObjStr);
      let geometry: THREE.BufferGeometry | null = null;
      
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (!geometry) {
            geometry = child.geometry;
          }
        }
      });

      if (geometry) {
        const geom = geometry as THREE.BufferGeometry;

        // Only merge + recompute normals if the OBJ has NO normals attribute.
        // Blender exports correct smooth normals — mergeVertices() and
        // computeVertexNormals() would destroy them, causing shading artifacts.
        if (!geom.attributes.normal) {
          let mergedGeometry = geom;
          try {
            mergedGeometry = mergeVertices(geom);
          } catch (e) {
            console.warn('Failed to merge vertices', e);
          }
          mergedGeometry.computeVertexNormals();
          setCustomGeometry(mergedGeometry);
        } else {
          // OBJ already has normals (Blender Shade Smooth) — use as-is
          setCustomGeometry(geom);
        }
      }
    } catch (err) {
      console.error('Failed to parse Suzanne.obj', err);
    }
  }, []);

  const handleTextureChange = useCallback((texture: THREE.CanvasTexture | null) => {
    setCurrentTexture(texture);
    textureRef.current = texture;
  }, []);

  const handleExport = useCallback(() => {
    if (textureRef.current && textureRef.current.image) {
      const canvas = textureRef.current.image as HTMLCanvasElement;
      const link = document.createElement('a');
      link.download = 'texture-paint.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      } else {
      toast.error('Nenhuma textura para exportar');
    }
  }, []);

  const handleImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        if (textureRef.current && textureRef.current.image) {
          const canvas = textureRef.current.image as HTMLCanvasElement;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            textureRef.current.needsUpdate = true;
          }
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleClear = useCallback(() => {
    if (layerControls?.clearCanvas) {
      layerControls.clearCanvas();
    } else if (textureRef.current && textureRef.current.image) {
      const canvas = textureRef.current.image as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        textureRef.current.needsUpdate = true;
      }
    }
  }, [layerControls]);

  const handleFill = useCallback(() => {
    if (layerControls?.fillCanvas) {
      layerControls.fillCanvas();
    } else if (textureRef.current && textureRef.current.image) {
      const canvas = textureRef.current.image as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = brushSettings.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        textureRef.current.needsUpdate = true;
      }
    }
  }, [layerControls, brushSettings.color]);

  const handleObjUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const contents = e.target?.result as string;
      const loader = new OBJLoader();
      try {
        const object = loader.parse(contents);
        let geometry: THREE.BufferGeometry | null = null;
        
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (!geometry) {
              geometry = child.geometry;
            }
          }
        });

        if (geometry) {
          let mergedGeometry: THREE.BufferGeometry = geometry as THREE.BufferGeometry;
          try {
            mergedGeometry = mergeVertices(geometry as THREE.BufferGeometry);
          } catch (e) {
            console.warn('Failed to merge vertices', e);
          }
          mergedGeometry.computeVertexNormals();
          setCustomGeometry(mergedGeometry);
          setModelName(file.name.replace(/\.obj$/i, ''));
          toast.success('Modelo OBJ carregado com sucesso!');
        } else {
          toast.error('O arquivo OBJ não contém geometrias válidas.');
        }
      } catch (err) {
        console.error(err);
        toast.error('Erro ao processar o arquivo OBJ.');
      }
    };
    reader.readAsText(file);
  }, []);

  return (
    <div className="h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      <Toaster position="top-right" theme="dark" />
      
      <header className="bg-[#121214] border-b border-white/5 px-4 py-3 flex items-center justify-between z-10 shadow-md">
        {/* LEFT SIDE */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 pr-4 border-r border-white/10">
            <div className="bg-white/5 p-2 rounded-lg border border-white/10">
              <Brush className="w-4 h-4 text-zinc-300" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xs font-semibold text-zinc-100 tracking-wide">3D PAINTER</h1>
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
                  onClear={handleClear} 
                  onExport={handleExport} 
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
              envRotation={envRotation}
              onEnvRotationChange={setEnvRotation}
            />
          </PopoverContent>
        </Popover>

          <Popover>
            <PopoverTrigger className="text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors p-2 rounded-md">
              <Boxes className="w-5 h-5" />
            </PopoverTrigger>
            <PopoverContent className="w-96 bg-[#121214] border-white/10 p-5 mt-2 shadow-2xl">
              <MaterialPanel
                color={objectColor}
                onColorChange={setObjectColor}
                roughness={roughness}
                onRoughnessChange={setRoughness}
                metalness={metalness}
                onMetalnessChange={setMetalness}
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
              <ColorPicker color={brushSettings.color} onColorChange={(color) => setBrushSettings({ ...brushSettings, color })} />
            </PopoverContent>
          </Popover>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden bg-[#09090b]">

        <main className="flex-1 relative flex">
              {/* Vertical Shortcut Bar */}
          <div className="absolute top-1/2 -translate-y-1/2 left-4 bg-[#121214]/90 backdrop-blur-md rounded-2xl py-4 px-2.5 border border-white/10 shadow-3xl flex flex-col items-center gap-4 z-20">
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

          <div className="flex-1 w-full relative flex" ref={containerRef}>
            {/* 3D Scene panel */}
            <div
              className="relative h-full"
              style={{ width: showUVPanel ? `${100 - uvPanelWidth}%` : '100%', transition: showUVPanel ? 'none' : 'width 0.2s ease' }}
            >
              <Scene3D
                brushSettings={brushSettings}
                customGeometry={customGeometry}
                showGrid={showGrid}
                showWireframe={showWireframe}
                flatShading={flatShading}
                textureResolution={textureResolution}
                matcapName={matcapName}
                lightSetup={lightSetup}
                lightIntensity={lightIntensity}
                focalLength={focalLength}
                envIntensity={envIntensity}
                objectColor={objectColor}
                roughness={roughness}
                metalness={metalness}
                onTextureChange={handleTextureChange}
                onLayerControlsReady={setLayerControls}
              />
            </div>

            {/* Drag divider */}
            {showUVPanel && (
              <div
                className="w-1.5 h-full bg-white/5 hover:bg-white/20 cursor-col-resize flex items-center justify-center z-20 transition-colors"
                style={{ flexShrink: 0 }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  isDraggingDividerRef.current = true;
                  const container = containerRef.current;
                  if (!container) return;

                  const onMove = (ev: PointerEvent) => {
                    if (!isDraggingDividerRef.current) return;
                    const rect = container.getBoundingClientRect();
                    const rightPct = ((rect.right - ev.clientX) / rect.width) * 100;
                    setUvPanelWidth(Math.min(70, Math.max(20, rightPct)));
                  };

                  const onUp = () => {
                    isDraggingDividerRef.current = false;
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                  };

                  window.addEventListener('pointermove', onMove);
                  window.addEventListener('pointerup', onUp);
                }}
              >
                <div className="w-px h-8 rounded-full bg-white/30" />
              </div>
            )}

            {/* UV panel — always mounted, hidden via CSS to avoid rebuild cost on open */}
            <div
              className="relative h-full bg-[#09090b]"
              style={{
                width: `${uvPanelWidth}%`,
                flexShrink: 0,
                display: showUVPanel ? 'block' : 'none',
              }}
            >
              <UVOverlayPanel texture={currentTexture} geometry={customGeometry} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
