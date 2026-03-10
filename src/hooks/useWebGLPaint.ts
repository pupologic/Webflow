import { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { BrushShaderMaterial } from '../components/3d/materials/BrushShaderMaterial';
import { DilationShaderMaterial } from '../components/3d/materials/DilationShaderMaterial';

export type BrushSettings = {
  color: string;
  size: number;
  opacity: number;
  hardness: number;
  type: 'circle' | 'square' | 'texture';
  mode: 'paint' | 'erase';
};

export interface GPULayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: THREE.Blending;
  target: THREE.WebGLRenderTarget;
}

const MAX_HISTORY = 10;

export function useWebGLPaint(
  meshRef: React.RefObject<THREE.Mesh | null>,
  brushSettings: BrushSettings
) {
  const { gl } = useThree();
  const [layers, setLayers] = useState<GPULayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);

  const stateRef = useRef({
    textureSize: 2048,
    isPainting: false,
    needsComposite: false,
    compositeTarget: null as THREE.WebGLRenderTarget | null,
    dilatedTarget: null as THREE.WebGLRenderTarget | null,
    uvMaskTarget: null as THREE.WebGLRenderTarget | null,
    needsUVMaskUpdate: false,
    
    decalScene: new THREE.Scene(),
    decalCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    decalMesh: new THREE.Mesh(),
    brushMaterial: new BrushShaderMaterial(),
    uvMaskMaterial: new THREE.ShaderMaterial({
      vertexShader: `void main() { gl_Position = vec4(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `void main() { gl_FragColor = vec4(1.0); }`,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    }),
    dilationMaterial: new DilationShaderMaterial(),
    
    compositeScene: new THREE.Scene(),
    compositeCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    compositeQuad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)),
    compositeMaterials: new Map<string, THREE.MeshBasicMaterial>(),

    lastHitPoint: new THREE.Vector3(),
  });

  const undoStackRef = useRef<{ layerId: string; target: THREE.WebGLRenderTarget }[]>([]);
  const redoStackRef = useRef<{ layerId: string; target: THREE.WebGLRenderTarget }[]>([]);

  // ---- Setup ----
  const initPaintSystem = useCallback((size: number) => {
    const state = stateRef.current;
    if (state.compositeTarget) state.compositeTarget.dispose();
    if (state.dilatedTarget) state.dilatedTarget.dispose();
    if (state.uvMaskTarget) state.uvMaskTarget.dispose();

    state.textureSize = size;
    const targetOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
    };
    state.compositeTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);
    state.dilatedTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);
    state.uvMaskTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);

    state.decalMesh.material = state.brushMaterial;
    state.decalScene.add(state.decalMesh);
    state.compositeScene.add(state.compositeQuad);

    addLayer('Base Layer');
  }, []);

  const cloneTarget = useCallback((source: THREE.WebGLRenderTarget) => {
    const clone = source.clone();
    // Copy data from source to clone
    const renderer = gl;
    const currentTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(clone);
    // Use the composite scene/quad to blit the texture
    const mat = new THREE.MeshBasicMaterial({ map: source.texture, depthTest: false, depthWrite: false, transparent: false });
    const oldMat = stateRef.current.compositeQuad.material;
    stateRef.current.compositeQuad.material = mat;
    renderer.render(stateRef.current.compositeScene, stateRef.current.compositeCamera);
    stateRef.current.compositeQuad.material = oldMat;
    mat.dispose();
    renderer.setRenderTarget(currentTarget);
    return clone;
  }, [gl]);

  // ---- Layer Management ----
  const getActiveLayer = useCallback(() => {
    return layers.find(l => l.id === activeLayerId);
  }, [layers, activeLayerId]);

  const addLayer = useCallback((name = 'New Layer') => {
    const state = stateRef.current;
    const newTarget = new THREE.WebGLRenderTarget(state.textureSize, state.textureSize, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
    });

    // Clear it
    const oldRT = gl.getRenderTarget();
    gl.setRenderTarget(newTarget);
    gl.setClearColor(0x000000, 0); 
    gl.clear();
    gl.setRenderTarget(oldRT);

    const newLayer: GPULayer = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      visible: true,
      opacity: 1,
      blendMode: THREE.NormalBlending,
      target: newTarget,
    };

    setLayers(prev => {
      const updated = [...prev, newLayer];
      if (!activeLayerId) setActiveLayerId(newLayer.id);
      return updated;
    });
    
    state.needsComposite = true;
  }, [activeLayerId, gl]);

  // ---- Painting Logic ----
  const saveUndoState = useCallback(() => {
    const active = getActiveLayer();
    if (!active) return;
    
    // Clear redo stack on new action
    redoStackRef.current.forEach(item => item.target.dispose());
    redoStackRef.current = [];

    // Push clone to undo
    const snapshot = cloneTarget(active.target);
    undoStackRef.current.push({ layerId: active.id, target: snapshot });
    
    if (undoStackRef.current.length > MAX_HISTORY) {
      const oldest = undoStackRef.current.shift();
      if (oldest) oldest.target.dispose();
    }
  }, [getActiveLayer, cloneTarget]);

  const drawStamp = useCallback((worldPos: THREE.Vector3, activeLayer: GPULayer) => {
    const state = stateRef.current;
    const { color, opacity, hardness, type, mode, size } = brushSettings;

    // Convert screen size brush to world radius approximately
    // Real implementation would calculate world radius at the hit point relative to camera
    // We use a simplified constant for now, should be refined based on fov and distance
    const worldRadius = size * 0.002;

    // Setup material for decal
    state.brushMaterial.setBrush(color, mode === 'erase' ? 1.0 : opacity, worldPos, worldRadius, hardness, type === 'square');
    
    if (mode === 'erase') {
      state.brushMaterial.blending = THREE.CustomBlending;
      state.brushMaterial.blendEquation = THREE.AddEquation;
      state.brushMaterial.blendSrc = THREE.ZeroFactor;
      state.brushMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
    } else {
      state.brushMaterial.blending = THREE.NormalBlending;
    }

    // Render directly to the layer's target
    const oldRT = gl.getRenderTarget();
    gl.autoClear = false;
    gl.setRenderTarget(activeLayer.target);
    gl.render(state.decalScene, state.decalCamera);
    gl.setRenderTarget(oldRT);
    gl.autoClear = true;

    state.needsComposite = true;
  }, [brushSettings, gl]);

  const startPainting = useCallback((intersection: THREE.Intersection) => {
    const state = stateRef.current;
    if (!meshRef.current) return;
    
    state.isPainting = true;
    state.lastHitPoint.copy(intersection.point);
    saveUndoState();

    // Sync decalMesh transform with the real mesh
    state.decalMesh.matrixAutoUpdate = false;
    state.decalMesh.matrixWorld.copy(meshRef.current.matrixWorld);
    
    const activeLine = getActiveLayer();
    if (activeLine) drawStamp(intersection.point, activeLine);
  }, [getActiveLayer, drawStamp, saveUndoState, meshRef]);

  const paint = useCallback((intersection: THREE.Intersection) => {
    const state = stateRef.current;
    if (!state.isPainting) return;
    
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;

    const currentPoint = intersection.point;
    const distance = state.lastHitPoint.distanceTo(currentPoint);
    
    // Convert screen brush size approx to world step
    const stepDist = Math.max(0.005, (brushSettings.size * 0.002) * 0.25);
    const steps = Math.ceil(distance / stepDist);
    
    // Interpolate in 3D space
    for (let i = 1; i <= steps; i++) {
       const lerpPos = new THREE.Vector3().lerpVectors(state.lastHitPoint, currentPoint, i / steps);
       drawStamp(lerpPos, activeLayer);
    }

    state.lastHitPoint.copy(currentPoint);
  }, [brushSettings.size, drawStamp, getActiveLayer]);

  const stopPainting = useCallback(() => {
    stateRef.current.isPainting = false;
  }, []);

  // ---- RAF Compositor ----
  const compositeAllLayers = useCallback(() => {
    const state = stateRef.current;
    if (!state.compositeTarget || layers.length === 0) return;

    const oldRT = gl.getRenderTarget();
    // --- Render UV Mask if needed ---
    if (state.needsUVMaskUpdate && state.uvMaskTarget) {
      gl.setRenderTarget(state.uvMaskTarget);
      gl.setClearColor(0x000000, 1);
      gl.clear();
      const oldMat = state.decalMesh.material;
      state.decalMesh.material = state.uvMaskMaterial;
      gl.render(state.decalScene, state.decalCamera);
      state.decalMesh.material = oldMat;
      state.needsUVMaskUpdate = false;
      gl.setRenderTarget(oldRT);
    }

    gl.setRenderTarget(state.compositeTarget);
    gl.setClearColor(0xffffff, 1); 
    gl.clear();

    for (const layer of layers) {
      if (!layer.visible) continue;
      
      let mat = state.compositeMaterials.get(layer.id);
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({ 
          map: layer.target.texture, 
          transparent: true,
          opacity: layer.opacity,
          blending: layer.blendMode,
          depthTest: false,
          depthWrite: false
        });
        state.compositeMaterials.set(layer.id, mat);
      } else {
        mat.map = layer.target.texture;
        mat.opacity = layer.opacity;
        mat.blending = layer.blendMode;
      }

        state.compositeQuad.material = mat;
      gl.render(state.compositeScene, state.compositeCamera);
    }
    
    // --- Dilation (Edge Padding) Pass ---
    if (state.uvMaskTarget) {
      gl.setRenderTarget(state.dilatedTarget);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      state.dilationMaterial.setMap(state.compositeTarget.texture, state.uvMaskTarget.texture, state.textureSize, state.textureSize);
      state.compositeQuad.material = state.dilationMaterial;
      gl.render(state.compositeScene, state.compositeCamera);
    }
    
    gl.setRenderTarget(oldRT);
    state.needsComposite = false;
  }, [gl, layers]);

  useEffect(() => {
    let animId: number;
    const loop = () => {
      if (stateRef.current.needsComposite) {
        compositeAllLayers();
      }
      animId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animId);
  }, [compositeAllLayers]);

  // Sync geometry
  useEffect(() => {
    if (meshRef.current && meshRef.current.geometry) {
       stateRef.current.decalMesh.geometry = meshRef.current.geometry;
       stateRef.current.needsUVMaskUpdate = true;
       stateRef.current.needsComposite = true;
    }
  }, [meshRef, meshRef.current?.geometry]);

  // Provide texture out
  const texture = stateRef.current.dilatedTarget?.texture || null;

  // ---- Missing Layer Operations ----
  const removeLayer = useCallback((id: string) => {
    setLayers(prev => {
      const remaining = prev.filter(l => l.id !== id);
      const layerToRemove = prev.find(l => l.id === id);
      if (layerToRemove) {
        layerToRemove.target.dispose();
      }
      
      if (activeLayerId === id && remaining.length > 0) {
        setActiveLayerId(remaining[remaining.length - 1].id);
      } else if (remaining.length === 0) {
        setActiveLayerId(null);
      }
      return remaining;
    });
    stateRef.current.needsComposite = true;
  }, [activeLayerId]);

  const updateLayer = useCallback((id: string, updates: Partial<GPULayer>) => {
    setLayers(prev => prev.map(l => (l.id === id ? { ...l, ...updates } : l)));
    if (updates.visible !== undefined || updates.opacity !== undefined || updates.blendMode !== undefined) {
      stateRef.current.needsComposite = true;
    }
  }, []);

  const moveLayer = useCallback((id: string, direction: 'up' | 'down') => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0) return prev;
      if (direction === 'up' && idx > 0) {
        const next = [...prev];
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        return next;
      }
      if (direction === 'down' && idx < prev.length - 1) {
        const next = [...prev];
        [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
        return next;
      }
      return prev;
    });
    stateRef.current.needsComposite = true;
  }, []);

  const clearCanvas = useCallback(() => {
    const active = getActiveLayer();
    if (!active) return;
    saveUndoState();

    const oldRT = gl.getRenderTarget();
    gl.setRenderTarget(active.target);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.setRenderTarget(oldRT);

    stateRef.current.needsComposite = true;
  }, [getActiveLayer, saveUndoState, gl]);

  const fillCanvas = useCallback(() => {
    const active = getActiveLayer();
    if (!active) return;
    saveUndoState();

    const oldRT = gl.getRenderTarget();
    gl.setRenderTarget(active.target);

    const fillMat = new THREE.MeshBasicMaterial({
      color: brushSettings.color,
      transparent: true,
      opacity: brushSettings.opacity,
      blending: brushSettings.mode === 'erase' ? THREE.CustomBlending : THREE.NormalBlending,
      blendEquation: brushSettings.mode === 'erase' ? THREE.AddEquation : THREE.AddEquation,
      blendSrc: brushSettings.mode === 'erase' ? THREE.ZeroFactor : THREE.SrcAlphaFactor,
      blendDst: brushSettings.mode === 'erase' ? THREE.OneMinusSrcAlphaFactor : THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false
    });

    const oldMat = stateRef.current.compositeQuad.material;
    stateRef.current.compositeQuad.material = fillMat;
    
    gl.render(stateRef.current.compositeScene, stateRef.current.compositeCamera);
    
    stateRef.current.compositeQuad.material = oldMat;
    fillMat.dispose();

    gl.setRenderTarget(oldRT);
    stateRef.current.needsComposite = true;
  }, [getActiveLayer, saveUndoState, gl, brushSettings]);

  const restoreSnapshotToLayer = useCallback((layerId: string, sourceTarget: THREE.WebGLRenderTarget) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    const oldRT = gl.getRenderTarget();
    gl.setRenderTarget(layer.target);
    gl.setClearColor(0x000000, 0);
    gl.clear();

    const blitMat = new THREE.MeshBasicMaterial({ map: sourceTarget.texture, depthTest: false, depthWrite: false });
    const oldMat = stateRef.current.compositeQuad.material;
    stateRef.current.compositeQuad.material = blitMat;

    gl.render(stateRef.current.compositeScene, stateRef.current.compositeCamera);

    stateRef.current.compositeQuad.material = oldMat;
    blitMat.dispose();

    gl.setRenderTarget(oldRT);
    stateRef.current.needsComposite = true;
  }, [layers, gl]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;

    // Save current to redo before undoing
    const currentState = cloneTarget(activeLayer.target);
    redoStackRef.current.push({ layerId: activeLayer.id, target: currentState });

    const step = undoStackRef.current.pop();
    if (step) {
      restoreSnapshotToLayer(step.layerId, step.target);
      step.target.dispose(); // clean up memory after use
    }
  }, [getActiveLayer, cloneTarget, restoreSnapshotToLayer]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;

    // Save current to undo before redoing
    const currentState = cloneTarget(activeLayer.target);
    undoStackRef.current.push({ layerId: activeLayer.id, target: currentState });

    const step = redoStackRef.current.pop();
    if (step) {
      restoreSnapshotToLayer(step.layerId, step.target);
      step.target.dispose();
    }
  }, [getActiveLayer, cloneTarget, restoreSnapshotToLayer]);

  const exportTexture = useCallback((format: 'png' | 'jpeg') => {
    const state = stateRef.current;
    if (!state.dilatedTarget) return null;
    
    const width = state.textureSize;
    const height = state.textureSize;
    const buffer = new Uint8Array(width * height * 4);
    
    gl.readRenderTargetPixels(state.dilatedTarget, 0, 0, width, height, buffer);
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    const imgData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    ctx.putImageData(imgData, 0, 0);

    // WebGL readPixels is upside down compared to Canvas 2D
    const flipCanvas = document.createElement('canvas');
    flipCanvas.width = width;
    flipCanvas.height = height;
    const flipCtx = flipCanvas.getContext('2d');
    if (flipCtx) {
      flipCtx.translate(0, height);
      flipCtx.scale(1, -1);
      flipCtx.drawImage(canvas, 0, 0);
      return flipCanvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png');
    }
    return canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png');
  }, [gl]);

  return {
    initPaintSystem,
    startPainting,
    paint,
    stopPainting,
    textureSize: { width: stateRef.current.textureSize, height: stateRef.current.textureSize },
    texture,
    layers,
    activeLayerId,
    addLayer,
    removeLayer,
    updateLayer,
    setLayerActive: setActiveLayerId,
    moveLayer,
    clearCanvas,
    fillCanvas,
    undo,
    redo,
    exportTexture,
  };
}
