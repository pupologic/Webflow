import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useWebGLPaint } from '@/hooks/useWebGLPaint';
import type { BrushSettings } from '@/hooks/useWebGLPaint';

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
  customGeometry?: THREE.BufferGeometry | null;
  onTextureChange?: (texture: THREE.CanvasTexture | null) => void;
  showWireframe?: boolean;
  flatShading?: boolean;
  textureResolution?: number;
  matcapName?: string | null;
  objectColor?: string;
  roughness?: number;
  metalness?: number;
  onPaintingChange?: (isPainting: boolean) => void;
  onLayerControlsReady?: (controls: any) => void;
}

export const PaintableMesh: React.FC<PaintableMeshProps> = ({
  brushSettings,
  customGeometry,
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
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireframeRef = useRef<THREE.Mesh>(null);
  const { camera, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const pointerRafRef = useRef<number>(0);
  const pointerEventData = useRef<{ event: React.PointerEvent<THREE.Mesh>, isDown: boolean } | null>(null);
  const [cursor, setCursor] = useState<{ point: THREE.Vector3; normal: THREE.Vector3; radius: number } | null>(null);
  
  const { 
    initPaintSystem, startPainting, paint, stopPainting,
    texture,
    layers, activeLayerId, addLayer, removeLayer, updateLayer, setLayerActive, moveLayer, clearCanvas, fillCanvas, undo, redo, exportTexture
  } = useWebGLPaint(
    meshRef,
     brushSettings
  );

  useEffect(() => {
    if (onLayerControlsReady) {
      onLayerControlsReady({ layers, activeLayerId, addLayer, removeLayer, updateLayer, setLayerActive, moveLayer, clearCanvas, fillCanvas, undo, redo, exportTexture });
    }
  }, [layers, activeLayerId, addLayer, removeLayer, updateLayer, setLayerActive, moveLayer, clearCanvas, fillCanvas, undo, redo, exportTexture, onLayerControlsReady]);

  // Initialize texture on mount and when resolution changes
  useEffect(() => {
    initPaintSystem(textureResolution);
  }, [initPaintSystem, textureResolution]);

  useEffect(() => {
    if (texture && onTextureChange) {
      onTextureChange(texture as any);
    }
  }, [texture, onTextureChange]);

  const [matcapTexture, setMatcapTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (matcapName && MATCAPS_URLS[matcapName]) {
      const loader = new THREE.TextureLoader();
      loader.load(MATCAPS_URLS[matcapName], (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        setMatcapTexture(texture);
      });
    } else {
      setMatcapTexture(null);
    }
  }, [matcapName]);

  // Update material when texture or material props change
  useEffect(() => {
    if (meshRef.current) {
      if (matcapName && matcapTexture) {
          meshRef.current.material = new THREE.MeshMatcapMaterial({
           matcap: matcapTexture,
           map: texture || null,
           flatShading: flatShading,
           color: objectColor
         });
      } else {
         meshRef.current.material = new THREE.MeshStandardMaterial({
           map: texture || null,
           roughness: roughness,
           metalness: metalness,
           flatShading: flatShading,
           color: objectColor
         });
      }
    }
  }, [texture, flatShading, matcapName, matcapTexture, objectColor, roughness, metalness]);

  const updateCursor = useCallback((intersects: THREE.Intersection[]) => {
    if (intersects.length > 0) {
      const hit = intersects[0];
      const dist = camera.position.distanceTo(hit.point);
      const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const worldHeight = 2 * dist * Math.tan(fov / 2);
      const radius = (brushSettings.size / window.innerHeight) * worldHeight * 0.5;

      const normal = hit.face?.normal.clone() || new THREE.Vector3(0, 0, 1);
      if (meshRef.current) {
         normal.transformDirection(meshRef.current.matrixWorld).normalize();
      }

      setCursor({ point: hit.point, normal, radius });
    } else {
      setCursor(null);
    }
  }, [camera, brushSettings.size]);

  const processPointerEvent = useCallback(() => {
    pointerRafRef.current = 0;
    const data = pointerEventData.current;
    if (!data) return;
    pointerEventData.current = null;

    const { event, isDown } = data;
    const mesh = meshRef.current;
    if (!mesh) return;

    const nativeEvent = event.nativeEvent;
    const rect = gl.domElement.getBoundingClientRect();
    mouse.current.x = ((nativeEvent.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.current.y = -((nativeEvent.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.current.setFromCamera(mouse.current, camera);
    const intersects = raycaster.current.intersectObject(mesh);
    updateCursor(intersects);

    if (intersects.length > 0) {
      if (isDown) {
        onPaintingChange?.(true);
        startPainting(intersects[0]);
        gl.domElement.setPointerCapture(nativeEvent.pointerId);
      } else {
        paint(intersects[0]);
      }
    }
  }, [camera, gl, startPainting, paint, onPaintingChange, updateCursor]);

  // Handle mouse events for painting
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<THREE.Mesh>) => {
      event.stopPropagation();
      // Execute immediately for responsiveness on initial touch
      pointerEventData.current = { event, isDown: true };
      processPointerEvent();
    },
    [processPointerEvent]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<THREE.Mesh>) => {
      // Throttle pointer move to 1 call per frame (fixes 120Hz/240Hz tablet lag)
      pointerEventData.current = { event, isDown: false };
      if (pointerRafRef.current === 0) {
        pointerRafRef.current = requestAnimationFrame(processPointerEvent);
      }
    },
    [processPointerEvent]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<THREE.Mesh>) => {
      event.stopPropagation();
      
      // Clear any pending frame
      if (pointerRafRef.current !== 0) {
        cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = 0;
        pointerEventData.current = null;
      }

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

  const handlePointerLeave = useCallback((event: React.PointerEvent<THREE.Mesh>) => {
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
    <group>
      {/* Main paintable mesh */}
      <mesh
        ref={meshRef}
        geometry={customGeometry || undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      >
        {!customGeometry && <sphereGeometry args={[2, 128, 128]} />}
      </mesh>

      {/* Wireframe overlay */}
      {showWireframe && (
        <mesh ref={wireframeRef} geometry={customGeometry || undefined}>
          {!customGeometry && <sphereGeometry args={[2, 128, 128]} />}
          <meshBasicMaterial
            color="#00ff00"
            wireframe
            transparent
            opacity={0.3}
          />
        </mesh>
      )}

      {/* Brush Cursor Indicator */}
      {cursor && (
        <mesh 
          position={cursor.point} 
          quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), cursor.normal)}
        >
          <ringGeometry args={[cursor.radius * 0.9, cursor.radius, 32]} />
          <meshBasicMaterial 
            color={brushSettings.color} 
            opacity={0.6} 
            transparent 
            depthTest={false} 
            depthWrite={false} 
            side={THREE.DoubleSide} 
          />
        </mesh>
      )}
    </group>
  );
};
