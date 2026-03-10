import { useRef, useCallback, useState, useEffect } from 'react';
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Inject BVH globally for lightning-fast raycasting
if (!(THREE.BufferGeometry.prototype as any).computeBoundsTree) {
  (THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
  (THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

export interface BrushSettings {
  size: number;
  color: string;
  opacity: number;
  spacing: number;
  type: 'circle' | 'square';
  mode?: 'paint' | 'erase';
}

export interface Layer {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible: boolean;
  opacity: number;
  blendMode: GlobalCompositeOperation;
}

interface SpatialHash {
  uuid: string;
  cellSize: number;
  cells: Map<number, number[]>;
  faceCenters: Float32Array;
  faceRadii: Float32Array;
}

export interface PaintState {
  isPainting: boolean;
  texture: THREE.CanvasTexture | null;
  compositeCanvas: HTMLCanvasElement | null;
  compositeCtx: CanvasRenderingContext2D | null;
  layers: Layer[];
  activeLayerId: string | null;
}

export function use3DPaint(
  _meshRef: React.RefObject<THREE.Mesh | null>,
  brushSettings: BrushSettings
) {
  const paintStateRef = useRef<PaintState>({
    isPainting: false,
    texture: null,
    compositeCanvas: null,
    compositeCtx: null,
    layers: [],
    activeLayerId: null,
  });

  const [isPainting, setIsPainting] = useState(false);
  const [textureSize, setTextureSize] = useState({ width: 2048, height: 2048 });
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);

  const undoStackRef = useRef<{ layerId: string; bitmap: ImageBitmap | HTMLCanvasElement }[]>([]);
  const redoStackRef = useRef<{ layerId: string; bitmap: ImageBitmap | HTMLCanvasElement }[]>([]);

  // --- RAF-based dirty compositor ---
  // Instead of compositing on every drawStamp call, we mark dirty and let a RAF
  // do exactly one composite per display frame. This is the biggest perf win at 4K.
  const compositeIsDirtyRef = useRef(false);
  const rafHandleRef = useRef<number>(0);

  const scheduleComposite = useCallback(() => {
    compositeIsDirtyRef.current = true;
    // Only schedule one pending RAF at a time
    if (rafHandleRef.current === 0) {
      rafHandleRef.current = requestAnimationFrame(() => {
        rafHandleRef.current = 0;
        if (!compositeIsDirtyRef.current) return;
        compositeIsDirtyRef.current = false;

        const state = paintStateRef.current;
        if (!state.compositeCtx || !state.compositeCanvas) return;
        state.compositeCtx.globalCompositeOperation = 'source-over';
        state.compositeCtx.globalAlpha = 1.0;
        state.compositeCtx.fillStyle = '#ffffff';
        state.compositeCtx.fillRect(0, 0, state.compositeCanvas.width, state.compositeCanvas.height);
        for (const layer of state.layers) {
          if (!layer.visible) continue;
          state.compositeCtx.globalAlpha = layer.opacity;
          state.compositeCtx.globalCompositeOperation = layer.blendMode;
          state.compositeCtx.drawImage(layer.canvas, 0, 0);
        }
        if (state.texture) {
          state.texture.needsUpdate = true;
        }
      });
    }
  }, []);

  // Original synchronous composite (kept for undo/redo and layer ops that need immediate update)
  const recompositeLayers = useCallback(() => {
    const state = paintStateRef.current;
    if (!state.compositeCtx || !state.compositeCanvas) return;
    state.compositeCtx.globalCompositeOperation = 'source-over';
    state.compositeCtx.globalAlpha = 1.0;
    state.compositeCtx.fillStyle = '#ffffff';
    state.compositeCtx.fillRect(0, 0, state.compositeCanvas.width, state.compositeCanvas.height);
    for (const layer of state.layers) {
      if (!layer.visible) continue;
      state.compositeCtx.globalAlpha = layer.opacity;
      state.compositeCtx.globalCompositeOperation = layer.blendMode;
      state.compositeCtx.drawImage(layer.canvas, 0, 0);
    }
    if (state.texture) {
      state.texture.needsUpdate = true;
    }
  }, []);

  // Store last mouse and point for stroke continuity
  const lastStrokeRef = useRef<{ 
    mouse: THREE.Vector2; 
    prevMouse: THREE.Vector2;
    worldPos: THREE.Vector3;
  } | null>(null);

  // Persistent Raycaster — avoids GC allocation on every paint step
  const raycasterRef = useRef(new THREE.Raycaster());

  const spatialHashRef = useRef<SpatialHash | null>(null);

  const getSpatialHash = useCallback((geometry: THREE.BufferGeometry) => {
    if (!(geometry as any).boundsTree) {
      (geometry as any).computeBoundsTree();
    }

    if (spatialHashRef.current && spatialHashRef.current.uuid === geometry.uuid) {
      return spatialHashRef.current;
    }

    const positions = geometry.attributes.position.array as Float32Array;
    const indices = geometry.index?.array;
    const numFaces = indices ? indices.length / 3 : positions.length / 9;

    const faceCenters = new Float32Array(numFaces * 3);
    const faceRadii = new Float32Array(numFaces);
    
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bbox = geometry.boundingBox!;
    
    const size = new THREE.Vector3().subVectors(bbox.max, bbox.min);
    let cellSize = Math.max(size.x, size.y, size.z) / 10;
    if (cellSize === 0) cellSize = 1;
    
    // Using an integer hash key instead of string concatenation to avoid GC overhead
    // Hash function for x, y, z grid coordinates:
    const hashCoord = (x: number, y: number, z: number) => {
        // Simple and fast hash assuming grid typically doesn't exceed -128 to 127 in each dimension for a 10x subdivision
        return (x & 0xFF) | ((y & 0xFF) << 8) | ((z & 0xFF) << 16);
    };
    
    const cells = new Map<number, number[]>();
    
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const center = new THREE.Vector3();

    for (let i = 0; i < numFaces; i++) {
        let a, b, c;
        if (indices) {
            a = indices[i * 3];
            b = indices[i * 3 + 1];
            c = indices[i * 3 + 2];
        } else {
            a = i * 3;
            b = i * 3 + 1;
            c = i * 3 + 2;
        }
        
        vA.fromArray(positions, a * 3);
        vB.fromArray(positions, b * 3);
        vC.fromArray(positions, c * 3);
        
        center.copy(vA).add(vB).add(vC).divideScalar(3);
        
        faceCenters[i * 3] = center.x;
        faceCenters[i * 3 + 1] = center.y;
        faceCenters[i * 3 + 2] = center.z;
        
        const radius = Math.max(
            center.distanceTo(vA),
            center.distanceTo(vB),
            center.distanceTo(vC)
        );
        faceRadii[i] = radius;
        
        const minX = Math.floor((center.x - radius) / cellSize);
        const maxX = Math.floor((center.x + radius) / cellSize);
        const minY = Math.floor((center.y - radius) / cellSize);
        const maxY = Math.floor((center.y + radius) / cellSize);
        const minZ = Math.floor((center.z - radius) / cellSize);
        const maxZ = Math.floor((center.z + radius) / cellSize);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const key = hashCoord(x, y, z);
                    let cell = cells.get(key);
                    if (!cell) {
                        cell = [];
                        cells.set(key, cell);
                    }
                    cell.push(i);
                }
            }
        }
    }

    const hash: SpatialHash = {
        uuid: geometry.uuid,
        cellSize,
        cells,
        faceCenters,
        faceRadii
    };
    
    spatialHashRef.current = hash;
    return hash;
  }, []);

  // Initialize painting canvas
  const initPaintCanvas = useCallback((width: number = 2048, height: number = 2048) => {
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = width;
    compositeCanvas.height = height;
    const compositeCtx = compositeCanvas.getContext('2d', { willReadFrequently: true });
    
    if (!compositeCtx) return null;

    const texture = new THREE.CanvasTexture(compositeCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    // Create Paint Layer
    const paintCanvas = document.createElement('canvas');
    paintCanvas.width = width;
    paintCanvas.height = height;
    const paintCtx = paintCanvas.getContext('2d', { willReadFrequently: true });
    
    if (paintCtx) {
       paintCtx.fillStyle = '#ffffff';
       paintCtx.fillRect(0, 0, width, height);
    }
    
    const paintLayer: Layer = {
      id: `layer-${Date.now()}`,
      name: 'Layer 1',
      canvas: paintCanvas,
      ctx: paintCtx!,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
    };

    const initialLayers = [paintLayer];

    paintStateRef.current = {
      isPainting: false,
      texture,
      compositeCanvas,
      compositeCtx,
      layers: initialLayers,
      activeLayerId: paintLayer.id,
    };

    setLayers(initialLayers);
    setActiveLayerId(paintLayer.id);
    setTextureSize({ width, height });
    
    recompositeLayers();
    return texture;
  }, [recompositeLayers]);

  // Calculate affine transform mapping screen space brush to UV space for a specific face
  const calculateUVTransformForFace = useCallback((
    faceIndex: number,
    hitPoint: THREE.Vector3,
    mesh: THREE.Mesh,
    camera: THREE.Camera,
    screenBrushSize: number,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positions = geometry.attributes.position.array as Float32Array;
    const uvs = geometry.attributes.uv?.array as Float32Array;
    const indices = geometry.index?.array;
    
    if (!uvs) return null;

    let a, b, c;
    if (indices) {
      a = indices[faceIndex * 3];
      b = indices[faceIndex * 3 + 1];
      c = indices[faceIndex * 3 + 2];
    } else {
      a = faceIndex * 3;
      b = faceIndex * 3 + 1;
      c = faceIndex * 3 + 2;
    }

    const meshMatrix = mesh.matrixWorld;
    const vA = new THREE.Vector3().fromArray(positions, a * 3).applyMatrix4(meshMatrix);
    const vB = new THREE.Vector3().fromArray(positions, b * 3).applyMatrix4(meshMatrix);
    const vC = new THREE.Vector3().fromArray(positions, c * 3).applyMatrix4(meshMatrix);

    const uvA = new THREE.Vector2().fromArray(uvs, a * 2);
    const uvB = new THREE.Vector2().fromArray(uvs, b * 2);
    const uvC = new THREE.Vector2().fromArray(uvs, c * 2);

    const plane = new THREE.Plane().setFromCoplanarPoints(vA, vB, vC);
    
    const distance = hitPoint.distanceTo(camera.position);
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const viewHeight = window.innerHeight; 
    const worldHeight = 2 * distance * Math.tan(fov / 2);
    const worldBrushRadius = (screenBrushSize / viewHeight) * worldHeight * 0.5;

    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

    const vecX = camRight.multiplyScalar(worldBrushRadius);
    const vecY = camUp.multiplyScalar(worldBrushRadius);

    const projectToPlane = (worldOffset: THREE.Vector3) => {
      const pt = hitPoint.clone().add(worldOffset);
      const rayDir = pt.sub(camera.position).normalize();
      const ray = new THREE.Ray(camera.position, rayDir);
      const target = new THREE.Vector3();
      if (ray.intersectPlane(plane, target)) {
        return target;
      }
      return hitPoint.clone().add(worldOffset);
    };

    const PCenter = projectToPlane(new THREE.Vector3(0, 0, 0));
    const Px = projectToPlane(vecX);
    const Py = projectToPlane(vecY);

    const triangle = new THREE.Triangle(vA, vB, vC);
    
    const getUV = (p: THREE.Vector3) => {
      const target = new THREE.Vector3();
      triangle.getBarycoord(p, target);
      return new THREE.Vector2(
         target.x * uvA.x + target.y * uvB.x + target.z * uvC.x,
         target.x * uvA.y + target.y * uvB.y + target.z * uvC.y
      );
    };

    const uvX = getUV(Px);
    const uvY = getUV(Py);
    const uvCenter = getUV(PCenter);

    const clip = [
      { x: uvA.x * canvasWidth, y: (1 - uvA.y) * canvasHeight },
      { x: uvB.x * canvasWidth, y: (1 - uvB.y) * canvasHeight },
      { x: uvC.x * canvasWidth, y: (1 - uvC.y) * canvasHeight }
    ];

    // Bloat UV triangle to bleed paint across seams between adjacent faces
    // Higher value = more pixels painted outside UV island borders = less visible seams
    const cx = (clip[0].x + clip[1].x + clip[2].x) / 3;
    const cy = (clip[0].y + clip[1].y + clip[2].y) / 3;
    const bloat = 12.0; // px in texture space
    for (let i = 0; i < 3; i++) {
      const dx = clip[i].x - cx;
      const dy = clip[i].y - cy;
      const len = Math.max(0.001, Math.sqrt(dx*dx + dy*dy));
      clip[i].x += (dx / len) * bloat;
      clip[i].y += (dy / len) * bloat;
    }

    return {
      a: (uvX.x - uvCenter.x) * canvasWidth,
      b: (uvCenter.y - uvX.y) * canvasHeight,
      c: (uvY.x - uvCenter.x) * canvasWidth,
      d: (uvCenter.y - uvY.y) * canvasHeight,
      e: uvCenter.x * canvasWidth,
      f: (1 - uvCenter.y) * canvasHeight,
      clip,
    };
  }, []);

  const getFacesInRadius = useCallback((
    hitPointWorld: THREE.Vector3,
    hitNormalLocal: THREE.Vector3,
    mesh: THREE.Mesh,
    camera: THREE.Camera,
    screenBrushSize: number
  ) => {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positions = geometry.attributes.position.array as Float32Array;
    const indices = geometry.index?.array;
    
    const distance = hitPointWorld.distanceTo(camera.position);
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const worldHeight = 2 * distance * Math.tan(fov / 2);
    const worldBrushRadius = (screenBrushSize / window.innerHeight) * worldHeight * 0.5;
    
    // Convert to local space to avoid matrix mults inside the loop
    const meshMatrixInverse = mesh.matrixWorld.clone().invert();
    const hitPointLocal = hitPointWorld.clone().applyMatrix4(meshMatrixInverse);
    
    // Calculate local radius correctly without transformDirection normalizing the magnitude
    const offsetPointWorld = hitPointWorld.clone().add(
      new THREE.Vector3(0, worldBrushRadius * 1.5, 0).applyQuaternion(camera.quaternion)
    );
    const localRadius = hitPointLocal.distanceTo(offsetPointWorld.applyMatrix4(meshMatrixInverse));

    const { cellSize, cells, faceCenters, faceRadii } = getSpatialHash(geometry);

    const facesToPaint = new Set<number>();

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const center = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();
    const triangle = new THREE.Triangle();

    const minX = Math.floor((hitPointLocal.x - localRadius) / cellSize);
    const maxX = Math.floor((hitPointLocal.x + localRadius) / cellSize);
    const minY = Math.floor((hitPointLocal.y - localRadius) / cellSize);
    const maxY = Math.floor((hitPointLocal.y + localRadius) / cellSize);
    const minZ = Math.floor((hitPointLocal.z - localRadius) / cellSize);
    const maxZ = Math.floor((hitPointLocal.z + localRadius) / cellSize);

    const hashCoord = (x: number, y: number, z: number) => {
      return (x & 0xFF) | ((y & 0xFF) << 8) | ((z & 0xFF) << 16);
    };

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = hashCoord(x, y, z);
          const cellFaces = cells.get(key);
          if (cellFaces) {
            for (const i of cellFaces) {
              if (facesToPaint.has(i)) continue;

              center.set(faceCenters[i * 3], faceCenters[i * 3 + 1], faceCenters[i * 3 + 2]);
              const frad = faceRadii[i];

              if (center.distanceTo(hitPointLocal) <= localRadius + frad) {
                let a, b, c;
                if (indices) {
                  a = indices[i * 3];
                  b = indices[i * 3 + 1];
                  c = indices[i * 3 + 2];
                } else {
                  a = i * 3;
                  b = i * 3 + 1;
                  c = i * 3 + 2;
                }

                vA.fromArray(positions, a * 3);
                vB.fromArray(positions, b * 3);
                vC.fromArray(positions, c * 3);
                
                triangle.set(vA, vB, vC);
                triangle.getNormal(faceNormal);
                
                // Discard faces pointing generally in the opposite direction of our hit surface normal
                if (faceNormal.dot(hitNormalLocal) > -0.2) {
                  facesToPaint.add(i);
                }
              }
            }
          }
        }
      }
    }
    return Array.from(facesToPaint);
  }, [getSpatialHash]);

  // Draw projected brush stamp
  const drawStamp = useCallback((
    transform: { a: number, b: number, c: number, d: number, e: number, f: number, clip?: {x: number, y: number}[] }
  ) => {
    const state = paintStateRef.current;
    if (!state.activeLayerId) return;
    
    const activeLayer = state.layers.find(l => l.id === state.activeLayerId);
    if (!activeLayer || !activeLayer.visible) return; // Cannot paint on hidden layers

    const ctx = activeLayer.ctx;
    if (!ctx) return;

    const { color, opacity, type, mode } = brushSettings;

    ctx.save();

    // Soft brush skips triangle clip — removed, pending rework.
    if (transform.clip) {
      ctx.beginPath();
      ctx.moveTo(transform.clip[0].x, transform.clip[0].y);
      ctx.lineTo(transform.clip[1].x, transform.clip[1].y);
      ctx.lineTo(transform.clip[2].x, transform.clip[2].y);
      ctx.closePath();
      ctx.clip();
    }

    ctx.globalAlpha = opacity;
    ctx.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';

    if (type === 'circle') {
      // Always solid — hardness removed pending redesign
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'square') {
      ctx.fillStyle = color;
      ctx.fillRect(-1, -1, 2, 2);
    }

    ctx.restore();
  }, [brushSettings]);

  const startPainting = useCallback((
    intersection: THREE.Intersection,
    mouseScale: THREE.Vector2,
    camera: THREE.Camera,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    const mesh = intersection.object as THREE.Mesh;
    const hitPoint = intersection.point.clone();
    const hitNormalLocal = intersection.face?.normal.clone() || new THREE.Vector3(0, 0, 1);
    
    paintStateRef.current.isPainting = true;
    lastStrokeRef.current = { 
      mouse: mouseScale.clone(), 
      prevMouse: mouseScale.clone(), 
      worldPos: hitPoint.clone()
    };

    // Save state for undo asynchronously to avoid stutter on stroke start
    const state = paintStateRef.current;
    if (state.activeLayerId) {
      const activeLayer = state.layers.find(l => l.id === state.activeLayerId);
      if (activeLayer && activeLayer.ctx) {
        if (typeof createImageBitmap !== 'undefined') {
           createImageBitmap(activeLayer.canvas).then(bitmap => {
             undoStackRef.current.push({ layerId: activeLayer.id, bitmap });
             if (undoStackRef.current.length > 20) {
                 const oldest = undoStackRef.current.shift();
                 if (oldest && 'close' in oldest.bitmap) oldest.bitmap.close();
             }
             redoStackRef.current.forEach(item => {
                 if ('close' in item.bitmap) item.bitmap.close();
             });
             redoStackRef.current = [];
           });
        } else {
           // Fallback for older browsers
           const snapCanvas = document.createElement('canvas');
           snapCanvas.width = activeLayer.canvas.width;
           snapCanvas.height = activeLayer.canvas.height;
           snapCanvas.getContext('2d')?.drawImage(activeLayer.canvas, 0, 0);
           undoStackRef.current.push({ layerId: activeLayer.id, bitmap: snapCanvas });
           if (undoStackRef.current.length > 20) undoStackRef.current.shift();
           redoStackRef.current = [];
        }
      }
    }

    const faces = getFacesInRadius(hitPoint, hitNormalLocal, mesh, camera, brushSettings.size);
    
    for (const faceIndex of faces) {
      const transform = calculateUVTransformForFace(
        faceIndex,
        hitPoint,
        mesh,
        camera,
        brushSettings.size,
        canvasWidth,
        canvasHeight
      );

      if (transform) {
        drawStamp(transform);
      }
    }

    recompositeLayers();
    scheduleComposite();
    setIsPainting(true);
  }, [brushSettings.size, calculateUVTransformForFace, getFacesInRadius, drawStamp, recompositeLayers, scheduleComposite]);

  // Continue painting
  const paint = useCallback((
    mouseScale: THREE.Vector2,
    mesh: THREE.Mesh,
    camera: THREE.Camera,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    if (!paintStateRef.current.isPainting) return;
    if (!lastStrokeRef.current) return;

    const lastMouse = lastStrokeRef.current.mouse;
    const prevMouse = lastStrokeRef.current.prevMouse;
    const currentMouse = mouseScale;
    
    // Calculate distance linearly in screen space
    const dist = lastMouse.distanceTo(currentMouse);
    
    // spacing is percentage of brush size.
    // ensure spacing doesn't go below 0.05 to avoid freezing at very dense settings
    const safeSpacing = Math.max(0.05, brushSettings.spacing || 0.25);
    const stepNdc = (brushSettings.size / window.innerHeight) * safeSpacing * 2.0; 
    
    // Cap steps at 50 per frame to ensure high performance even with textured brushes
    const steps = Math.min(50, Math.max(1, Math.floor(dist / stepNdc)));
    const raycaster = raycasterRef.current; // reuse persistent instance — no GC!

    const startPt = new THREE.Vector2().addVectors(prevMouse, lastMouse).multiplyScalar(0.5);
    const endPt = new THREE.Vector2().addVectors(lastMouse, currentMouse).multiplyScalar(0.5);
    const controlPt = lastMouse;
    
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;
        
        const interpMouse = new THREE.Vector2(
           uu * startPt.x + 2 * u * t * controlPt.x + tt * endPt.x,
           uu * startPt.y + 2 * u * t * controlPt.y + tt * endPt.y
        );
        
        raycaster.setFromCamera(interpMouse, camera);
        const intersects = raycaster.intersectObject(mesh);
        
        if (intersects.length > 0) {
            const hit = intersects[0];
            const hitPoint = hit.point.clone();
            const hitNormalLocal = hit.face?.normal.clone() || new THREE.Vector3(0, 0, 1);
            
            const faces = getFacesInRadius(hitPoint, hitNormalLocal, mesh, camera, brushSettings.size);
            
            for (const faceIndex of faces) {
              const transform = calculateUVTransformForFace(
                  faceIndex,
                  hitPoint,
                  mesh,
                  camera,
                  brushSettings.size,
                  canvasWidth,
                  canvasHeight
              );
              if (transform) {
                  drawStamp(transform);
              }
            }
            lastStrokeRef.current.worldPos = hit.point.clone();
        }
    }

    // Use scheduleComposite (RAF-gated) — at most 1 composite per display frame
    scheduleComposite();
    lastStrokeRef.current.prevMouse = lastStrokeRef.current.mouse.clone();
    lastStrokeRef.current.mouse = currentMouse.clone();
  }, [brushSettings.size, calculateUVTransformForFace, getFacesInRadius, drawStamp, scheduleComposite]);

  // Cleanup pending RAF on unmount
  useEffect(() => {
    return () => {
      if (rafHandleRef.current !== 0) {
        cancelAnimationFrame(rafHandleRef.current);
      }
    };
  }, []);

  // Stop painting
  const stopPainting = useCallback(() => {
    paintStateRef.current.isPainting = false;
    lastStrokeRef.current = null;
    setIsPainting(false);
  }, []);

  // Clear specific layer or base canvas
  const clearCanvas = useCallback(() => {
    const state = paintStateRef.current;
    if (!state.activeLayerId) return;
    const activeLayer = state.layers.find(l => l.id === state.activeLayerId);
    if (!activeLayer) return;

    // Save for undo
    if (typeof createImageBitmap !== 'undefined') {
       createImageBitmap(activeLayer.canvas).then(bitmap => {
         undoStackRef.current.push({ layerId: activeLayer.id, bitmap });
         if (undoStackRef.current.length > 20) {
             const oldest = undoStackRef.current.shift();
             if (oldest && 'close' in oldest.bitmap) oldest.bitmap.close();
         }
         redoStackRef.current.forEach(item => {
             if ('close' in item.bitmap) item.bitmap.close();
         });
         redoStackRef.current = [];
       });
    } else {
       const snapCanvas = document.createElement('canvas');
       snapCanvas.width = activeLayer.canvas.width;
       snapCanvas.height = activeLayer.canvas.height;
       snapCanvas.getContext('2d')?.drawImage(activeLayer.canvas, 0, 0);
       undoStackRef.current.push({ layerId: activeLayer.id, bitmap: snapCanvas });
       if (undoStackRef.current.length > 20) undoStackRef.current.shift();
       redoStackRef.current = [];
    }

    activeLayer.ctx.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
    if (state.layers[state.layers.length - 1].id === activeLayer.id) {
      activeLayer.ctx.fillStyle = '#ffffff';
      activeLayer.ctx.fillRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
    }
    
    scheduleComposite();
  }, [scheduleComposite]);

  // Fill specific layer with current brush color
  const fillCanvas = useCallback(() => {
    const state = paintStateRef.current;
    if (!state.activeLayerId) return;
    const activeLayer = state.layers.find(l => l.id === state.activeLayerId);
    if (!activeLayer) return;

    // Save for undo
    if (typeof createImageBitmap !== 'undefined') {
       createImageBitmap(activeLayer.canvas).then(bitmap => {
         undoStackRef.current.push({ layerId: activeLayer.id, bitmap });
         if (undoStackRef.current.length > 20) {
             const oldest = undoStackRef.current.shift();
             if (oldest && 'close' in oldest.bitmap) oldest.bitmap.close();
         }
         redoStackRef.current.forEach(item => {
             if ('close' in item.bitmap) item.bitmap.close();
         });
         redoStackRef.current = [];
       });
    } else {
       const snapCanvas = document.createElement('canvas');
       snapCanvas.width = activeLayer.canvas.width;
       snapCanvas.height = activeLayer.canvas.height;
       snapCanvas.getContext('2d')?.drawImage(activeLayer.canvas, 0, 0);
       undoStackRef.current.push({ layerId: activeLayer.id, bitmap: snapCanvas });
       if (undoStackRef.current.length > 20) undoStackRef.current.shift();
       redoStackRef.current = [];
    }

    // Erase mode clears the layer (like clearCanvas) or paints with transparency/eraser mode
    if (brushSettings.mode === 'erase') {
        activeLayer.ctx.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
        if (state.layers[state.layers.length - 1].id === activeLayer.id) {
          activeLayer.ctx.fillStyle = '#ffffff';
          activeLayer.ctx.fillRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
        }
    } else {
        // Normal block: Use source-over inside canvas to overlay color
        activeLayer.ctx.globalCompositeOperation = 'source-over';
        activeLayer.ctx.fillStyle = brushSettings.color;
        activeLayer.ctx.fillRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
    }
    
    scheduleComposite();
  }, [scheduleComposite, brushSettings]);

  // Export texture
  const exportTexture = useCallback(() => {
    const { compositeCanvas } = paintStateRef.current;
    if (!compositeCanvas) return null;
    return compositeCanvas.toDataURL('image/png');
  }, []);

  // Import texture to active layer
  const importTexture = useCallback((imageUrl: string) => {
    const state = paintStateRef.current;
    if (!state.activeLayerId) return;
    const activeLayer = state.layers.find(l => l.id === state.activeLayerId);
    if (!activeLayer) return;

    const img = new Image();
    img.onload = () => {
      activeLayer.ctx.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
      activeLayer.ctx.drawImage(img, 0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
      recompositeLayers();
    };
    img.src = imageUrl;
  }, [recompositeLayers]);

  // Get current texture
  const getTexture = useCallback(() => {
    return paintStateRef.current.texture;
  }, []);

  const addLayer = useCallback(() => {
    const state = paintStateRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = textureSize.width;
    canvas.height = textureSize.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const newLayer: Layer = {
      id: `layer-${Date.now()}`,
      name: `Layer ${state.layers.length + 1}`,
      canvas,
      ctx,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
    };

    const newLayers = [newLayer, ...state.layers]; // Add to top basically
    state.layers = newLayers;
    setLayers(newLayers);
    setActiveLayerId(newLayer.id);
    state.activeLayerId = newLayer.id;
    recompositeLayers();
  }, [textureSize, recompositeLayers]);

  const updateLayer = useCallback((id: string, updates: Partial<Layer>) => {
    const state = paintStateRef.current;
    state.layers = state.layers.map(l => (l.id === id ? { ...l, ...updates } : l));
    setLayers(state.layers);
    recompositeLayers();
  }, [recompositeLayers]);

  const removeLayer = useCallback((id: string) => {
    const state = paintStateRef.current;
    if (state.layers.length <= 1) return; // Must have at least one layer
    state.layers = state.layers.filter(l => l.id !== id);
    if (state.activeLayerId === id) {
       state.activeLayerId = state.layers[0].id;
       setActiveLayerId(state.activeLayerId);
    }
    setLayers(state.layers);
    recompositeLayers();
  }, [recompositeLayers]);

  const setLayerActive = useCallback((id: string) => {
    paintStateRef.current.activeLayerId = id;
    setActiveLayerId(id);
  }, []);

  const moveLayer = useCallback((id: string, direction: 'up' | 'down') => {
    const state = paintStateRef.current;
    const index = state.layers.findIndex(l => l.id === id);
    if (index === -1) return;

    const newLayers = [...state.layers];
    if (direction === 'up' && index > 0) {
      // Move up means closer to index 0 (top of stack)
      const temp = newLayers[index - 1];
      newLayers[index - 1] = newLayers[index];
      newLayers[index] = temp;
    } else if (direction === 'down' && index < newLayers.length - 1) {
      // Move down means closer to end (bottom of stack)
      const temp = newLayers[index + 1];
      newLayers[index + 1] = newLayers[index];
      newLayers[index] = temp;
    } else {
      return;
    }

    state.layers = newLayers;
    setLayers(newLayers);
    recompositeLayers();
  }, [recompositeLayers]);

  const undo = useCallback(() => {
    const state = paintStateRef.current;
    const last = undoStackRef.current.pop();
    if (last) {
      const layer = state.layers.find(l => l.id === last.layerId);
      if (layer) {
        if (typeof createImageBitmap !== 'undefined') {
           createImageBitmap(layer.canvas).then(bitmap => {
             redoStackRef.current.push({ layerId: layer.id, bitmap });
             layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
             layer.ctx.drawImage(last.bitmap, 0, 0);
             scheduleComposite();
           });
        } else {
           const snapCanvas = document.createElement('canvas');
           snapCanvas.width = layer.canvas.width;
           snapCanvas.height = layer.canvas.height;
           snapCanvas.getContext('2d')?.drawImage(layer.canvas, 0, 0);
           redoStackRef.current.push({ layerId: layer.id, bitmap: snapCanvas });
           layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
           layer.ctx.drawImage(last.bitmap, 0, 0);
           scheduleComposite();
        }
      }
    }
  }, [scheduleComposite]);

  const redo = useCallback(() => {
    const state = paintStateRef.current;
    const next = redoStackRef.current.pop();
    if (next) {
      const layer = state.layers.find(l => l.id === next.layerId);
      if (layer) {
        if (typeof createImageBitmap !== 'undefined') {
           createImageBitmap(layer.canvas).then(bitmap => {
             undoStackRef.current.push({ layerId: layer.id, bitmap });
             layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
             layer.ctx.drawImage(next.bitmap, 0, 0);
             scheduleComposite();
           });
        } else {
           const snapCanvas = document.createElement('canvas');
           snapCanvas.width = layer.canvas.width;
           snapCanvas.height = layer.canvas.height;
           snapCanvas.getContext('2d')?.drawImage(layer.canvas, 0, 0);
           undoStackRef.current.push({ layerId: layer.id, bitmap: snapCanvas });
           layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
           layer.ctx.drawImage(next.bitmap, 0, 0);
           scheduleComposite();
        }
      }
    }
  }, [scheduleComposite]);

  return {
    initPaintCanvas,
    startPainting,
    paint,
    stopPainting,
    clearCanvas,
    fillCanvas,
    exportTexture,
    importTexture,
    getTexture,
    isPainting,
    textureSize,
    layers,
    activeLayerId,
    addLayer,
    updateLayer,
    removeLayer,
    setLayerActive,
    moveLayer,
    undo,
    redo,
  };
}


