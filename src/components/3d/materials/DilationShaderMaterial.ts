import * as THREE from 'three';

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tMask;
  uniform vec2 uPixelSize;
  varying vec2 vUv;

  void main() {
    vec4 base = texture2D(tDiffuse, vUv);
    float mask = texture2D(tMask, vUv).r;
    
    // If the pixel is INSIDE the UV island, NEVER dilate it.
    // Just output whatever color is there.
    if (mask > 0.5) {
      gl_FragColor = base;
      return;
    }

    // Otherwise, we are OUTSIDE the UV island (in the gutter).
    // Look for the nearest painted neighbor that is INSIDE the UV island.
    float closestDist = 9999.0;
    vec4 bestColor = vec4(0.0);
    
    for (int y = -4; y <= 4; y++) {
      for (int x = -4; x <= 4; x++) {
        if (x == 0 && y == 0) continue;
        
        vec2 offset = vec2(float(x), float(y)) * uPixelSize;
        vec4 samp = texture2D(tDiffuse, vUv + offset);
        float sampMask = texture2D(tMask, vUv + offset).r;
        
        // Only pull bleed color from painted pixels inside the UV mask
        if (samp.a > 0.05 && sampMask > 0.5) {
          float d = float(x*x + y*y);
          if (d < closestDist) {
            closestDist = d;
            bestColor = vec4(samp.rgb, samp.a); 
          }
        }
      }
    }
    
    if (bestColor.a > 0.0) {
      gl_FragColor = bestColor;
    } else {
      gl_FragColor = base;
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
        tMask: { value: null },
        uPixelSize: { value: new THREE.Vector2(1/2048, 1/2048) },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
  }

  setMap(map: THREE.Texture, mask: THREE.Texture, width: number, height: number) {
    this.uniforms.tDiffuse.value = map;
    this.uniforms.tMask.value = mask;
    this.uniforms.uPixelSize.value.set(1 / width, 1 / height);
  }
}
