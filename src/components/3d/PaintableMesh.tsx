import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { useWebGLPaint } from '@/hooks/useWebGLPaint';
import type { BrushSettings } from '@/hooks/useWebGLPaint';
import type { OverlayData } from '@/components/ui-custom/OverlayManager';

import grayClay from '@/matcap/gray_clay_010001.png';
import lightGrey from '@/matcap/light_grey_010001.png';
import merge1 from '@/matcap/merge0001.png';
import merge2 from '@/matcap/merge0002.png';
import warmClay from '@/matcap/warm_clay_010001.png';
import softlightGrey from '@/matcap/softlight_grey.png';

const MATCAPS_URLS: Record<string, string> = {
  'gray_clay_010001.png': grayClay,
  'light_grey_010001.png': lightGrey,
  'merge0001.png': merge1,
  'merge0002.png': merge2,
  'warm_clay_010001.png': warmClay,
  'softlight_grey.png': softlightGrey,
};

export interface GradientSession {
  start: THREE.Vector3;
  end: THREE.Vector3;
  mid: THREE.Vector3;
  isLocked: boolean;
  isCreating?: boolean;
}

interface PaintableMeshProps {
  brushSettings: BrushSettings;
  modelParts: any[];
  modelTransform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  onTextureChange?: (texture: THREE.Texture | null, previewCanvas?: HTMLCanvasElement) => void;
  showWireframe?: boolean;
  flatShading?: boolean;
  textureResolution?: number;
  matcapName?: string | null;
  objectColor?: string;
  roughness?: number;
  metalness?: number;
  onPaintingChange?: (isPainting: boolean) => void;
  onLayerControlsReady?: (controls: any) => void;
  onBrushSettingsChange?: (settings: BrushSettings) => void;
  activeStencil?: OverlayData;
  onColorPainted?: (color: string) => void;
  onLoadingProgress?: (progress: number, status?: string) => void;
  isVisible?: boolean;
  bumpScale?: number;
  
  // New Gradient Props
  gradientSession?: GradientSession | null;
  setGradientSession?: React.Dispatch<React.SetStateAction<GradientSession | null>>;
}

export const PaintableMesh: React.FC<PaintableMeshProps> = ({
  brushSettings,
  modelParts,
  modelTransform,
  onTextureChange,
  showWireframe = false,
  flatShading = false,
  textureResolution = 2048,
  matcapName = null,
  objectColor = '#e5e5e5',
  roughness = 0.8,
  metalness = 0.1,
  onPaintingChange,
  onLayerControlsReady,
  onBrushSettingsChange,
  activeStencil,
  onColorPainted,
  onLoadingProgress,
  isVisible = true,
  bumpScale = 1.0,
  // New Gradient Props
  gradientSession,
  setGradientSession,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, gl, size } = useThree();
  const pointerRafRef = useRef<number>(0);
  const isOrbitingRef = useRef(false);
  const isPickingRef = useRef(false);
  const cursorGroupRef = useRef<THREE.Group>(null);
  const cursorRingRef = useRef<THREE.Mesh>(null);
  const symmetryGroupRef = useRef<THREE.Group>(null);
  const lazyGroupRef = useRef<THREE.Group>(null);
  const lazyLineRef = useRef<any>(null);
  
  const { 
    initPaintSystem, startPainting, paint, stopPainting,
    texture, pbrTextures, previewCanvas,
    layers, activeLayerId, addLayer, addFolder, removeLayer, updateLayer, setLayerActive, moveLayer, reorderLayer, clearCanvas, fillCanvas, undo, redo, exportTexture, sampleColor,
    createLayerMask, deleteLayerMask, toggleLayerMask, setEditingMask,
    mergeLayer, mergeFolder,
    renderGradient, startGradientPreview, previewGradient,
    exportProjectLayersData, importProjectLayersData,
    importImageToLayer,
    exportTarget, pbrTargets,
    lazyPoint
  } = useWebGLPaint(
    groupRef,
    brushSettings,
    [modelParts],
    activeStencil,
    onColorPainted
  );

  const [loadingProgress, setLoadingProgress] = useState({ matcap: 0, layers: 0 });
  const [internalIsPainting, setInternalIsPainting] = useState(false);

  useEffect(() => {
    const total = (loadingProgress.matcap + loadingProgress.layers) / 2;
    if (onLoadingProgress) {
      const status = total < 100 ? (loadingProgress.layers < 100 ? 'Carregando camadas...' : 'Finalizando materiais...') : undefined;
      onLoadingProgress(total, status);
    }
  }, [loadingProgress, onLoadingProgress]);

  useEffect(() => {
    if (onLayerControlsReady) {
      onLayerControlsReady({ 
        layers, activeLayerId, addLayer, addFolder, removeLayer, updateLayer, setLayerActive, moveLayer, reorderLayer, 
        clearCanvas, fillCanvas, undo, redo, exportTexture, 
        createLayerMask, deleteLayerMask, toggleLayerMask, setEditingMask,
        mergeLayer, mergeFolder,
        renderGradient, startGradientPreview, previewGradient,
        exportProjectLayersData, exportTarget, pbrTargets, importImageToLayer,
        importProjectLayersData: (data: any[]) => {
          setLoadingProgress(p => ({ ...p, layers: 0 }));
          return importProjectLayersData(data, (prog) => {
            setLoadingProgress(p => ({ ...p, layers: prog }));
          });
        }
      });
    }
  }, [layers, activeLayerId, addLayer, addFolder, removeLayer, updateLayer, setLayerActive, moveLayer, reorderLayer, clearCanvas, fillCanvas, undo, redo, exportTexture, onLayerControlsReady, createLayerMask, deleteLayerMask, toggleLayerMask, setEditingMask, exportProjectLayersData, importProjectLayersData, importImageToLayer, renderGradient, startGradientPreview, previewGradient, exportTarget, pbrTargets]);

  // Initialize texture on mount and when resolution changes
  useEffect(() => {
    initPaintSystem(textureResolution);
    setLoadingProgress(p => ({ ...p, layers: 100 })); // New project case
  }, [initPaintSystem, textureResolution]);

  useEffect(() => {
    if (texture && onTextureChange) {
      onTextureChange(texture, previewCanvas);
    }
  }, [texture, previewCanvas, onTextureChange]);

  const [matcapTexture, setMatcapTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (matcapName && MATCAPS_URLS[matcapName]) {
      setLoadingProgress(p => ({ ...p, matcap: 0 }));
      const loader = new THREE.TextureLoader();
      loader.load(
        MATCAPS_URLS[matcapName], 
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          setMatcapTexture(texture);
          setLoadingProgress(p => ({ ...p, matcap: 100 }));
        },
        undefined,
        () => {
          setLoadingProgress(p => ({ ...p, matcap: 100 }));
        }
      );
    } else {
      setMatcapTexture(null);
      setLoadingProgress(p => ({ ...p, matcap: 100 }));
    }
  }, [matcapName]);

  // Update material when texture or material props change
  useEffect(() => {
    if (groupRef.current) {
      const newMaterial = (matcapName && matcapTexture)
        ? new THREE.MeshMatcapMaterial({ 
            matcap: matcapTexture, 
            map: pbrTextures.albedo || texture || null, 
            flatShading, 
            color: objectColor,
            transparent: true,
            depthWrite: true,
            alphaTest: 0.001
          })
        : new THREE.MeshStandardMaterial({ 
            map: pbrTextures.albedo || texture || null, 
            metalnessMap: pbrTextures.metalness || null,
            roughnessMap: pbrTextures.roughness || null,
            emissiveMap: pbrTextures.emissive || null,
            alphaMap: pbrTextures.alpha || null,
            bumpMap: (pbrTextures as any).bump || null,
            bumpScale: (pbrTextures as any).bump ? bumpScale : 0,
            emissive: new THREE.Color(0xffffff), // Emissive color is controlled by the map
            emissiveIntensity: pbrTextures.emissive ? 1.0 : 0.0,
            roughness: pbrTextures.roughness ? 1.0 : roughness, 
            metalness: pbrTextures.metalness ? 1.0 : metalness, 
            flatShading, 
            color: objectColor,
            transparent: true,
            depthWrite: true,
            alphaTest: 0.001
          });

      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = newMaterial;
        }
      });
    }
  }, [texture, pbrTextures, flatShading, matcapName, matcapTexture, objectColor, roughness, metalness, bumpScale]);

  const updateCursor = useCallback((hit: THREE.Intersection | undefined, pressure: number = 1.0, forceIsPainting?: boolean) => {
    const group = cursorGroupRef.current;
    if (!group) return;

    if (hit && isVisible && brushSettings.mode !== 'gradient') {
      group.visible = true;
      const dist = camera.position.distanceTo(hit.point);
      let radius = 0.1;
      const dynamicSize = Math.max(4, brushSettings.size * Math.max(0.05, pressure));

      if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
        const worldHeight = 2 * dist * Math.tan(fov / 2);
        radius = (dynamicSize / size.height) * worldHeight * 0.5;
      } else {
        const ortho = camera as THREE.OrthographicCamera;
        const worldHeight = ortho.top - ortho.bottom;
        radius = (dynamicSize / size.height) * worldHeight * 0.5;
      }

      let normal = hit.face?.normal.clone() || new THREE.Vector3(0, 0, 1);
      if (brushSettings.projectFromCamera) {
        camera.getWorldDirection(normal).negate();
      } else if (hit.object) {
        normal.transformDirection(hit.object.matrixWorld).normalize();
      }

      // Update Main Cursor
      group.position.copy(hit.point);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      if (cursorRingRef.current) {
        cursorRingRef.current.scale.set(radius, radius, 1);
      }

      // Update Symmetry
      const symGroup = symmetryGroupRef.current;
      if (symGroup) {
        symGroup.children.forEach(c => c.visible = false);
        
        if (brushSettings.symmetryMode && brushSettings.symmetryMode !== 'none' && groupRef.current) {
          const mode = brushSettings.symmetryMode;
          const axis = brushSettings.symmetryAxis || 'x';
          const points = brushSettings.radialPoints || 4;
          
          if (mode === 'mirror') {
             const localPos = groupRef.current.worldToLocal(hit.point.clone());
             const localNorm = normal.clone();
             if (axis === 'x') { localPos.x *= -1; localNorm.x *= -1; }
             else if (axis === 'y') { localPos.y *= -1; localNorm.y *= -1; }
             else if (axis === 'z') { localPos.z *= -1; localNorm.z *= -1; }
             
             const symChild = symGroup.children[0] as THREE.Group;
             if (symChild) {
               symChild.visible = true;
               symChild.position.copy(groupRef.current.localToWorld(localPos)).sub(hit.point);
               symChild.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localNorm.normalize()).premultiply(group.quaternion.clone().invert());
               symChild.scale.set(radius, radius, 1);
             }
          } else if (mode === 'radial') {
             const angleStep = (Math.PI * 2) / points;
             const localOrigin = groupRef.current.worldToLocal(hit.point.clone());
             
             for (let i = 1; i < points; i++) {
               const localPos = localOrigin.clone();
               const localNorm = normal.clone();
               const theta = angleStep * i;
               
               if (axis === 'y') {
                 localPos.set(localOrigin.x * Math.cos(theta) - localOrigin.z * Math.sin(theta), localOrigin.y, localOrigin.x * Math.sin(theta) + localOrigin.z * Math.cos(theta));
                 localNorm.set(normal.x * Math.cos(theta) - normal.z * Math.sin(theta), normal.y, normal.x * Math.sin(theta) + normal.z * Math.cos(theta));
               } else if (axis === 'x') {
                 localPos.set(localOrigin.x, localOrigin.y * Math.cos(theta) - localOrigin.z * Math.sin(theta), localOrigin.y * Math.sin(theta) + localOrigin.z * Math.cos(theta));
                 localNorm.set(normal.x, normal.y * Math.cos(theta) - normal.z * Math.sin(theta), normal.y * Math.sin(theta) + normal.z * Math.cos(theta));
               } else if (axis === 'z') {
                 localPos.set(localOrigin.x * Math.cos(theta) - localOrigin.y * Math.sin(theta), localOrigin.x * Math.sin(theta) + localOrigin.y * Math.cos(theta), localOrigin.z);
                 localNorm.set(normal.x * Math.cos(theta) - normal.y * Math.sin(theta), normal.x * Math.sin(theta) + normal.y * Math.cos(theta), normal.z);
               }

               const symChild = symGroup.children[i-1] as THREE.Group;
               if (symChild) {
                 symChild.visible = true;
                 symChild.position.copy(groupRef.current.localToWorld(localPos)).sub(hit.point);
                 symChild.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localNorm.normalize()).premultiply(group.quaternion.clone().invert());
                 symChild.scale.set(radius, radius, 1);
               }
             }
          }
        }
      }

      // Update Lazy Point
      const lazyGroup = lazyGroupRef.current;
      if (lazyGroup) {
        const isActuallyPainting = forceIsPainting !== undefined ? forceIsPainting : internalIsPainting;
        if (brushSettings.lazyMouse && isActuallyPainting && lazyPoint) {
          lazyGroup.visible = true;
          lazyGroup.position.copy(lazyPoint).sub(hit.point);
          lazyGroup.scale.set(radius, radius, 1);
          if (lazyLineRef.current) {
             lazyLineRef.current.setPoints([new THREE.Vector3(0,0,0), lazyGroup.position.clone().negate()]);
          }
        } else {
          lazyGroup.visible = false;
        }
      }

    } else {
      group.visible = false;
    }
  }, [camera, brushSettings.size, brushSettings.lazyMouse, brushSettings.symmetryMode, brushSettings.symmetryAxis, brushSettings.radialPoints, size.height, lazyPoint, internalIsPainting, isVisible]);

  // Hold latest interaction for throttled move
  const latestInteraction = useRef<{ hit: THREE.Intersection, pressure: number } | null>(null);

  const processPointerEvent = useCallback(() => {
    pointerRafRef.current = 0;
    const interaction = latestInteraction.current;
    if (!interaction) return;

    if (brushSettings.mode === 'gradient') return; // Don't paint during move for gradient
    updateCursor(interaction.hit, interaction.pressure);
    paint(interaction.hit, interaction.pressure);
  }, [paint, updateCursor, brushSettings.mode]);


  const handlePointerDown = useCallback(
    (event: any) => {
      const nativeEvent = event.nativeEvent as PointerEvent;
      
      // Secondary buttons always orbit
      if (nativeEvent.buttons > 1) {
        isOrbitingRef.current = true;
        return;
      }

      if ((brushSettings.mode as any) === 'gradient') {
        const nativeEvent = event.nativeEvent as PointerEvent;
        const isLocked = gradientSession?.isLocked ?? true; // Default to locked (painting mode)
        
        if (!isLocked) {
          // Navigation mode: Do not stop propagation, let OrbitControls handle it
          return;
        }

        event.stopPropagation();
        
        // Manual ray calculation to be safe and independent of R3F event raycaster
        const rect = gl.domElement.getBoundingClientRect();
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);

        // Always use plane projection at the origin, facing the camera for start point
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          camera.getWorldDirection(new THREE.Vector3()).negate(),
          new THREE.Vector3(0, 0, 0)
        );
        
        const intersect = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, intersect)) {
          const point = intersect.clone();
          setGradientSession?.({
            start: point,
            end: point.clone(),
            mid: point.clone(),
            isLocked: true,
            isCreating: true
          });
          
          startGradientPreview?.();
          onPaintingChange?.(true);
          gl.domElement.setPointerCapture(nativeEvent.pointerId);
        }
        return;
      }
      
      event.stopPropagation();
      isOrbitingRef.current = false;
      const hit = event.intersections[0] as THREE.Intersection;
      if (!hit) return;

      // Eyedropper logic (Alt Key)
      if (nativeEvent.altKey) {
        isPickingRef.current = true;
        const color = sampleColor(hit);
        onBrushSettingsChange?.({ ...brushSettings, color });
        onColorPainted?.(color);
        return;
      }
      
      let pressure = nativeEvent.pointerType === 'pen' ? nativeEvent.pressure : 1.0;
      // Stylus fix: some tablets report 0 on first touchdown
      if (pressure === 0 && nativeEvent.pointerType === 'pen') pressure = 0.5;
      if (pressure === 0 && nativeEvent.pointerType !== 'pen') pressure = 1.0;
      
      onPaintingChange?.(true);
      setInternalIsPainting(true);
      startPainting(hit, pressure);
      updateCursor(hit, pressure, true);
      gl.domElement.setPointerCapture(nativeEvent.pointerId);
    },
    [startPainting, updateCursor, onPaintingChange, gl, sampleColor, brushSettings.mode, onBrushSettingsChange, gradientSession, setGradientSession]
  );

  const handlePointerMove = useCallback(
    (event: any) => {
      const hit = event.intersections[0] as THREE.Intersection;
      const nativeEvent = event.nativeEvent as PointerEvent;

      // Skip cursor updates if we are orbiting or using secondary buttons
      if (isOrbitingRef.current || (nativeEvent.pointerType === 'mouse' && nativeEvent.buttons > 1)) {
        updateCursor(undefined); // Hide cursor
        return;
      }

      let pressure = nativeEvent.pointerType === 'pen' ? nativeEvent.pressure : 1.0;
      // Stylus fix: some tablets report 0 on first touchdown or during hover
      if (nativeEvent.pointerType === 'pen' && pressure === 0) pressure = 0.5;
      if (nativeEvent.pointerType !== 'pen' && pressure === 0) pressure = 1.0;

      if (brushSettings.mode as any === 'gradient') return;
      
      latestInteraction.current = { hit, pressure };
      if (pointerRafRef.current === 0) {
        pointerRafRef.current = requestAnimationFrame(processPointerEvent);
      }
    },
    [processPointerEvent, brushSettings.mode, gradientSession, camera, updateCursor]
  );

  const handlePointerUp = useCallback(
    (event: any) => {
      event.stopPropagation();
      
      if (pointerRafRef.current !== 0) {
        cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = 0;
      }
      latestInteraction.current = null;
      isOrbitingRef.current = false;
      isPickingRef.current = false;

      if ((brushSettings.mode as any) === 'gradient') {
        // PointerUp is now handled by the global listener to ensure 100% reliability
        return;
      }

      onPaintingChange?.(false);
      setInternalIsPainting(false);
      stopPainting();
      
      const nativeEvent = event.nativeEvent;
      try {
        if (nativeEvent && nativeEvent.pointerId !== undefined) {
          gl.domElement.releasePointerCapture(nativeEvent.pointerId);
        }
      } catch (e) {
        // Ignore if pointer capture was not set
      }
    },
    [gl, stopPainting, onPaintingChange, gradientSession, brushSettings.mode]
  );

  const handlePointerLeave = useCallback(() => {
    // Don't stop painting here anymore!
    // Just hide the cursor
    updateCursor(undefined);
    // Signal a stroke break to useWebGLPaint so it doesn't interpolate when re-entering
    latestInteraction.current = { hit: null as any, pressure: 0 };
  }, [updateCursor]);

  // Global pointerup listener to ensure we stop creating/dragging even if mouse is off-mesh
  useEffect(() => {
    const isInteracting = ((brushSettings.mode as any) === 'gradient' && gradientSession?.isCreating) || internalIsPainting;
    if (!isInteracting) return;

    const onGlobalPointerMove = (e: PointerEvent) => {
      if (!gradientSession?.isCreating || !setGradientSession || !previewGradient) return;

      // Project onto plane using screen coordinates
      const rect = gl.domElement.getBoundingClientRect();
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);

      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new THREE.Vector3()).negate(),
        gradientSession.start
      );
      
      const intersect = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, intersect)) {
        const point = intersect.clone();
        setGradientSession(prev => {
          if (!prev) return null;
          const newSession = { ...prev, end: point, mid: new THREE.Vector3().lerpVectors(prev.start, point, 0.5) };
          previewGradient(newSession.start, newSession.end);
          return newSession;
        });
      }
    };

    const onGlobalPointerUp = (e: PointerEvent) => {
      if ((brushSettings.mode as any) === 'gradient') {
        setGradientSession?.(prev => {
          if (prev?.isCreating) {
            // Auto apply on final release
            renderGradient?.(prev.start, prev.end);
            return null;
          }
          return prev;
        });
      } else if (internalIsPainting) {
        onPaintingChange?.(false);
        setInternalIsPainting(false);
        stopPainting();
        latestInteraction.current = null;
      }

      try {
        gl.domElement.releasePointerCapture(e.pointerId);
      } catch (err) {}
    };

    window.addEventListener('pointermove', onGlobalPointerMove);
    window.addEventListener('pointerup', onGlobalPointerUp);
    return () => {
      window.removeEventListener('pointermove', onGlobalPointerMove);
      window.removeEventListener('pointerup', onGlobalPointerUp);
    };
  }, [brushSettings.mode, internalIsPainting, stopPainting, gradientSession?.isCreating, gradientSession?.start, setGradientSession, onPaintingChange, gl, camera, previewGradient, renderGradient]);

  useEffect(() => {
    return () => {
      if (pointerRafRef.current !== 0) {
        cancelAnimationFrame(pointerRafRef.current);
      }
    };
  }, []);

  return (
    <>
      {/* Background click-catcher for off-mesh interaction - Only active in gradient mode */}
      {(brushSettings.mode as any) === 'gradient' && (
        <mesh 
          onPointerDown={handlePointerDown}
        >
          <sphereGeometry args={[1000, 32, 32]} />
          <meshBasicMaterial transparent opacity={0} side={THREE.BackSide} depthWrite={false} />
        </mesh>
      )}

      <group 
        position={modelTransform?.position} 
        rotation={modelTransform?.rotation} 
        scale={modelTransform?.scale}
        visible={isVisible}
      >
        <group ref={groupRef}>
          {modelParts.length > 0 ? (
            modelParts.map((part) => {
              if (!part.visible) return null;
              return (
                <mesh
                  key={part.id}
                  geometry={part.geometry}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerLeave}
                  onPointerCancel={handlePointerUp}
                />
              );
            })
          ) : (
            <mesh
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              onPointerCancel={handlePointerUp}
            >
              <sphereGeometry args={[2, 128, 128]} />
            </mesh>
          )}
        </group>

        {showWireframe && (
          <group>
            {modelParts.length > 0 ? (
              modelParts.map((part) => {
                if (!part.visible) return null;
                return (
                  <mesh key={`wire-${part.id}`} geometry={part.geometry}>
                    <meshBasicMaterial
                      color="#00ff00"
                      wireframe
                      transparent
                      opacity={0.3}
                      depthTest={false}
                    />
                  </mesh>
                );
              })
            ) : (
              <mesh>
                <sphereGeometry args={[2, 128, 128]} />
                <meshBasicMaterial
                  color="#00ff00"
                  wireframe
                  transparent
                  opacity={0.3}
                />
              </mesh>
            )}
          </group>
        )}
      </group>

      {isVisible && brushSettings.mode !== 'gradient' && (
        <group ref={cursorGroupRef} visible={false}>
          {/* Main Cursor Ring */}
          <mesh ref={cursorRingRef}>
            <ringGeometry args={[0.95, 1, 32]} />
            <meshBasicMaterial 
              color={brushSettings.color} 
              opacity={0.6} 
              transparent 
              depthTest={false} 
              depthWrite={false} 
              side={THREE.DoubleSide} 
            />
          </mesh>

          {/* Symmetry Cursors Pool (32 max) */}
          <group ref={symmetryGroupRef}>
            {Array.from({ length: 32 }).map((_, i) => (
               <group key={i} visible={false}>
                 <mesh>
                   <ringGeometry args={[0.95, 1, 32]} />
                   <meshBasicMaterial 
                     color={brushSettings.color} 
                     opacity={0.4} 
                     transparent 
                     depthTest={false} 
                     depthWrite={false} 
                     side={THREE.DoubleSide} 
                   />
                 </mesh>
                 <mesh>
                   <circleGeometry args={[0.05, 16]} />
                   <meshBasicMaterial 
                     color={brushSettings.color} 
                     opacity={0.6} 
                     transparent 
                     depthTest={false} 
                     depthWrite={false} 
                     side={THREE.DoubleSide} 
                   />
                 </mesh>
               </group>
            ))}
          </group>

          {/* Lazy Mouse Cursor */}
          <group ref={lazyGroupRef} visible={false}>
             <mesh>
                <ringGeometry args={[0.45, 0.5, 16]} />
                <meshBasicMaterial color="#ffffff" opacity={0.6} transparent depthTest={false} />
             </mesh>
             <Line 
                ref={lazyLineRef}
                points={[new THREE.Vector3(0,0,0), new THREE.Vector3(0.01, 0.01, 0.01)]} 
                color="#ffffff" 
                lineWidth={1} 
                transparent 
                opacity={0.3} 
                depthTest={false}
             />
          </group>
        </group>
      )}

      {(brushSettings.mode as any) === 'gradient' && gradientSession && gradientSession.isCreating && (
        <group renderOrder={999}>
          {/* Main Direction Line - Thin White */}
          <Line 
            points={[gradientSession.start, gradientSession.end]} 
            color="#ffffff" 
            lineWidth={1}
            transparent
            opacity={0.6}
            depthTest={false}
          />
          
          {/* Start Handle - White Circle (Smaller) */}
          <mesh position={gradientSession.start}>
            <sphereGeometry args={[0.008, 16, 16]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={1} />
          </mesh>

          {/* End Handle - Blue Ring (Stroke Style) */}
          <mesh position={gradientSession.end}>
            {/* Outer White Glow/Stroke effect */}
            <mesh>
              <sphereGeometry args={[0.014, 16, 16]} />
              <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.3} />
            </mesh>
            {/* Main Blue Ring */}
            <mesh>
              <sphereGeometry args={[0.012, 16, 16]} />
              <meshBasicMaterial color="#3b82f6" depthTest={false} transparent opacity={1} />
            </mesh>
            {/* Inner Hollow Center (Simulation) */}
            <mesh scale={[0.8, 0.8, 0.8]}>
               <sphereGeometry args={[0.012, 16, 16]} />
               <meshBasicMaterial color="#121214" depthTest={false} transparent opacity={1} />
            </mesh>
          </mesh>
        </group>
      )}
    </>
  );
};

export default PaintableMesh;
