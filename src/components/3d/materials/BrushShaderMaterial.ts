import * as THREE from 'three';

const vertexShader = `
  uniform mat4 uVPMatrix;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec2 vScreenUV;

  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;

    // Pre-calculate screen UV for stencil/screen projection
    vec4 projectedPos = uVPMatrix * vec4(vWorldPos, 1.0);
    vScreenUV = (projectedPos.xy / projectedPos.w) * 0.5 + 0.5;

    // Map UV to NDC (Normalized Device Coordinates) [-1, 1]
    vec2 wrappedUv = fract(uv);
    gl_Position = vec4(wrappedUv.x * 2.0 - 1.0, wrappedUv.y * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec3 uBrushPos;
  uniform vec3 uBrushNormal;
  uniform float uBrushAngle;
  uniform float uRadius;
  uniform float uHardness;
  uniform int uShape; 
  uniform sampler2D uBrushTexture;
  uniform bool uUseTexture;
  uniform bool uUseStencil;
  uniform sampler2D uStencilTexture;
  uniform mat3 uStencilMatrix; // Transform from Screen Space to Stencil UV Space
  uniform mat4 uVPMatrix; // View-Projection Matrix for screen space projection
  uniform int uStencilMode; // 0: Alpha, 1: Invert, 2: Luminance
  uniform bool uIsEraser;
  uniform int uMode; // 0: paint, 1: erase, 2: blur, 3: smudge
  uniform sampler2D uSnapshotTexture;
  uniform vec2 uSmudgeOffset;
  uniform float uBlurStrength;
  uniform float uSmudgeStrength;
  uniform vec2 uTexSize;
  uniform vec3 uCameraPos;
  uniform bool uIsScreenProjected;
  
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec2 vScreenUV;

    // Rotation matrix for brush randomness/angle
    mat2 rotate2d(float _angle){
        return mat2(cos(_angle),-sin(_angle),
                    sin(_angle),cos(_angle));
    }

    void main() {
      float alphaMultiplier = 1.0;

      // 1. Normal/View Masking
      // When Screen Projecting, we want a very consistent "stamp" feel.
      // We only fade out if the surface is nearly parallel to the projection 
      // or completely back-facing.
      float angleFactor = dot(normalize(vNormal), normalize(uBrushNormal));
      
      if (uIsScreenProjected) {
          // Much more aggressive projection for the "2D stamp" feel
          // Only discard if truly facing away from the camera
          alphaMultiplier *= smoothstep(-0.4, 0.1, angleFactor);
      } else {
          // Standard surface alignment has a softer falloff
          alphaMultiplier *= smoothstep(-0.2, 0.3, angleFactor);
          
          // 2. View Masking: Only for non-screen-projected brushes
          vec3 viewDir = normalize(uCameraPos - vWorldPos);
          float viewFactor = dot(normalize(vNormal), viewDir);
          alphaMultiplier *= smoothstep(-0.1, 0.2, viewFactor);
      }

      // 3. Depth Masking: Projector volume
      float depthDist = abs(dot(vWorldPos - uBrushPos, normalize(uBrushNormal)));
      if (depthDist > uRadius * 3.0) discard; // increased from 1.5 to 3.0
      float depthAlpha = 1.0 - smoothstep(uRadius * 0.5, uRadius * 3.0, depthDist);

      alphaMultiplier *= depthAlpha;

      // 3. Project to 2D Plane (Decal Projection)
      vec3 p = vWorldPos - uBrushPos;
      
      vec3 up = abs(uBrushNormal.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 tangent = normalize(cross(up, normalize(uBrushNormal)));
      vec3 bitangent = cross(normalize(uBrushNormal), tangent);
      
      vec2 localPos = vec2(dot(p, tangent), dot(p, bitangent));
      localPos = rotate2d(uBrushAngle) * localPos;

      if (uMode == 0 || uMode == 1) { // Paint or Erase
        if (!uUseTexture) {
          if (uShape == 0) {
            float dist = length(localPos);
            if (dist > uRadius) discard;
            float normalizedDist = dist / uRadius;
            alphaMultiplier *= 1.0 - smoothstep(uHardness, 1.0, normalizedDist);
          } else {
            vec2 d = abs(localPos);
            float maxDist = max(d.x, d.y);
            if (maxDist > uRadius) discard;
            float normalizedDist = maxDist / uRadius;
            alphaMultiplier *= 1.0 - smoothstep(uHardness, 1.0, normalizedDist);
          }
        } else {
          if (length(localPos) > uRadius) discard;
          vec2 texUV = (localPos / (uRadius * 2.0)) + 0.5;
          if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) discard;
          vec4 texColor = texture2D(uBrushTexture, texUV);
          if (texColor.a > 0.99) {
            // No alpha: use luminance/max channel (white particles on dark/black background)
            alphaMultiplier = max(texColor.r, max(texColor.g, texColor.b));
          } else {
            // Alpha exists: standard brush
            alphaMultiplier *= texColor.a;
          }
          float dist = length(localPos) / uRadius;
          alphaMultiplier *= (1.0 - smoothstep(uHardness, 1.0, dist));
          if (alphaMultiplier <= 0.01) discard;
        }
      } else {
        // Blur or Smudge both use the circular bounds logic
        float dist = length(localPos);
        if (dist > uRadius) discard;
        float normalizedDist = dist / uRadius;
        alphaMultiplier *= 1.0 - smoothstep(uHardness, 1.0, normalizedDist);
      }
      


      // 4. Stencil Masking
      if (uUseStencil) {
          vec3 stencilPos = uStencilMatrix * vec3(vScreenUV, 1.0);
          
          if (stencilPos.x >= 0.0 && stencilPos.x <= 1.0 && stencilPos.y >= 0.0 && stencilPos.y <= 1.0) {
              vec4 stencilColor = texture2D(uStencilTexture, vec2(stencilPos.x, stencilPos.y)); 
              float lum = (stencilColor.r + stencilColor.g + stencilColor.b) / 3.0;
              float stencilMask = 1.0;
              if (uStencilMode == 0) stencilMask = stencilColor.a;
              else if (uStencilMode == 1) stencilMask = 1.0 - stencilColor.a;
              else if (uStencilMode == 2) stencilMask = lum * stencilColor.a;
              alphaMultiplier *= stencilMask;
          } else {
              alphaMultiplier = 0.0;
          }
      }

      if (uMode == 1) { // Erase
        gl_FragColor = vec4(0.0, 0.0, 0.0, alphaMultiplier * uOpacity);
      } else if (uMode == 0) { // Paint
        gl_FragColor = vec4(uColor, uOpacity * alphaMultiplier);
      } else if (uMode == 2) { // Blur
        vec4 color = vec4(0.0);
        float total = 0.0;
        
        for(float x = -2.0; x <= 2.0; x += 1.0) {
            for(float y = -2.0; y <= 2.0; y += 1.0) {
                vec2 offset = vec2(x, y) * (1.0 / uTexSize) * uBlurStrength;
                color += texture2D(uSnapshotTexture, vUv + offset);
                total += 1.0;
            }
        }
        vec4 blurred = color / total;
        gl_FragColor = vec4(blurred.rgb, blurred.a * alphaMultiplier * uOpacity);
      } else if (uMode == 3) { // Smudge
        // Sample snapshot at offset position
        vec2 samplePos = vUv - uSmudgeOffset * uSmudgeStrength;
        vec4 smudgedColor = texture2D(uSnapshotTexture, samplePos);
        gl_FragColor = vec4(smudgedColor.rgb, smudgedColor.a * alphaMultiplier * uOpacity);
      }
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
        uBrushNormal: { value: new THREE.Vector3(0, 0, 1) },
        uBrushAngle: { value: 0.0 },
        uUseTexture: { value: false },
        uBrushTexture: { value: null },
        uUseStencil: { value: false },
        uStencilTexture: { value: null },
        uStencilMatrix: { value: new THREE.Matrix3() },
        uVPMatrix: { value: new THREE.Matrix4() },
        uStencilMode: { value: 0 },
        uIsEraser: { value: false },
        uMode: { value: 0 },
        uSnapshotTexture: { value: null },
        uSmudgeOffset: { value: new THREE.Vector2(0, 0) },
        uBlurStrength: { value: 1.0 },
        uSmudgeStrength: { value: 1.0 },
        uTexSize: { value: new THREE.Vector2(2048, 2048) },
        uCameraPos: { value: new THREE.Vector3() },
        uIsScreenProjected: { value: false }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  setBrush(
    color: string, 
    opacity: number, 
    worldPos: THREE.Vector3, 
    radius: number, 
    hardness: number, 
    isSquare: boolean, 
    texture: THREE.Texture | null = null,
    normal: THREE.Vector3 = new THREE.Vector3(0, 0, 1),
    angle: number = 0.0,
    stencilTexture: THREE.Texture | null = null,
    stencilMatrix: THREE.Matrix3 | null = null,
    vpMatrix: THREE.Matrix4 | null = null,
    stencilMode: number = 0,
    cameraPos: THREE.Vector3 = new THREE.Vector3(),
    isScreenProjected: boolean = false,
    // New parameters for Blur/Smudge
    mode: 'paint' | 'erase' | 'blur' | 'smudge' = 'paint',
    snapshotTexture: THREE.Texture | null = null,
    smudgeOffset: THREE.Vector2 = new THREE.Vector2(0, 0),
    blurStrength: number = 1.0,
    texSize: number = 2048,
    smudgeStrength: number = 1.0
  ) {
    this.uniforms.uColor.value.set(color === 'erase' ? '#000000' : color);
    this.uniforms.uCameraPos.value.copy(cameraPos);
    this.uniforms.uIsScreenProjected.value = isScreenProjected;
    this.uniforms.uOpacity.value = opacity;
    this.uniforms.uBrushPos.value.copy(worldPos);
    this.uniforms.uRadius.value = radius;
    this.uniforms.uHardness.value = hardness;
    this.uniforms.uShape.value = isSquare ? 1 : 0;
    this.uniforms.uBrushNormal.value.copy(normal);
    this.uniforms.uBrushAngle.value = angle;
    this.uniforms.uTexSize.value.set(texSize, texSize);
    
    if (texture) {
      this.uniforms.uUseTexture.value = true;
      this.uniforms.uBrushTexture.value = texture;
    } else {
      this.uniforms.uUseTexture.value = false;
      this.uniforms.uBrushTexture.value = null;
    }
    
    if (stencilTexture && stencilMatrix && vpMatrix) {
      this.uniforms.uUseStencil.value = true;
      this.uniforms.uStencilTexture.value = stencilTexture;
      this.uniforms.uStencilMatrix.value.copy(stencilMatrix);
      this.uniforms.uVPMatrix.value.copy(vpMatrix);
      this.uniforms.uStencilMode.value = stencilMode;
    } else {
      this.uniforms.uUseStencil.value = false;
      this.uniforms.uStencilTexture.value = null;
    }

    // Set Mode
    if (mode === 'paint') this.uniforms.uMode.value = 0;
    else if (mode === 'erase') this.uniforms.uMode.value = 1;
    else if (mode === 'blur') this.uniforms.uMode.value = 2;
    else if (mode === 'smudge') this.uniforms.uMode.value = 3;

    this.uniforms.uSnapshotTexture.value = snapshotTexture;
    this.uniforms.uSmudgeOffset.value.copy(smudgeOffset);
    this.uniforms.uBlurStrength.value = blurStrength;
    this.uniforms.uSmudgeStrength.value = smudgeStrength;

    // Handle Blending
    if (mode === 'erase') {
        this.uniforms.uIsEraser.value = true;
        this.blending = THREE.CustomBlending;
        this.blendEquation = THREE.AddEquation;
        this.blendSrc = THREE.ZeroFactor;
        this.blendDst = THREE.OneMinusSrcAlphaFactor;
        this.blendSrcAlpha = THREE.ZeroFactor;
        this.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    } else {
        this.uniforms.uIsEraser.value = false;
        this.blending = THREE.NormalBlending;
    }
  }
}
