import { useState, useCallback, useRef, useEffect, useMemo } from 'react'; 
import * as THREE from 'three';
import { Scene3D } from '@/components/3d/Scene3D';
import type { BrushSettings } from '@/hooks/useWebGLPaint';
import { OverlayManager } from '@/components/ui-custom/OverlayManager';
import type { OverlayData } from '@/components/ui-custom/OverlayManager';
import { Toaster, toast } from 'sonner';
import { UVOverlayPanel } from '@/components/ui-custom/UVOverlayPanel';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import suzanneObjStr from '@/models/Suzanne.obj?raw';
import { Dashboard } from '@/components/ui-custom/Dashboard';
import { ProjectManager } from '@/services/ProjectManager';
import type { SavedProject } from '@/services/ProjectManager';
import { TopHeader } from '@/components/ui-custom/TopHeader';
import { LeftShortcutBar } from '@/components/ui-custom/LeftShortcutBar';
import { ToolOptionsBar } from '@/components/ui-custom/ToolOptionsBar';
import { LoadingOverlay } from '@/components/ui-custom/LoadingOverlay';
import type { GradientSession } from '@/components/3d/PaintableMesh';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { UVUnwrapper } from '@/services/UVUnwrapper';
import { ExportModal } from '@/components/ui-custom/ExportModal';
import './App.css';

// Initialize BVH
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

export interface ModelPart {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  visible: boolean;
}

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

function App() {
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    size: 20,
    color: '#ff0000',
    secondaryColor: '#1e40af',
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
    followPath: false,
    blurStrength: 1.0,
    smudgeStrength: 1.0,
    gradientType: 'linear',
    gradientColor1Transparent: false,
    gradientColor2Transparent: false,

    // Metadata for V2
    id: 'default-round',
    name: 'Default Round',
    category: 'Basics',
    usePressureSize: true,
    usePressureOpacity: true,
    pressureCurve: 1.0,
    performanceMode: isMobile,
    projectFromCamera: true, 
  });

  const [modelName, setModelName] = useState<string>('Suzanne');
  const [modelData, setModelData] = useState<Blob | ArrayBuffer | string | undefined>(undefined);
  const [modelFormat, setModelFormat] = useState<'obj' | 'glb' | 'fbx' | 'usdz' | undefined>(undefined);
  const [modelParts, setModelParts] = useState<ModelPart[]>([]);
  const [overlays, setOverlays] = useState<OverlayData[]>([]);
  
  const [gradientSession, setGradientSession] = useState<GradientSession | null>(null);
  const layerControlsRef = useRef<any>(null);

  // Project Management State
  const [isDashboard, setIsDashboard] = useState(true);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [isUnwrapping, setIsUnwrapping] = useState(false);
  const loadingClearTimerRef = useRef<any>(null);

  const [modelTransform, setModelTransform] = useState({
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number]
  });

  const clearLoadingOverlay = useCallback((delay = 800) => {
    if (loadingClearTimerRef.current) clearTimeout(loadingClearTimerRef.current);
    loadingClearTimerRef.current = setTimeout(() => {
      setIsLoading(false);
      setLoadingStatus('');
      setTimeout(() => setIsUnwrapping(false), 500);
      loadingClearTimerRef.current = null;
    }, delay);
  }, []);

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
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const allGeometries = useMemo(() => modelParts.map(p => p.geometry), [modelParts]);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timer);
  }, [showUVPanel, uvPanelWidth]);
  
  const [matcapName, setMatcapName] = useState<string | null>('softlight_grey.png');
  const [lastMatcap, setLastMatcap] = useState<string>('softlight_grey.png');
  const [lightSetup, setLightSetup] = useState<'3point' | 'directional' | 'ambient'>('3point');
  const [lightIntensity, setLightIntensity] = useState(0.2);
  const [focalLength, setFocalLength] = useState(35);
  const [envIntensity, setEnvIntensity] = useState(0.3);
  const [bumpScale, setBumpScale] = useState(1.0);

  const [objectColor, setObjectColor] = useState('#e5e5e5');
  const [roughness] = useState(0.8);
  const [metalness] = useState(0.1);
  
  const [saoEnabled, setSaoEnabled] = useState(false);
  const [saoIntensity, setSaoIntensity] = useState(0.5);
  const [saoScale, setSaoScale] = useState(1.0);
  const [pbrMode, setPbrMode] = useState(false);

  const handlePbrModeChange = useCallback((enabled: boolean) => {
    setPbrMode(enabled);
    if (enabled) {
      handleMatcapChange(null);
      setLightSetup('3point');
    }
  }, []);

  const handleMatcapChange = useCallback((name: string | null) => {
    setMatcapName(name);
    if (name !== null) {
      setLastMatcap(name);
    }
    if (name === null) {
      setLightIntensity(0.2);
      setEnvIntensity(0.3);
    }
  }, []);

  const handleAddOverlay = useCallback((type: 'reference' | 'stencil', file: File) => {
    const url = URL.createObjectURL(file);
    const newOverlay: OverlayData = {
      id: THREE.MathUtils.generateUUID(),
      type,
      imageUrl: url,
      x: 0.5,
      y: 0.5,
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

  const loadSuzanne = useCallback(() => {
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
          geom.computeBoundsTree();
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
        setModelName('Suzanne');
        return true;
      }
    } catch (err) {
      console.error('Failed to parse Suzanne.obj', err);
    }
    return false;
  }, [suzanneObjStr]);

  useEffect(() => {
    loadSuzanne();
  }, [loadSuzanne]);

  const handleTextureChange = useCallback((texture: THREE.Texture | null, canvas?: HTMLCanvasElement) => {
    setCurrentTexture(texture);
    if (canvas) setPreviewCanvas(canvas);
  }, []);

  const handleExport = useCallback(() => {
    setIsExportModalOpen(true);
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
    layerControlsRef.current = controls;
    if (initialLayersToLoadRef.current) {
      if (controls.importProjectLayersData) {
        controls.importProjectLayersData(initialLayersToLoadRef.current);
      }
      initialLayersToLoadRef.current = null;
    }
  }, []);

  const handleUVUnwrap = async () => {
    if (modelParts.length === 0) return;
    
    setIsLoading(true);
    setIsUnwrapping(true);
    setLoadingProgress(0);
    setLoadingStatus('UV Unwrapping...');
    
    try {
      const geometries = modelParts.map(p => p.geometry);
      const newGeometries = await UVUnwrapper.packAtlas(geometries, (prog) => {
        setLoadingProgress(prev => Math.max(prev, prog)); 
      });
      
      const newParts = modelParts.map((part, i) => {
        const geom = newGeometries[i];
        if ((geom as any).computeBoundsTree) (geom as any).computeBoundsTree();
        return { ...part, geometry: geom };
      });

      setModelParts(newParts);
      await new Promise(resolve => setTimeout(resolve, 100));
      handleClear();
      setLoadingProgress(100);
      toast.success('UV Unwrap concluído com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao realizar UV Unwrap.');
    } finally {
      clearLoadingOverlay(1000);
    }
  };

  const loadModelFromData = useCallback(async (contents: any, format: string, fileName: string) => {
    let loader: any;
    try {
      let object: THREE.Group | THREE.Object3D;
      if (format === 'glb' || format === 'gltf') {
        loader = new GLTFLoader();
        const gltf = await loader.parseAsync(contents, '');
        object = gltf.scene;
      } else if (format === 'fbx') {
        loader = new FBXLoader();
        object = loader.parse(contents, '');
      } else if (format === 'usdz') {
        loader = new USDZLoader();
        object = loader.parse(contents);
      } else {
        loader = new OBJLoader();
        object = loader.parse(contents as string);
      }

      const parts: ModelPart[] = [];
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const geom = child.geometry as THREE.BufferGeometry;
          if (!geom.attributes.normal) geom.computeVertexNormals();
          geom.computeBoundsTree();
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
        setModelName(fileName.replace(/\.[^/.]+$/, ""));
        handleClear(); 
        return true;
      }
    } catch (err) {
      console.error(err);
    }
    return false;
  }, [handleClear]);

  const handleObjUpload = useCallback((file: File) => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingStatus(`Carregando ${file.name}...`);
    const extension = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();

    reader.onload = async (e) => {
      const contents = e.target?.result;
      if (!contents) { setIsLoading(false); return; }
      const success = await loadModelFromData(contents, extension || 'obj', file.name);
      if (success) {
        setModelData(contents as any);
        setModelFormat(extension as any);
        toast.success(`${file.name} carregado com sucesso!`);
      } else {
        toast.error('O arquivo não contém geometrias válidas.');
      }
      clearLoadingOverlay(1000);
    };

    if (extension === 'glb' || extension === 'fbx' || extension === 'usdz') reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }, [clearLoadingOverlay, loadModelFromData]);

  const handleSaveProject = async () => {
    if (!layerControls) return;
    setIsLoading(true);
    setLoadingStatus('Salvando...');
    setLoadingProgress(10);
    try {
      const exportedLayers = layerControls.exportProjectLayersData ? await layerControls.exportProjectLayersData() : [];
      setLoadingProgress(80);
      const project: SavedProject = {
        id: currentProjectId || THREE.MathUtils.generateUUID(),
        name: modelName,
        lastModified: Date.now(),
        modelName,
        modelData,
        modelFormat,
        brushSettings,
        layersData: exportedLayers
      };
      await ProjectManager.saveProject(project);
      setCurrentProjectId(project.id);
      setLoadingProgress(100);
      toast.success('Projeto salvo com sucesso!');
    } catch (e: any) {
      console.error(e);
      toast.error(`Erro ao salvar: ${e.message || 'Erro desconhecido'}`);
    } finally {
      clearLoadingOverlay(500);
    }
  };

  const handleNewProject = (type: 'Suzanne' | 'Cube', file?: File) => {
    setIsLoading(true);
    setLoadingProgress(0);
    setModelTransform({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    if (file) handleObjUpload(file);
    else {
      setModelData(undefined);
      setModelFormat(undefined);
      if (type === 'Suzanne') loadSuzanne();
      handleClear();
    }
    setOverlays([]);
    setCurrentProjectId(null);
    setIsDashboard(false);
    setTimeout(() => setIsLoading(false), 500);
  };

  const handleLoadProject = async (project: SavedProject) => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingStatus('Restaurando modelo...');
    if (project.modelData && project.modelFormat) {
      const success = await loadModelFromData(project.modelData, project.modelFormat, project.modelName);
      if (success) {
        setModelData(project.modelData);
        setModelFormat(project.modelFormat);
      }
    } else if (project.modelName === 'Suzanne') {
      loadSuzanne();
    }
    setModelName(project.modelName);
    setBrushSettings(project.brushSettings);
    setCurrentProjectId(project.id);
    initialLayersToLoadRef.current = project.layersData;
    setIsDashboard(false);
    toast.success('Projeto carregado!');
    clearLoadingOverlay(800);
  };

  return (
    <div className="h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      <LoadingOverlay 
        show={isLoading} 
        progress={loadingProgress} 
        status={loadingStatus} 
        transparent={loadingStatus === 'Salvando...'} 
      />
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
            previewCanvas={previewCanvas}
            handleExport={handleExport}
            handleClear={handleClear}
            textureResolution={textureResolution}
            setTextureResolution={setTextureResolution}
            handleSaveProject={handleSaveProject}
            showUVPanel={showUVPanel}
            setShowUVPanel={setShowUVPanel}
            handleFill={handleFill}
            brushSettings={brushSettings}
            setBrushSettings={setBrushSettings}
            matcapName={matcapName}
            setMatcapName={handleMatcapChange}
            lastMatcap={lastMatcap}
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
            colorHistory={colorHistory}
            layerControls={layerControls}
            saoEnabled={saoEnabled}
            onSaoEnabledChange={setSaoEnabled}
            saoIntensity={saoIntensity}
            onSaoIntensityChange={setSaoIntensity}
            saoScale={saoScale}
            onSaoScaleChange={setSaoScale}
            bumpScale={bumpScale}
            onBumpScaleChange={setBumpScale}
            pbrMode={pbrMode}
            onPbrModeChange={handlePbrModeChange}
            onUVUnwrap={handleUVUnwrap}
          />

          <div className="flex-1 flex overflow-hidden bg-[#09090b]">
            <main className="flex-1 relative flex min-w-0 overflow-hidden">
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

              <div className="flex-1 relative flex min-w-0 overflow-hidden" ref={containerRef}>
                <ToolOptionsBar 
                  brushSettings={brushSettings}
                  setBrushSettings={setBrushSettings}
                  gradientSession={gradientSession}
                  setGradientSession={setGradientSession}
                />

                <div className="flex-1 relative h-full overflow-hidden min-w-0" style={{ display: 'flex', flexDirection: 'column' }}>
                  <OverlayManager 
                    overlays={overlays}
                    onAdd={handleAddOverlay}
                    onUpdate={handleUpdateOverlay}
                    onRemove={handleRemoveOverlay}
                  />

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
                    gradientSession={gradientSession}
                    setGradientSession={setGradientSession}
                    onLoadingProgress={(prog, status) => {
                      if (isUnwrapping) return; 
                      setLoadingProgress(prev => prog === 0 ? 0 : Math.max(prev, prog));
                      if (status) setLoadingStatus(status);
                      if (prog >= 100) clearLoadingOverlay(800);
                    }}
                    isModelVisible={!isLoading || loadingStatus === 'Salvando...'}
                    saoEnabled={saoEnabled}
                    saoIntensity={saoIntensity}
                    saoScale={saoScale}
                    bumpScale={bumpScale}
                  />
                </div>

                {showUVPanel && (
                  <div
                    className="w-1.5 h-full bg-white/5 hover:bg-white/20 cursor-col-resize flex items-center justify-center z-20 transition-colors"
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

                <div
                  className="relative h-full bg-[#09090b] min-w-0 overflow-hidden"
                  style={{ width: `${uvPanelWidth}%`, flexShrink: 0, display: showUVPanel ? 'block' : 'none' }}
                >
                  <UVOverlayPanel previewCanvas={previewCanvas} geometries={allGeometries} isVisible={showUVPanel} />
                </div>
              </div>
            </main>
          </div>
        </>
      )}

      <ExportModal 
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        projectName={modelName}
        layers={layerControls?.layers || []}
        pbrTargets={layerControls?.pbrTargets || {}}
        exportTarget={layerControls?.exportTarget}
      />
    </div>
  );
}

export default App;
