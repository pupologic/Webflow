import * as THREE from 'three';

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tMeshMask;
  uniform vec2 uTexSize;
  uniform float uRadius;
  varying vec2 vUv;

  void main() {
    vec4 col = texture2D(tDiffuse, vUv);
    float mask = texture2D(tMeshMask, vUv).r;

    // We only dilate if the mask is low (outside mesh)
    if (mask > 0.5) {
      gl_FragColor = col;
      return;
    }

    vec2 texelSize = 1.0 / uTexSize;
    float bestDistSq = 1e10;
    vec4 bestCol = col;
    bool found = false;
    
    // Jump-flood inspired sampling for efficiency
    // We sample a sparse grid to find the nearest valid mesh pixel
    float step = max(1.0, uRadius / 2.0);
    
    for (float x = -1.0; x <= 1.0; x += 1.0) {
      for (float y = -1.0; y <= 1.0; y += 1.0) {
        if (x == 0.0 && y == 0.0) continue;
        
        vec2 offset = vec2(x, y) * texelSize * step;
        vec4 sampleCol = texture2D(tDiffuse, vUv + offset);
        float sampleMask = texture2D(tMeshMask, vUv + offset).r;
        
        if (sampleMask > 0.5 && sampleCol.a > 0.01) {
          float d2 = dot(offset, offset);
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestCol = sampleCol;
            found = true;
          }
        }
      }
    }

    if (found) {
      gl_FragColor = vec4(bestCol.rgb, bestCol.a);
    } else {
      // If nothing found in the sparse grid, keep original (or black)
      gl_FragColor = col;
    }
  }
`;

export class DilationShaderMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        tDiffuse: { value: null },
        tMeshMask: { value: null },
        uTexSize: { value: new THREE.Vector2(2048, 2048) },
        uRadius: { value: 4.0 }
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.NoBlending
    });
  }

  setMap(texture: THREE.Texture, mask: THREE.Texture, width: number, height: number, radius: number = 4.0) {
    this.uniforms.tDiffuse.value = texture;
    this.uniforms.tMeshMask.value = mask;
    this.uniforms.uTexSize.value.set(width, height);
    this.uniforms.uRadius.value = radius;
  }
}
