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
//   medium: scene (HDR)          -> bloom (quarter-res)    -> final -> 8-bit target -> FXAA -> screen
//   low:    direct render (no composer; the canvas has MSAA instead, see scene.js)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// AgX (Sobotka; Filament/three.js fit) with a look applied in the AgX log domain.
//
// The AgX log encoding is reshaped toward a camera response:
//   ev = log2(x)
//   ev += 0.595 * log2(1 + exp2((ev + 0.4) / 0.7))  photographic shoulder: AgX keeps
//        ~6.5 stops above middle grey, so a sunlit white wall would land at ~85% and
//        daylight looks flat; above ~0.75 each stop counts ~1.85, so sunlit whites
//        and clouds reach ~91-95%
//   ev += 0.10 * log2(1 + exp2(-4 - ev))            slightly softer toe than AgX, so
//        shade keeps detail without lifting the blacks
//   n = (ev + 12.47393) / 16.499999                 AgX log range
// That chain costs 12 log2/exp2 per pixel, and on 'low' it runs in every material
// (overdraw 2-4), so n is evaluated as a degree-6 polynomial in log2(x), fitted
// over the whole range (max error 0.18/255 before the look, max dE76 0.43 at the
// output). Every tier uses this same function, so tiers match exactly.
export const TONEMAP_GLSL = /* glsl */`
vec3 czAgxContrast( vec3 x ) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 czToneMap( vec3 color ) {
  // AgX inset * (linear sRGB -> Rec.2020), premultiplied
  const mat3 toAgx = mat3(
    vec3( 0.5448121, 0.1404193, 0.08881714 ),
    vec3( 0.3737974, 0.7541078, 0.1788598 ),
    vec3( 0.08138096, 0.1053967, 0.7323154 ) );
  const mat3 outset = mat3(
    vec3( 1.1271005818144368, -0.1413297634984383, -0.14132976349843826 ),
    vec3( -0.11060664309660323, 1.157823702216272, -0.11060664309660294 ),
    vec3( -0.016493938717834573, -0.016493938717834257, 1.2519364065950405 ) );
  const mat3 fromRec2020 = mat3( vec3( 1.6605, -0.1246, -0.0182 ), vec3( -0.5876, 1.1329, -0.1006 ), vec3( -0.0728, -0.0083, 1.1187 ) );
  color = toAgx * color;
  // log2(x) in [-13.42, 1.95] -> u in [0, 1] -> shaped AgX log value (see above)
  vec3 u = clamp( log2( max( color, 1e-10 ) ) * 0.06506181 + 0.87312947, 0.0, 1.0 );
  vec3 n = -0.00852148 + u * ( 1.20771 + u * ( -3.21688 + u * ( 11.5383 + u * ( -19.98 + u * ( 16.5216 + u * -5.06064 ) ) ) ) );
  color = czAgxContrast( clamp( n, 0.0, 1.0 ) );
  // look: AgX's inset leaves colours muted; restore saturation in the mid-tones,
  // less in deep shadow (skylight already tints them blue) and in highlights
  // (keeps sunlit red paint from clipping).
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  float sat = mix( 1.22, 1.52, smoothstep( 0.08, 0.3, luma ) ) * ( 1.0 - 0.18 * smoothstep( 0.55, 0.92, luma ) );
  color = luma + sat * ( color - luma );
  color = outset * color;
  // gentle S-curve in display space: deeper blacks (no hazy, lifted shadows),
  // middle grey stays put, highlights a touch brighter
  color += 0.22 * ( color * color * ( 3.0 - 2.0 * color ) - color );
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
// sun glints don't flicker. The sun's specular on clearcoat and glass (roughness
// 0.015-0.03) peaks in the thousands, so each tap is clamped (hue kept) and the
// taps are averaged with 1/(1 + luma) weights (Karis average): an isolated glint
// can't flood the blur chain with a white smudge, while bright areas a few pixels
// across (the sun disc, a wide sheen) still bloom.
const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
vec4 czTap( vec2 o ) {
  vec3 c = texture2D( tDiffuse, vUv + uTexel * o ).rgb;
  float br = max( c.r, max( c.g, c.b ) );
  float k = min( 1.0, 24.0 / max( br, 1e-4 ) );
  c *= k;
  br *= k;
  float knee = uThreshold * 0.5;
  float soft = clamp( br - uThreshold + knee, 0.0, 2.0 * knee );
  soft = soft * soft / ( 4.0 * knee + 1e-4 );
  float w = 1.0 / ( 1.0 + dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) );
  return vec4( c * ( max( soft, br - uThreshold ) / max( br, 1e-4 ) * w ), w );
}
void main() {
  vec4 s = czTap( vec2( -0.5, -0.5 ) ) + czTap( vec2( 0.5, -0.5 ) )
         + czTap( vec2( -0.5, 0.5 ) ) + czTap( vec2( 0.5, 0.5 ) );
  gl_FragColor = vec4( min( s.rgb / s.a, vec3( 16.0 ) ), 1.0 );
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
  c *= mix( vec3( 0.98, 1.0, 1.03 ), vec3( 1.03, 1.0, 0.96 ), smoothstep( 0.05, 0.6, l ) );
  // vignette
  vec2 q = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
  float r2 = dot( q, q ) / ( 0.25 * ( uAspect * uAspect + 1.0 ) );
  c *= 1.0 - uVignette * r2 * r2;
  c = czSRGB( clamp( c, 0.0, 1.0 ) );
  c += ( czHash( gl_FragCoord.xy ) - 0.5 ) / 255.0;
  gl_FragColor = vec4( c, 1.0 );
}`;

// The composer never swaps buffers: the scene stays in its one HDR target, and
// the final pass writes to the screen or, when FXAA follows, to an 8-bit target
// (`output`). Swapping would alternate the scene between two HDR targets (on
// 'high' a second 4x MSAA half-float target, tens of MB) and keep the
// FXAA input in half-float for no gain.
class FinalPass extends Pass {
  constructor(bloom, exposure) {
    super();
    this.needsSwap = false;
    this.output = null;
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

  setSize(w, h) {
    this.material.uniforms.uAspect.value = w / Math.max(1, h);
    if (this.output) this.output.setSize(w, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tBloom.value = this.bloom && this.bloom.enabled ? this.bloom.texture : null;
    u.uBloom.value = this.bloom && this.bloom.enabled ? 1 : 0;
    u.uAO.value = this.ao ? this.aoStrength : 0;
    u.tAO.value = this.ao ? this.ao.gtaoMap : null;
    u.tAODepth.value = this.ao ? this.ao.depthTexture : null;
    if (this.ao) u.uNearFar.value.set(this.ao.camera.near, this.ao.camera.far);
    // (only a pass that writes the composer's writeBuffer may swap)
    this.needsSwap = !this.renderToScreen && !this.output;
    renderer.setRenderTarget(this.renderToScreen ? null : (this.output || writeBuffer));
    this.fsQuad.render(renderer);
  }

  dispose() { this.material.dispose(); this.fsQuad.dispose(); if (this.output) this.output.dispose(); }
}

// FXAA from the final pass's 8-bit output straight to the screen.
class FXAAPass extends ShaderPass {
  constructor(input) {
    super(FXAAShader);
    this.input = input;
    this.needsSwap = false;
  }

  render(renderer, writeBuffer) { super.render(renderer, writeBuffer, this.input); }
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

// radius < 0.5 favours the tight mips, so what still blooms stays close to the highlight
const BLOOM = {
  high: { strength: 0.42, radius: 0.4, threshold: 3.2, downscale: 1 },
  medium: { strength: 0.36, radius: 0.35, threshold: 3.2, downscale: 2 },
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
      // tone-mapped, dithered sRGB: 8 bits is all FXAA needs
      const ldr = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { depthBuffer: false, stencilBuffer: false });
      ldr.texture.name = 'PostFX.ldr';
      this.final.output = ldr;
      this.fxaa = new FXAAPass(ldr);
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
    if (this.fxaa) this.fxaa.dispose();
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

// Whether this device can run the composer (renders to half-float targets).
// Asked before the renderer exists, on a throwaway context, so the canvas can be
// created with MSAA when there will be no composer to antialias.
export function probePostSupport() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const ok = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return ok;
  } catch (err) {
    return false;
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
