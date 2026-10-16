// Renderer, sky, lighting, reflections and the frame render.
//
// One sun (sky.js SUN_DIR) drives everything: the sky dome and its clouds, the
// shadow-casting DirectionalLight, the aerial-perspective fog and the
// prefiltered environment map used for paint/glass reflections and ambient
// light. Post-processing (post.js) runs on 'medium' and 'high'; 'low' renders
// straight to the canvas with the same tone curve.
//
// Handy values for other modules (all on WorldView):
//   sunDirection (unit THREE.Vector3 toward the sun), sunColor, sunIntensity,
//   horizonColor (THREE.Color, linear; same object as scene.fog.color),
//   skyIrradiance (THREE.Color), hazeAt(dir, outColor) (horizon haze colour for
//   a view direction, what distant things fade into), exposure.
import * as THREE from 'three';
import { Environment } from './environment.js';
import { SkyDome, SUN_DIR, SUN_COLOR, SUN_ILLUMINANCE, HORIZON_COLOR, SKY_IRRADIANCE, hazeRadiance } from './sky.js';
import { SunRig, installLightingChunks } from './lighting.js';
import { createPost, installToneMapping, probePostSupport } from './post.js';

// sunlit 18% grey -> ~60% sRGB, sunlit white ~91%, clouds ~95%, shaded asphalt
// ~17% (see the tone curve in post.js)
const EXPOSURE = 0.93;
// pixel budgets (drawing-buffer pixels) per tier; the tier caps DPR as before
const DPR_CAP = { high: 2, medium: 1.25, low: 1.25 };
const PIXEL_BUDGET = { high: 2560 * 1440, medium: 1920 * 1080, low: 1280 * 720 * 1.1 };

function pixelRatioFor(quality, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP[quality] || 1.25);
  const budget = PIXEL_BUDGET[quality] || PIXEL_BUDGET.medium;
  const fit = Math.sqrt(budget / Math.max(1, w * h));
  return Math.max(Math.min(dpr, fit), Math.min(1, dpr));
}

export function createRenderer(canvas, quality) {
  installLightingChunks(quality);
  // With post-processing, MSAA happens in the HDR target ('high') or FXAA runs
  // ('medium'), so the canvas doesn't need it. Without ('low', or no half-float
  // targets) the canvas gets MSAA: nearly free on tile-based mobile GPUs, and the
  // thin kerbs, rails, posts and building edges crawl without it.
  const direct = quality === 'low' || !probePostSupport();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: direct, stencil: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatioFor(quality, window.innerWidth, window.innerHeight));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  installToneMapping(renderer, EXPOSURE);
  renderer.shadowMap.enabled = quality !== 'low';
  // 'medium': PCFShadowMap is patched to a 4-tap bilinear PCF (lighting.js)
  renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.setClearColor(HORIZON_COLOR, 1);
  return renderer;
}

export class WorldView {
  constructor(renderer, world, quality) {
    this.renderer = renderer;
    this.world = world;
    this.quality = quality;
    const scene = this.scene = new THREE.Scene();

    this.sunDirection = SUN_DIR.clone();
    this.sunColor = SUN_COLOR.clone();
    this.sunIntensity = SUN_ILLUMINANCE;
    this.skyIrradiance = SKY_IRRADIANCE.clone();
    this._exposure = EXPOSURE;
    this._haze = [0, 0, 0];
    this._invRef = new THREE.Color(1 / HORIZON_COLOR.r, 1 / HORIZON_COLOR.g, 1 / HORIZON_COLOR.b);

    // aerial perspective: clear near by, ~7% haze at 500 m, ~36% at 1 km, ~95% by
    // 2.2 km (see lighting.js). near/far are chosen so shaders that do their own
    // smoothstep(fogNear, fogFar, depth) get nearly the same amounts.
    scene.fog = new THREE.Fog(HORIZON_COLOR.clone(), 120, 2200);
    this.horizonColor = scene.fog.color;

    this.skyDome = new SkyDome(scene, quality);
    this.sky = this.skyDome.mesh;

    // reflections + image-based ambient from the same sky (plus lit ground and a hazy horizon band)
    scene.environment = this.skyDome.buildEnvironment(renderer);
    scene.environmentIntensity = 1.0;

    // sky + ground-bounce irradiance for non-PBR materials only (lighting.js keeps
    // it off materials that already get ambient from scene.environment)
    const bounce = new THREE.Color(0.09, 0.1, 0.075).multiply(
      SUN_COLOR.clone().multiplyScalar(SUN_ILLUMINANCE * SUN_DIR.y).add(SKY_IRRADIANCE));
    // (clouds and the bright horizon make real skylight less blue than clear-sky single scattering)
    const skyFill = SKY_IRRADIANCE.clone();
    const lum = skyFill.r * 0.2126 + skyFill.g * 0.7152 + skyFill.b * 0.0722;
    skyFill.lerp(new THREE.Color(lum, lum, lum), 0.35);
    // x1.3: the clouds in the environment add about that much to the PBR ambient,
    // so Lambert and Standard surfaces in shade come out alike
    this.hemi = new THREE.HemisphereLight(skyFill, bounce, 1.3);
    scene.add(this.hemi);

    this.sunRig = new SunRig(scene, quality);
    this.sun = this.sunRig.light;

    this.env = new Environment(this);
    this.post = createPost(renderer, scene, quality, EXPOSURE);

    // A lost context (phones backgrounding the tab, GPU resets) comes back with
    // every render-target texture empty. Data/canvas textures and per-frame
    // targets refill themselves, but the prefiltered environment would stay
    // black, leaving PBR surfaces (whose hemisphere fill is off, see
    // lighting.js) with no ambient light. Rebuild it; three's own restore
    // handler was registered first, so the renderer is ready by now.
    this._onContextRestored = () => {
      // the old target's GL objects died with the context: drop it, don't dispose
      // it (its listeners belong to the pre-loss renderer state)
      this.skyDome.envRT = null;
      scene.environment = this.skyDome.buildEnvironment(renderer);
    };
    renderer.domElement.addEventListener('webglcontextrestored', this._onContextRestored);
  }

  // horizon haze (linear radiance) toward `dir`, scaled by any fog colour change
  hazeAt(dir, out = new THREE.Color()) {
    const c = hazeRadiance(dir, this._haze);
    return out.setRGB(c[0], c[1], c[2]).multiply(this.horizonColor).multiply(this._invRef);
  }

  // exposure multiplier ahead of the tone curve, applied on every tier
  get exposure() { return this._exposure; }
  set exposure(v) {
    this._exposure = v;
    this.renderer.toneMappingExposure = v;
    if (this.post) this.post.exposure = v;
  }

  followSun(target, camera = null) {
    this.sunRig.follow(target, camera);
  }

  // ---- seams used by main.js
  addColliderMesh(c) { return this.env.addColliderMesh(c); }
  removeColliderMesh(c) { this.env.removeColliderMesh(c); }

  // called once per frame before render; focus = THREE.Vector3 the camera follows
  update(dt, camera, focus) {
    this.skyDome.update(dt, camera);
    if (focus) this.followSun(focus, camera);
    else if (camera) this.followSun(camera.position, camera);
    this.env.update(dt, camera);
  }

  setSize(w, h) {
    const pr = pixelRatioFor(this.quality, w, h);
    if (pr !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.post) {
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.post.setSize(s.x, s.y);
    }
  }

  render(camera) {
    if (this.post) this.post.render(camera);
    else this.renderer.render(this.scene, camera);
  }
}
