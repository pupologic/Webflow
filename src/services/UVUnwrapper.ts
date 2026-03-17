import * as THREE from 'three';
import { UVUnwrapper as XAtlasUnwrapper } from 'xatlas-three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export class UVUnwrapper {
  private static instance: any = null;

  private static async getInstance(onProgress?: (mode: string, progress: number) => void) {
    if (!this.instance) {
      const unwrapper = new XAtlasUnwrapper({
        BufferAttribute: THREE.BufferAttribute,
      });

      const baseUrl = window.location.origin;
      const wasmPath = `${baseUrl}/xatlas/xatlas.wasm`;
      const jsPath = `${baseUrl}/xatlas/xatlas.js`;

      // Helper to fetch and create a Blob URL with a specific MIME type
      // This solves MIME type errors on servers that return application/octet-stream
      const fetchAsBlobUrl = async (url: string, mime: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
        const blob = await resp.blob();
        return URL.createObjectURL(new Blob([blob], { type: mime }));
      };

      try {
        const [wasmBlobUrl, jsBlobUrl] = await Promise.all([
          fetchAsBlobUrl(wasmPath, 'application/wasm'),
          fetchAsBlobUrl(jsPath, 'application/javascript')
        ]);

        await unwrapper.loadLibrary(
          (mode: string, progress: number) => {
            if (onProgress) onProgress(mode, progress);
            else console.log(`xatlas [${mode}]: ${Math.round(progress * 100)}%`);
          },
          wasmBlobUrl,
          jsBlobUrl
        );
      } catch (err) {
        console.error('Initial unwrap load failed:', err);
        // Fallback to direct paths if fetch fails
        await unwrapper.loadLibrary(
          (mode: string, progress: number) => {
            if (onProgress) onProgress(mode, progress);
          },
          wasmPath,
          jsPath
        );
      }

      this.instance = unwrapper;
    }
    return this.instance;
  }

  /**
   * Unwraps a single geometry.
   */
  static async unwrap(geometry: THREE.BufferGeometry): Promise<THREE.BufferGeometry> {
    const unwrapper = await this.getInstance();

    // Clone to ensure we have a new reference for React to detect changes
    let indexedGeometry = geometry.clone();
    
    // xatlas-three REQUIRES indexed geometry.
    if (!indexedGeometry.index) {
      indexedGeometry = BufferGeometryUtils.mergeVertices(indexedGeometry);
    }

    // Configure standard options
    unwrapper.chartOptions = {
      fixWinding: false,
      maxBoundaryLength: 0,
      maxChartArea: 0,
      maxCost: 2,
      maxIterations: 1,
      normalDeviationWeight: 2,
      normalSeamWeight: 4,
      roundnessWeight: 0.01,
      straightnessWeight: 6,
      textureSeamWeight: 0.5,
      useInputMeshUvs: false,
    };

    unwrapper.packOptions = {
      bilinear: true,
      blockAlign: false,
      bruteForce: false,
      createImage: false,
      maxChartSize: 0,
      padding: 0,
      resolution: 0,
      rotateCharts: true,
      rotateChartsToAxis: true,
      texelsPerUnit: 0,
    };

    // Unwrap will write to the 'uv' attribute (and move original 'uv' to 'uv2' if it exists)
    await unwrapper.unwrap(indexedGeometry);
    
    // Ensure the new UV attribute is marked for update
    if (indexedGeometry.attributes.uv) {
      indexedGeometry.attributes.uv.needsUpdate = true;
    }

    return indexedGeometry;
  }

  /**
   * Unwraps multiple geometries and packs them into a single atlas.
   */
  static async packAtlas(
    geometries: THREE.BufferGeometry[], 
    onProgress?: (prog: number) => void
  ): Promise<THREE.BufferGeometry[]> {
    if (onProgress) onProgress(5); 

    const unwrapper = await this.getInstance((_mode, prog) => {
      // Library loading is the first 25% of the total process
      // Handle both 0-1 and 0-100 scales just in case
      const normalizedProg = prog > 1 ? prog / 100 : prog;
      if (onProgress) onProgress(5 + normalizedProg * 25); 
    });

    if (onProgress) onProgress(30); 

    const indexedGeometries = geometries.map(g => {
      const cloned = g.clone();
      if (!cloned.index) return BufferGeometryUtils.mergeVertices(cloned);
      return cloned;
    });

    if (onProgress) onProgress(40); 

    unwrapper.packOptions = {
       bilinear: true,
       blockAlign: false,
       bruteForce: false,
       createImage: false,
       maxChartSize: 0,
       padding: 2,
       resolution: 2048, 
       rotateCharts: true,
       rotateChartsToAxis: true,
       texelsPerUnit: 0
    };

    // packAtlas (this is the heavy part)
    // We can't easily get granular progress from the WASM call itself,
    // so we step it to 90% after it finishes.
    await unwrapper.packAtlas(indexedGeometries, 'uv');

    if (onProgress) onProgress(95); 

    indexedGeometries.forEach(g => {
      if (g.attributes.uv) g.attributes.uv.needsUpdate = true;
    });

    if (onProgress) onProgress(100);

    return indexedGeometries;
  }
}
