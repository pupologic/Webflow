import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { GPULayer } from '@/hooks/useWebGLPaint';
import { Layers, Plus, Trash2, Eye, EyeOff, ArrowUp, ArrowDown, Folder, FolderPlus, ChevronRight, ChevronDown, CornerUpLeft, Merge, Image as ImageIcon } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';

interface LayerControls {
  layers: GPULayer[];
  activeLayerId: string | null;
  addLayer: (name?: string) => void;
  addFolder: (name?: string) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<GPULayer>) => void;
  setLayerActive: (id: string) => void;
  moveLayer: (id: string, direction: 'up' | 'down') => void;
  reorderLayer: (sourceId: string, targetId: string | null, newParentId?: string) => void;
  createLayerMask?: (id: string) => void;
  deleteLayerMask?: (id: string) => void;
  toggleLayerMask?: (id: string) => void;
  setEditingMask?: (id: string, editing: boolean) => void;
  mergeLayer?: (id: string) => void;
  mergeFolder?: (id: string) => void;
  importImageToLayer?: (file: File) => Promise<void>;
}

interface LayersPanelProps {
  layerControls: LayerControls | null;
  pbrMode: boolean;
  bumpScale: number;
  onBumpScaleChange: (v: number) => void;
}

const blendModes = [
  { label: 'Normal', value: 0 },
  { label: 'Additive', value: 1 },
  { label: 'Subtractive', value: 2 },
  { label: 'Multiply', value: 3 },
  { label: 'Screen', value: 4 },
  { label: 'Overlay', value: 5 },
  { label: 'Soft Light', value: 6 },
  { label: 'Hard Light', value: 7 },
  { label: 'Difference', value: 8 },
  { label: 'Erase', value: 9 },
];

const mapTypes = [
  { label: 'Albedo', value: 'albedo' },
  { label: 'Metalness', value: 'metalness' },
  { label: 'Roughness', value: 'roughness' },
  { label: 'Emissive', value: 'emissive' },
  { label: 'Alpha', value: 'alpha' },
  { label: 'Bump', value: 'bump' },
];

export const LayersPanel: React.FC<LayersPanelProps> = ({ layerControls, pbrMode, bumpScale, onBumpScaleChange }) => {
  if (!layerControls) return null;

  const {
    layers, activeLayerId, addLayer, addFolder, removeLayer, updateLayer, setLayerActive, moveLayer, reorderLayer,
    createLayerMask, deleteLayerMask, toggleLayerMask, setEditingMask,
    mergeLayer, mergeFolder, importImageToLayer
  } = layerControls;
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropParentId, setDropParentId] = useState<string | null>(null);
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingLayerId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingLayerId]);

  const startEditing = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setEditingLayerId(id);
    setEditName(name);
  };

  const saveRename = () => {
    if (editingLayerId) {
      updateLayer(editingLayerId, { name: editName });
      setEditingLayerId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveRename();
    if (e.key === 'Escape') setEditingLayerId(null);
  };

  const toggleCollapse = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setCollapsedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onDragStart = (id: string) => {
    setDraggedId(id);
  };

  const onDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const targetLayer = layers.find(l => l.id === targetId);
    if (!targetLayer) return;

    if (targetLayer.isFolder) {
      setDropParentId(targetId);
      setDragOverId(null);
    } else {
      setDragOverId(targetId);
      setDropParentId(targetLayer.parentId || null);
    }
  };

  const onDrop = (e: React.DragEvent, targetId: string | null) => {
    e.preventDefault();
    if (!draggedId) return;
    if (draggedId === targetId) return;

    const targetLayer = targetId ? layers.find(l => l.id === targetId) : null;
    const sourceLayer = layers.find(l => l.id === draggedId);

    // Folders cannot have parents
    const newParentId = (sourceLayer?.isFolder || !targetLayer) ? undefined : (targetLayer.isFolder ? targetId : targetLayer.parentId);

    reorderLayer(draggedId, targetId, newParentId === null ? undefined : newParentId);

    setDraggedId(null);
    setDragOverId(null);
    setDropParentId(null);
  };

  return (
    <div className="bg-[#09090b] rounded-xl p-5 border border-white/5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase flex items-center gap-2">
          <Layers className="w-4 h-4 text-zinc-400" />
          Layers
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => addFolder('New Folder')}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
            title="Add Folder"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            onClick={() => addLayer('New Layer')}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
            title="Add Layer"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
            title="Import Texture to Layer"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file && importImageToLayer) {
                try {
                  await importImageToLayer(file);
                  toast.success(`${file.name} importado para nova camada!`);
                } catch (err) {
                  toast.error("Erro ao importar imagem.");
                }
              }
              e.target.value = ''; // Reset for next selection
            }}
          />
        </div>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
        {layers.map((layer, index) => {
          let isHiddenByParent = false;
          let currentParentId = layer.parentId;
          while (currentParentId) {
            if (collapsedItems.has(currentParentId)) {
              isHiddenByParent = true;
              break;
            }
            const parent = layers.find(l => l.id === currentParentId);
            currentParentId = parent?.parentId;
          }

          if (isHiddenByParent) return null;

          const hasParent = layer.parentId && layers.some(l => l.id === layer.parentId);
          const isCollapsed = collapsedItems.has(layer.id);

          return (
            <div
              key={layer.id}
              draggable
              onDragStart={() => onDragStart(layer.id)}
              onDragOver={(e) => onDragOver(e, layer.id)}
              onDragEnd={() => { setDraggedId(null); setDragOverId(null); setDropParentId(null); }}
              onDrop={(e) => onDrop(e, layer.id)}
              className={`p-3 rounded-xl border transition-all cursor-move ${activeLayerId === layer.id
                  ? 'bg-zinc-800/50 border-white/20'
                  : 'bg-transparent border-white/5 hover:border-white/10'
                } ${draggedId === layer.id ? 'opacity-30' : ''}
              ${dragOverId === layer.id ? 'border-t-2 border-t-amber-500' : ''}
              ${dropParentId === layer.id && layer.isFolder ? 'bg-amber-500/10 border-amber-500/30' : ''}
              ${hasParent ? 'ml-6 relative before:content-[""] before:absolute before:-left-3 before:top-1/2 before:w-2 before:h-[1px] before:bg-zinc-600' : ''}`}
              onClick={() => {
                if (draggedId) return; // Ignore clicks while dragging
                if (!layer.isFolder) setLayerActive(layer.id);
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <button
                  className="flex-shrink-0 text-gray-400 hover:text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateLayer(layer.id, { visible: !layer.visible });
                  }}
                >
                  {layer.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>

                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <button
                    onClick={(e) => toggleCollapse(e, layer.id)}
                    className="flex-shrink-0 text-zinc-500 hover:text-white"
                  >
                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {layer.isFolder ? <Folder className="w-4 h-4 flex-shrink-0 text-amber-400/80" /> : null}
                  {editingLayerId === layer.id ? (
                    <input
                      ref={inputRef}
                      className="flex-1 bg-zinc-900 text-white text-sm font-medium border border-zinc-600 rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-zinc-400"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={saveRename}
                      onKeyDown={handleKeyDown}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <button
                      className={`flex-1 text-left truncate text-sm font-medium focus:outline-none transition-colors ${activeLayerId === layer.id && !layer.isEditingMask ? 'text-amber-400' : 'text-zinc-300 hover:text-white'}`}
                      onClick={() => {
                        if (!layer.isFolder) {
                          setLayerActive(layer.id);
                          if (setEditingMask) setEditingMask(layer.id, false);
                        }
                      }}
                      onDoubleClick={(e) => startEditing(e, layer.id, layer.name)}
                    >
                      {layer.name}
                    </button>
                  )}

                  {layer.maskTarget && (
                    <button
                      title="Edit Layer Mask"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLayerActive(layer.id);
                        if (setEditingMask) setEditingMask(layer.id, true);
                      }}
                      className={`flex-shrink-0 w-6 h-6 ml-1 rounded border bg-zinc-800 flex items-center justify-center relative overflow-hidden transition-all ${activeLayerId === layer.id && layer.isEditingMask ? 'border-amber-500 ring-1 ring-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'border-zinc-600 hover:border-zinc-400 opacity-60'}`}
                    >
                      <div className="w-1/2 h-full bg-white absolute left-0" />
                      <div className="w-1/2 h-full bg-black absolute right-0" />
                      {!layer.maskEnabled && <div className="absolute inset-0 z-10 flex items-center justify-center"><div className="w-full h-0.5 bg-red-500/80 rotate-45" /></div>}
                    </button>
                  )}
                </div>

                {!layer.isFolder && hasParent ? (
                  <button
                    className="flex-shrink-0 text-zinc-500 hover:text-amber-400 disabled:opacity-30 ml-2"
                    title="Remove from Folder"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (layer.parentId) reorderLayer(layer.id, layer.parentId, undefined);
                    }}
                  >
                    <CornerUpLeft className="w-3.5 h-3.5" />
                  </button>
                ) : null}

                <div className="flex items-center gap-1">
                  <button
                    className="flex-shrink-0 text-gray-500 hover:text-white disabled:opacity-30"
                    onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'up'); }}
                    disabled={index === 0}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="flex-shrink-0 text-gray-500 hover:text-white disabled:opacity-30"
                    onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'down'); }}
                    disabled={index === layers.length - 1}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="flex-shrink-0 text-gray-500 hover:text-red-400 disabled:opacity-30"
                    onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
                    disabled={layers.length <= 1 && !layer.isFolder}
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  {layer.isFolder ? (
                    <button
                      className="flex-shrink-0 text-zinc-500 hover:text-amber-400"
                      onClick={(e) => { e.stopPropagation(); mergeFolder?.(layer.id); }}
                      title="Merge Folder"
                    >
                      <Merge className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    index < layers.length - 1 && !layers[index + 1].isFolder && (
                      <button
                        className="flex-shrink-0 text-zinc-500 hover:text-amber-400"
                        onClick={(e) => { e.stopPropagation(); mergeLayer?.(layer.id); }}
                        title="Merge Down"
                      >
                        <Merge className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}
                </div>
              </div>

              {activeLayerId === layer.id && !layer.isFolder && !isCollapsed && (
                <div className="space-y-4 text-xs pt-3 mt-2 border-t border-white/5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-500 text-[10px] uppercase font-mono tracking-wider w-12">BLEND</span>
                    <select
                      className="flex-1 bg-zinc-900 border border-white/10 rounded-md px-2 py-1 text-xs text-zinc-300 outline-none focus:ring-1 focus:ring-zinc-600"
                      value={layer.blendMode}
                      onChange={(e) => updateLayer(layer.id, { blendMode: parseInt(e.target.value) as THREE.Blending })}
                    >
                      {blendModes.map(mode => (
                        <option key={mode.label} value={mode.value}>{mode.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-500 text-[10px] uppercase font-mono tracking-wider w-12">CHANNEL</span>
                    <div className="flex-1 flex flex-col gap-1">
                      <select
                        className={`w-full border rounded-md px-2 py-1 text-xs outline-none transition-colors ${!pbrMode ? 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed' :
                            layer.mapType === 'albedo' ? 'bg-zinc-900 border-white/10 text-zinc-300' :
                              layer.mapType === 'metalness' ? 'bg-blue-900/20 border-blue-500/30 text-blue-300' :
                                layer.mapType === 'roughness' ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-300' :
                                  layer.mapType === 'emissive' ? 'bg-amber-900/20 border-amber-500/30 text-amber-300' :
                                    layer.mapType === 'bump' ? 'bg-blue-900/20 border-blue-400/30 text-blue-300' :
                                      'bg-zinc-900 border-white/10 text-zinc-300'
                          }`}
                        value={layer.mapType}
                        disabled={!pbrMode}
                        onChange={(e) => updateLayer(layer.id, { mapType: e.target.value as any })}
                      >
                        {mapTypes.map(m => (
                          <option key={m.value} value={m.value} className="bg-zinc-900 text-white">{m.label}</option>
                        ))}
                      </select>
                      {!pbrMode && (
                        <p className="text-[9px] text-zinc-600 italic">🔒 Unlock in Shader/Material</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-zinc-500 text-[10px] uppercase font-mono tracking-wider w-12">OPACITY</span>
                    <div className="flex-1 flex items-center gap-3">
                      <Slider
                        value={[layer.opacity]}
                        min={0}
                        max={1}
                        step={0.01}
                        onValueChange={([val]) => updateLayer(layer.id, { opacity: val })}
                        className="w-full"
                      />
                      <span className="w-8 text-right text-zinc-400 font-mono text-[10px]">{Math.round(layer.opacity * 100)}%</span>
                    </div>
                  </div>

                  {layer.mapType === 'emissive' && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-zinc-500 text-[10px] uppercase font-mono tracking-wider w-12">GLOW BOOST</span>
                      <div className="flex-1 flex items-center gap-3">
                        <Slider
                          value={[layer.intensity || 1]}
                          min={0}
                          max={10}
                          step={0.1}
                          onValueChange={([val]) => updateLayer(layer.id, { intensity: val })}
                          className="w-full"
                        />
                        <span className="w-8 text-right text-zinc-400 font-mono text-[10px]">{(layer.intensity || 1).toFixed(1)}x</span>
                      </div>
                    </div>
                  )}

                  {layer.mapType === 'bump' && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-zinc-500 text-[10px] uppercase font-mono tracking-wider w-12">BUMP SCALE</span>
                      <div className="flex-1 flex items-center gap-3">
                        <Slider
                          value={[bumpScale]}
                          min={0}
                          max={5.0}
                          step={0.01}
                          onValueChange={([val]) => onBumpScaleChange(val)}
                          className="w-full"
                        />
                        <span className="w-8 text-right text-zinc-400 font-mono text-[10px]">{bumpScale.toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
                    <span className="text-zinc-500 text-[10px] uppercase font-mono tracking-wider w-16">LAYER MASK</span>
                    <div className="flex items-center gap-2 flex-1">
                      {!layer.maskTarget ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (createLayerMask) createLayerMask(layer.id);
                          }}
                          className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-2 border transition-colors bg-zinc-900 border-white/10 text-zinc-400 hover:text-white hover:border-white/30"
                        >
                          <Plus className="w-3 h-3 text-zinc-500" /> Add Mask
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (toggleLayerMask) toggleLayerMask(layer.id); }}
                            className={`flex-1 py-1 text-xs border rounded transition-colors ${layer.maskEnabled ? 'bg-amber-500/10 text-amber-500 border-amber-500/50 hover:bg-amber-500/20' : 'bg-transparent border-white/10 text-zinc-500 hover:text-zinc-300'}`}
                          >
                            {layer.maskEnabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (deleteLayerMask) deleteLayerMask(layer.id); }}
                            className="px-2 py-1 flex items-center justify-center text-xs border border-red-500/20 text-red-500 rounded transition-colors hover:bg-red-500/10 hover:border-red-500/50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
