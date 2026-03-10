import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface UVOverlayPanelProps {
  texture: THREE.CanvasTexture | null;
  geometry: THREE.BufferGeometry | null;
}

const UV_CACHE_SIZE = 512;

export const UVOverlayPanel: React.FC<UVOverlayPanelProps> = ({ texture, geometry }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showUVs, setShowUVs] = useState(true);

  // All live values stored in refs — closures (ResizeObserver, rAF) always read the latest version
  const showUVsRef = useRef(true);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const uvCacheRef = useRef<HTMLCanvasElement | null>(null);

  // Sync props into refs every render so stale closures are never a problem
  textureRef.current = texture;
  geometryRef.current = geometry;

  // ---------------------------------------------------------------------------
  // Build UV wireframe into a fixed-size offscreen canvas (done once per geometry)
  // ---------------------------------------------------------------------------
  const buildUVCache = useCallback(() => {
    const geom = geometryRef.current;
    if (!geom) { uvCacheRef.current = null; return; }

    const uvs = geom.attributes.uv?.array as Float32Array;
    const indices = geom.index?.array;
    if (!uvs) return;

    const S = UV_CACHE_SIZE;
    const offscreen = document.createElement('canvas');
    offscreen.width = S;
    offscreen.height = S;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    const numFaces = indices ? indices.length / 3 : uvs.length / 6;
    ctx.strokeStyle = 'rgba(0, 220, 80, 0.65)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();

    const wrap = (v: number) => { const r = v % 1; return r < 0 ? r + 1 : r; };

    for (let i = 0; i < numFaces; i++) {
      let a, b, c;
      if (indices) { a = indices[i*3]; b = indices[i*3+1]; c = indices[i*3+2]; }
      else { a = i*3; b = i*3+1; c = i*3+2; }

      const uA = wrap(uvs[a*2]); const vA = wrap(uvs[a*2+1]);
      const uB = wrap(uvs[b*2]); const vB = wrap(uvs[b*2+1]);
      const uC = wrap(uvs[c*2]); const vC = wrap(uvs[c*2+1]);

      if (
        Math.abs(uA-uB)>0.5||Math.abs(uA-uC)>0.5||Math.abs(uB-uC)>0.5||
        Math.abs(vA-vB)>0.5||Math.abs(vA-vC)>0.5||Math.abs(vB-vC)>0.5
      ) continue;

      ctx.moveTo(uA*S, (1-vA)*S);
      ctx.lineTo(uB*S, (1-vB)*S);
      ctx.lineTo(uC*S, (1-vC)*S);
      ctx.closePath();
    }
    ctx.stroke();
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

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, displayW, displayH);

    const tex = textureRef.current;
    const padding = 16;
    let drawRect = { x: padding, y: padding, w: displayW - padding*2, h: displayH - padding*2 };

    if (tex && tex.image) {
      const img = tex.image as HTMLCanvasElement;
      if (img.width > 0 && img.height > 0) {
        const aspect = img.width / img.height;
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
        ctx.drawImage(img, drawRect.x, drawRect.y, drawRect.w, drawRect.h);
      }
    }

    if (showUVsRef.current && uvCacheRef.current) {
      ctx.drawImage(uvCacheRef.current, drawRect.x, drawRect.y, drawRect.w, drawRect.h);
    }
  }, []); // empty deps — reads everything from refs, never goes stale

  // ---------------------------------------------------------------------------
  // Pre-build UV cache on idle whenever geometry prop changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    uvCacheRef.current = null;
    if (!geometry) return;

    const idleCb = (window as any).requestIdleCallback;
    const id = idleCb
      ? idleCb(() => { buildUVCache(); drawFrame(); })
      : setTimeout(() => { buildUVCache(); drawFrame(); }, 50);

    return () => {
      if ((window as any).cancelIdleCallback) (window as any).cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [geometry, buildUVCache, drawFrame]);

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
      const tex = textureRef.current;
      if (tex && tex.version !== lastVersion) {
        lastVersion = tex.version;
        drawFrame();
      }
      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame]); // stable, runs once

  const handleShowUVsChange = (val: boolean) => {
    showUVsRef.current = val;
    setShowUVs(val);
    drawFrame();
  };

  return (
    <div className="w-full h-full relative bg-[#09090b]" ref={containerRef}>
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0 }} />
      <div className="absolute top-4 left-4 bg-[#121214]/90 backdrop-blur-md rounded-xl p-3 border border-white/10 shadow-2xl z-10">
        <div className="flex items-center gap-3">
          <Switch id="uv-toggle" checked={showUVs} onCheckedChange={handleShowUVsChange} className="scale-75 origin-left" />
          <Label htmlFor="uv-toggle" className="text-zinc-300 text-xs flex items-center gap-2 cursor-pointer font-semibold uppercase tracking-wider">
            Show UV Overlay
          </Label>
        </div>
      </div>
    </div>
  );
};
