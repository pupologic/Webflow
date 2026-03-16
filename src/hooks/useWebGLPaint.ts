import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { BrushShaderMaterial } from '../components/3d/materials/BrushShaderMaterial';
import { DilationShaderMaterial } from '../components/3d/materials/DilationShaderMaterial';
import { CompositeShaderMaterial } from '../components/3d/materials/CompositeShaderMaterial';
import { GradientShaderMaterial } from '../components/3d/materials/GradientShaderMaterial';
import type { OverlayData } from '../components/ui-custom/OverlayManager';

export interface BrushSettings {
  color: string;
  secondaryColor?: string;
  size: number;
  opacity: number;
  hardness: number;
  type: 'circle' | 'square' | 'texture';
  textureId?: string | null;
  mode: 'paint' | 'erase' | 'blur' | 'smudge' | 'gradient';
  gradientType?: 'linear' | 'radial';
  blurStrength?: number;
  smudgeStrength?: number;
  spacing: number;
  lazyMouse?: boolean;
  lazyRadius?: number;
  jitterSize?: number;
  jitterAngle?: boolean;
  jitterOpacity?: number;
  symmetryMode?: 'none' | 'mirror' | 'radial';
  symmetryAxis?: 'x' | 'y' | 'z';
  radialPoints?: number;
  followPath?: boolean;
  gradientColor1Transparent?: boolean;
  gradientColor2Transparent?: boolean;
  
  // Brush System V2
  id: string;
  name: string;
  category: string;
  usePressureSize?: boolean;
  usePressureOpacity?: boolean;
  pressureCurve?: number; // 0.5 = soft, 1.0 = linear, 2.0 = firm
  performanceMode?: boolean;
};

export type StrokePoint = {
  pos: THREE.Vector3;
  pressure: number;
  opacityPressure: number;
  normal: THREE.Vector3;
  angle: number;
  uv: THREE.Vector2;
};

export type PBRMapType = 'albedo' | 'metalness' | 'roughness' | 'emissive' | 'alpha' | 'bump';

export interface GPULayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  intensity?: number; // For emissive boost
  blendMode: number; // 0-8 modes, 9: Erase
  target: THREE.WebGLRenderTarget | null; // Null for folders
  isFolder?: boolean;
  parentId?: string; // For UI organization
  mapType: PBRMapType;
  maskTarget?: THREE.WebGLRenderTarget | null;
  maskEnabled?: boolean;
  isEditingMask?: boolean;
  premultipliedAlpha?: boolean;
}

const MAX_HISTORY = 10;

export function useWebGLPaint(
  groupRef: React.RefObject<THREE.Group | null>,
  brushSettings: BrushSettings,
  updateDependencies: any[] = [],
  activeStencil?: OverlayData,
  onColorPainted?: (color: string) => void
) {
  const { gl, camera, size: canvasSize } = useThree();
  const onColorPaintedRef = useRef(onColorPainted);
  onColorPaintedRef.current = onColorPainted;

  const [layers, setLayers] = useState<GPULayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);

  const stateRef = useRef({
    textureSize: 2048,
    isPainting: false,
    needsComposite: false,
    compositeTarget: null as THREE.WebGLRenderTarget | null,
    compositeTargetB: null as THREE.WebGLRenderTarget | null,
    dilatedTarget: null as THREE.WebGLRenderTarget | null,
    uvMaskTarget: null as THREE.WebGLRenderTarget | null,
    needsUVMaskUpdate: false,
    lastCompositeResult: null as THREE.WebGLRenderTarget | null,
    
    // PBR Channel Results
    pbrTargets: {
      albedo: null as THREE.WebGLRenderTarget | null,
      metalness: null as THREE.WebGLRenderTarget | null,
      roughness: null as THREE.WebGLRenderTarget | null,
      emissive: null as THREE.WebGLRenderTarget | null,
      alpha: null as THREE.WebGLRenderTarget | null,
      bump: null as THREE.WebGLRenderTarget | null,
    },
    
    layers: [] as GPULayer[], // Ref-based source of truth for renderer
    dirtyChannels: new Set<PBRMapType>(['albedo', 'metalness', 'roughness', 'emissive', 'alpha', 'bump']), // Mark all dirty on init
    
    decalScene: new THREE.Scene(),
    decalCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    decalMesh: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), // NDC quad
    brushMaterial: new BrushShaderMaterial(),
    uvMaskMaterial: new THREE.ShaderMaterial({
      vertexShader: `void main() { gl_Position = vec4(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `void main() { gl_FragColor = vec4(1.0); }`,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    }),
    dilationMaterial: new DilationShaderMaterial(),
    gradientMaterial: new GradientShaderMaterial(),
    
    compositeScene: new THREE.Scene(),
    compositeCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    compositeQuad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)),
    compositeMaterials: new Map<string, CompositeShaderMaterial>(),
    textureCache: new Map<string, THREE.Texture>(),

    lastHitPoint: new THREE.Vector3(),
    lastPressure: 1.0,
    previewCanvas: document.createElement('canvas'),
    previewContext: null as CanvasRenderingContext2D | null,
    previewTarget: null as THREE.WebGLRenderTarget | null,
    previewBlitMaterial: null as THREE.MeshBasicMaterial | null,
    lastSyncTime: 0,
    staggerStep: 0, // 0: Idle, 1: Full Dilation, 2: Sync Preview
    lazyPoint: new THREE.Vector3(),
    hasLazyPoint: false,
    
    // Stencil State
    stencilTexture: null as THREE.Texture | null,
    stencilMatrix: new THREE.Matrix3(),

    // Blur / Smudge State
    snapshotTarget: null as THREE.WebGLRenderTarget | null,
    lastHitUV: new THREE.Vector2(),
    hasSnapshot: false,
    lastFollowAngle: 0,
    strokeBBox: { minX: 1, minY: 1, maxX: 0, maxY: 0 },
    frameStrokeBBox: { minX: 1, minY: 1, maxX: 0, maxY: 0 },
    strokeProxyTarget: null as THREE.WebGLRenderTarget | null,
    isUsingProxy: false,
    strokePoints: [] as StrokePoint[],
  });

  const undoStackRef = useRef<{ layerId: string; target: THREE.WebGLRenderTarget, isMask: boolean }[]>([]);
  const redoStackRef = useRef<{ layerId: string; target: THREE.WebGLRenderTarget, isMask: boolean }[]>([]);

  // ---- Setup ----
  const initPaintSystem = useCallback((size: number) => {
    const state = stateRef.current;
    const oldSize = state.textureSize;

    // Avoid redundant initialization if size is the same and we have layers
    if (state.compositeTarget && oldSize === size && state.layers.length > 0) {
      return;
    }

    if (state.compositeTarget) state.compositeTarget.dispose();
    if (state.compositeTargetB) state.compositeTargetB.dispose();
    if (state.dilatedTarget) state.dilatedTarget.dispose();
    if (state.uvMaskTarget) state.uvMaskTarget.dispose();
    if (state.snapshotTarget) state.snapshotTarget.dispose();
    if (state.strokeProxyTarget) state.strokeProxyTarget.dispose();

    state.textureSize = size;
    const targetOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
    };
    state.compositeTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);
    state.compositeTargetB = new THREE.WebGLRenderTarget(size, size, targetOpts);
    state.dilatedTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);
    state.uvMaskTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);
    state.snapshotTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);
    state.strokeProxyTarget = new THREE.WebGLRenderTarget(size / 2, size / 2, targetOpts);

    state.pbrTargets = {
      albedo: new THREE.WebGLRenderTarget(size, size, targetOpts),
      metalness: new THREE.WebGLRenderTarget(size, size, targetOpts),
      roughness: new THREE.WebGLRenderTarget(size, size, targetOpts),
      emissive: new THREE.WebGLRenderTarget(size, size, targetOpts),
      alpha: new THREE.WebGLRenderTarget(size, size, targetOpts),
      bump: new THREE.WebGLRenderTarget(size, size, targetOpts),
    };

    // Helper to migrate texture data to new resolution
    const migrateTarget = (oldTarget: THREE.WebGLRenderTarget) => {
      const newTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);
      const renderer = gl;
      const currentRT = renderer.getRenderTarget();
      
      renderer.setRenderTarget(newTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      
      const mat = new THREE.MeshBasicMaterial({ 
        map: oldTarget.texture, 
        transparent: true, 
        depthTest: false, 
        depthWrite: false, 
        blending: THREE.NoBlending 
      });
      
      // Use the composite quad to render
      const oldMat = state.compositeQuad.material;
      state.compositeQuad.material = mat;
      renderer.render(state.compositeScene, state.compositeCamera);
      state.compositeQuad.material = oldMat;
      mat.dispose();
      
      renderer.setRenderTarget(currentRT);
      oldTarget.dispose();
      return newTarget;
    };

    // Migrate layers if resolution changed
    if (oldSize !== size && oldSize > 0) {
      state.layers.forEach(l => {
        if (l.target) l.target = migrateTarget(l.target);
        if (l.maskTarget) l.maskTarget = migrateTarget(l.maskTarget);
      });
      
      // Also migrate undo/redo stacks to prevent size mismatch artifacts
      undoStackRef.current.forEach(item => {
        item.target = migrateTarget(item.target);
      });
      redoStackRef.current.forEach(item => {
        item.target = migrateTarget(item.target);
      });
    }

    // ONLY add base layer if there are NO layers
    if (state.layers.length === 0) {
      addLayer('Base Layer');
    }
    
    state.decalMesh.material = state.brushMaterial;
    state.decalMesh.frustumCulled = false;
    state.decalScene.add(state.decalMesh);
    state.compositeQuad.frustumCulled = false;
    state.compositeScene.add(state.compositeQuad);

    state.previewCanvas.width = 512; // Sufficient for UI preview
    state.previewCanvas.height = 512;
    state.previewContext = state.previewCanvas.getContext('2d', { willReadFrequently: true });

    if (state.previewTarget) state.previewTarget.dispose();
    state.previewTarget = new THREE.WebGLRenderTarget(512, 512, targetOpts);
    
    if (state.previewBlitMaterial) state.previewBlitMaterial.dispose();
    state.previewBlitMaterial = new THREE.MeshBasicMaterial({ transparent: false, depthTest: false, depthWrite: false });

    state.needsUVMaskUpdate = true;
    stateRef.current.dirtyChannels.add('albedo');
    stateRef.current.dirtyChannels.add('metalness');
    stateRef.current.dirtyChannels.add('roughness');
    stateRef.current.dirtyChannels.add('emissive');
    stateRef.current.dirtyChannels.add('alpha');
    stateRef.current.dirtyChannels.add('bump');
    stateRef.current.needsComposite = true;
  }, []);

  const cloneTarget = useCallback((source: THREE.WebGLRenderTarget) => {
    const clone = source.clone();
    // Copy data from source to clone
    const renderer = gl;
    const currentTarget = renderer.getRenderTarget();
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();
    
    renderer.setRenderTarget(clone);
    // Use the composite scene/quad to blit the texture
    const mat = new THREE.MeshBasicMaterial({ 
      map: source.texture, 
      depthTest: false, 
      depthWrite: false, 
      transparent: true,
      blending: THREE.NoBlending
    });
    const oldMat = stateRef.current.compositeQuad.material;
    stateRef.current.compositeQuad.material = mat;
    renderer.render(stateRef.current.compositeScene, stateRef.current.compositeCamera);
    stateRef.current.compositeQuad.material = oldMat;
    mat.dispose();
    renderer.setRenderTarget(currentTarget);
    gl.setClearColor(oldClearColor, oldClearAlpha);
    return clone;
  }, [gl]);

  const markChannelDirty = useCallback((type: PBRMapType | 'all') => {
    const state = stateRef.current;
    if (type === 'all') {
      state.dirtyChannels.add('albedo');
      state.dirtyChannels.add('metalness');
      state.dirtyChannels.add('roughness');
      state.dirtyChannels.add('emissive');
      state.dirtyChannels.add('alpha');
      state.dirtyChannels.add('bump');
    } else {
      state.dirtyChannels.add(type);
    }
    if (state.staggerStep === 0) state.staggerStep = 1;
    state.needsComposite = true;
  }, []);

  // ---- Layer Management ----
  const getActiveLayer = useCallback(() => {
    return layers.find(l => l.id === activeLayerId);
  }, [layers, activeLayerId]);

  const addLayer = useCallback((nameArg: any = 'New Layer') => {
    const name = (typeof nameArg === 'string') ? nameArg : 'New Layer';
    const state = stateRef.current;
    const newTarget = new THREE.WebGLRenderTarget(state.textureSize, state.textureSize, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
    });

    // Clear it
    const oldRT = gl.getRenderTarget();
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();

    gl.setRenderTarget(newTarget);
    
    // Check real current layers length to decide on clear color
    // We use state.layers which is the ref-synced source of truth to avoid stale closures
    if (state.layers.length === 0) {
      gl.setClearColor(0xffffff, 1); 
    } else {
      gl.setClearColor(0x000000, 0); 
    }
    
    gl.clear();
    gl.setRenderTarget(oldRT);
    gl.setClearColor(oldClearColor, oldClearAlpha);

    const newLayer: GPULayer = {
      id: THREE.MathUtils.generateUUID(),
      name,
      visible: true,
      opacity: 1,
      intensity: 1,
      blendMode: 0, // Normal
      target: newTarget,
      mapType: 'albedo',
      maskTarget: null,
      maskEnabled: false,
      isEditingMask: false,
    };

    setLayers(prev => {
      const updated = [newLayer, ...prev];
      state.layers = updated;
      markChannelDirty(newLayer.mapType);
      return updated;
    });
    
    // Always auto-select the new layer
    setActiveLayerId(newLayer.id);
  }, [gl]); // activeLayerId removed from deps as we now ALWAYS set it, layers length checked via ref

  // Sync ref to state
  useEffect(() => {
    stateRef.current.layers = layers;
  }, [layers]);

  // ---- Painting Logic ----
  const saveUndoState = useCallback(() => {
    const active = getActiveLayer();
    if (!active || !active.target) return;
    
    // Clear redo stack on new action
    redoStackRef.current.forEach(item => item.target.dispose());
    redoStackRef.current = [];

    // Push clone to undo
    const targetToClone = active.isEditingMask && active.maskTarget ? active.maskTarget : active.target;
    if (targetToClone) {
        const snapshot = cloneTarget(targetToClone);
        undoStackRef.current.push({ layerId: active.id, target: snapshot, isMask: !!(active.isEditingMask && active.maskTarget) });
        
        if (undoStackRef.current.length > MAX_HISTORY) {
          const oldest = undoStackRef.current.shift();
          if (oldest) oldest.target.dispose();
        }
    }
  }, [getActiveLayer, cloneTarget]);

  const drawStamp = useCallback((
    worldPos: THREE.Vector3, 
    activeLayer: GPULayer, 
    sizePressure: number = 1.0, 
    opacityPressure: number = 1.0,
    normal: THREE.Vector3 = new THREE.Vector3(0, 0, 1),
    angle: number = 0.0,
    uv: THREE.Vector2 = new THREE.Vector2(),
    isReplaying: boolean = false
  ) => {
    const state = stateRef.current;
    
    // Record point for Performance Mode replay
    if (state.isUsingProxy && !isReplaying) {
      state.strokePoints.push({
        pos: worldPos.clone(),
        pressure: sizePressure,
        opacityPressure,
        normal: normal.clone(),
        angle,
        uv: uv.clone()
      });
    }

    const { color, opacity, hardness, type, mode, size, blurStrength, smudgeStrength } = brushSettings;

    const dist = camera.position.distanceTo(worldPos);
    let worldRadius = 0.1;
    
    // Apply Size Jitter
    let dynamicSize = size * sizePressure;
    const jSize = brushSettings.jitterSize || 0;
    if (jSize > 0.01) {
      const variation = (Math.random() * 2.0 - 1.0) * jSize;
      dynamicSize *= Math.max(0.1, 1.0 + variation);
    }

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const worldHeight = 2 * dist * Math.tan(fov / 2);
      worldRadius = (dynamicSize / canvasSize.height) * worldHeight * 0.5;
    } else {
      const ortho = camera as THREE.OrthographicCamera;
      const worldHeight = ortho.top - ortho.bottom;
      worldRadius = (dynamicSize / canvasSize.height) * worldHeight * 0.5;
    }

    // Setup material for decal
    let brushTex = null;
    if (type === 'texture' && brushSettings.textureId) {
      brushTex = state.textureCache.get(brushSettings.textureId) || null;
    }
    
    // Stencil Setup
    let stencilTex = null;
    let stencilMat = null;
    let stencilMode = 0; // 0 = alpha, 1 = invert, 2 = luminance
    
    if (activeStencil && activeStencil.imageUrl) {
      if (activeStencil.applyMode === 'invert') stencilMode = 1;
      else if (activeStencil.applyMode === 'luminance') stencilMode = 2;
      // 1. Load Stencil Texture (cached)
      if (!state.textureCache.has(activeStencil.imageUrl)) {
          // Attempt to grab from DOM for synchronous load (prevents dropped first click)
          const imgEl = document.getElementById(`overlay-img-${activeStencil.id}`) as HTMLImageElement;
          if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
              const tex = new THREE.Texture(imgEl);
              tex.minFilter = THREE.LinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.needsUpdate = true;
              state.textureCache.set(activeStencil.imageUrl, tex);
          } else {
              // Preemptively set to avoid spamming the loader in requestAnimationFrame
              state.textureCache.set(activeStencil.imageUrl, undefined as any);
              new THREE.TextureLoader().load(activeStencil.imageUrl, (t) => {
                  t.minFilter = THREE.LinearFilter;
                  t.magFilter = THREE.LinearFilter;
                  state.textureCache.set(activeStencil.imageUrl, t);
              });
          }
      }
      stencilTex = state.textureCache.get(activeStencil.imageUrl) || null;
      if (!stencilTex) return; // Prevent painting before stencil is loaded
      
      // 2. Compute Inverse Transform Matrix
      // The DOM overlay transforms the image relative to its center point.
      // We need to map WebGL gl_FragCoord (0..width, 0..height) back to UV space (0..1, 0..1)
      if (stencilTex && stencilTex.image) {
          const img = stencilTex.image as HTMLImageElement;
          // Calculate rendered dimensions based on "object-contain" constraints
          // The overlay uses max-width/max-height, so we need to infer the actual rendered box
          let w = img.width;
          let h = img.height;
          const maxW = window.innerWidth * 0.7;
          const maxH = window.innerHeight * 0.7;
          if (w > maxW || h > maxH) {
             const scaleDown = Math.min(maxW / w, maxH / h);
             w *= scaleDown;
             h *= scaleDown;
          }
          w *= activeStencil.scale;
          h *= activeStencil.scale;
           
          // Create 3x3 Transformation Matrix mapping Screen UV (0..1) to Stencil UV (0..1)
          const m = state.stencilMatrix;
          
          const rect = gl.domElement.getBoundingClientRect();
          const canvasW = rect.width;
          const canvasH = rect.height;

          // Target logic: stencilUV = CenterToUV * ScaleInv * RotateInv * TranslateInv * ScreenPixels
          
          // 1. Convert Screen UV (WebGL: y=0 at bottom) to Screen Pixels (DOM: y=0 at top)
          const toPixels = new THREE.Matrix3().set(
            canvasW, 0, 0,
            0, -canvasH, canvasH,
            0, 0, 1
          );
          
          // 2. Translate from screen origin to Stencil center
          const trInv = new THREE.Matrix3().set(
            1, 0, -activeStencil.x,
            0, 1, -activeStencil.y,
            0, 0, 1
          );

          // 3. Inverse Rotation (Clockwise in DOM -> Negate angle)
          const angleRad = activeStencil.rotation * (Math.PI / 180);
          const c = Math.cos(-angleRad);
          const s = Math.sin(-angleRad);
          // Inverse of CW rotation is CCW rotation
          const rotInv = new THREE.Matrix3().set(
            c, -s, 0,
            s,  c, 0,
            0,  0, 1
          );

          // 4. Inverse Scale (to normalize dimensions)
          const scaleInv = new THREE.Matrix3().set(
            1/w, 0, 0,
            0, 1/h, 0,
            0, 0, 1
          );

          // 5. Convert from normalized local [-0.5, 0.5] to UV [0, 1]
          // Reminder: DOM local y goes down, but WebGL UV y goes up
          const toUV = new THREE.Matrix3().set(
            1,  0, 0.5,
            0, -1, 0.5,
            0,  0, 1
          );

          m.identity();
          m.multiply(toUV);
          m.multiply(scaleInv);
          m.multiply(rotInv);
          m.multiply(trInv);
          m.multiply(toPixels);
          
          stencilMat = m;
      }
    }

    // View-Projection Matrix
    const vpMatrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    const smudgeDisplacement = new THREE.Vector2().subVectors(uv, state.lastHitUV).multiplyScalar(1.5);

    if (mode !== 'gradient') {
      state.brushMaterial.setBrush(
        mode === 'erase' ? 'erase' : color, 
        opacity * opacityPressure, 
        worldPos, 
        worldRadius, 
        hardness, 
        type === 'square',
        brushTex,
        normal,
        angle,
        stencilTex,
        stencilMat,
        vpMatrix,
        stencilMode,
        camera.position,
        mode as any,
        state.snapshotTarget?.texture || null,
        smudgeDisplacement,
        blurStrength || 1.0,
        state.isUsingProxy ? state.textureSize / 2 : state.textureSize,
        smudgeStrength !== undefined ? smudgeStrength : 1.0
      );
      
      // Render
      const oldRT = gl.getRenderTarget();
      const oldAutoClear = gl.autoClear;
      gl.autoClear = false;
      
      const targetRT = (activeLayer.isEditingMask && activeLayer.maskTarget) ? activeLayer.maskTarget : activeLayer.target;
      const finalTarget = state.isUsingProxy ? state.strokeProxyTarget : targetRT;
      gl.setRenderTarget(finalTarget);

      const renderDecal = () => {
        if (groupRef.current) {
          groupRef.current.traverse((child) => {
            if (child instanceof THREE.Mesh && child.visible) {
              state.decalMesh.geometry = child.geometry;
              child.matrixWorld.decompose(
                state.decalMesh.position,
                state.decalMesh.quaternion,
                state.decalMesh.scale
              );
              gl.render(state.decalScene, state.decalCamera);
            }
          });
        }
      };

      renderDecal();

      // Advanced Symmetry
      if (brushSettings.symmetryMode && brushSettings.symmetryMode !== 'none') {
        const symMode = brushSettings.symmetryMode;
        const axis = brushSettings.symmetryAxis || 'x';
        
        if (symMode === 'mirror') {
          const mirroredPos = worldPos.clone();
          const mirroredNormal = normal.clone();
          
          if (axis === 'x') { mirroredPos.x *= -1; mirroredNormal.x *= -1; }
          else if (axis === 'y') { mirroredPos.y *= -1; mirroredNormal.y *= -1; }
          else if (axis === 'z') { mirroredPos.z *= -1; mirroredNormal.z *= -1; }
          
          // View-Projection Matrix
          const vpMatrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

          state.brushMaterial.setBrush(
            brushSettings.mode === 'erase' ? 'erase' : color, 
            opacity * opacityPressure, 
            mirroredPos, 
            worldRadius, 
            hardness, 
            type === 'square',
            brushTex,
            mirroredNormal,
            angle,
            stencilTex,
            stencilMat,
            vpMatrix,
            stencilMode,
            camera.position,
            mode as any,
            state.snapshotTarget?.texture || null,
            smudgeDisplacement,
            blurStrength || 1.0,
            state.isUsingProxy ? state.textureSize / 2 : state.textureSize,
            smudgeStrength !== undefined ? smudgeStrength : 1.0
          );
          renderDecal();
        } 
        else if (symMode === 'radial') {
          const points = brushSettings.radialPoints || 4;
          const angleStep = (Math.PI * 2) / points;
          
          for (let i = 1; i < points; i++) {
            const radialPos = worldPos.clone();
            const radialNormal = normal.clone();
            const theta = angleStep * i;
            
            if (axis === 'y') {
              // Rotate around Y axis
              const x = worldPos.x * Math.cos(theta) - worldPos.z * Math.sin(theta);
              const z = worldPos.x * Math.sin(theta) + worldPos.z * Math.cos(theta);
              radialPos.set(x, worldPos.y, z);
              
              const nx = normal.x * Math.cos(theta) - normal.z * Math.sin(theta);
              const nz = normal.x * Math.sin(theta) + normal.z * Math.cos(theta);
              radialNormal.set(nx, normal.y, nz);
            } else if (axis === 'x') {
              // Rotate around X axis
              const y = worldPos.y * Math.cos(theta) - worldPos.z * Math.sin(theta);
              const z = worldPos.y * Math.sin(theta) + worldPos.z * Math.cos(theta);
              radialPos.set(worldPos.x, y, z);
              
              const ny = normal.y * Math.cos(theta) - normal.z * Math.sin(theta);
              const nz = normal.y * Math.sin(theta) + normal.z * Math.cos(theta);
              radialNormal.set(normal.x, ny, nz);
            } else if (axis === 'z') {
              // Rotate around Z axis
              const x = worldPos.x * Math.cos(theta) - worldPos.y * Math.sin(theta);
              const y = worldPos.x * Math.sin(theta) + worldPos.y * Math.cos(theta);
              radialPos.set(x, y, worldPos.z);
              
              const nx = normal.x * Math.cos(theta) - normal.y * Math.sin(theta);
              const ny = normal.x * Math.sin(theta) + normal.y * Math.cos(theta);
              radialNormal.set(nx, ny, normal.z);
            }
            
            // View-Projection Matrix
            const vpMatrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

            state.brushMaterial.setBrush(
              brushSettings.mode === 'erase' ? 'erase' : color, 
              opacity * opacityPressure, 
              radialPos, 
              worldRadius, 
              hardness, 
              type === 'square',
              brushTex,
              radialNormal,
              angle,
              stencilTex,
              stencilMat,
              vpMatrix,
              stencilMode,
              camera.position,
              mode as any,
              state.snapshotTarget?.texture || null,
              smudgeDisplacement,
              blurStrength || 1.0,
              state.isUsingProxy ? state.textureSize / 2 : state.textureSize,
              smudgeStrength !== undefined ? smudgeStrength : 1.0
            );
            renderDecal();
          }
        }
      }

      gl.setRenderTarget(oldRT);
      gl.autoClear = oldAutoClear;
      markChannelDirty(activeLayer.mapType);
    }
  }, [brushSettings, gl, activeStencil, camera, canvasSize.height, groupRef, markChannelDirty]);

  const startPainting = useCallback((intersection: THREE.Intersection, pressure: number = 1.0) => {
    const state = stateRef.current;
    if (!groupRef.current) return;
    
    state.isPainting = true;
    const { mode } = brushSettings;
    
    if (onColorPaintedRef.current) {
      onColorPaintedRef.current(brushSettings.color);
    }

    
    if (brushSettings.lazyMouse) {
      state.lazyPoint.copy(intersection.point);
      state.hasLazyPoint = true;
    }

    state.lastHitPoint.copy(intersection.point);
    const uv = intersection.uv?.clone() || new THREE.Vector2();
    state.strokeBBox = { minX: uv.x, minY: uv.y, maxX: uv.x, maxY: uv.y };
    state.frameStrokeBBox = { minX: uv.x, minY: uv.y, maxX: uv.x, maxY: uv.y };
    state.strokePoints = [];

    saveUndoState();
    
    const activeLine = getActiveLayer();
    if (activeLine) {
      state.isUsingProxy = !!(brushSettings.performanceMode && activeLine.target && (mode === 'paint' || mode === 'erase'));
      if (state.isUsingProxy && state.strokeProxyTarget) {
        const renderer = gl;
        const currentRT = renderer.getRenderTarget();
        const sourceRT = (activeLine.isEditingMask && activeLine.maskTarget) ? activeLine.maskTarget : activeLine.target;
        
        renderer.setRenderTarget(state.strokeProxyTarget);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        
        const mat = new THREE.MeshBasicMaterial({ 
          map: sourceRT!.texture, 
          transparent: true, 
          depthTest: false, 
          depthWrite: false, 
          blending: THREE.NoBlending 
        });
        const oldMat = state.compositeQuad.material;
        state.compositeQuad.material = mat;
        renderer.render(state.compositeScene, state.compositeCamera);
        state.compositeQuad.material = oldMat;
        mat.dispose();
        renderer.setRenderTarget(currentRT);
      }

      const normal = intersection.face?.normal.clone() || new THREE.Vector3(0, 0, 1);
      if (intersection.object) normal.transformDirection(intersection.object.matrixWorld).normalize();
      
      let angle = brushSettings.type === 'texture' ? Math.random() * Math.PI * 2 : 0;
      if (brushSettings.jitterAngle) angle = Math.random() * Math.PI * 2;
      
      let finalPressure = pressure;
      if (brushSettings.jitterOpacity) {
        finalPressure *= (1.0 - Math.random() * brushSettings.jitterOpacity);
      }

      if (mode === 'blur' || mode === 'smudge') {
          // Function to capture the current layer into the snapshot, with dilation to fix seams
          const updateSnapshot = () => {
              const renderer = gl;
              const currentRT = renderer.getRenderTarget();
              
              const oldMat = state.compositeQuad.material;
              renderer.setRenderTarget(state.snapshotTarget);

              if (state.uvMaskTarget) {
                  // Perform dilation on the snapshot to fix seam artifacts
                  state.dilationMaterial.setMap(
                      activeLine.target!.texture, 
                      state.uvMaskTarget.texture, 
                      state.textureSize, 
                      state.textureSize, 
                      2.0
                  );
                  state.compositeQuad.material = state.dilationMaterial;
              } else {
                  const mat = new THREE.MeshBasicMaterial({ 
                    map: activeLine.target!.texture, 
                    depthTest: false, depthWrite: false, transparent: true, blending: THREE.NoBlending 
                  });
                  state.compositeQuad.material = mat;
              }
              
              renderer.render(state.compositeScene, state.compositeCamera);
              
              if (state.compositeQuad.material !== state.dilationMaterial) {
                  (state.compositeQuad.material as any).dispose();
              }
              
              state.compositeQuad.material = oldMat;
              renderer.setRenderTarget(currentRT);
              state.hasSnapshot = true;
          };

          if (activeLine.target) {
              updateSnapshot();
              (state as any).updateSnapshot = updateSnapshot;
          }
      }

      const uv = intersection.uv?.clone() || new THREE.Vector2();
      state.lastHitUV.copy(uv);

      const sPressure = brushSettings.usePressureSize ? pressure : 1.0;
      const oPressure = brushSettings.usePressureOpacity ? pressure : 1.0;
      drawStamp(intersection.point, activeLine, sPressure, oPressure, normal, angle, uv);
    }
  }, [getActiveLayer, drawStamp, saveUndoState, groupRef, onColorPaintedRef, brushSettings, gl]);

  const paint = useCallback((intersection: THREE.Intersection, targetPressure: number = 1.0) => {
    const state = stateRef.current;
    if (!state.isPainting) return;
    
    const activeLayer = getActiveLayer();
    if (!activeLayer) return;

    const targetUV = intersection.uv?.clone() || new THREE.Vector2();

    // Update stroke bounding box (cumulative for the whole stroke)
    state.strokeBBox.minX = Math.min(state.strokeBBox.minX, targetUV.x);
    state.strokeBBox.maxX = Math.max(state.strokeBBox.maxX, targetUV.x);
    state.strokeBBox.minY = Math.min(state.strokeBBox.minY, targetUV.y);
    state.strokeBBox.maxY = Math.max(state.strokeBBox.maxY, targetUV.y);

    // Update frame bounding box (for incremental scissor optimization)
    state.frameStrokeBBox.minX = Math.min(state.frameStrokeBBox.minX, targetUV.x);
    state.frameStrokeBBox.maxX = Math.max(state.frameStrokeBBox.maxX, targetUV.x);
    state.frameStrokeBBox.minY = Math.min(state.frameStrokeBBox.minY, targetUV.y);
    state.frameStrokeBBox.maxY = Math.max(state.frameStrokeBBox.maxY, targetUV.y);

    let currentPoint = intersection.point;

    // --- Lazy Mouse logic ---
    if (brushSettings.lazyMouse && state.hasLazyPoint) {
      const lazyRadius = brushSettings.lazyRadius || 0.1;
      const distToCursor = state.lazyPoint.distanceTo(currentPoint);
      
      if (distToCursor > lazyRadius) {
        const dir = new THREE.Vector3().subVectors(currentPoint, state.lazyPoint).normalize();
        state.lazyPoint.add(dir.multiplyScalar(distToCursor - lazyRadius));
      }
      currentPoint = state.lazyPoint.clone();
    }

    const distance = state.lastHitPoint.distanceTo(currentPoint);
    if (distance < 0.0001) return; // No move
    
    const distToCam = camera.position.distanceTo(currentPoint);
    let worldRadius = 0.1;
    
    // Base size (jitter is applied inside drawStamp)
    const dynamicSize = brushSettings.size * Math.max(0.05, targetPressure);

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const worldHeight = 2 * distToCam * Math.tan(fov / 2);
      worldRadius = (dynamicSize / canvasSize.height) * worldHeight * 0.5;
    } else {
      const ortho = camera as THREE.OrthographicCamera;
      const worldHeight = ortho.top - ortho.bottom;
      worldRadius = (dynamicSize / canvasSize.height) * worldHeight * 0.5;
    }

    const stepDist = Math.max(0.001, worldRadius * brushSettings.spacing);
    const steps = Math.ceil(distance / stepDist);
    
    // Determine Normal
    const normal = intersection.face?.normal.clone() || new THREE.Vector3(0, 0, 1);
    if (intersection.object) normal.transformDirection(intersection.object.matrixWorld).normalize();

    // Interpolate in 3D space and pressure space
    for (let i = 1; i <= steps; i++) {
       const t = i / steps;
       const lerpPos = new THREE.Vector3().lerpVectors(state.lastHitPoint, currentPoint, t);
       const lerpPressure = THREE.MathUtils.lerp(state.lastPressure, targetPressure, t);
       
       let angle = brushSettings.type === 'texture' ? Math.random() * Math.PI * 2 : 0;
       
       if (brushSettings.followPath) {
         const moveDir = new THREE.Vector3().subVectors(currentPoint, state.lastHitPoint).normalize();
         if (moveDir.lengthSq() > 0.0001) {
           const up = Math.abs(normal.y) < 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
           const tangent = new THREE.Vector3().crossVectors(up, normal).normalize();
           const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
           
           const localX = moveDir.dot(tangent);
           const localY = moveDir.dot(bitangent);
           
           const targetAngle = Math.atan2(localY, localX);
           
           // Smooth the angle to prevent flickering
           const lerpFactor = 0.3;
           let diff = targetAngle - state.lastFollowAngle;
           if (diff < -Math.PI) diff += Math.PI * 2;
           if (diff > Math.PI) diff -= Math.PI * 2;
           
           state.lastFollowAngle += diff * lerpFactor;
           angle = state.lastFollowAngle;
         } else {
           angle = state.lastFollowAngle;
         }
       } else if (brushSettings.jitterAngle) {
         angle = Math.random() * Math.PI * 2;
       }
       
       // Apply pressure curve
       const curvedPres = Math.pow(lerpPressure, brushSettings.pressureCurve || 1.0);
       const sPressure = brushSettings.usePressureSize ? curvedPres : 1.0;
       const oPressure = brushSettings.usePressureOpacity ? curvedPres : 1.0;

       let finalOpacityPressure = oPressure;
       if (brushSettings.jitterOpacity) {
         finalOpacityPressure *= (1.0 - Math.random() * brushSettings.jitterOpacity);
       }
       
       const lerpUV = new THREE.Vector2().lerpVectors(state.lastHitUV, targetUV, t);
       
       drawStamp(lerpPos, activeLayer, sPressure, finalOpacityPressure, normal, angle, lerpUV);
       state.lastHitUV.copy(lerpUV);

       // Accumulate: Update snapshot more frequently for smudge to prevent tearing during fast moves
       const updateFrequency = brushSettings.mode === 'smudge' ? 2 : 5;
       if (i % updateFrequency === 0 && (brushSettings.mode === 'smudge' || brushSettings.mode === 'blur') && (state as any).updateSnapshot) {
           (state as any).updateSnapshot();
       }
    }

    // Accumulation: Update snapshot after some steps or at the end of the event
    // This allows the smudge to "pick up" colors as it moves.
    if ((brushSettings.mode === 'smudge' || brushSettings.mode === 'blur') && (state as any).updateSnapshot) {
        (state as any).updateSnapshot();
    }

    state.lastHitPoint.copy(currentPoint);
    state.lastPressure = targetPressure;
  }, [brushSettings.size, brushSettings.spacing, brushSettings.lazyMouse, brushSettings.lazyRadius, brushSettings.type, brushSettings.jitterAngle, brushSettings.jitterOpacity, drawStamp, getActiveLayer, camera, canvasSize.height]);

  const stopPainting = useCallback(() => {
    const state = stateRef.current;
    
    // Commit proxy results if active using HIGH-FIDELITY replay
    if (state.isUsingProxy && state.strokePoints.length > 0) {
        const activeLayer = getActiveLayer();
        if (activeLayer && activeLayer.target) {
            // 1. Terminate proxy mode to ensure drawStamp renders to full-res
            state.isUsingProxy = false;
            
            // 2. Replay the entire stroke at full resolution
            state.strokePoints.forEach(p => {
                drawStamp(p.pos, activeLayer, p.pressure, p.opacityPressure, p.normal, p.angle, p.uv, true);
            });
            
            // 3. Clear proxy buffer
            if (state.strokeProxyTarget) {
                const renderer = gl;
                const currentRT = renderer.getRenderTarget();
                renderer.setRenderTarget(state.strokeProxyTarget);
                renderer.setClearColor(0x000000, 0);
                renderer.clear();
                renderer.setRenderTarget(currentRT);
            }
        }
    }

    state.isPainting = false;
    state.isUsingProxy = false;
    state.strokePoints = [];
    state.hasLazyPoint = false;
    state.staggerStep = 1; // Start post-stroke cleanup staggered
    state.needsComposite = true;
  }, [gl, getActiveLayer, drawStamp]);

  const syncPreviewCanvas = useCallback(() => {
    const state = stateRef.current;
    if (!state.previewContext || !state.previewTarget || !state.previewBlitMaterial) return;

    const activeLayer = layers.find(l => l.id === activeLayerId);
    const previewChannel = activeLayer ? activeLayer.mapType : 'albedo';
    const source = state.pbrTargets[previewChannel as PBRMapType] || state.pbrTargets.albedo;
    if (!source) return;

    const size = 512;
    const renderer = gl;
    const oldRT = renderer.getRenderTarget();
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();
    
    renderer.setRenderTarget(state.previewTarget);
    gl.setClearColor(0x000000, 1);
    gl.clear();

    state.previewBlitMaterial.map = source.texture;
    state.compositeQuad.material = state.previewBlitMaterial;
    
    // Safe render for preview without affecting main scene objects
    const oldQuadScale = state.compositeQuad.scale.clone();
    state.compositeQuad.scale.set(1, -1, 1);
    renderer.render(state.compositeScene, state.compositeCamera);
    state.compositeQuad.scale.copy(oldQuadScale);
    
    // Read pixels
    const pixelBuffer = new Uint8Array(size * size * 4);
    gl.readRenderTargetPixels(state.previewTarget, 0, 0, size, size, pixelBuffer);
    
    const imageData = new ImageData(new Uint8ClampedArray(pixelBuffer), size, size);
    state.previewContext.putImageData(imageData, 0, 0);

    renderer.setRenderTarget(oldRT);
    gl.setClearColor(oldClearColor, oldClearAlpha);
    
    (state.previewCanvas as any).version = ((state.previewCanvas as any).version || 0) + 1;
  }, [gl, activeLayerId, layers]);

  // Check if a layer is visible by traversing up its folder parents
  const isLayerVisuallyVisible = useCallback((layer: GPULayer, allLayers: GPULayer[]) => {
    if (!layer.visible) return false;
    
    let current = layer;
    const visited = new Set<string>([layer.id]);
    
    while (current.parentId) {
      if (visited.has(current.parentId)) break; // Cycle detection
      
      const parentId = current.parentId;
      const parent = allLayers.find(l => l.id === parentId);
      
      if (!parent) break;
      if (!parent.visible) return false;
      
      visited.add(parentId);
      current = parent;
    }
    return true;
  }, []);

  // ---- RAF Compositor ----
  const compositeAllLayers = useCallback(() => {
    const state = stateRef.current;
    const compositeLayers = state.layers;
    if (!state.compositeTarget || compositeLayers.length === 0) return;

    const oldRT = gl.getRenderTarget();
    const oldAutoClear = gl.autoClear;
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();

    // --- Render UV Mask if needed ---
    if (state.needsUVMaskUpdate && state.uvMaskTarget) {
      gl.setRenderTarget(state.uvMaskTarget);
      gl.setClearColor(0x000000, 1);
      gl.clear();
      const oldMat = state.decalMesh.material;
      state.decalMesh.material = state.uvMaskMaterial;
      
      if (groupRef.current) {
        groupRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh && child.visible) {
            state.decalMesh.geometry = child.geometry;
            gl.render(state.decalScene, state.decalCamera);
          }
        });
      }

      state.decalMesh.material = oldMat;
      state.needsUVMaskUpdate = false;
      gl.setRenderTarget(oldRT);
    }

    // --- Scissor Testing Optimization ---
    const useScissor = state.strokeBBox.maxX >= state.strokeBBox.minX;
    if (useScissor) {
      // Use cumulative bbox for full refresh frames, or frame-specific for active painting
      const bbox = state.isPainting ? state.frameStrokeBBox : state.strokeBBox;
      
      const margin = state.isPainting ? 8 : 32; // Smaller margin during interaction
      const uvMargin = margin / state.textureSize;
      const x = Math.floor(Math.max(0, bbox.minX - uvMargin) * state.textureSize);
      const y = Math.floor(Math.max(0, bbox.minY - uvMargin) * state.textureSize);
      const w = Math.ceil(Math.min(1, bbox.maxX + uvMargin) * state.textureSize) - x;
      const h = Math.ceil(Math.min(1, bbox.maxY + uvMargin) * state.textureSize) - y;
      gl.setScissorTest(true);
      gl.setScissor(x, y, Math.max(1, w), Math.max(1, h));
    }

    // --- Channel-based Compositing ---
    const channelsToUpdate = Array.from(state.dirtyChannels);
    if (channelsToUpdate.length === 0) {
      gl.setScissorTest(false);
      gl.autoClear = oldAutoClear;
      gl.setClearColor(oldClearColor, oldClearAlpha);
      gl.setRenderTarget(oldRT);
      state.needsComposite = false;
      if (state.staggerStep === 1) state.staggerStep = 2;
      return;
    }

    for (const channel of channelsToUpdate) {
      if (!state.compositeTarget || !state.compositeTargetB) continue;
      
      let currentSrc = state.compositeTarget;
      let currentDst = state.compositeTargetB;

      // Clear initial background for channel
      gl.setRenderTarget(currentSrc);
      if (channel === 'metalness' || channel === 'emissive') {
        gl.setClearColor(0x000000, 1);
      } else if (channel === 'roughness') {
        gl.setClearColor(0x999999, 1); // standard roughness 0.6ish
      } else if (channel === 'alpha') {
        gl.setClearColor(0xffffff, 1); // Full opaque base
      } else if (channel === 'bump') {
        gl.setClearColor(0x000000, 1); // Bump neutral is black
      } else {
        gl.setClearColor(0xffffff, 1);
      }
      gl.clear();

      // Render layers back-to-front
      for (let i = compositeLayers.length - 1; i >= 0; i--) {
        const layer = compositeLayers[i];
        if (layer.mapType !== channel || layer.isFolder || !layer.target) continue;
        if (!isLayerVisuallyVisible(layer, compositeLayers)) continue;
        
        let mat = state.compositeMaterials.get(layer.id);
        if (!mat) {
          mat = new CompositeShaderMaterial();
          state.compositeMaterials.set(layer.id, mat);
        }
        
        gl.setRenderTarget(currentDst);
        gl.clear();

        if (layer.maskEnabled && layer.maskTarget) {
            let layerTex = layer.target.texture;
            if (state.isUsingProxy && layer.id === activeLayerId && state.strokeProxyTarget) {
                layerTex = state.strokeProxyTarget.texture;
            }
            mat.setLayerMasked(layerTex, currentSrc.texture, layer.maskTarget.texture, layer.opacity, layer.blendMode, layer.intensity || 1.0);
        } else {
            let layerTex = layer.target.texture;
            if (state.isUsingProxy && layer.id === activeLayerId && state.strokeProxyTarget) {
                layerTex = state.strokeProxyTarget.texture;
            }
            mat.setLayer(layerTex, currentSrc.texture, layer.opacity, layer.blendMode, layer.intensity || 1.0);
        }

        state.compositeQuad.material = mat;
        gl.render(state.compositeScene, state.compositeCamera);

        const temp = currentSrc;
        currentSrc = currentDst;
        currentDst = temp;
      }

      // Store result in PBR target
      const targetRT = state.pbrTargets[channel];
      if (!targetRT) continue;
      
      // Run Dilation for this channel
      if (state.uvMaskTarget) {
          gl.setRenderTarget(targetRT);
          
          if (state.isPainting) {
            // SKIP HEAVY DILATION DURING ACTIVE STROKE
            // Just blit the composite result directly for speed
            const blitMat = new THREE.MeshBasicMaterial({ map: currentSrc.texture, transparent: true, blending: THREE.NoBlending });
            state.compositeQuad.material = blitMat;
            gl.render(state.compositeScene, state.compositeCamera);
            blitMat.dispose();
          } else {
            // Run high-quality 16px dilation ONLY on idle frames (staggerStep/stopPainting)
            const currentRadius = 16.0;
            state.dilationMaterial.setMap(currentSrc.texture, (state.uvMaskTarget as THREE.WebGLRenderTarget).texture, state.textureSize, state.textureSize, currentRadius);
            state.compositeQuad.material = state.dilationMaterial;
            gl.render(state.compositeScene, state.compositeCamera);
          }
      } else {
          // Blit directly if no UV mask
          gl.setRenderTarget(targetRT);
          const blitMat = new THREE.MeshBasicMaterial({ map: currentSrc.texture, transparent: true, blending: THREE.NoBlending });
          state.compositeQuad.material = blitMat;
          gl.render(state.compositeScene, state.compositeCamera);
          blitMat.dispose();
      }
    }

    state.dirtyChannels.clear();
    state.lastCompositeResult = state.pbrTargets.albedo; 
    
    gl.setScissorTest(false);
    gl.autoClear = oldAutoClear;
    gl.setClearColor(oldClearColor, oldClearAlpha);
    gl.setRenderTarget(oldRT);
    state.needsComposite = false;
    // Reset frame-specific bbox for the next animation frame
    state.frameStrokeBBox = { minX: 1, minY: 1, maxX: 0, maxY: 0 };
    if (state.staggerStep === 1) state.staggerStep = 2;
  }, [gl, isLayerVisuallyVisible, syncPreviewCanvas, activeLayerId]);

  useEffect(() => {
    let animId: number;
    const loop = () => {
      const state = stateRef.current;
      if (state.needsComposite) {
        compositeAllLayers();
      } else if (state.staggerStep === 2) {
        // Run sync on a separate frame after dilation to prevent single-frame spikes
        syncPreviewCanvas();
        state.staggerStep = 0;
      }
      animId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animId);
  }, [compositeAllLayers, syncPreviewCanvas]);
  useEffect(() => {
    return () => {
      const state = stateRef.current;
      state.compositeTarget?.dispose();
      state.compositeTargetB?.dispose();
      state.dilatedTarget?.dispose();
      state.uvMaskTarget?.dispose();
      state.previewTarget?.dispose();
      state.brushMaterial.dispose();
      state.uvMaskMaterial.dispose();
      state.dilationMaterial.dispose();
      state.previewBlitMaterial?.dispose();
      state.compositeMaterials.forEach(m => m.dispose());
    };
  }, []);


  // Sync geometry UV masks when parts change
  useEffect(() => {
    stateRef.current.needsUVMaskUpdate = true;
    markChannelDirty('all');
  }, [groupRef, markChannelDirty, ...updateDependencies]);
  
  // Load Texture Mask on Demand
  useEffect(() => {
    if (brushSettings.type === 'texture' && brushSettings.textureId) {
      const state = stateRef.current;
      if (!state.textureCache.has(brushSettings.textureId)) {
        new THREE.TextureLoader().load(brushSettings.textureId, (tex) => {
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          state.textureCache.set(brushSettings.textureId!, tex);
        });
      }
    }
  }, [brushSettings.type, brushSettings.textureId]);


  const addFolder = useCallback((nameArg: any = 'New Folder') => {
    const name = (typeof nameArg === 'string') ? nameArg : 'New Folder';
    const newFolder: GPULayer = {
      id: THREE.MathUtils.generateUUID(),
      name,
      visible: true,
      opacity: 1,
      blendMode: 0,
      target: null,
      isFolder: true,
      mapType: 'albedo'
    };

    setLayers(prev => {
      const updated = [newFolder, ...prev];
      stateRef.current.layers = updated;
      markChannelDirty('all'); // Folders can affect everything below
      return updated;
    });
  }, [markChannelDirty]);

  // ---- Missing Layer Operations ----
  const removeLayer = useCallback((id: string) => {
    setLayers(prev => {
      const layerToRemove = prev.find(l => l.id === id);
      if (!layerToRemove) return prev;

      // If it's a folder, we also remove its children
      let idsToRemove = [id];
      if (layerToRemove.isFolder) {
        const getChildren = (parentId: string): string[] => {
          const children = prev.filter(l => l.parentId === parentId);
          let childIds = children.map(c => c.id);
          children.forEach(c => {
            if (c.isFolder) childIds = [...childIds, ...getChildren(c.id)];
          });
          return childIds;
        };
        idsToRemove = [...idsToRemove, ...getChildren(id)];
      }

      const remaining = prev.filter(l => !idsToRemove.includes(l.id));
      stateRef.current.layers = remaining;
      
      prev.forEach(l => {
        if (idsToRemove.includes(l.id)) {
          if (l.target) l.target.dispose();
          if (l.maskTarget) l.maskTarget.dispose();
        }
      });
      
      if (activeLayerId && idsToRemove.includes(activeLayerId)) {
        if (remaining.length > 0) {
          // Find first non-folder layer to activate
          const firstLayer = remaining.find(l => !l.isFolder);
          setActiveLayerId(firstLayer ? firstLayer.id : null);
        } else {
          setActiveLayerId(null);
        }
      }
      markChannelDirty('all');
      return remaining;
    });
  }, [activeLayerId, markChannelDirty]);

  const updateLayer = useCallback((id: string, updates: Partial<GPULayer>) => {
    setLayers(prev => {
      const target = prev.find(l => l.id === id);
      const updated = prev.map(l => (l.id === id ? { ...l, ...updates } : l));
      stateRef.current.layers = updated;
      
      if (target && (
        updates.visible !== undefined || 
        updates.opacity !== undefined || 
        updates.blendMode !== undefined || 
        updates.parentId !== undefined || 
        updates.maskEnabled !== undefined ||
        updates.intensity !== undefined ||
        updates.mapType !== undefined
      )) {
        if (updates.mapType !== undefined) {
          markChannelDirty(target.mapType);
          markChannelDirty(updates.mapType);
        } else {
          markChannelDirty(target.mapType);
        }
      }
      return updated;
    });
  }, [markChannelDirty]);

  const createLayerMask = useCallback((id: string) => {
    const state = stateRef.current;
    
    setLayers(prev => {
      const layer = prev.find(l => l.id === id);
      if (!layer || layer.maskTarget) return prev;
      
      const newMaskTarget = new THREE.WebGLRenderTarget(state.textureSize, state.textureSize, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        generateMipmaps: false,
      });

      const oldRT = gl.getRenderTarget();
      const oldClearColor = gl.getClearColor(new THREE.Color());
      const oldClearAlpha = gl.getClearAlpha();

      gl.setRenderTarget(newMaskTarget);
      gl.setClearColor(0xffffff, 1); // White means fully visible
      gl.clear();
      gl.setRenderTarget(oldRT);
      gl.setClearColor(oldClearColor, oldClearAlpha);

      const updated = prev.map(l => 
        l.id === id ? { ...l, maskTarget: newMaskTarget, maskEnabled: true, isEditingMask: true } : l
      );
      state.layers = updated;
      markChannelDirty(id === activeLayerId ? (prev.find(l=>l.id===id)?.mapType || 'albedo') : 'all');
      return updated;
    });
  }, [gl]);

  const deleteLayerMask = useCallback((id: string) => {
    setLayers(prev => {
      const layer = prev.find(l => l.id === id);
      if (!layer || !layer.maskTarget) return prev;
      
      layer.maskTarget.dispose();
      
      const updated = prev.map(l => 
        l.id === id ? { ...l, maskTarget: null, maskEnabled: false, isEditingMask: false } : l
      );
      stateRef.current.layers = updated;
      stateRef.current.needsComposite = true;
      return updated;
    });
  }, []);

  const toggleLayerMask = useCallback((id: string) => {
    setLayers(prev => {
      const layer = prev.find(l => l.id === id);
      if (!layer || !layer.maskTarget) return prev; // Cannot toggle if no mask exists

      const updated = prev.map(l => 
        l.id === id ? { ...l, maskEnabled: !l.maskEnabled } : l
      );
      stateRef.current.layers = updated;
      stateRef.current.needsComposite = true;
      return updated;
    });
  }, []);

  const setEditingMask = useCallback((id: string, isEditingMask: boolean) => {
    setLayers(prev => {
      const updated = prev.map(l => 
        l.id === id ? { ...l, isEditingMask } : l
      );
      stateRef.current.layers = updated;
      return updated;
    });
  }, []);

  const moveLayer = useCallback((id: string, direction: 'up' | 'down') => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0) return prev;
      let next = [...prev];
      if (direction === 'up' && idx > 0) {
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      } else if (direction === 'down' && idx < prev.length - 1) {
        [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      }
      stateRef.current.layers = next;
      markChannelDirty('all');
      return next;
    });
  }, []);

  const reorderLayer = useCallback((sourceId: string, targetId: string | null, newParentId?: string) => {
    setLayers(prev => {
      const sourceIdx = prev.findIndex(l => l.id === sourceId);
      if (sourceIdx < 0) return prev;
      
      const newLayers = [...prev];
      const sourceLayer = newLayers[sourceIdx];
      
      // Prevent nesting folders or putting folders inside layers
      const updatedParentId = sourceLayer.isFolder ? undefined : newParentId;
      
      const [movedLayer] = newLayers.splice(sourceIdx, 1);
      movedLayer.parentId = updatedParentId || undefined;
      
      if (targetId === null) {
        newLayers.push(movedLayer);
      } else {
        const targetIdx = newLayers.findIndex(l => l.id === targetId);
        const targetLayer = newLayers[targetIdx];
        
        // If dropping ON a folder AND specify it as parent, place it AFTER (inside)
        if (targetLayer.isFolder && newParentId === targetId) {
          newLayers.splice(targetIdx + 1, 0, movedLayer);
        } else {
          // Place BEFORE the target (useful for ejecting or simple reordering)
          newLayers.splice(targetIdx, 0, movedLayer);
        }
      }
      
      stateRef.current.layers = newLayers;
      stateRef.current.needsComposite = true;
      return newLayers;
    });
  }, []);

  const mergeLayer = useCallback((id: string) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0 || idx === prev.length - 1) return prev; 

      // Find the next layer below that is not a folder
      let nextBelowIdx = -1;
      for (let i = idx + 1; i < prev.length; i++) {
        if (!prev[i].isFolder) {
          nextBelowIdx = i;
          break;
        }
      }

      if (nextBelowIdx === -1) return prev;

      const topLayer = prev[idx];
      const bottomLayer = prev[nextBelowIdx];

      if (!topLayer.target || !bottomLayer.target) return prev;

      // Ensure we are working on the bottom layer for undo
      const oldActiveId = activeLayerId;
      setActiveLayerId(bottomLayer.id);
      saveUndoState();
      
      const oldRT = gl.getRenderTarget();
      gl.setRenderTarget(bottomLayer.target);
      const oldAutoClear = gl.autoClear;
      gl.autoClear = false;

      let mat = stateRef.current.compositeMaterials.get(topLayer.id);
      if (!mat) {
        mat = new CompositeShaderMaterial();
        stateRef.current.compositeMaterials.set(topLayer.id, mat);
      }
      
      if (topLayer && topLayer.target) {
        if (topLayer.maskEnabled && topLayer.maskTarget) {
          mat.setLayerMasked(topLayer.target.texture, bottomLayer.target.texture, topLayer.maskTarget.texture, topLayer.opacity, topLayer.blendMode as any);
        } else {
          mat.setLayer(topLayer.target.texture, bottomLayer.target.texture, topLayer.opacity, topLayer.blendMode as any);
        }
      }

      stateRef.current.compositeQuad.material = mat;
      gl.render(stateRef.current.compositeScene, stateRef.current.compositeCamera);
      
      gl.autoClear = oldAutoClear;
      gl.setRenderTarget(oldRT);

      // Clean up top layer
      topLayer.target.dispose();
      if (topLayer.maskTarget) topLayer.maskTarget.dispose();

      const updated = prev.filter(l => l.id !== id);
      stateRef.current.layers = updated;
      stateRef.current.needsComposite = true;
      
      // If we merged the active layer, set the bottom one as active
      if (oldActiveId === id) {
        setActiveLayerId(bottomLayer.id);
      } else {
        setActiveLayerId(oldActiveId);
      }

      return updated;
    });
  }, [gl, saveUndoState, activeLayerId]);

  const mergeFolder = useCallback((folderId: string) => {
    setLayers(prev => {
      const folder = prev.find(l => l.id === folderId);
      if (!folder || !folder.isFolder) return prev;

      const children = prev.filter(l => l.parentId === folderId && !l.isFolder);
      if (children.length === 0) {
        return prev.filter(l => l.id !== folderId);
      }

      const state = stateRef.current;
      const mergedTarget = new THREE.WebGLRenderTarget(state.textureSize, state.textureSize, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        generateMipmaps: false,
      });

      const oldRT = gl.getRenderTarget();
      const oldClearColor = gl.getClearColor(new THREE.Color());
      const oldClearAlpha = gl.getClearAlpha();

      gl.setRenderTarget(mergedTarget);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      
      const oldAutoClear = gl.autoClear;
      gl.autoClear = false;

      // Composite visible children back-to-front
      const sortedChildren = [...children].reverse();
      let currentResult = new THREE.WebGLRenderTarget(state.textureSize, state.textureSize); // Temporary base
      const dummyRT = new THREE.WebGLRenderTarget(state.textureSize, state.textureSize);
      
      gl.setRenderTarget(currentResult);
      gl.setClearColor(0x000000, 0);
      gl.clear();

      for (const child of sortedChildren) {
          if (!child.target || !child.visible) continue;
          let mat = state.compositeMaterials.get(child.id);
          if (!mat) {
            mat = new CompositeShaderMaterial();
            state.compositeMaterials.set(child.id, mat);
          }
          
          gl.setRenderTarget(dummyRT);
          gl.clear();

          if (child.maskEnabled && child.maskTarget) {
            mat.setLayerMasked(child.target.texture, currentResult.texture, child.maskTarget.texture, child.opacity, child.blendMode);
          } else {
            mat.setLayer(child.target.texture, currentResult.texture, child.opacity, child.blendMode);
          }
          state.compositeQuad.material = mat;
          gl.render(state.compositeScene, state.compositeCamera);
          
          // Copy dummyRT to currentResult
          gl.setRenderTarget(mergedTarget);
          gl.clear();
          const blitMat = new THREE.MeshBasicMaterial({ map: dummyRT.texture, transparent: true });
          state.compositeQuad.material = blitMat;
          gl.render(state.compositeScene, state.compositeCamera);
          
          // For the next iteration, mergedTarget is the new background
          // This is a bit inefficient for one-off merge, but keeps logic consistent
          gl.setRenderTarget(currentResult);
          gl.clear();
          gl.render(state.compositeScene, state.compositeCamera);
          blitMat.dispose();
      }
      
      currentResult.dispose();
      dummyRT.dispose();

      gl.autoClear = oldAutoClear;
      gl.setRenderTarget(oldRT);
      gl.setClearColor(oldClearColor, oldClearAlpha);

      const newLayer: GPULayer = {
        id: THREE.MathUtils.generateUUID(),
        name: folder.name + " (Merged)",
        visible: true,
        opacity: 1,
        blendMode: 0, // Normal
        target: mergedTarget,
        mapType: folder.mapType,
        maskTarget: null,
        maskEnabled: false,
        isEditingMask: false,
        parentId: folder.parentId
      };

      const childIds = children.map(c => c.id);
      const folderIdx = prev.findIndex(l => l.id === folderId);
      
      const idsToRemove = [folderId, ...childIds];
      const finalLayers: GPULayer[] = [];
      let inserted = false;
      
      for (let i = 0; i < prev.length; i++) {
        if (i === folderIdx) {
           finalLayers.push(newLayer);
           inserted = true;
        }
        if (!idsToRemove.includes(prev[i].id)) {
           finalLayers.push(prev[i]);
        }
      }
      
      if (!inserted) finalLayers.unshift(newLayer);

      children.forEach(c => {
        if (c.target) c.target.dispose();
        if (c.maskTarget) c.maskTarget.dispose();
      });

      stateRef.current.layers = finalLayers;
      markChannelDirty('all');
      setActiveLayerId(newLayer.id);
      return finalLayers;
    });
  }, [gl]);

  const clearCanvas = useCallback(() => {
    const active = getActiveLayer();
    if (!active) return;
    saveUndoState();

    const targetRT = (active.isEditingMask && active.maskTarget) ? active.maskTarget : active.target;
    if (!targetRT) return;

    const oldRT = gl.getRenderTarget();
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();

    gl.setRenderTarget(targetRT);
    
    // For masks, a clear sets alpha to 0 (fully hidden)
    // For layers, a clear sets also to transparent black so the white background shows through
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.setRenderTarget(oldRT);
    gl.setClearColor(oldClearColor, oldClearAlpha);

    markChannelDirty(active.mapType);
  }, [getActiveLayer, saveUndoState, gl]);

  const fillCanvas = useCallback(() => {
    const active = getActiveLayer();
    if (!active) return;
    saveUndoState();

    const targetRT = (active.isEditingMask && active.maskTarget) ? active.maskTarget : active.target;
    if (!targetRT) return;

    const oldRT = gl.getRenderTarget();
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();

    gl.setRenderTarget(targetRT);
    
    if (active.isEditingMask) {
      gl.setClearColor(0xffffff, 1); // White means fully visible
    } else {
      gl.setClearColor(brushSettings.color, brushSettings.opacity);
    }
    
    gl.clear();
    gl.setRenderTarget(oldRT);
    gl.setClearColor(oldClearColor, oldClearAlpha);

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
    markChannelDirty(active.mapType);
  }, [getActiveLayer, saveUndoState, gl, brushSettings, markChannelDirty]);

  const restoreSnapshotToLayer = useCallback((layerId: string, sourceTarget: THREE.WebGLRenderTarget, isMask: boolean) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    const targetToRestore = isMask ? layer.maskTarget : layer.target;
    if (!targetToRestore) return;

    const oldRT = gl.getRenderTarget();
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();

    gl.setRenderTarget(targetToRestore);
    // Masks clear to alpha 0 = fully hidden, colors clear to 0
    gl.setClearColor(0x000000, 0);
    gl.clear();

    const blitMat = new THREE.MeshBasicMaterial({ 
      map: sourceTarget.texture, 
      depthTest: false, 
      depthWrite: false,
      transparent: true,
      blending: THREE.NoBlending
    });
    const oldMat = stateRef.current.compositeQuad.material;
    stateRef.current.compositeQuad.material = blitMat;

    gl.render(stateRef.current.compositeScene, stateRef.current.compositeCamera);

    stateRef.current.compositeQuad.material = oldMat;
    blitMat.dispose();

    gl.setRenderTarget(oldRT);
    gl.setClearColor(oldClearColor, oldClearAlpha);
    markChannelDirty(layer.mapType);
  }, [layers, gl, markChannelDirty]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    
    const step = undoStackRef.current.pop();
    if (!step) return;

    const activeLayer = layers.find(l => l.id === step.layerId);
    if (!activeLayer) return;

    // Save current to redo before undoing
    const targetToClone = step.isMask ? activeLayer.maskTarget : activeLayer.target;
    if (targetToClone) {
        const currentState = cloneTarget(targetToClone);
        redoStackRef.current.push({ layerId: activeLayer.id, target: currentState, isMask: step.isMask });
    }

    restoreSnapshotToLayer(step.layerId, step.target, step.isMask);
    step.target.dispose(); // clean up memory after use
  }, [layers, cloneTarget, restoreSnapshotToLayer]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    
    const step = redoStackRef.current.pop();
    if (!step) return;

    const activeLayer = layers.find(l => l.id === step.layerId);
    if (!activeLayer) return;

    // Save current to undo before redoing
    const targetToClone = step.isMask ? activeLayer.maskTarget : activeLayer.target;
    if (targetToClone) {
        const currentState = cloneTarget(targetToClone);
        undoStackRef.current.push({ layerId: activeLayer.id, target: currentState, isMask: step.isMask });
    }

    restoreSnapshotToLayer(step.layerId, step.target, step.isMask);
    step.target.dispose();
  }, [layers, cloneTarget, restoreSnapshotToLayer]);

  const exportTexture = useCallback((format: 'png' | 'jpeg') => {
    const state = stateRef.current;
    if (!state.compositeTarget) return null;

    const oldRT = gl.getRenderTarget();
    const oldAutoClear = gl.autoClear;
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();
    gl.autoClear = false;

    // --- Reuse main compositing logic concepts ---
    let currentSrc = new THREE.WebGLRenderTarget(state.textureSize, state.textureSize, { format: THREE.RGBAFormat });
    let currentDst = new THREE.WebGLRenderTarget(state.textureSize, state.textureSize, { format: THREE.RGBAFormat });

    gl.setRenderTarget(currentSrc);
    gl.setClearColor(format === 'png' ? 0x000000 : 0xffffff, format === 'png' ? 0 : 1);
    gl.clear();

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible || layer.isFolder || !layer.target) continue;
      
      let mat = state.compositeMaterials.get(layer.id);
      if (mat) {
          gl.setRenderTarget(currentDst);
          gl.clear();
          if (layer.maskEnabled && layer.maskTarget) {
            mat.setLayerMasked(layer.target.texture, currentSrc.texture, layer.maskTarget.texture, layer.opacity, layer.blendMode as any);
          } else {
            mat.setLayer(layer.target.texture, currentSrc.texture, layer.opacity, layer.blendMode as any);
          }
        
        state.compositeQuad.material = mat;
        gl.render(state.compositeScene, state.compositeCamera);

        const temp = currentSrc;
        currentSrc = currentDst;
        currentDst = temp;
      }
    }
    
    // Final result is in currentSrc, copy to state.compositeTarget for legacy reasons/dilation
    gl.setRenderTarget(state.compositeTarget);
    gl.clear();
    const finalBlit = new THREE.MeshBasicMaterial({ map: currentSrc.texture, transparent: true });
    state.compositeQuad.material = finalBlit;
    gl.render(state.compositeScene, state.compositeCamera);
    finalBlit.dispose();
    currentSrc.dispose();
    currentDst.dispose();

    // Run dilation on this new composite
    if (state.uvMaskTarget) {
      gl.setRenderTarget(state.dilatedTarget);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      state.dilationMaterial.setMap(state.compositeTarget.texture, state.uvMaskTarget.texture, state.textureSize, state.textureSize, 16.0);
      state.compositeQuad.material = state.dilationMaterial;
      gl.render(state.compositeScene, state.compositeCamera);
    }

    const width = state.textureSize;
    const height = state.textureSize;
    const buffer = new Uint8Array(width * height * 4);
    
    gl.readRenderTargetPixels(state.dilatedTarget!, 0, 0, width, height, buffer);
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      gl.setRenderTarget(oldRT);
      gl.autoClear = oldAutoClear;
      gl.setClearColor(oldClearColor, oldClearAlpha);
      return null;
    }
    
    const imgData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    ctx.putImageData(imgData, 0, 0);

    // WebGL readPixels is upside down compared to Canvas 2D
    const flipCanvas = document.createElement('canvas');
    flipCanvas.width = width;
    flipCanvas.height = height;
    const flipCtx = flipCanvas.getContext('2d');
    let finalDataUrl = '';
    
    if (flipCtx) {
      flipCtx.translate(0, height);
      flipCtx.scale(1, -1);
      flipCtx.drawImage(canvas, 0, 0);
      finalDataUrl = flipCanvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png');
    } else {
      finalDataUrl = canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png');
    }

    gl.setRenderTarget(oldRT);
    gl.autoClear = oldAutoClear;
    gl.setClearColor(oldClearColor, oldClearAlpha);
    
    // Trigger a normal composite update for the viewport after we messed with the target
    markChannelDirty('all');

    return finalDataUrl;
  }, [gl, layers]);

  const exportProjectLayersData = useCallback(async () => {
    return new Promise<any[]>((resolve, reject) => {
      setTimeout(() => {
        try {
          const state = stateRef.current;
          const width = state.textureSize;
          const height = state.textureSize;
          const buffer = new Uint8Array(width * height * 4);
          
          const exportTarget = (target: THREE.WebGLRenderTarget) => {
            const oldRT = gl.getRenderTarget();
            const oldAutoClear = gl.autoClear;
            const oldClearColor = gl.getClearColor(new THREE.Color());
            const oldClearAlpha = gl.getClearAlpha();
            
            gl.setRenderTarget(target);
            gl.readRenderTargetPixels(target, 0, 0, width, height, buffer);
            gl.setRenderTarget(oldRT);
            gl.autoClear = oldAutoClear;
            gl.setClearColor(oldClearColor, oldClearAlpha);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const tempCtx = tempCanvas.getContext('2d');
            
            const tempFlipCanvas = document.createElement('canvas');
            tempFlipCanvas.width = width;
            tempFlipCanvas.height = height;
            const tempFlipCtx = tempFlipCanvas.getContext('2d');

            if (!tempCtx || !tempFlipCtx) return undefined;

            const imgData = new ImageData(new Uint8ClampedArray(buffer), width, height);
            tempCtx.putImageData(imgData, 0, 0);

            tempFlipCtx.clearRect(0, 0, width, height);
            tempFlipCtx.save();
            tempFlipCtx.translate(0, height);
            tempFlipCtx.scale(1, -1);
            tempFlipCtx.drawImage(tempCanvas, 0, 0);
            tempFlipCtx.restore();

            return tempFlipCanvas.toDataURL('image/png');
          };

          const layersData = state.layers.map(l => ({
            id: l.id,
            name: l.name,
            visible: l.visible,
            opacity: l.opacity,
            intensity: l.intensity || 1,
            blendMode: l.blendMode,
            isFolder: !!l.isFolder,
            parentId: l.parentId,
            maskEnabled: l.maskEnabled,
            mapType: l.mapType,
            hasMask: !!l.maskTarget,
            targetBlobUrl: l.target ? exportTarget(l.target) : undefined,
            maskBlobUrl: l.maskTarget ? exportTarget(l.maskTarget) : undefined
          }));
          
          resolve(layersData);
        } catch (error) {
          reject(error);
        }
      }, 10);
    });
  }, [gl]);

  const importProjectLayersData = useCallback(async (layersData: any[], onProgress?: (progress: number) => void) => {
    const state = stateRef.current;
    
    // Cleanup existing layers
    state.layers.forEach(l => {
        if(l.target) l.target.dispose();
        if(l.maskTarget) l.maskTarget.dispose();
    });
    
    const newLayers: GPULayer[] = [];
    const size = state.textureSize;
    const oldRT = gl.getRenderTarget();
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();

    const totalSteps = layersData.length * 2; // target and mask for each layer
    let completedSteps = 0;

    const reportProgress = () => {
      if (onProgress) {
        onProgress((completedSteps / totalSteps) * 100);
      }
    };

    for (const lData of layersData) {
        const targetOpts = {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          generateMipmaps: false,
        };
        
        let target: THREE.WebGLRenderTarget | null = null;
        let maskTarget: THREE.WebGLRenderTarget | null = null;
        
        if (!lData.isFolder) {
            target = new THREE.WebGLRenderTarget(size, size, targetOpts);
            if (lData.targetBlobUrl) {
               await new Promise<void>((resolve) => {
                 const img = new Image();
                 img.onload = () => {
                    const tempRT = gl.getRenderTarget();
                    const oldAutoClear = gl.autoClear;
                    const tempOldClearColor = gl.getClearColor(new THREE.Color());
                    const tempOldClearAlpha = gl.getClearAlpha();
                    gl.autoClear = false;

                    gl.setRenderTarget(target!);
                    gl.setClearColor(0x000000, 0);
                    gl.clear();
                    
                    const tex = new THREE.Texture(img);
                    tex.needsUpdate = true;
                    tex.minFilter = THREE.LinearFilter;
                    tex.magFilter = THREE.LinearFilter;
                    tex.flipY = true; 

                    const mat = new THREE.MeshBasicMaterial({ 
                      map: tex, 
                      depthTest: false, 
                      depthWrite: false, 
                      transparent: true,
                      blending: THREE.NoBlending
                    });
                     
                    const oldMat = state.compositeQuad.material;
                    state.compositeQuad.material = mat;
                    gl.render(state.compositeScene, state.compositeCamera);
                    state.compositeQuad.material = oldMat;
                    
                    mat.dispose();
                    tex.dispose();

                    gl.setRenderTarget(tempRT);
                    gl.autoClear = oldAutoClear;
                    gl.setClearColor(tempOldClearColor, tempOldClearAlpha);
                    completedSteps++;
                    reportProgress();
                    resolve();
                 };
                 img.src = lData.targetBlobUrl;
               });
            } else {
               gl.setRenderTarget(target);
               gl.setClearColor(0x000000, 0);
               gl.clear();
               completedSteps++;
               reportProgress();
            }
        } else {
          completedSteps++; // Folders count as one step too for simplicity
          reportProgress();
        }
        
        if (lData.hasMask) {
            maskTarget = new THREE.WebGLRenderTarget(size, size, targetOpts);
            if (lData.maskBlobUrl) {
                await new Promise<void>((resolve) => {
                 const img = new Image();
                 img.onload = () => {
                    const tempRT = gl.getRenderTarget();
                    const oldAutoClear = gl.autoClear;
                    const tempOldClearColor = gl.getClearColor(new THREE.Color());
                    const tempOldClearAlpha = gl.getClearAlpha();
                    gl.autoClear = false;

                    gl.setRenderTarget(maskTarget!);
                    gl.setClearColor(0x000000, 0);
                    gl.clear();

                    const tex = new THREE.Texture(img);
                    tex.needsUpdate = true;
                    tex.minFilter = THREE.LinearFilter;
                    tex.magFilter = THREE.LinearFilter;
                    tex.flipY = true;

                    const mat = new THREE.MeshBasicMaterial({ 
                      map: tex, 
                      depthTest: false, 
                      depthWrite: false, 
                      transparent: true,
                      blending: THREE.NoBlending
                    });
                    
                    const oldMat = state.compositeQuad.material;
                    state.compositeQuad.material = mat;
                    gl.render(state.compositeScene, state.compositeCamera);
                    state.compositeQuad.material = oldMat;
                    
                    mat.dispose();
                    tex.dispose();

                    gl.setRenderTarget(tempRT);
                    gl.autoClear = oldAutoClear;
                    gl.setClearColor(tempOldClearColor, tempOldClearAlpha);
                    completedSteps++;
                    reportProgress();
                    resolve();
                 };
                 img.src = lData.maskBlobUrl;
               });
            } else {
               gl.setRenderTarget(maskTarget);
               gl.setClearColor(0x000000, 0);
               gl.clear();
               completedSteps++;
               reportProgress();
            }
        } else {
          completedSteps++;
          reportProgress();
        }
        
        newLayers.push({
            id: lData.id,
            name: lData.name,
            visible: lData.visible,
            opacity: lData.opacity,
            intensity: lData.intensity || 1,
            blendMode: lData.blendMode,
            isFolder: lData.isFolder,
            parentId: lData.parentId,
            maskEnabled: lData.maskEnabled,
            target,
            maskTarget,
            mapType: lData.mapType || 'albedo',
            isEditingMask: false
        });
    }
    
    gl.setRenderTarget(oldRT);
    gl.setClearColor(oldClearColor, oldClearAlpha);
    
    if (newLayers.length === 0) {
        addLayer('Base Layer');
    } else {
        setLayers(newLayers);
        setActiveLayerId(newLayers.find(l => !l.isFolder)?.id || newLayers[0].id);
        state.layers = newLayers;
        state.needsComposite = true;
    }
  }, [gl, addLayer]);

  const sampleColor = useCallback((intersection: THREE.Intersection) => {
    const state = stateRef.current;
    if (!state.dilatedTarget || !intersection.uv) return '#ffffff';

    const width = state.textureSize;
    const height = state.textureSize;
    const x = Math.floor(intersection.uv.x * width);
    const y = Math.floor(intersection.uv.y * height);
    
    const buffer = new Uint8Array(4);
    gl.readRenderTargetPixels(state.dilatedTarget, x, y, 1, 1, buffer);
    
    const r = buffer[0].toString(16).padStart(2, '0');
    const g = buffer[1].toString(16).padStart(2, '0');
    const b = buffer[2].toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }, [gl]);

  const renderGradient = useCallback((start: THREE.Vector3, end: THREE.Vector3) => {
    const state = stateRef.current;
    const activeLayer = state.layers.find(l => l.id === activeLayerId);
    if (!activeLayer || !activeLayer.target || !groupRef.current) return;

    saveUndoState();

    const color1 = brushSettings.color;
    const color2 = brushSettings.secondaryColor || '#000000';
    const type = brushSettings.gradientType || 'linear';
    const opacity = brushSettings.opacity;
    const alpha1 = brushSettings.gradientColor1Transparent ? 0.0 : 1.0;
    const alpha2 = brushSettings.gradientColor2Transparent ? 0.0 : 1.0;
    
    // Get camera direction for plane projection
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);

    state.gradientMaterial.setGradient(color1, color2, start, end, type, camDir, opacity, alpha1, alpha2);

    const oldRT = gl.getRenderTarget();
    const oldAutoClear = gl.autoClear;
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();
    gl.autoClear = false;
    gl.setRenderTarget(activeLayer.target);

    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.visible) {
        state.decalMesh.geometry = child.geometry;
        state.decalMesh.matrixAutoUpdate = false;
        state.decalMesh.matrixWorld.copy(child.matrixWorld);
        
        const originalMat = state.decalMesh.material;
        state.decalMesh.material = state.gradientMaterial;
        gl.render(state.decalScene, state.decalCamera);
        state.decalMesh.material = originalMat;
      }
    });

    gl.setRenderTarget(oldRT);
    gl.autoClear = oldAutoClear;
    gl.setClearColor(oldClearColor, oldClearAlpha);
    markChannelDirty(activeLayer.mapType);
    setLayers([...state.layers]);
  }, [activeLayerId, brushSettings, gl, camera, saveUndoState, groupRef]);

  const startGradientPreview = useCallback(() => {
    const state = stateRef.current;
    const activeLayer = state.layers.find(l => l.id === activeLayerId);
    if (!activeLayer || !activeLayer.target) return;
    
    const isMask = activeLayer.isEditingMask && !!activeLayer.maskTarget;
    const target = isMask ? activeLayer.maskTarget! : activeLayer.target!;
    
    // Take snapshot
    const oldRT = gl.getRenderTarget();
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();
    gl.setRenderTarget(state.snapshotTarget);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    
    const blitMat = new THREE.MeshBasicMaterial({ 
      map: target.texture, 
      depthTest: false, 
      depthWrite: false,
      transparent: true,
      blending: THREE.NoBlending
    });
    const oldMat = state.compositeQuad.material;
    state.compositeQuad.material = blitMat;
    gl.render(state.compositeScene, state.compositeCamera);
    state.compositeQuad.material = oldMat;
    blitMat.dispose();
    gl.setRenderTarget(oldRT);
    gl.setClearColor(oldClearColor, oldClearAlpha);
    state.hasSnapshot = true;
  }, [activeLayerId, gl]);

  const previewGradient = useCallback((start: THREE.Vector3, end: THREE.Vector3) => {
    const state = stateRef.current;
    const activeLayer = state.layers.find(l => l.id === activeLayerId);
    if (!activeLayer || !activeLayer.target || !state.hasSnapshot || !groupRef.current) return;

    const isMask = activeLayer.isEditingMask && !!activeLayer.maskTarget;
    const target = isMask ? activeLayer.maskTarget! : activeLayer.target!;

    // 1. Restore from snapshot
    const oldRT = gl.getRenderTarget();
    const oldAutoClear = gl.autoClear;
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();

    gl.setRenderTarget(target);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    
    const blitMat = new THREE.MeshBasicMaterial({ 
      map: state.snapshotTarget?.texture, 
      depthTest: false, 
      depthWrite: false,
      transparent: true,
      blending: THREE.NoBlending
    });
    const oldMat = state.compositeQuad.material;
    state.compositeQuad.material = blitMat;
    gl.render(state.compositeScene, state.compositeCamera);
    state.compositeQuad.material = oldMat;
    blitMat.dispose();

    // 2. Render Gradient
    const color1 = brushSettings.color;
    const color2 = brushSettings.secondaryColor || '#000000';
    const type = brushSettings.gradientType || 'linear';
    const opacity = brushSettings.opacity;
    const alpha1 = brushSettings.gradientColor1Transparent ? 0.0 : 1.0;
    const alpha2 = brushSettings.gradientColor2Transparent ? 0.0 : 1.0;
    
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    state.gradientMaterial.setGradient(color1, color2, start, end, type, camDir, opacity, alpha1, alpha2);

    gl.autoClear = false;
    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.visible) {
        state.decalMesh.geometry = child.geometry;
        state.decalMesh.matrixAutoUpdate = false;
        state.decalMesh.matrixWorld.copy(child.matrixWorld);
        const originalMat = state.decalMesh.material;
        state.decalMesh.material = state.gradientMaterial;
        gl.render(state.decalScene, state.decalCamera);
        state.decalMesh.material = originalMat;
      }
    });

    gl.setRenderTarget(oldRT);
    gl.autoClear = oldAutoClear;
    gl.setClearColor(oldClearColor, oldClearAlpha);
    if (activeLayer) markChannelDirty(activeLayer.mapType);
  }, [activeLayerId, brushSettings, gl, camera, groupRef]);


  const texture = stateRef.current.dilatedTarget?.texture || null;
  const previewCanvas = stateRef.current.previewCanvas;

  return useMemo(() => ({
    initPaintSystem,
    startPainting,
    paint,
    stopPainting,
    texture,
    pbrTextures: {
      albedo: stateRef.current.pbrTargets.albedo?.texture || null,
      metalness: stateRef.current.pbrTargets.metalness?.texture || null,
      roughness: stateRef.current.pbrTargets.roughness?.texture || null,
      emissive: stateRef.current.pbrTargets.emissive?.texture || null,
      alpha: stateRef.current.pbrTargets.alpha?.texture || null,
      bump: stateRef.current.pbrTargets.bump?.texture || null,
    },
    textureSize: { width: stateRef.current.textureSize, height: stateRef.current.textureSize },
    previewCanvas,
    syncPreviewCanvas,
    layers,
    activeLayerId,
    addLayer,
    addFolder,
    removeLayer,
    updateLayer,
    setLayerActive: setActiveLayerId,
    moveLayer,
    reorderLayer,
    clearCanvas,
    fillCanvas,
    undo,
    redo,
    exportTexture,
    sampleColor,
    createLayerMask,
    deleteLayerMask,
    toggleLayerMask,
    setEditingMask,
    exportProjectLayersData,
    importProjectLayersData,
    mergeLayer,
    mergeFolder,
    renderGradient,
    startGradientPreview,
    previewGradient,
    markChannelDirty,
  }), [
    initPaintSystem,
    startPainting,
    paint,
    stopPainting,
    texture,
    previewCanvas,
    syncPreviewCanvas,
    layers,
    activeLayerId,
    addLayer,
    addFolder,
    removeLayer,
    updateLayer,
    setActiveLayerId,
    moveLayer,
    reorderLayer,
    clearCanvas,
    fillCanvas,
    undo,
    redo,
    exportTexture,
    sampleColor,
    createLayerMask,
    deleteLayerMask,
    toggleLayerMask,
    setEditingMask,
    exportProjectLayersData,
    importProjectLayersData,
    mergeLayer,
    mergeFolder,
    renderGradient,
    startGradientPreview,
    previewGradient,
    markChannelDirty,
    camera,
    gl
  ]);
}
