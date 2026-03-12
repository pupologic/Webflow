import React, { useState, useCallback, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { PaintableMesh } from './PaintableMesh';
import type { BrushSettings } from '@/hooks/useWebGLPaint';
import type { OverlayData } from '@/components/ui-custom/OverlayManager';
import type { PerformanceConfig } from '@/App';

interface Scene3DProps {
  brushSettings: BrushSettings;
  modelParts: any[];
  modelTransform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  showGrid?: boolean;
  showWireframe?: boolean;
  flatShading?: boolean;
  textureResolution?: number;
  matcapName?: string | null;
  lightSetup?: '3point' | 'directional' | 'ambient';
  lightIntensity?: number;
  focalLength?: number;
  objectColor?: string;
  roughness?: number;
  metalness?: number;
  envIntensity?: number;
  envRotation?: number;
  backgroundColor?: string;
  onTextureChange?: (texture: THREE.Texture | null, previewCanvas?: HTMLCanvasElement) => void;
  onLayerControlsReady?: (controls: any) => void;
  activeStencil?: OverlayData;
  onColorPainted?: (color: string) => void;
  onLoadingProgress?: (progress: number, status: string) => void;
  isModelVisible?: boolean;
  performanceConfig?: PerformanceConfig;
}

const CameraController = ({ focalLength }: { focalLength: number }) => {
  const { camera } = useThree();
  const { gl } = useThree();

  React.useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.setFocalLength(focalLength);
      camera.updateProjectionMatrix();
    }
  }, [camera, focalLength, gl.domElement.clientWidth, gl.domElement.clientHeight]);

  return null;
};

const EnvRotator = ({ envRotation }: { envRotation: number }) => {
  const { scene } = useThree();
  React.useEffect(() => {
    // In newer Three.js versions, environmentRotation is a Euler which requires .set()
    if (scene.environmentRotation) {
      scene.environmentRotation.set(0, envRotation, 0, 'XYZ');
    }
    if (scene.backgroundRotation) {
      scene.backgroundRotation.set(0, envRotation, 0, 'XYZ');
    }
  }, [scene, envRotation]);
  return null;
};

export const Scene3D: React.FC<Scene3DProps> = ({
  brushSettings,
  modelParts,
  modelTransform,
  showGrid = true,
  showWireframe = false,
  flatShading = false,
  textureResolution = 2048,
  matcapName = null,
  lightSetup = '3point',
  lightIntensity = 1,
  focalLength = 35,
  objectColor = '#e5e5e5',
  roughness = 0.8,
  metalness = 0.1,
  envIntensity = 1,
  envRotation = 0,
  onTextureChange,
  onLayerControlsReady,
  activeStencil,
  onColorPainted,
  onLoadingProgress,
  isModelVisible = true,
  performanceConfig
}) => {
  const [cameraPosition] = useState<[number, number, number]>([0, 0, 8]);
  const controlsRef = useRef<any>(null);

  const handlePaintingChange = useCallback((isPainting: boolean) => {
    if (controlsRef.current) {
      controlsRef.current.enabled = !isPainting;
      controlsRef.current.enablePan = !isPainting;
      controlsRef.current.enableZoom = !isPainting;
      controlsRef.current.enableRotate = !isPainting;
    }
  }, []);

  const handleTextureChange = useCallback((texture: THREE.Texture | null, previewCanvas?: HTMLCanvasElement) => {
    if (onTextureChange) {
      onTextureChange(texture, previewCanvas);
    }
  }, [onTextureChange]);

  return (
    <div className="w-full h-full" style={{ background: `linear-gradient(to bottom, #2a2a2e 0%, #0c0c0e 100%)` }}>
      <Canvas
        camera={{ position: cameraPosition, fov: 50 }}
        gl={{ 
          antialias: true, 
          alpha: true,
          preserveDrawingBuffer: true,
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <CameraController focalLength={focalLength} />
        {/* Transparent background to allow the div's gradient to show through */}
        
        {/* Performance Stats */}
        
        {/* Absolute reliable environment and background rotation */}
        <EnvRotator envRotation={envRotation} />

        {/* Environment (fallback when no lights or just a small reflection) */}
        {!matcapName && (
          <Environment 
            preset="studio" 
            environmentIntensity={envIntensity} 
            backgroundRotation={[0, envRotation, 0]} 
            environmentRotation={[0, envRotation, 0]} 
          />
        )}
        
        {/* Grid */}
        {showGrid && (
          <Grid
            position={[0, -3, 0]}
            args={[20, 20]}
            cellSize={0.5}
            cellThickness={0.5}
            cellColor="#444444"
            sectionSize={2}
            sectionThickness={1}
            sectionColor="#666666"
            fadeDistance={25}
            fadeStrength={1}
            infiniteGrid
          />
        )}

        <PaintableMesh
          brushSettings={brushSettings}
          modelParts={modelParts}
          modelTransform={modelTransform}
          onTextureChange={handleTextureChange}
          showWireframe={showWireframe}
          flatShading={flatShading}
          textureResolution={textureResolution}
          matcapName={matcapName}
          objectColor={objectColor}
          roughness={roughness}
          metalness={metalness}
          onPaintingChange={handlePaintingChange}
          onLayerControlsReady={onLayerControlsReady}
          activeStencil={activeStencil}
          onColorPainted={onColorPainted}
          onLoadingProgress={onLoadingProgress}
          isVisible={isModelVisible}
          performanceConfig={performanceConfig}
        />

        {/* Lights (all grouped so rotation applies consistently to the lighting setup) */}
        <group rotation={[0, envRotation, 0]}>
          {lightSetup === '3point' && (
            <>
              <ambientLight intensity={0.6 * lightIntensity} />
              <directionalLight position={[5, 4, 5]} intensity={1 * lightIntensity} />
              <directionalLight position={[-5, -4, -5]} intensity={0.5 * lightIntensity} />
              <pointLight position={[1, 5, 1]} intensity={0.5 * lightIntensity} />
            </>
          )}
          
          {lightSetup === 'directional' && (
            <>
              <ambientLight intensity={0.2 * lightIntensity} />
              <directionalLight position={[2, 5, 5]} intensity={1.5 * lightIntensity} />
            </>
          )}

          {lightSetup === 'ambient' && (
            <ambientLight intensity={1.5 * lightIntensity} />
          )}
        </group>

        {/* Camera Controls */}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping={false}
          minDistance={0.5}
          maxDistance={20}
          target={[0, 0, 0]}
        />
      </Canvas>
    </div>
  );
};
