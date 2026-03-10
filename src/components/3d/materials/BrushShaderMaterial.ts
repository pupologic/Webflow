import * as THREE from 'three';

const vertexShader = `
  varying vec3 vWorldPos;
  void main() {
    // We apply the mesh's transform to get the true world position
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    // Map UV to NDC (Normalized Device Coordinates) [-1, 1]
    gl_Position = vec4(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec3 uBrushPos;
  uniform float uRadius;
  uniform float uHardness;
  uniform int uShape; 

  varying vec3 vWorldPos;

  void main() {
    float alphaMultiplier = 1.0;

    if (uShape == 0) {
      // Circle / Sphere intersection in World Space
      float dist = distance(vWorldPos, uBrushPos);
      if (dist > uRadius) discard;
      
      // Calculate softness based on Hardness parameter
      // Hardness = 1.0 -> step is [1.0, 1.0], no fade
      // Hardness = 0.0 -> step is [0.0, 1.0], linear fade from center
      float normalizedDist = dist / uRadius;
      alphaMultiplier = 1.0 - smoothstep(uHardness, 1.0, normalizedDist);
      
    } else {
      // Square / Cube intersection in World Space
      vec3 d = abs(vWorldPos - uBrushPos);
      float maxDist = max(max(d.x, d.y), d.z);
      if (maxDist > uRadius) discard;
      
      // Square softness
      float normalizedDist = maxDist / uRadius;
      alphaMultiplier = 1.0 - smoothstep(uHardness, 1.0, normalizedDist);
    }

    gl_FragColor = vec4(uColor, uOpacity * alphaMultiplier);
  }
`;

export class BrushShaderMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 1.0 },
        uBrushPos: { value: new THREE.Vector3() },
        uRadius: { value: 0.1 },
        uHardness: { value: 1.0 },
        uShape: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  setBrush(color: string, opacity: number, worldPos: THREE.Vector3, radius: number, hardness: number, isSquare: boolean) {
    this.uniforms.uColor.value.set(color);
    this.uniforms.uOpacity.value = opacity;
    this.uniforms.uBrushPos.value.copy(worldPos);
    this.uniforms.uRadius.value = radius;
    this.uniforms.uHardness.value = hardness;
    this.uniforms.uShape.value = isSquare ? 1 : 0;
  }
}
