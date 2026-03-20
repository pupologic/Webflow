

export interface SavedProject {
  id: string;
  name: string;
  lastModified: number;
  modelName: string; // "Suzanne", "Cube", or base filename of custom OBJ
  modelData?: Blob | ArrayBuffer | string;
  modelFormat?: 'obj' | 'glb' | 'fbx' | 'usdz';
  
  // We'll store the brush settings
  brushSettings: any;
  
  // For the actual save data, we serialize layers
  layersData: {
    id: string;
    name: string;
    visible: boolean;
    opacity: number;
    blendMode: number;
    isFolder: boolean;
    parentId?: string;
    maskEnabled?: boolean;
    hasMask: boolean; // Tells us if there's a mask target to load
    // Blobs, Blob URLs or base64 strings for the image textures
    targetBlobUrl?: Blob | string; 
    maskBlobUrl?: Blob | string;
  }[];
}

const DB_NAME = '3DPainterDB';
const STORE_NAME = 'projects';

export class ProjectManager {
  private static db: IDBDatabase | null = null;

  static async init(): Promise<void> {
    if (this.db) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      
      request.onerror = () => reject(request.error);
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }

  static async saveProject(project: SavedProject): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(project);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  static async loadProject(id: string): Promise<SavedProject | null> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  static async getAllProjects(): Promise<SavedProject[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      
      request.onsuccess = () => {
        // Sort by most recent
        const projects = (request.result as SavedProject[]).sort((a, b) => b.lastModified - a.lastModified);
        resolve(projects);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async deleteProject(id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
