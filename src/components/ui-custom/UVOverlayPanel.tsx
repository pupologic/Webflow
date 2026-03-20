import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface UVOverlayPanelProps {
  previewCanvas: HTMLCanvasElement | null;
  geometries: (THREE.BufferGeometry | null)[];
  isVisible: boolean;
}

const UV_CACHE_SIZE = 1024; // Increased for better detail when zooming

export const UVOverlayPanel: React.FC<UVOverlayPanelProps> = ({ previewCanvas, geometries, isVisible }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showUVs, setShowUVs] = useState(true);

  // All live values stored in refs — closures (ResizeObserver, rAF) always read the latest version
  const showUVsRef = useRef(true);
  const geometriesRef = useRef<(THREE.BufferGeometry | null)[]>([]);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const uvCacheRef = useRef<HTMLCanvasElement | null>(null);
  const prevGeometriesRef = useRef<(THREE.BufferGeometry | null)[]>([]);

  // --- NAVIGATION STATE (stored in refs for performance) ---
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // Sync props into refs every render so stale closures are never a problem
  geometriesRef.current = geometries;
  previewCanvasRef.current = previewCanvas;

  // ---------------------------------------------------------------------------
  // Build UV wireframe into a fixed-size offscreen canvas (done once per geometry)
  // ---------------------------------------------------------------------------
  const buildUVCache = useCallback(() => {
    const geoms = geometriesRef.current.filter(g => g !== null && g !== undefined) as THREE.BufferGeometry[];
    if (geoms.length === 0) { uvCacheRef.current = null; return; }

    const S = UV_CACHE_SIZE;
    const offscreen = document.createElement('canvas');
    offscreen.width = S;
    offscreen.height = S;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    let totalFaces = 0;
    geoms.forEach(geom => {
      const uvs = geom.attributes.uv;
      if (!uvs) return;
      totalFaces += (geom.index ? geom.index.count : uvs.count) / 3;
    });

    const isDense = totalFaces > 80000;
    const isVeryDense = totalFaces > 200000;
    
    // As requested: Simple black UV lines on top of everything
    const uvOpacity = isVeryDense ? 0.3 : (isDense ? 0.5 : 0.8);
    ctx.strokeStyle = `rgba(0, 0, 0, ${uvOpacity})`;
    ctx.lineWidth = isVeryDense ? 0.1 : (isDense ? 0.3 : 0.6);

    ctx.beginPath();
    let currentPathCount = 0;

    geoms.forEach(geom => {
      const uvs = geom.attributes.uv;
      const indices = geom.index;
      if (!uvs) return;

      const numFaces = (indices ? indices.count : uvs.count) / 3;

      for (let i = 0; i < numFaces; i++) {
        let a, b, c;
        if (indices) { a = indices.getX(i*3); b = indices.getX(i*3+1); c = indices.getX(i*3+2); }
        else { a = i*3; b = i*3+1; c = i*3+2; }

        const uA = uvs.getX(a); const vA = uvs.getY(a);
        const uB = uvs.getX(b); const vB = uvs.getY(b);
        const uC = uvs.getX(c); const vC = uvs.getY(c);

        // Sanity check for huge triangles that cross UV space (wrap helper)
        if (
          Math.abs(uA-uB)>0.7||Math.abs(uA-uC)>0.7||Math.abs(uB-uC)>0.7||
          Math.abs(vA-vB)>0.7||Math.abs(vA-vC)>0.7||Math.abs(vB-vC)>0.7
        ) continue;

        ctx.moveTo(uA*S, (1-vA)*S);
        ctx.lineTo(uB*S, (1-vB)*S);
        ctx.lineTo(uC*S, (1-vC)*S);
        ctx.lineTo(uA*S, (1-vA)*S);
        
        currentPathCount++;
        
        // Batch strokes to keep JS execution chunks small and GPU busy
        if (currentPathCount > 8000) {
          ctx.stroke();
          ctx.beginPath();
          currentPathCount = 0;
        }
      }
    });
    
    if (currentPathCount > 0) {
        ctx.stroke();
    }
    
    uvCacheRef.current = offscreen;
  }, []);

  // ---------------------------------------------------------------------------
  // drawFrame: reads exclusively from refs — safe to call from any closure
  // ---------------------------------------------------------------------------
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displayW = container.clientWidth;
    const displayH = container.clientHeight;
    if (displayW === 0 || displayH === 0) return;

    if (canvas.width !== displayW || canvas.height !== displayH) {
      canvas.width = displayW;
      canvas.height = displayH;
    }

    // Draw Checkerboard Background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cellSize = 16;
    const cols = Math.ceil(displayW / cellSize);
    const rows = Math.ceil(displayH / cellSize);
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            ctx.fillStyle = (i + j) % 2 === 0 ? '#121214' : '#09090b';
            ctx.fillRect(j * cellSize, i * cellSize, cellSize, cellSize);
        }
    }

    // Apply zoom/pan transform
    // We center the content on the canvas then apply scale and offset
    ctx.translate(displayW / 2 + offsetRef.current.x, displayH / 2 + offsetRef.current.y);
    ctx.scale(scaleRef.current, scaleRef.current);
    ctx.translate(-displayW / 2, -displayH / 2);

    const padding = 16;
    let drawRect = { x: padding, y: padding, w: displayW - padding*2, h: displayH - padding*2 };

    const pCanvas = previewCanvasRef.current;
    if (pCanvas) {
        const aspect = pCanvas.width / pCanvas.height;
        const availW = displayW - padding*2;
        const availH = displayH - padding*2;

        if (availW / availH > aspect) {
          const tw = availH * aspect;
          drawRect = { x: (displayW-tw)/2, y: padding, w: tw, h: availH };
        } else {
          const th = availW / aspect;
          drawRect = { x: padding, y: (displayH-th)/2, w: availW, h: th };
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(pCanvas, drawRect.x, drawRect.y, drawRect.w, drawRect.h);
    }

    if (showUVsRef.current && uvCacheRef.current) {
        // Simple source-over for black lines on top
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(uvCacheRef.current, drawRect.x, drawRect.y, drawRect.w, drawRect.h);
    }
  }, []); 

  // ---------------------------------------------------------------------------
  // Pre-build UV cache on idle whenever geometry prop changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Only build cache if geometries exist and THE PANEL IS OPEN
    if (!geometries || geometries.length === 0 || !isVisible) {
      return; 
    }

    // Force rebuild if the geometry array reference changed (new model loaded)
    if (geometries !== prevGeometriesRef.current) {
      uvCacheRef.current = null;
      prevGeometriesRef.current = geometries;
    }

    // If we already have a cache, just draw it 
    if (uvCacheRef.current) {
        drawFrame();
        return;
    }

    const idleCb = (window as any).requestIdleCallback;
    const id = idleCb
      ? idleCb(() => { buildUVCache(); drawFrame(); })
      : setTimeout(() => { buildUVCache(); drawFrame(); }, 50);

    return () => {
      if ((window as any).cancelIdleCallback) (window as any).cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [geometries, isVisible, buildUVCache, drawFrame]);

  // ---------------------------------------------------------------------------
  // ResizeObserver: always calls the stable drawFrame closure (reads from refs)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => drawFrame());
    observer.observe(container);
    return () => observer.disconnect();
  }, [drawFrame]);

  // ---------------------------------------------------------------------------
  // rAF: poll texture version, call drawFrame on change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let lastVersion = -1;
    let rafId: number;

    const poll = () => {
      const pc = previewCanvasRef.current as any;
      if (pc && pc.version !== lastVersion) {
        lastVersion = pc.version;
        drawFrame();
      }
      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame]);

  // ---------------------------------------------------------------------------
  // Interaction: Navigation (Zoom & Pan)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY;
      const factor = Math.pow(1.1, delta / 100);
      
      const newScale = Math.max(0.1, Math.min(20, scaleRef.current * factor));
      
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Adjust offset to zoom toward mouse
      const dx = (mouseX - (canvas.width / 2 + offsetRef.current.x)) / scaleRef.current;
      const dy = (mouseY - (canvas.height / 2 + offsetRef.current.y)) / scaleRef.current;

      scaleRef.current = newScale;
      offsetRef.current.x = mouseX - canvas.width / 2 - dx * scaleRef.current;
      offsetRef.current.y = mouseY - canvas.height / 2 - dy * scaleRef.current;

      drawFrame();
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      
      offsetRef.current.x += dx;
      offsetRef.current.y += dy;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      
      drawFrame();
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      canvas.style.cursor = 'crosshair';
    };

    const handleDoubleClick = () => {
      scaleRef.current = 1;
      offsetRef.current = { x: 0, y: 0 };
      drawFrame();
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('dblclick', handleDoubleClick);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('dblclick', handleDoubleClick);
    };
  }, [drawFrame]);

  const handleShowUVsChange = (val: boolean) => {
    showUVsRef.current = val;
    setShowUVs(val);
    drawFrame();
  };

  return (
    <div className="w-full h-full relative bg-[#09090b] overflow-hidden" ref={containerRef}>
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, cursor: 'crosshair', touchAction: 'none' }} />
      <div className="absolute top-4 left-4 bg-[#121214]/90 backdrop-blur-md rounded-xl p-3 border border-white/10 shadow-2xl z-10 select-none">
        <div className="flex items-center gap-3">
          <Switch id="uv-toggle" checked={showUVs} onCheckedChange={handleShowUVsChange} className="scale-75 origin-left" />
          <Label htmlFor="uv-toggle" className="text-zinc-300 text-[10px] flex items-center gap-2 cursor-pointer font-bold uppercase tracking-wider">
            Show UV Overlay
          </Label>
        </div>
        <div className="mt-2 text-[8px] text-zinc-500 uppercase tracking-tight font-medium opacity-60">
          Scroll: Zoom • Drag: Pan • DblClick: Reset
        </div>
      </div>
    </div>
  );
};
