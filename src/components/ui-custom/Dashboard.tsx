import React, { useEffect, useState } from 'react';
import { ProjectManager } from '@/services/ProjectManager';
import type { SavedProject } from '@/services/ProjectManager';
import { Plus, FolderOpen, Box, Upload, Trash2, Clock, Pencil } from 'lucide-react';
import logoImg from '@/logo/logo.png';

interface DashboardProps {
  onNewProject: (modelType: 'Suzanne' | 'Cube', file?: File) => void;
  onLoadProject: (project: SavedProject) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNewProject, onLoadProject }) => {
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const list = await ProjectManager.getAllProjects();
      setProjects(list);
    } catch (e) {
      console.error('Failed to load projects', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Tem certeza que deseja excluir este projeto?')) {
      await ProjectManager.deleteProject(id);
      loadProjects();
    }
  };

  const handleRename = async (e: React.MouseEvent, id: string, oldName: string) => {
    e.stopPropagation();
    const newName = prompt('Renomear projeto para:', oldName);
    if (newName && newName !== oldName) {
      const project = projects.find(p => p.id === id);
      if (project) {
        await ProjectManager.saveProject({ ...project, name: newName });
        loadProjects();
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onNewProject('Suzanne', file);
    }
  };

  return (
    <div className="w-full h-screen bg-[#09090b] text-zinc-100 flex flex-col p-8 md:p-16 overflow-y-auto">
      
      <header className="mb-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-white/5 p-2 rounded-xl border border-white/10 w-14 h-14 flex items-center justify-center overflow-hidden shadow-lg">
            <img src={logoImg} alt="Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">3D Web Painter</h1>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* New Project Section */}
        <section className="col-span-1 border border-white/10 p-6 rounded-2xl bg-[#121214] flex flex-col gap-6">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Plus className="w-5 h-5 text-blue-400" /> Novo Projeto
          </h2>
          
          <div className="flex flex-col gap-4">
            <button 
              onClick={() => onNewProject('Suzanne')}
              className="flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-left group"
            >
              <div className="bg-zinc-800 p-3 rounded-lg group-hover:bg-blue-600/20 transition-colors">
                <Box className="w-6 h-6 text-zinc-400 group-hover:text-blue-400" />
              </div>
              <div>
                <h3 className="font-medium text-zinc-100">Iniciar com Suzanne</h3>
              </div>
            </button>



            <div className="relative overflow-hidden flex items-center gap-4 p-4 rounded-xl border border-dashed border-white/20 bg-transparent hover:bg-white/5 hover:border-white/40 transition-all text-left group cursor-pointer">
              <input 
                type="file" 
                accept=".obj" 
                onChange={handleFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                title="Carregar modelo OBJ"
              />
              <div className="bg-zinc-800 p-3 rounded-lg group-hover:bg-blue-600/20 transition-colors">
                <Upload className="w-6 h-6 text-zinc-400 group-hover:text-blue-400" />
              </div>
              <div>
                <h3 className="font-medium text-zinc-100">Carregar OBJ Customizado</h3>
                <p className="text-xs text-zinc-500">Importe seu próprio modelo 3D</p>
              </div>
            </div>
          </div>
        </section>

        {/* Recent Projects Section */}
        <section className="col-span-1 lg:col-span-2 flex flex-col gap-6">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-zinc-400" /> Projetos Recentes
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {loading ? (
              <p className="text-zinc-500 text-sm">Carregando projetos...</p>
            ) : projects.length === 0 ? (
              <div className="col-span-2 border border-white/5 rounded-2xl bg-white/[0.02] p-12 text-center flex flex-col items-center justify-center">
                <FolderOpen className="w-12 h-12 text-zinc-600 mb-4" />
                <h3 className="text-zinc-400 font-medium">Nenhum projeto salvo</h3>
                <p className="text-zinc-600 text-sm mt-1">Crie um novo projeto ao lado para começar.</p>
              </div>
            ) : (
              projects.map(p => (
                <div 
                  key={p.id}
                  onClick={() => onLoadProject(p)}
                  className="relative group border border-white/10 bg-[#121214] hover:bg-[#18181b] hover:border-blue-500/50 p-5 rounded-2xl cursor-pointer transition-all flex flex-col"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                       <button 
                         onClick={(e) => handleRename(e, p.id, p.name)}
                         className="p-1.5 rounded-md hover:bg-white/10 text-zinc-500 hover:text-blue-400 transition-colors"
                         title="Renomear Projeto"
                       >
                         <Pencil className="w-3.5 h-3.5" />
                       </button>
                       <h3 className="font-bold text-lg text-zinc-100 group-hover:text-blue-400 transition-colors truncate">{p.name}</h3>
                    </div>
                    <button 
                      onClick={(e) => handleDelete(e, p.id)}
                      className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                      title="Excluir Projeto"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="mt-auto flex items-center justify-between text-xs text-zinc-500">
                    <span className="flex items-center gap-1 bg-white/5 px-2 py-1 rounded-md">
                      <Box className="w-3 h-3" /> {p.modelName}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(p.lastModified).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
