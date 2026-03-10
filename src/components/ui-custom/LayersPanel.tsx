import React, { useState, useRef, useEffect } from 'react';
import type { Layer } from '@/hooks/use3DPaint';
import { Layers, Plus, Trash2, Eye, EyeOff, ArrowUp, ArrowDown } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

interface LayerControls {
  layers: Layer[];
  activeLayerId: string | null;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  setLayerActive: (id: string) => void;
  moveLayer: (id: string, direction: 'up' | 'down') => void;
}

interface LayersPanelProps {
  layerControls: LayerControls | null;
}

const blendModes = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity'
];

export const LayersPanel: React.FC<LayersPanelProps> = ({ layerControls }) => {
  if (!layerControls) return null;

  const { layers, activeLayerId, addLayer, removeLayer, updateLayer, setLayerActive, moveLayer } = layerControls;
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="bg-[#09090b] rounded-xl p-5 border border-white/5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase flex items-center gap-2">
          <Layers className="w-4 h-4 text-zinc-400" />
          Layers
        </h3>
        <button
          onClick={addLayer}
          className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
          title="Add Layer"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
        {layers.map((layer, index) => (
          <div
            key={layer.id}
            className={`p-3 rounded-xl border transition-all ${
              activeLayerId === layer.id
                ? 'bg-zinc-800/50 border-white/20'
                : 'bg-transparent border-white/5 hover:border-white/10'
            }`}
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
                  className="flex-1 text-left truncate text-sm font-medium focus:outline-none text-white hover:text-zinc-200"
                  onClick={() => setLayerActive(layer.id)}
                  onDoubleClick={(e) => startEditing(e, layer.id, layer.name)}
                >
                  {layer.name}
                </button>
              )}

              <button
                className="flex-shrink-0 text-gray-500 hover:text-white disabled:opacity-30 disabled:hover:text-gray-500"
                onClick={(e) => {
                  e.stopPropagation();
                  moveLayer(layer.id, 'up');
                }}
                disabled={index === 0}
              >
                <ArrowUp className="w-4 h-4" />
              </button>

              <button
                className="flex-shrink-0 text-gray-500 hover:text-white disabled:opacity-30 disabled:hover:text-gray-500"
                onClick={(e) => {
                  e.stopPropagation();
                  moveLayer(layer.id, 'down');
                }}
                disabled={index === layers.length - 1}
              >
                <ArrowDown className="w-4 h-4" />
              </button>

              <button
                className="flex-shrink-0 text-gray-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-gray-500"
                onClick={(e) => {
                  e.stopPropagation();
                  removeLayer(layer.id);
                }}
                disabled={layers.length <= 1}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {activeLayerId === layer.id && (
              <div className="space-y-4 text-xs pt-3 mt-2 border-t border-white/5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500 text-[10px] uppercase font-mono tracking-wider w-12">BLEND</span>
                  <select
                    className="flex-1 bg-zinc-900 border border-white/10 rounded-md px-2 py-1 text-xs text-zinc-300 outline-none focus:ring-1 focus:ring-zinc-600"
                    value={layer.blendMode}
                    onChange={(e) => updateLayer(layer.id, { blendMode: e.target.value as GlobalCompositeOperation })}
                  >
                    {blendModes.map(mode => (
                      <option key={mode} value={mode}>{mode}</option>
                    ))}
                  </select>
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
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
