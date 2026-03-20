import React, { useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { 
  Download, 
  Layers, 
  Image as ImageIcon, 
  AlertCircle,
  FileDown,
  ChevronRight
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { GPULayer, PBRMapType } from '@/hooks/useWebGLPaint';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  layers: GPULayer[];
  pbrTargets: Record<PBRMapType, THREE.WebGLRenderTarget | null>;
  exportTarget: (target: THREE.WebGLRenderTarget) => Promise<Blob | string | undefined>;
  projectName: string;
}

interface ExportItem {
  id: string;
  name: string;
  type: 'merged' | 'layer';
  mapType: PBRMapType;
  target: THREE.WebGLRenderTarget;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  layers,
  pbrTargets,
  exportTarget,
  projectName
}) => {
  const [tab, setTab] = useState<'merged' | 'layers'>('merged');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [namingPattern] = useState('{PROJECT}_{NAME}_{TYPE}');
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Derive exportable items with memoization to prevent useEffect loops
  const mergedItems: ExportItem[] = React.useMemo(() => Object.entries(pbrTargets)
    .filter(([_, target]) => target !== null)
    .map(([type, target]) => ({
      id: `merged_${type}`,
      name: type.charAt(0).toUpperCase() + type.slice(1),
      type: 'merged',
      mapType: type as PBRMapType,
      target: target as THREE.WebGLRenderTarget
    })), [pbrTargets]);

  const layerItems: ExportItem[] = React.useMemo(() => layers
    .filter(l => !l.isFolder && l.target)
    .map(l => ({
      id: l.id,
      name: l.name,
      type: 'layer',
      mapType: l.mapType,
      target: l.target as THREE.WebGLRenderTarget
    })), [layers]);

  const currentItems = tab === 'merged' ? mergedItems : layerItems;

  // Handle Preview
  useEffect(() => {
    let active = true;
    const generatePreview = async () => {
      if (!previewId) {
        setPreviewUrl(null);
        return;
      }

      const item = [...mergedItems, ...layerItems].find(it => it.id === previewId);
      if (item && item.target) {
        setIsPreviewLoading(true);
        try {
            const result = await exportTarget(item.target);
            if (active) {
                if (result instanceof Blob) {
                    const url = URL.createObjectURL(result);
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(url);
                } else if (typeof result === 'string') {
                    setPreviewUrl(result);
                }
            }
        } catch (err) {
            console.error("Preview generation failed", err);
        } finally {
            if (active) setIsPreviewLoading(false);
        }
      }
    };

    generatePreview();
    return () => { active = false; };
  }, [previewId, exportTarget, mergedItems, layerItems]);

  // Revoke preview URL on close
  useEffect(() => {
    if (!isOpen && previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [isOpen, previewUrl]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleExport = useCallback(async (ids: string[]) => {
    setIsExporting(true);
    const allItems = [...mergedItems, ...layerItems];
    
    try {
        for (const id of ids) {
            const item = allItems.find(it => it.id === id);
            if (!item) continue;

            const result = await exportTarget(item.target);
            if (!result) continue;

            const blob = result instanceof Blob ? result : await (await fetch(result)).blob();
            
            // Generate Filename
            let filename = namingPattern
                .replace('{PROJECT}', projectName || 'Project')
                .replace('{NAME}', item.name)
                .replace('{TYPE}', item.mapType)
                .replace(/\s+/g, '_');
            
            filename += '.png';

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
            
            // Artificial delay to prevent browser download batching issues
            await new Promise(r => setTimeout(r, 200));
        }
    } catch (err) {
        console.error("Export failed", err);
    } finally {
        setIsExporting(false);
    }
  }, [exportTarget, mergedItems, layerItems, namingPattern, projectName]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full sm:max-w-[800px] h-[75vh] bg-zinc-950 border-white/10 text-white flex flex-col p-0 gap-0 overflow-hidden shadow-2xl">
        <DialogHeader className="p-6 border-b border-white/5 shrink-0">
          <div className="flex justify-between items-center">
            <div>
                <DialogTitle className="text-xl font-semibold flex items-center gap-2 text-zinc-100">
                    <Download className="w-5 h-5 text-blue-400" />
                    Export PBR Assets
                </DialogTitle>
                <DialogDescription className="text-zinc-400">
                    Export your project as high-quality PNG textures.
                </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Selection */}
          <div className="w-64 shrink-0 border-r border-white/5 flex flex-col bg-zinc-900/20">
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
              <TabsList className="w-full bg-transparent border-b border-white/5 rounded-none h-12">
                <TabsTrigger value="merged" className="flex-1 data-[state=active]:bg-white/5 data-[state=active]:text-white text-zinc-400 rounded-none h-full transition-colors">
                    <ImageIcon className="w-3.5 h-3.5 mr-2" />
                    Merged
                </TabsTrigger>
                <TabsTrigger value="layers" className="flex-1 data-[state=active]:bg-white/5 data-[state=active]:text-white text-zinc-400 rounded-none h-full transition-colors">
                    <Layers className="w-3.5 h-3.5 mr-2" />
                    Layers
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1 h-[calc(75vh-220px)]">
                <div className="p-4 space-y-1">
                  {currentItems.map(item => (
                    <div 
                      key={item.id}
                      onClick={() => setPreviewId(item.id)}
                      className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all group ${
                        previewId === item.id ? 'bg-blue-600/10 border-blue-500/20' : 'hover:bg-white/5'
                      }`}
                    >
                      <Checkbox 
                        checked={selectedIds.has(item.id)}
                        onCheckedChange={() => toggleSelect(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="border-zinc-700 data-[state=checked]:bg-blue-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-zinc-200 truncate">{item.name}</div>
                        <div className="text-[10px] text-zinc-400 uppercase tracking-wider">{item.mapType}</div>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors ${previewId === item.id ? 'text-blue-400' : ''}`} />
                    </div>
                  ))}
                  {currentItems.length === 0 && (
                    <div className="py-12 text-center">
                        <AlertCircle className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                        <div className="text-zinc-500 text-xs">No items to export in this category</div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </Tabs>

            <div className="mt-auto p-4 border-t border-white/5 bg-zinc-950/50">
                <Button 
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs h-10 shadow-lg shadow-blue-600/10"
                    disabled={selectedIds.size === 0 || isExporting}
                    onClick={() => handleExport([...selectedIds])}
                >
                    {isExporting ? (
                        <span className="flex items-center gap-2">Processing...</span>
                    ) : (
                        <span className="flex items-center gap-2">
                            <FileDown className="w-4 h-4" />
                            Batch Export ({selectedIds.size})
                        </span>
                    )}
                </Button>
            </div>
          </div>

          {/* Center: Preview */}
          <div className="flex-1 min-w-[400px] bg-[#050505] flex flex-col items-center justify-center relative group overflow-hidden">
            {isPreviewLoading ? (
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                    <div className="text-zinc-400 text-xs font-medium uppercase tracking-widest">Generating Preview...</div>
                </div>
            ) : previewUrl ? (
                <div className="relative w-full h-full flex flex-col items-center justify-center p-8">
                    <div className="flex-1 flex items-center justify-center w-full min-h-0">
                        <img 
                          src={previewUrl} 
                          alt="Preview" 
                          className="max-w-full max-h-full object-contain shadow-2xl rounded border border-white/10 bg-zinc-900/50" 
                        />
                    </div>
                    <div className="mt-6 flex gap-2">
                        <Button 
                          size="sm" 
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-2 px-6 h-10"
                          onClick={() => handleExport([previewId!])}
                        >
                            <Download className="w-4 h-4" />
                            Download Selected Map
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="text-center">
                    <div className="w-16 h-16 bg-zinc-900/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/5">
                        <ImageIcon className="w-8 h-8 text-zinc-600" />
                    </div>
                    <div className="text-zinc-400 text-sm font-medium">Select a map to preview</div>
                    <div className="text-zinc-400 text-[10px] mt-1">Real-time composite preview</div>
                </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
