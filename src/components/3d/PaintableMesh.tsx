import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { useWebGLPaint } from '@/hooks/useWebGLPaint';
import type { BrushSettings } from '@/hooks/useWebGLPaint';
import type { OverlayData } from '@/components/ui-custom/OverlayManager';
import type { PerformanceConfig } from '@/App';

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
  onLoadingProgress?: (progress: number, status: string) => void;
  isVisible?: boolean;
  performanceConfig?: PerformanceConfig;
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
  performanceConfig
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, gl, size } = useThree();
  const pointerRafRef = useRef<number>(0);
  const [cursor, setCursor] = useState<{ point: THREE.Vector3; normal: THREE.Vector3; radius: number, lazyPoint?: THREE.Vector3 } | null>(null);
  const isOrbitingRef = useRef(false);
  const isPickingRef = useRef(false);
  const frameCountRef = useRef(0);
  
  const { 
    initPaintSystem, startPainting, paint, stopPainting,
    texture, previewCanvas,
    layers, activeLayerId, addLayer, addFolder, removeLayer, updateLayer, setLayerActive, moveLayer, reorderLayer, clearCanvas, fillCanvas, undo, redo, exportTexture, sampleColor,
    createLayerMask, deleteLayerMask, toggleLayerMask, setEditingMask,
    exportProjectLayersData, importProjectLayersData
  } = useWebGLPaint(
    groupRef,
    brushSettings,
    [modelParts],
    activeStencil,
    onColorPainted,
    performanceConfig
  );

  const [loadingProgress, setLoadingProgress] = useState({ matcap: 0, layers: 0 });

  useEffect(() => {
    const total = (loadingProgress.matcap + loadingProgress.layers) / 2;
    if (onLoadingProgress) {
      const status = loadingProgress.layers < 100 ? 'Carregando camadas...' : 'Finalizando materiais...';
      onLoadingProgress(total, status);
    }
  }, [loadingProgress, onLoadingProgress]);

  useEffect(() => {
    if (onLayerControlsReady) {
      onLayerControlsReady({ 
        layers, activeLayerId, addLayer, addFolder, removeLayer, updateLayer, setLayerActive, moveLayer, reorderLayer, 
        clearCanvas, fillCanvas, undo, redo, exportTexture, 
        createLayerMask, deleteLayerMask, toggleLayerMask, setEditingMask,
        exportProjectLayersData, 
        importProjectLayersData: (data: any[]) => {
          setLoadingProgress(p => ({ ...p, layers: 0 }));
          return importProjectLayersData(data, (prog) => {
            setLoadingProgress(p => ({ ...p, layers: prog }));
          });
        }
      });
    }
  }, [layers, activeLayerId, addLayer, addFolder, removeLayer, updateLayer, setLayerActive, moveLayer, reorderLayer, clearCanvas, fillCanvas, undo, redo, exportTexture, onLayerControlsReady, createLayerMask, deleteLayerMask, toggleLayerMask, setEditingMask, exportProjectLayersData, importProjectLayersData]);

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
            map: texture || null, 
            flatShading, 
            color: objectColor,
            transparent: true,
            depthWrite: true,
            alphaTest: 0.001
          })
        : new THREE.MeshStandardMaterial({ 
            map: texture || null, 
            roughness, 
            metalness, 
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
  }, [texture, flatShading, matcapName, matcapTexture, objectColor, roughness, metalness]);

  const updateCursor = useCallback((hit: THREE.Intersection | undefined, pressure: number = 1.0) => {
    if (hit) {
      const dist = camera.position.distanceTo(hit.point);
      let radius = 0.1;
      const dynamicSize = brushSettings.size * Math.max(0.05, pressure);

      if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
        const worldHeight = 2 * dist * Math.tan(fov / 2);
        radius = (dynamicSize / size.height) * worldHeight * 0.5;
      } else {
        const ortho = camera as THREE.OrthographicCamera;
        const worldHeight = ortho.top - ortho.bottom;
        radius = (dynamicSize / size.height) * worldHeight * 0.5;
      }

      const normal = hit.face?.normal.clone() || new THREE.Vector3(0, 0, 1);
      // Transform normal by the intersected object's world matrix
      if (hit.object) {
         normal.transformDirection(hit.object.matrixWorld).normalize();
      }

      setCursor({ 
        point: hit.point, 
        normal, 
        radius,
        lazyPoint: brushSettings.lazyMouse ? (useWebGLPaint as any).lazyPoint?.clone() : undefined
      });
    } else {
      setCursor(null);
    }
  }, [camera, brushSettings.size, brushSettings.lazyMouse, size.height]);

  // Hold latest interaction for throttled move
  const latestInteraction = useRef<{ hit: THREE.Intersection, pressure: number } | null>(null);

  const processPointerEvent = useCallback(() => {
    pointerRafRef.current = 0;
    const interaction = latestInteraction.current;
    if (!interaction) return;

    updateCursor(interaction.hit, interaction.pressure);
    paint(interaction.hit, interaction.pressure);
  }, [paint, updateCursor]);

  const handlePointerDown = useCallback(
    (event: any) => {
      event.stopPropagation();
      const nativeEvent = event.nativeEvent as PointerEvent;
      
      // If we clicked on the background or use secondary buttons, we are orbiting
      if (nativeEvent.buttons > 1) {
        isOrbitingRef.current = true;
        setCursor(null);
        return;
      }
      
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
      if (pressure === 0 && nativeEvent.pointerType !== 'pen') pressure = 1.0;
      
      onPaintingChange?.(true);
      startPainting(hit, pressure);
      updateCursor(hit, pressure);
      gl.domElement.setPointerCapture(nativeEvent.pointerId);
    },
    [startPainting, updateCursor, onPaintingChange, gl, sampleColor, brushSettings, onBrushSettingsChange]
  );

  const handlePointerMove = useCallback(
    (event: any) => {
      const hit = event.intersections[0] as THREE.Intersection;
      if (!hit) {
        setCursor(null);
        return;
      }
      
      const nativeEvent = event.nativeEvent as PointerEvent;

      // Skip cursor updates if we are orbiting or using secondary buttons
      if (isOrbitingRef.current || (nativeEvent.pointerType === 'mouse' && nativeEvent.buttons > 1)) {
        setCursor(null);
        return;
      }

      let pressure = nativeEvent.pointerType === 'pen' ? nativeEvent.pressure : 1.0;
      if (pressure === 0 && nativeEvent.pointerType !== 'pen') pressure = 1.0;
      
      // Raycast Throttling
      frameCountRef.current++;
      const throttle = performanceConfig?.raycastThrottle || 1;
      if (throttle > 1 && frameCountRef.current % throttle !== 0) {
        return;
      }

      latestInteraction.current = { hit, pressure };
      if (pointerRafRef.current === 0) {
        pointerRafRef.current = requestAnimationFrame(processPointerEvent);
      }
    },
    [processPointerEvent, performanceConfig]
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

      onPaintingChange?.(false);
      stopPainting();
      
      const nativeEvent = event.nativeEvent;
      try {
        gl.domElement.releasePointerCapture(nativeEvent.pointerId);
      } catch (e) {
        // Ignore if pointer capture was not set
      }
    },
    [gl, stopPainting, onPaintingChange]
  );

  const handlePointerLeave = useCallback((event: any) => {
    handlePointerUp(event);
    setCursor(null);
  }, [handlePointerUp]);

  useEffect(() => {
    return () => {
      if (pointerRafRef.current !== 0) {
        cancelAnimationFrame(pointerRafRef.current);
      }
    };
  }, []);

  // Geometry is passed directly to the mesh props to avoid R3F <primitive> attach/detach issues across multiple meshes

  return (
    <>
      <group 
        position={modelTransform?.position} 
        rotation={modelTransform?.rotation} 
        scale={modelTransform?.scale}
        visible={isVisible}
      >
        {/* Main paintable group containing all visible submeshes */}
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

      {/* Wireframe overlay group */}
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

      {cursor && isVisible && (
        <group>
          {/* Main Cursor */}
          <mesh 
            position={cursor.point} 
            quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), cursor.normal)}
          >
            <ringGeometry args={[cursor.radius * 0.95, cursor.radius, 32]} />
            <meshBasicMaterial 
              color={brushSettings.color} 
              opacity={0.4} 
              transparent 
              depthTest={false} 
              depthWrite={false} 
              side={THREE.DoubleSide} 
            />
          </mesh>

          {/* Advanced Symmetry Indicators */}
          {(() => {
            if (!brushSettings.symmetryMode || brushSettings.symmetryMode === 'none') return null;
            
            const mode = brushSettings.symmetryMode;
            const axis = brushSettings.symmetryAxis || 'x';
            const symmetryPoints: { pos: THREE.Vector3, normal: THREE.Vector3 }[] = [];

            if (mode === 'mirror') {
              const pos = cursor.point.clone();
              const norm = cursor.normal.clone();
              if (axis === 'x') { pos.x *= -1; norm.x *= -1; }
              else if (axis === 'y') { pos.y *= -1; norm.y *= -1; }
              else if (axis === 'z') { pos.z *= -1; norm.z *= -1; }
              symmetryPoints.push({ pos, normal: norm });
            } else if (mode === 'radial') {
              const points = brushSettings.radialPoints || 4;
              const angleStep = (Math.PI * 2) / points;
              for (let i = 1; i < points; i++) {
                const pos = cursor.point.clone();
                const norm = cursor.normal.clone();
                const theta = angleStep * i;
                
                if (axis === 'y') {
                  pos.set(cursor.point.x * Math.cos(theta) - cursor.point.z * Math.sin(theta), cursor.point.y, cursor.point.x * Math.sin(theta) + cursor.point.z * Math.cos(theta));
                  norm.set(cursor.normal.x * Math.cos(theta) - cursor.normal.z * Math.sin(theta), cursor.normal.y, cursor.normal.x * Math.sin(theta) + cursor.normal.z * Math.cos(theta));
                } else if (axis === 'x') {
                  pos.set(cursor.point.x, cursor.point.y * Math.cos(theta) - cursor.point.z * Math.sin(theta), cursor.point.y * Math.sin(theta) + cursor.point.z * Math.cos(theta));
                  norm.set(cursor.normal.x, cursor.normal.y * Math.cos(theta) - cursor.normal.z * Math.sin(theta), cursor.normal.y * Math.sin(theta) + cursor.normal.z * Math.cos(theta));
                } else if (axis === 'z') {
                  pos.set(cursor.point.x * Math.cos(theta) - cursor.point.y * Math.sin(theta), cursor.point.x * Math.sin(theta) + cursor.point.y * Math.cos(theta), cursor.point.z);
                  norm.set(cursor.normal.x * Math.cos(theta) - cursor.normal.y * Math.sin(theta), cursor.normal.x * Math.sin(theta) + cursor.normal.y * Math.cos(theta), cursor.normal.z);
                }
                symmetryPoints.push({ pos, normal: norm });
              }
            }

            return symmetryPoints.map((p, i) => (
              <group 
                key={`sym-${i}`}
                position={p.pos} 
                quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.normal.normalize())}
              >
                {/* Outer Ring */}
                <mesh>
                  <ringGeometry args={[cursor.radius * 0.95, cursor.radius, 32]} />
                  <meshBasicMaterial 
                    color={brushSettings.color} 
                    opacity={0.4} 
                    transparent 
                    depthTest={false} 
                    depthWrite={false} 
                    side={THREE.DoubleSide} 
                  />
                </mesh>
                
                {/* Inner Dot for center precise location */}
                <mesh>
                  <circleGeometry args={[cursor.radius * 0.05, 16]} />
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
            ));
          })()}

          {/* Lazy Mouse Indicator */}
          {brushSettings.lazyMouse && cursor.lazyPoint && (
             <group>
               <mesh position={cursor.lazyPoint} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), cursor.normal)}>
                 <ringGeometry args={[cursor.radius * 0.45, cursor.radius * 0.5, 16]} />
                 <meshBasicMaterial color="#ffffff" opacity={0.6} transparent depthTest={false} />
               </mesh>
               <Line 
                 points={[cursor.point, cursor.lazyPoint]} 
                 color="#ffffff" 
                 lineWidth={1} 
                 transparent 
                 opacity={0.3} 
                 depthTest={false}
               />
             </group>
          )}
        </group>
      )}
    </>
  );
};

export default PaintableMesh;
