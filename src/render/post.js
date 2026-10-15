// Tone mapping and post-processing.
//
// Every tier uses the same tone curve: AgX reshaped toward a camera response
// (shoulder: sunlit whites and clouds reach near-white instead of AgX's flat
// ~85%; softer toe: shade keeps detail) plus a saturation look; very bright
// colours still roll off toward white smoothly. On 'low' it runs inside each
// material (CustomToneMapping, no extra passes). On 'medium'/'high' the scene is
// rendered to a half-float target and the final pass applies it after bloom:
//
//   high:   scene (4x MSAA, HDR) -> bloom (half-res chain) -> final (AO + bloom + tone map + grade + vignette + sRGB + dither) -> screen
//           GTAO runs at half resolution from its own normal/depth pass and is multiplied in by the final pass
//           (no half-float MSAA on the GPU: plain HDR target and FXAA after the final pass, as on medium)
//   medium: scene (HDR)          -> bloom (quarter-res)    -> final -> FXAA -> screen
//   low:    direct render (no composer)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// AgX (Sobotka; Filament/three.js fit) with a look applied in the AgX log domain.
export const TONEMAP_GLSL = /* glsl */`
vec3 czAgxContrast( vec3 x ) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 czToneMap( vec3 color ) {
  const mat3 toRec2020 = mat3( vec3( 0.6274, 0.0691, 0.0164 ), vec3( 0.3293, 0.9195, 0.0880 ), vec3( 0.0433, 0.0113, 0.8956 ) );
  const mat3 fromRec2020 = mat3( vec3( 1.6605, -0.1246, -0.0182 ), vec3( -0.5876, 1.1329, -0.1006 ), vec3( -0.0728, -0.0083, 1.1187 ) );
  const mat3 inset = mat3(
    vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
    vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
    vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ) );
  const mat3 outset = mat3(
    vec3( 1.1271005818144368, -0.1413297634984383, -0.14132976349843826 ),
    vec3( -0.11060664309660323, 1.157823702216272, -0.11060664309660294 ),
    vec3( -0.016493938717834573, -0.016493938717834257, 1.2519364065950405 ) );
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  color = inset * ( toRec2020 * color );
  vec3 ev = clamp( log2( max( color, 1e-10 ) ), -14.0, 12.0 );
  // Photographic shoulder: AgX keeps ~6.5 stops above middle grey, so a sunlit
  // white wall lands at ~85% and daylight looks flat. Above ~0.75 each stop
  // counts ~1.85 (soft knee), so sunlit whites and clouds reach ~91-95%.
  ev += 0.595 * log2( 1.0 + exp2( ( ev + 0.4 ) * 1.4285714 ) );
  // Softer toe: below ~0.06 each stop counts ~0.82, so shade keeps detail
  // instead of sinking into navy (AgX's toe is steeper than a camera's).
  ev += 0.18 * log2( 1.0 + exp2( -4.0 - ev ) );
  color = clamp( ( ev - minEv ) / ( maxEv - minEv ), 0.0, 1.0 );
  color = czAgxContrast( color );
  // look: AgX's inset leaves colours muted; restore saturation in the mid-tones,
  // less in deep shadow (skylight already tints them blue) and in highlights
  // (keeps sunlit red paint from clipping).
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  float sat = mix( 1.12, 1.32, smoothstep( 0.08, 0.3, luma ) ) * ( 1.0 - 0.2 * smoothstep( 0.5, 0.9, luma ) );
  color = luma + sat * ( color - luma );
  color = outset * color;
  color = pow( max( color, 0.0 ), vec3( 2.2 ) );
  return clamp( fromRec2020 * color, 0.0, 1.0 );
}
`;

// Use the same curve for materials rendered straight to the canvas (low tier).
let toneInstalled = false;
export function installToneMapping(renderer, exposure) {
  if (!toneInstalled) {
    toneInstalled = true;
    const C = THREE.ShaderChunk;
    const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
    if (C.tonemapping_pars_fragment.includes(stub)) {
      C.tonemapping_pars_fragment = C.tonemapping_pars_fragment.replace(stub,
        TONEMAP_GLSL + 'vec3 CustomToneMapping( vec3 color ) { return czToneMap( color * toneMappingExposure ); }');
    }
  }
  const ok = THREE.ShaderChunk.tonemapping_pars_fragment.includes('czToneMap');
  renderer.toneMapping = ok ? THREE.CustomToneMapping : THREE.AgXToneMapping;
  renderer.toneMappingExposure = exposure;
}

// Soft-knee bright pass (energy above the threshold only), 4 taps so small
// sun glints don't flicker, clamped against fireflies.
const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
vec3 czBright( vec3 c ) {
  float br = max( c.r, max( c.g, c.b ) );
  float knee = uThreshold * 0.5;
  float soft = clamp( br - uThreshold + knee, 0.0, 2.0 * knee );
  soft = soft * soft / ( 4.0 * knee + 1e-4 );
  return c * ( max( soft, br - uThreshold ) / max( br, 1e-4 ) );
}
void main() {
  vec3 c = czBright( texture2D( tDiffuse, vUv + uTexel * vec2( -0.5, -0.5 ) ).rgb )
         + czBright( texture2D( tDiffuse, vUv + uTexel * vec2( 0.5, -0.5 ) ).rgb )
         + czBright( texture2D( tDiffuse, vUv + uTexel * vec2( -0.5, 0.5 ) ).rgb )
         + czBright( texture2D( tDiffuse, vUv + uTexel * vec2( 0.5, 0.5 ) ).rgb );
  gl_FragColor = vec4( min( c * 0.25, vec3( 150.0 ) ), 1.0 );
}`;

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;

// UnrealBloomPass's blur chain, but it leaves the result in a texture for the
// final pass instead of blending it back into the full-resolution HDR buffer
// (saves a full-screen pass and an MSAA resolve).
class BloomPass extends UnrealBloomPass {
  constructor(size, { strength, radius, threshold, downscale }) {
    super(size, strength, radius, threshold);
    this.downscale = downscale;
    this.needsSwap = false;
    this.brightMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: threshold } },
      vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false,
    });
    this.setSize(size.x, size.y);
  }

  get texture() { return this.renderTargetsHorizontal[0].texture; }

  setSize(width, height) {
    const d = this.downscale || 1;
    // 4 bilinear taps spaced to box-filter every source pixel under a bright-pass texel
    if (this.brightMaterial) this.brightMaterial.uniforms.uTexel.value.set(d / width, d / height);
    super.setSize(Math.max(2, Math.round(width / d)), Math.max(2, Math.round(height / d)));
  }

  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._oldClearColor);
    this.oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    this.brightMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.brightMaterial.uniforms.uThreshold.value = this.threshold;
    this.fsQuad.material = this.brightMaterial;
    renderer.setRenderTarget(this.renderTargetBright);
    this.fsQuad.render(renderer);

    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      this.fsQuad.material = m;
      m.uniforms.colorTexture.value = input.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      this.fsQuad.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      this.fsQuad.render(renderer);
      input = this.renderTargetsVertical[i];
    }
    this.fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    this.fsQuad.render(renderer);

    renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }

  dispose() { super.dispose(); this.brightMaterial.dispose(); }
}

const FINAL_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform sampler2D tAO;
uniform sampler2D tAODepth;
uniform float uBloom;
uniform float uAO;
uniform vec2 uNearFar;
uniform float uExposure;
uniform float uVignette;
uniform float uAspect;
varying vec2 vUv;
${TONEMAP_GLSL}
float czHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
vec3 czSRGB( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( 0.0031308, c ) );
}
void main() {
  vec3 hdr = texture2D( tDiffuse, vUv ).rgb;
  if ( uAO > 0.0 ) {
    // fade AO out with distance: it is for contact shading, not for hills
    float d = texture2D( tAODepth, vUv ).x;
    float viewZ = ( uNearFar.x * uNearFar.y ) / ( ( uNearFar.y - uNearFar.x ) * d - uNearFar.y );
    float fade = 1.0 - smoothstep( 35.0, 80.0, -viewZ );
    hdr *= mix( 1.0, texture2D( tAO, vUv ).r, uAO * fade );
  }
  hdr += uBloom * texture2D( tBloom, vUv ).rgb;
  vec3 c = czToneMap( hdr * uExposure );
  // grade: faintly warm highlights; shadows only a touch cool (skylight already tints them)
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c *= mix( vec3( 0.99, 1.0, 1.015 ), vec3( 1.015, 1.0, 0.98 ), smoothstep( 0.05, 0.6, l ) );
  // vignette
  vec2 q = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
  float r2 = dot( q, q ) / ( 0.25 * ( uAspect * uAspect + 1.0 ) );
  c *= 1.0 - uVignette * r2 * r2;
  c = czSRGB( clamp( c, 0.0, 1.0 ) );
  c += ( czHash( gl_FragCoord.xy ) - 0.5 ) / 255.0;
  gl_FragColor = vec4( c, 1.0 );
}`;

class FinalPass extends Pass {
  constructor(bloom, exposure) {
    super();
    this.bloom = bloom;
    this.ao = null;
    this.aoStrength = 0.9;
    this.material = new THREE.ShaderMaterial({
      name: 'FinalPass',
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        tAO: { value: null },
        tAODepth: { value: null },
        uBloom: { value: 1 },
        uAO: { value: 0 },
        uNearFar: { value: new THREE.Vector2(0.25, 3000) },
        uExposure: { value: exposure },
        uVignette: { value: 0.18 },
        uAspect: { value: 16 / 9 },
      },
      vertexShader: QUAD_VERT, fragmentShader: FINAL_FRAG,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  setSize(w, h) { this.material.uniforms.uAspect.value = w / Math.max(1, h); }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tBloom.value = this.bloom && this.bloom.enabled ? this.bloom.texture : null;
    u.uBloom.value = this.bloom && this.bloom.enabled ? 1 : 0;
    u.uAO.value = this.ao ? this.aoStrength : 0;
    u.tAO.value = this.ao ? this.ao.gtaoMap : null;
    u.tAODepth.value = this.ao ? this.ao.depthTexture : null;
    if (this.ao) u.uNearFar.value.set(this.ao.camera.near, this.ao.camera.far);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

// GTAO whose normal/depth pre-pass skips things that don't belong in the depth
// buffer: points, lines, sprites, transparent surfaces (skid marks, smoke,
// glass), alpha-tested cards (the override material can't cut them out, so
// foliage/tuft quads would occlude as solid rectangles) and anything flagged
// userData.noAO. Opaque ground layers (no depth write) stay in so cars get
// contact shading on the ground.
class ContactAOPass extends GTAOPass {
  constructor(...args) {
    super(...args);
    const cache = this._visibilityCache;
    const cutout = (m) => m && (m.transparent || m.alphaTest > 0 || m.alphaHash || m.visible === false);
    this._hide = (o) => {
      cache.set(o, o.visible);
      const m = o.material;
      if (o.isPoints || o.isLine || o.isSprite || o.userData.noAO ||
        (o.isMesh && (Array.isArray(m) ? m.every(cutout) : cutout(m)))) o.visible = false;
    };
    this._restore = (o) => { const v = cache.get(o); if (v !== undefined) o.visible = v; };
  }
  overrideVisibility() { this.scene.traverse(this._hide); }
  restoreVisibility() { this.scene.traverse(this._restore); this._visibilityCache.clear(); }
}

const AO_FAR = 150;

const BLOOM = {
  high: { strength: 0.32, radius: 0.55, threshold: 3.2, downscale: 1 },
  medium: { strength: 0.28, radius: 0.5, threshold: 3.2, downscale: 2 },
};

export class PostFX {
  constructor(renderer, scene, quality, exposure) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.useAO = quality === 'high';
    this.ao = null; // created on first render (needs the camera)
    const size = this.size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // MSAA on the HDR target where the GPU supports it for half-float, else FXAA
    const samples = quality === 'high' ? Math.min(4, maxHalfFloatSamples(renderer)) : 0;
    this.msaa = samples > 1;
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: this.msaa ? samples : 0,
      depthBuffer: true,
      stencilBuffer: false,
    });
    rt.texture.name = 'PostFX.hdr';
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(1); // sizes below are in drawing-buffer pixels
    this.renderPass = new RenderPass(scene, null);
    this.bloom = new BloomPass(size.clone(), BLOOM[quality] || BLOOM.medium);
    this.final = new FinalPass(this.bloom, exposure);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    if (!this.msaa) {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
    this.setSize(size.x, size.y);
  }

  set exposure(v) { this.final.material.uniforms.uExposure.value = v; }
  get exposure() { return this.final.material.uniforms.uExposure.value; }

  // drawing-buffer size (CSS size x pixel ratio)
  setSize(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    this.size.set(w, h);
    this.composer.setSize(w, h);
    if (this.ao) this.ao.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  // Ground-contact and crevice occlusion (high only): GTAO at half resolution,
  // computed into a texture the final pass multiplies in. No copy/blend passes.
  ensureAO(camera) {
    if (this.ao || !this.useAO) return;
    try {
      const w = Math.max(1, this.size.x >> 1), h = Math.max(1, this.size.y >> 1);
      this.aoCamera = new THREE.PerspectiveCamera();
      this.syncAOCamera(camera);
      this.ao = new ContactAOPass(this.scene, this.aoCamera, w, h, undefined,
        { radius: 1.0, distanceExponent: 1.6, thickness: 1.2, distanceFallOff: 1.0, scale: 1.4, samples: 12 },
        { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
      this.ao.output = GTAOPass.OUTPUT.Off;
      this.final.ao = this.ao;
    } catch (err) {
      console.warn('ambient occlusion disabled:', err);
      this.useAO = false;
      this.ao = null;
    }
  }

  // The AO pre-pass only needs the near field (AO fades out by 80 m): same view
  // and projection (including any setViewOffset), far plane pulled in to 150 m
  // so distant scenery is culled and depth precision goes where it is used.
  syncAOCamera(camera) {
    const c = this.aoCamera;
    camera.updateMatrixWorld();
    camera.matrixWorld.decompose(c.position, c.quaternion, c.scale);
    c.updateMatrixWorld();
    const n = camera.near, f = Math.min(camera.far, AO_FAR);
    c.near = n; c.far = f;
    c.projectionMatrix.copy(camera.projectionMatrix);
    const e = c.projectionMatrix.elements;
    e[10] = -(f + n) / (f - n);
    e[14] = -2 * f * n / (f - n);
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
  }

  render(camera) {
    this.renderPass.camera = camera;
    this.ensureAO(camera);
    if (this.ao) {
      // The AO normal pass hides decals, particles and alpha-tested cards, so it
      // must not refresh the shadow map (they would lose their shadows); the
      // main pass renders it once, with everything visible.
      const sm = this.renderer.shadowMap;
      const autoUpdate = sm.autoUpdate, needsUpdate = sm.needsUpdate;
      sm.autoUpdate = false;
      sm.needsUpdate = false;
      this.syncAOCamera(camera);
      this.ao.render(this.renderer, null, null);
      sm.autoUpdate = autoUpdate;
      sm.needsUpdate = needsUpdate;
    }
    this.composer.render();
  }

  dispose() {
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.bloom.dispose();
    this.final.dispose();
    if (this.ao) this.ao.dispose();
  }
}

// Largest MSAA sample count the GPU offers for RGBA16F renderbuffers (some
// mobile/older GPUs offer none; a multisampled target would then be incomplete).
function maxHalfFloatSamples(renderer) {
  try {
    const gl = renderer.getContext();
    const s = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
    return s && s.length ? Math.max(...s) : 0;
  } catch (err) {
    return 0;
  }
}

// Returns null when the tier renders directly or the device can't render to
// half-float targets.
export function createPost(renderer, scene, quality, exposure) {
  if (quality === 'low') return null;
  const ext = renderer.extensions;
  if (!renderer.capabilities.isWebGL2 || !(ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'))) return null;
  try {
    return new PostFX(renderer, scene, quality, exposure);
  } catch (err) {
    console.warn('post-processing disabled:', err);
    return null;
  }
}
