import { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Scene3D } from '@/components/3d/Scene3D';
import type { BrushSettings } from '@/hooks/useWebGLPaint';
import { OverlayManager } from '@/components/ui-custom/OverlayManager';
import type { OverlayData } from '@/components/ui-custom/OverlayManager';
import { Toaster, toast } from 'sonner';
import { UVOverlayPanel } from '@/components/ui-custom/UVOverlayPanel';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import suzanneObjStr from '@/models/Suzanne.obj?raw';
import { Dashboard } from '@/components/ui-custom/Dashboard';
import { ProjectManager } from '@/services/ProjectManager';
import type { SavedProject } from '@/services/ProjectManager';
import { TopHeader } from '@/components/ui-custom/TopHeader';
import { LeftShortcutBar } from '@/components/ui-custom/LeftShortcutBar';
import { LoadingOverlay } from '@/components/ui-custom/LoadingOverlay';
import './App.css';

export interface ModelPart {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  visible: boolean;
}

export interface PerformanceConfig {
  raycastThrottle: number; // 1 = every frame, 2 = every 2 frames, etc.
  dilationRadius: number; // 2 to 16
}

function App() {
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    size: 20,
    color: '#ff0000',
    opacity: 1,
    hardness: 0.8,
    type: 'circle',
    mode: 'paint',
    spacing: 0.25,
    symmetryMode: 'none',
    symmetryAxis: 'x',
    radialPoints: 4,
    lazyMouse: false,
    lazyRadius: 0.1,
    jitterSize: 0,
    jitterAngle: false,
    jitterOpacity: 0,
  });

  const [modelName, setModelName] = useState<string>('Suzanne');
  const [modelParts, setModelParts] = useState<ModelPart[]>([]);
  const [overlays, setOverlays] = useState<OverlayData[]>([]);

  // Project Management State
  const [isDashboard, setIsDashboard] = useState(true);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  const [modelTransform, setModelTransform] = useState({
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number]
  });

  // Shortcut Bar State
  const [isMaskEditing, setIsMaskEditing] = useState(false);
  const [primaryColor, setPrimaryColor] = useState('#ff0000');
  const [secondaryColor, setSecondaryColor] = useState('#1e40af');
  const [colorHistory, setColorHistory] = useState<string[]>(['#ff0000']);

  const handleColorPainted = useCallback((color: string) => {
    setColorHistory(prev => {
      const filtered = prev.filter(c => c.toLowerCase() !== color.toLowerCase());
      return [color, ...filtered].slice(0, 10);
    });
  }, []);

  const [showUVPanel, setShowUVPanel] = useState<boolean>(false);
  const [uvPanelWidth, setUvPanelWidth] = useState<number>(50); // percent
  const isDraggingDividerRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [flatShading, setFlatShading] = useState(false);
  const [textureResolution, setTextureResolution] = useState<number>(2048);
  const [currentTexture, setCurrentTexture] = useState<THREE.Texture | null>(null);
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [layerControls, setLayerControls] = useState<any>(null);
  const initialLayersToLoadRef = useRef<any[] | null>(null);
  
  // Environment controls
  const [matcapName, setMatcapName] = useState<string | null>('softlight_grey.png');
  const [lightSetup, setLightSetup] = useState<'3point' | 'directional' | 'ambient'>('3point');
  const [lightIntensity, setLightIntensity] = useState(1);
  const [focalLength, setFocalLength] = useState(35);
  const [envIntensity, setEnvIntensity] = useState(1);

  // Material / Shader controls
  const [objectColor, setObjectColor] = useState('#e5e5e5');
  const [roughness, setRoughness] = useState(0.8);
  const [metalness, setMetalness] = useState(0.1);

  const [performanceConfig, setPerformanceConfig] = useState<PerformanceConfig>({
    raycastThrottle: 1,
    dilationRadius: 16,
  });

  const handleAddOverlay = useCallback((type: 'reference' | 'stencil', file: File) => {
    const url = URL.createObjectURL(file);
    const newOverlay: OverlayData = {
      id: THREE.MathUtils.generateUUID(),
      type,
      imageUrl: url,
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      scale: 1,
      rotation: 0,
      opacity: type === 'stencil' ? 0.5 : 1.0,
      visible: true
    };
    setOverlays(prev => [...prev, newOverlay]);
  }, []);

  const handleUpdateOverlay = useCallback((id: string, updates: Partial<OverlayData>) => {
    setOverlays(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
  }, []);

  const handleRemoveOverlay = useCallback((id: string) => {
    setOverlays(prev => {
      const target = prev.find(o => o.id === id);
      if (target) {
        URL.revokeObjectURL(target.imageUrl);
      }
      return prev.filter(o => o.id !== id);
    });
  }, []);

  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    try {
      const loader = new OBJLoader();
      const object = loader.parse(suzanneObjStr);
      const parts: ModelPart[] = [];
      
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const geom = child.geometry as THREE.BufferGeometry;
          if (!geom.attributes.normal) {
            geom.computeVertexNormals();
          }
          parts.push({
            id: THREE.MathUtils.generateUUID(),
            name: child.name || `Part ${parts.length + 1}`,
            geometry: geom,
            visible: true,
          });
        }
      });

      if (parts.length > 0) {
        setModelParts(parts);
      }
    } catch (err) {
      console.error('Failed to parse Suzanne.obj', err);
    }
  }, []);

  const handleTextureChange = useCallback((texture: THREE.Texture | null, canvas?: HTMLCanvasElement) => {
    setCurrentTexture(texture);
    if (canvas) setPreviewCanvas(canvas);
  }, []);

  const handleExport = useCallback(async () => {
    if (layerControls?.exportTexture) {
      const dataUrl = layerControls.exportTexture('png');
      if (dataUrl) {
        const link = document.createElement('a');
        link.download = 'texture-paint.png';
        link.href = dataUrl;
        link.click();
      }
    } else {
      toast.error('Nenhuma textura para exportar');
    }
  }, [layerControls]);

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

  const handleTogglePartVisibility = useCallback((id: string) => {
    setModelParts((prev) => 
      prev.map(part => part.id === id ? { ...part, visible: !part.visible } : part)
    );
  }, []);

  const handleUpdateTransform = useCallback((transformType: 'position' | 'rotation' | 'scale', axis: 0 | 1 | 2 | 'all', value: number) => {
    setModelTransform(prev => {
      if (axis === 'all') {
        return { ...prev, [transformType]: [value, value, value] as [number, number, number] };
      }
      const newTransform = [...prev[transformType]] as [number, number, number];
      newTransform[axis] = value;
      return { ...prev, [transformType]: newTransform };
    });
  }, []);

  const handleLayerControlsReady = useCallback((controls: any) => {
    setLayerControls(controls);
    if (initialLayersToLoadRef.current) {
      if (controls.importProjectLayersData) {
        controls.importProjectLayersData(initialLayersToLoadRef.current);
      }
      initialLayersToLoadRef.current = null;
    }
  }, []);

  const handleObjUpload = useCallback((file: File) => {
    setIsLoading(true);
    setLoadingProgress(0);
    const reader = new FileReader();
    reader.onload = (e) => {
      const contents = e.target?.result as string;
      const loader = new OBJLoader();
      try {
        const object = loader.parse(contents);
        const parts: ModelPart[] = [];
        
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const geom = child.geometry as THREE.BufferGeometry;
            if (!geom.attributes.normal) {
              geom.computeVertexNormals();
            }
            parts.push({
              id: THREE.MathUtils.generateUUID(),
              name: child.name || `Part ${parts.length + 1}`,
              geometry: geom,
              visible: true,
            });
          }
        });

        if (parts.length > 0) {
          setModelParts(parts);
          setModelName(file.name.replace(/\.obj$/i, ''));
          handleClear(); // Automatically create a baseline texture
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
  }, [handleClear]);

  const handleSaveProject = async () => {
    if (!layerControls) return;
    try {
      const exportedLayers = layerControls.exportProjectLayersData ? await layerControls.exportProjectLayersData() : [];

      const project: SavedProject = {
        id: currentProjectId || THREE.MathUtils.generateUUID(),
        name: modelName,
        lastModified: Date.now(),
        modelName,
        brushSettings,
        layersData: exportedLayers
      };
      await ProjectManager.saveProject(project);
      setCurrentProjectId(project.id);
      toast.success('Projeto salvo com sucesso!');
    } catch (e: any) {
      console.error(e);
      toast.error(`Erro ao salvar: ${e.message || 'Erro desconhecido'}`);
    }
  };

  const handleNewProject = (type: 'Suzanne' | 'Cube', file?: File) => {
    setIsLoading(true);
    setLoadingProgress(0);
    if (file) {
      handleObjUpload(file);
    } else {
      setModelName(type);
    }
    setCurrentProjectId(null);
    setIsDashboard(false);
  };

  const handleLoadProject = (project: SavedProject) => {
    setIsLoading(true);
    setLoadingProgress(0);
    setModelName(project.modelName);
    setBrushSettings(project.brushSettings);
    setCurrentProjectId(project.id);
    initialLayersToLoadRef.current = project.layersData;
    setIsDashboard(false);
    toast.success('Projeto carregado!');
  };

  return (
    <div className="h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      <LoadingOverlay show={isLoading} progress={loadingProgress} />
      <Toaster position="top-right" theme="dark" />
      
      {isDashboard ? (
        <Dashboard onNewProject={handleNewProject} onLoadProject={handleLoadProject} />
      ) : (
        <>
          <TopHeader
        setIsDashboard={setIsDashboard}
        modelName={modelName}
        setModelName={setModelName}
        handleObjUpload={handleObjUpload}
        showWireframe={showWireframe}
        setShowWireframe={setShowWireframe}
        flatShading={flatShading}
        setFlatShading={setFlatShading}
        modelParts={modelParts}
        handleTogglePartVisibility={handleTogglePartVisibility}
        modelTransform={modelTransform}
        handleUpdateTransform={handleUpdateTransform}
        currentTexture={currentTexture}
        previewCanvas={previewCanvas}
        handleExport={handleExport}
        handleClear={handleClear}
        handleImport={handleImport}
        textureResolution={textureResolution}
        setTextureResolution={setTextureResolution}
        handleSaveProject={handleSaveProject}
        showUVPanel={showUVPanel}
        setShowUVPanel={setShowUVPanel}
        handleFill={handleFill}
        brushSettings={brushSettings}
        setBrushSettings={setBrushSettings}
        matcapName={matcapName}
        setMatcapName={setMatcapName}
        lightSetup={lightSetup}
        setLightSetup={setLightSetup}
        lightIntensity={lightIntensity}
        setLightIntensity={setLightIntensity}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        focalLength={focalLength}
        setFocalLength={setFocalLength}
        envIntensity={envIntensity}
        setEnvIntensity={setEnvIntensity}
        objectColor={objectColor}
        setObjectColor={setObjectColor}
        roughness={roughness}
        setRoughness={setRoughness}
        metalness={metalness}
        setMetalness={setMetalness}
        colorHistory={colorHistory}
        layerControls={layerControls}
        performanceConfig={performanceConfig}
        setPerformanceConfig={setPerformanceConfig}
      />

      <div className="flex-1 flex overflow-hidden bg-[#09090b]">

        <main className="flex-1 relative flex">
          {/* Vertical Shortcut Bar */}
          <LeftShortcutBar 
            brushSettings={brushSettings}
            setBrushSettings={setBrushSettings}
            layerControls={layerControls}
            isMaskEditing={isMaskEditing}
            setIsMaskEditing={setIsMaskEditing}
            primaryColor={primaryColor}
            setPrimaryColor={setPrimaryColor}
            secondaryColor={secondaryColor}
            setSecondaryColor={setSecondaryColor}
            colorHistory={colorHistory}
          />

          <div className="flex-1 w-full relative flex" ref={containerRef}>
            {/* OVERLAYS UI (DOM Level) */}
            <OverlayManager 
              overlays={overlays}
              onAdd={handleAddOverlay}
              onUpdate={handleUpdateOverlay}
              onRemove={handleRemoveOverlay}
            />

            {/* 3D Scene panel */}
            <div
              className="relative h-full"
              style={{ width: showUVPanel ? `${100 - uvPanelWidth}%` : '100%', transition: showUVPanel ? 'none' : 'width 0.2s ease' }}
            >
              <Scene3D
                brushSettings={brushSettings}
                modelParts={modelParts}
                modelTransform={modelTransform}
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
                onLayerControlsReady={handleLayerControlsReady}
                onColorPainted={handleColorPainted}
                activeStencil={overlays.find(o => o.type === 'stencil' && o.visible)}
                performanceConfig={performanceConfig}
                onLoadingProgress={(prog) => {
                  setLoadingProgress(prog);
                  if (prog >= 100) {
                    setTimeout(() => setIsLoading(false), 800);
                  }
                }}
                isModelVisible={!isLoading}
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
              <UVOverlayPanel texture={currentTexture} previewCanvas={previewCanvas} geometry={modelParts[0]?.geometry || null} />
            </div>
            </div>
          </main>
        </div>
        </>
      )}
    </div>
  );
}

export default App;
