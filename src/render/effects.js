// Crash and driving effects: lit tyre smoke / dust / steam / oily smoke, HDR spark
// streaks, glass shards with glints, tumbling debris, tyre marks and loose wheels.
// Public API (used by main.js) is unchanged; the systems live in fx*.js.
import * as THREE from 'three';
import { makeWheelMesh } from './carview.js';
import { makeCarMaterials, CRACKED } from './carmaterials.js';
import { CARS } from '../vehicle/specs.js';
import { makePuffAtlas, makeNoiseTexture, makeGlintTexture, linearRGB } from './fxtextures.js';
import { BillboardPool, StreakPool } from './fxparticles.js';
import { RigidPool, chunkGeometry, shardGeometry } from './fxdebris.js';
import { SkidMarks } from './fxskids.js';

// Budgets per quality tier. 'low' halves the pools and shrinks puffs to keep phone
// overdraw down; 'high' gets detail noise in the smoke, shadows on debris and more glints.
const QUALITY = {
  high: { smoke: 640, glints: 72, sparks: 600, shards: 420, plastic: 160, metal: 90, skids: 4096, size: 1, alpha: 1, detail: true, bulge: true, sparkPerCall: 2, glassPerEvent: 110, glassBurst: 7, glintFly: 2.5, glintRest: 0.04, debrisMul: 0.8, debrisRate: 160, shadows: true, hotspots: 0.3, clods: 160, clodRate: 0.35, tex: 128 },
  medium: { smoke: 360, glints: 48, sparks: 400, shards: 280, plastic: 110, metal: 60, skids: 3072, size: 0.7, alpha: 1.1, detail: false, bulge: false, sparkPerCall: 1, glassPerEvent: 75, glassBurst: 5, glintFly: 1.5, glintRest: 0.02, debrisMul: 0.7, debrisRate: 110, shadows: false, hotspots: 0.2, clods: 100, clodRate: 0.25, tex: 128 },
  low: { smoke: 320, glints: 24, sparks: 200, shards: 140, plastic: 60, metal: 30, skids: 2048, size: 0.65, alpha: 1.2, detail: false, bulge: false, sparkPerCall: 1, glassPerEvent: 36, glassBurst: 4, glintFly: 0.8, glintRest: 0, debrisMul: 0.6, debrisRate: 60, shadows: false, hotspots: 0, clods: 50, clodRate: 0.15, tex: 64 },
};

// Particle presets (life range s, start/end radius m, peak opacity, fade-in s,
// edge erosion, buoyancy m/s^2, air drag 1/s, wind coupling, swirl, spin rad/s).
// Optional: rVar (end-radius spread, +-fraction), shear (m/s drift along the wind
// that grows with age, so tall plumes lean and fan out), colT (fraction of life
// over which the colour goes from col to col2; default the whole life).
const P_TYRE = { life: [2.0, 3.2], r0: 0.32, r1: 2.3, alpha: 0.5, fadeIn: 0.2, erode: 0.55, buoy: 0.22, drag: 1.3, wind: 1, turb: 0.6, spin: 0.7 };
const P_DUST = { life: [1.8, 2.8], r0: 0.38, r1: 2.1, alpha: 0.6, fadeIn: 0.08, erode: 0.5, buoy: -0.04, drag: 1.8, wind: 0.8, turb: 0.4, spin: 0.5 };
const P_STEAM = { life: [0.9, 1.5], r0: 0.12, r1: 1.0, alpha: 0.45, fadeIn: 0.06, erode: 0.75, buoy: 1.4, drag: 1.0, wind: 1.2, turb: 1.2, spin: 1.2 };
const P_OIL = { life: [2.4, 3.6], r0: 0.18, r1: 2.0, rVar: 0.4, alpha: 0.36, fadeIn: 0.1, erode: 0.55, buoy: 0.75, drag: 0.9, wind: 1.4, turb: 1.6, spin: 0.6, shear: 1.2, colT: 0.6 };
const P_CRASH = { life: [1.6, 2.6], r0: 0.5, r1: 2.6, alpha: 0.22, fadeIn: 0.05, erode: 0.5, buoy: 0.05, drag: 2.2, wind: 0.8, turb: 0.5, spin: 0.5 };
const P_WHEEL = { life: [1.2, 2.0], r0: 0.25, r1: 1.3, alpha: 0.3, fadeIn: 0.08, erode: 0.5, buoy: 0.05, drag: 1.8, wind: 0.8, turb: 0.4, spin: 0.5 };
const P_GLINT = { life: [0.08, 0.2], r0: 0.05, r1: 0.075, alpha: 1, fadeIn: 0.025, erode: 0, buoy: 0, drag: 0, wind: 0, turb: 0, spin: 2 };
const P_BURST = { life: [0.08, 0.2], r0: 0.06, r1: 0.09, alpha: 1, fadeIn: 0.02, erode: 0, buoy: 0, drag: 0, wind: 0, turb: 0, spin: 1 };
const P_HOT = { life: [0.04, 0.08], r0: 0.09, r1: 0.12, alpha: 1, fadeIn: 0.01, erode: 0, buoy: 0, drag: 0, wind: 0, turb: 0, spin: 4 };

// albedo (linear)
const C_TYRE = [linearRGB('#d9d9d6'), linearRGB('#cfd0d0'), linearRGB('#e2e0dc')];
const C_DIRT = linearRGB('#9a8064');
const C_DIRT2 = linearRGB('#b9a78f');
const C_GRASS = linearRGB('#857a5e');
const C_GRASS2 = linearRGB('#a39a84');
const C_STEAM = linearRGB('#f4f6f7');
const C_OIL = linearRGB('#2f2c29');
const C_OIL2 = linearRGB('#77736d');
const C_CRASH = linearRGB('#a9a59d');
const C_WHEEL = linearRGB('#a39c8e');
// emissive HDR colours (linear, > 1 so bloom can pick them up)
const C_GLINT = [5, 5.3, 5.8];
const C_HOT = [9, 5, 1.6];

const CLOD_DIRT = [0x5b4633, 0x6b5440, 0x4a3a2a, 0x7a6249];
const CLOD_GRASS = [0x3d4a22, 0x4b3d2a, 0x56472f, 0x35411d];
const PLASTIC = [0x1d1e20, 0x242527, 0x2c2d30, 0x34363a, 0x3f4145, 0x18191b];
const METAL = [0x75797f, 0x8b8f95, 0x9ea2a8, 0x60646a, 0xb3b6ba];

const rnd = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

class LooseWheel {
  constructor(scene, spec, pos, vel, side, quality) {
    this.mesh = makeWheelMesh(spec, quality);
    if (side < 0) this.mesh.scale.z = -1;
    this.r = spec.dims.wheelRadius;
    this.p = new THREE.Vector3(...pos);
    this.v = new THREE.Vector3(...vel).add(new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3));
    this.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, 0));
    this.w = new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 12);
    this.dq = new THREE.Quaternion();
    this.axis = new THREE.Vector3();
    this.scene = scene;
    scene.add(this.mesh);
    this.age = 0;
  }

  update(dt, fx) {
    this.age += dt;
    this.v.y -= 9.81 * dt;
    this.p.addScaledVector(this.v, dt);
    if (this.p.y < this.r) {
      this.p.y = this.r;
      const impact = -this.v.y;
      if (this.v.y < 0) this.v.y *= -0.35;
      this.v.x *= 0.985; this.v.z *= 0.985;
      this.w.multiplyScalar(0.97);
      // kick up a little dust when it lands hard or rolls fast
      const speed = Math.hypot(this.v.x, this.v.z);
      if (impact > 2.5) fx.wheelDust(this.p.x, this.p.z, this.v.x, this.v.z, Math.min(1, impact / 8));
      else if (speed > 3 && Math.random() < speed * 0.012) fx.wheelDust(this.p.x, this.p.z, this.v.x, this.v.z, Math.min(1, speed / 15) * 0.5);
    }
    const wl = this.w.length();
    if (wl > 1e-4) {
      this.axis.copy(this.w).divideScalar(wl);
      this.q.premultiply(this.dq.setFromAxisAngle(this.axis, wl * dt));
    }
    this.mesh.position.copy(this.p);
    this.mesh.quaternion.copy(this.q);
  }

  dispose() { this.scene.remove(this.mesh); }
}

export class Effects {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    const Q = this.Q = QUALITY[quality] || QUALITY.high;
    const puff = makePuffAtlas(Q.tex), noise = makeNoiseTexture(Q.tex), glintTex = makeGlintTexture();

    this.smoke = new BillboardPool(scene, { max: Q.smoke, map: puff, detail: Q.detail ? noise : null, bulge: Q.bulge, lit: true, lift: 0.65, nearFade: [0.6, 3.5], maxScreen: true, renderOrder: 2 });
    this.glints = new BillboardPool(scene, { max: Q.glints, map: glintTex, additive: true, nearFade: [0.1, 0.4], renderOrder: 4 });
    this.sparks = new StreakPool(scene, Q.sparks);

    // Glass is a dielectric: ~4% reflective face-on (the dark green-grey base stands in
    // for the ground seen through it), mirror-bright at grazing angles, so the
    // tumbling facets flash instead of reading as white paper chips.
    const glassMat = new THREE.MeshStandardMaterial({ color: '#4c5a57', metalness: 0, roughness: 0.04, envMapIntensity: 1.7, flatShading: true, side: THREE.DoubleSide });
    this.shards = new RigidPool(scene, { max: Q.shards, geometry: shardGeometry(), material: glassMat, restLife: 30, bounce: 0.35 });
    const plasticMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.05, roughness: 0.55, flatShading: true });
    const metalMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.85, roughness: 0.35, flatShading: true });
    this.plastic = new RigidPool(scene, { max: Q.plastic, geometry: chunkGeometry(3), material: plasticMat, colors: true, castShadow: Q.shadows, restLife: 45, bounce: 0.3 });
    this.metal = new RigidPool(scene, { max: Q.metal, geometry: chunkGeometry(11), material: metalMat, colors: true, castShadow: Q.shadows, restLife: 45, bounce: 0.25 });
    // clods of dirt and turf thrown by tyres sliding off the tarmac
    const clodMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0, roughness: 1, flatShading: true });
    this.clods = new RigidPool(scene, { max: Q.clods, geometry: chunkGeometry(7), material: clodMat, colors: true, restLife: 9, bounce: 0.12 });

    this.skids = new SkidMarks(scene, Q.skids, noise);
    this.loose = [];

    this.time = 0;
    this.wind = new THREE.Vector3(1.1, 0, 0.5);
    this.debrisTokens = Q.debrisRate * 0.5;
    // the sort for smoke uses the camera of the last frame that was drawn
    this.camPos = new THREE.Vector3(0, 5, 0);
    const grabCamera = (r, s, cam) => { this.camPos.setFromMatrixPosition(cam.matrixWorld); };
    this.skids.mesh.onBeforeRender = grabCamera;
    this.smoke.mesh.onBeforeRender = (r, s, cam) => { grabCamera(r, s, cam); this.smoke.checkRenderer(r); };

    // lighting taken from the scene's own lights (found lazily)
    this.sun = null; this.hemi = null; this.lightScan = 0;
    this.sunDir = new THREE.Vector3(0.6, 0.7, 0.35).normalize();
    this.sunCol = new THREE.Color(); this.skyCol = new THREE.Color(); this.groundCol = new THREE.Color();
    this.tmpCol = new THREE.Color();
    this.updateLighting(0);

    const glint = (x, y, z, vx, vy, vz) => this.glints.emit(x, y, z, vx, vy, vz, P_GLINT, 1, 1, C_GLINT);
    this.glassGlint = { rateFly: Q.glintFly, rateRest: Q.glintRest, emit: glint };

    // engine smoke / steam sources, to thin the plume out once a wreck stands still
    this.sources = [];

    // Shader warm-up: every pool starts hidden, so without this their programs (and
    // the debris shadow-depth variants, and the cracked-glass material) would compile
    // lazily on the frame of the first crash. For the first few frames after start
    // and after every clear() the empty pools are drawn with zero instances, which
    // builds the programs while the game is loading or a mode is starting.
    const dummyGeo = new THREE.BufferGeometry();
    dummyGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    dummyGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    dummyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2));
    let cracked = null;
    try {
      const spec = CARS.a4 || CARS[Object.keys(CARS)[0]];
      const set = makeCarMaterials(spec, quality, spec.color);
      cracked = set.list[CRACKED];
      set.release();
    } catch (e) { cracked = null; }
    this.crackedDummy = new THREE.Mesh(dummyGeo, cracked || new THREE.MeshBasicMaterial());
    this.crackedDummy.frustumCulled = false;
    this.crackedDummy.receiveShadow = true;
    this.crackedDummy.visible = false;
    if (cracked) scene.add(this.crackedDummy);
    const bb = (p) => ({ mesh: p.mesh, empty: () => p.live === 0, zero: () => { p.geo.instanceCount = 0; } });
    const rg = (p) => ({ mesh: p.mesh, empty: () => p.active === 0, zero: () => { p.mesh.count = 0; } });
    this.warmList = [bb(this.smoke), bb(this.glints), bb(this.sparks), rg(this.shards), rg(this.plastic), rg(this.metal), rg(this.clods),
      { mesh: this.skids.mesh, empty: () => this.skids.used === 0, zero: () => this.skids.geo.setDrawRange(0, 0) }];
    if (cracked) this.warmList.push({ mesh: this.crackedDummy, empty: () => true, zero: () => {} });
    this.forced = [];
    this.warmFrames = 3;
    this.forceWarm();
  }

  forceWarm() {
    for (const w of this.warmList) {
      if (w.mesh.visible || !w.empty()) continue;
      w.zero();
      w.mesh.visible = true;
      this.forced.push(w);
    }
  }

  unforceWarm() {
    for (const w of this.forced) if (w.empty()) w.mesh.visible = false;
    this.forced.length = 0;
  }

  // Engine smoke and steam come from a car's nose every few frames. A wreck that
  // stands still keeps emitting into the same column, which piles up into an opaque
  // sheet; track where each source is and taper it off after ~8 s in one spot.
  sourceGate(x, z) {
    const t = this.time, src = this.sources;
    let s = null;
    for (const c of src) {
      if (t - c.last > 1) continue;
      if ((c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) < 1.2 * 1.2) { s = c; break; }
    }
    if (!s) {
      s = src.find(c => t - c.last > 1);
      if (!s) { if (src.length >= 16) src.shift(); s = {}; src.push(s); }
      s.x = x; s.z = z; s.t0 = s.tA = t;
    } else if ((s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) > 1) {
      // moved a metre: re-anchor, and restart the clock unless it only crept there
      if (t - s.tA < 4) s.t0 = t;
      s.x = x; s.z = z; s.tA = t;
    }
    s.last = t;
    const still = t - s.t0;
    return still < 8 ? 1 : Math.max(0, 1 - (still - 8) / 4);
  }

  setViewport(h, fov) {
    this.sparks.setViewHeight(h);
    this.viewH = h; this.fov = fov;
  }

  // ------------------------------------------------------------------ emitters
  tyreSmoke(x, y, z, vx, vz, amount, surface) {
    this.skids.hint(x, z, surface);
    const Q = this.Q;
    const jx = (Math.random() - 0.5) * 0.3, jz = (Math.random() - 0.5) * 0.3;
    if (surface === 'grass' || surface === 'dirt') {
      const dirt = surface === 'dirt';
      this.smoke.emit(x + jx, y + 0.18, z + jz,
        vx * 0.35 + (Math.random() - 0.5) * 1.4, 0.25 + Math.random() * 0.6, vz * 0.35 + (Math.random() - 0.5) * 1.4,
        P_DUST, Q.size * (0.55 + amount * 0.6), Q.alpha * (dirt ? 0.45 + 0.55 * amount : 0.2 + 0.45 * amount), dirt ? C_DIRT : C_GRASS, dirt ? C_DIRT2 : C_GRASS2);
      if (amount > 0.3 && Math.random() < Q.clodRate * amount) {
        const sz = rnd(0.025, 0.06), pal = dirt ? CLOD_DIRT : CLOD_GRASS;
        this.clods.emit(x + jx, y + 0.08, z + jz,
          vx * 0.45 + (Math.random() - 0.5) * 2.5, 1.2 + Math.random() * 2.8, vz * 0.45 + (Math.random() - 0.5) * 2.5,
          sz, sz * rnd(0.5, 0.9), sz * rnd(0.6, 1), pal[Math.floor(Math.random() * pal.length)]);
      }
    } else {
      this.smoke.emit(x + jx, y + 0.2, z + jz,
        vx * 0.3 + (Math.random() - 0.5), 0.4 + Math.random() * 0.6, vz * 0.3 + (Math.random() - 0.5),
        P_TYRE, Q.size * (0.5 + 0.7 * amount), Q.alpha * (0.3 + 0.7 * amount), C_TYRE[Math.floor(Math.random() * 3)]);
    }
  }

  steam(x, y, z, dark) {
    const Q = this.Q;
    const gate = this.sourceGate(x, z);
    if (dark) {
      // main.js calls this on about half the frames (a fifth on low); oil smoke only
      // needs ~0.3 puffs per frame (0.15 on low), more just stacks into a flat veil
      // (a dead engine on a parked wreck keeps a faint wisp going)
      if (Math.random() >= (this.quality === 'low' ? 0.75 : 0.6) * Math.max(0.12, gate)) return;
      this.smoke.emit(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 1.2, 0.9 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2,
        P_OIL, Q.size, Q.alpha, C_OIL, C_OIL2);
    } else {
      if (gate < 1 && Math.random() >= gate) return;
      this.smoke.emit(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.8, 1.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.8,
        P_STEAM, Q.size, Q.alpha, C_STEAM);
    }
  }

  spark(x, y, z, vx, vy, vz) {
    const Q = this.Q;
    for (let k = 0; k < Q.sparkPerCall; k++) {
      const m = 0.6 + Math.random() * 0.7;
      this.sparks.emit(x, y + 0.02, z,
        vx * m + (Math.random() - 0.5) * 5, vy + 0.5 + Math.random() * 3.5, vz * m + (Math.random() - 0.5) * 5,
        0.25 + Math.random() * 0.55, 0.65 + Math.random() * 0.35);
    }
    if (Math.random() < Q.hotspots) this.glints.emit(x, y + 0.03, z, 0, 0, 0, P_HOT, 1, 1, C_HOT);
  }

  glass(x, y, z, vx, vy, vz) {
    const Q = this.Q;
    for (let k = 0; k < Q.glassPerEvent; k++) {
      // tempered glass crumbles into small nuggets (mostly 1-2 cm, a few larger)
      const s = 0.007 + Math.random() * Math.random() * 0.024;
      this.shards.emit(x + (Math.random() - 0.5) * 0.9, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.9,
        vx * 0.6 + (Math.random() - 0.5) * 5, vy + Math.random() * 3, vz * 0.6 + (Math.random() - 0.5) * 5,
        s * rnd(0.8, 1.4), 0.004 + Math.random() * 0.003, s * rnd(0.6, 1.1));
    }
    for (let k = 0; k < Q.glassBurst; k++) {
      this.glints.emit(x + (Math.random() - 0.5) * 0.9, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.9,
        vx * 0.5 + (Math.random() - 0.5) * 3, vy + Math.random() * 2, vz * 0.5 + (Math.random() - 0.5) * 3, P_BURST, 1, 1, C_GLINT);
    }
  }

  debrisDust(x, y, z, amount) {
    const Q = this.Q;
    // chunks of trim and metal, limited by a token bucket so pile-ups stay bounded
    let n = Math.min(Math.round(amount * Q.debrisMul), Math.floor(this.debrisTokens));
    this.debrisTokens -= n;
    while (n-- > 0) {
      const a = Math.random() * Math.PI * 2, d = 0.6 + Math.random() * 1.4;
      const ca = Math.cos(a), sa = Math.sin(a);
      const out = 1.5 + Math.random() * 4.5;
      const px = x + ca * d, py = Math.max(0.15, y + rnd(-0.25, 0.35)), pz = z + sa * d;
      const vx = ca * out + (Math.random() - 0.5) * 2, vy = 1 + Math.random() * 4.5, vz = sa * out + (Math.random() - 0.5) * 2;
      if (Math.random() < 0.65) {
        const big = Math.random() < 0.25;
        const sx = big ? rnd(0.12, 0.26) : rnd(0.04, 0.12);
        this.plastic.emit(px, py, pz, vx, vy, vz, sx, rnd(0.008, 0.02), sx * rnd(0.4, 0.9), PLASTIC[Math.floor(Math.random() * PLASTIC.length)]);
      } else {
        const chunky = Math.random() < 0.4;
        const sx = rnd(0.03, 0.1);
        this.metal.emit(px, py, pz, vx, vy, vz, sx, chunky ? sx * rnd(0.5, 0.9) : rnd(0.006, 0.014), sx * rnd(0.5, 1.0), METAL[Math.floor(Math.random() * METAL.length)]);
      }
    }
    // a low, wide burst of dust thrown out from under the car
    const nd = Math.max(1, Math.round(amount * 0.35));
    for (let k = 0; k < nd; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * 1.5;
      const ca = Math.cos(a), sa = Math.sin(a);
      this.smoke.emit(x + ca * d, 0.3 + Math.random() * 0.4, z + sa * d,
        ca * rnd(1.5, 4), rnd(0.3, 1.5), sa * rnd(1.5, 4), P_CRASH, Q.size, Q.alpha, C_CRASH);
    }
  }

  wheelDust(x, z, vx, vz, amount) {
    this.smoke.emit(x, 0.2, z, vx * 0.2 + (Math.random() - 0.5), 0.3 + Math.random() * 0.4, vz * 0.2 + (Math.random() - 0.5),
      P_WHEEL, this.Q.size * (0.6 + amount * 0.6), this.Q.alpha * (0.4 + 0.6 * amount), C_WHEEL);
  }

  looseWheel(spec, pos, vel, side) {
    this.loose.push(new LooseWheel(this.scene, spec, pos, vel, side, this.quality));
    if (this.loose.length > 12) this.loose.shift().dispose();
  }

  // ------------------------------------------------------------------ frame
  updateLighting(dt) {
    this.lightScan -= dt;
    if ((!this.sun || !this.sun.parent) && this.lightScan <= 0) {
      this.lightScan = 2;
      this.sun = null; this.hemi = null;
      this.scene.traverse((o) => {
        if (o.isDirectionalLight && (!this.sun || (o.castShadow && !this.sun.castShadow))) this.sun = o;
        if (o.isHemisphereLight && !this.hemi) this.hemi = o;
      });
    }
    const sun = this.sun, hemi = this.hemi;
    if (sun) {
      _v.setFromMatrixPosition(sun.matrixWorld).sub(_v2.setFromMatrixPosition(sun.target.matrixWorld));
      if (_v.lengthSq() > 1e-6) this.sunDir.copy(_v.normalize());
      this.sunCol.copy(sun.color).multiplyScalar(sun.intensity / Math.PI);
    } else this.sunCol.setRGB(0.85, 0.8, 0.72);
    // image-based ambient from the sky is not visible to custom shaders: approximate it
    const env = this.scene.environment ? (this.scene.environmentIntensity ?? 1) : 0;
    this.skyCol.setRGB(0.3, 0.36, 0.45).multiplyScalar(0.4 + 0.6 * env);
    this.groundCol.setRGB(0.15, 0.15, 0.13).multiplyScalar(0.4 + 0.6 * env);
    if (hemi) {
      this.skyCol.add(this.tmpCol.copy(hemi.color).multiplyScalar(hemi.intensity / Math.PI));
      this.groundCol.add(this.tmpCol.copy(hemi.groundColor).multiplyScalar(hemi.intensity / Math.PI));
    }
    this.smoke.setLighting(this.sunDir, this.sunCol, this.skyCol, this.groundCol);
  }

  update(dt) {
    if (this.forced.length) this.unforceWarm();
    this.time += dt;
    const t = this.time;
    this.wind.set(1.1 + 0.45 * Math.sin(t * 0.31) + 0.2 * Math.sin(t * 1.7), 0, 0.5 + 0.3 * Math.sin(t * 0.23 + 1.3));
    this.debrisTokens = Math.min(this.Q.debrisRate * 0.5, this.debrisTokens + this.Q.debrisRate * dt);
    this.updateLighting(dt);
    this.smoke.update(dt, this.camPos, this.wind);
    this.sparks.update(dt);
    this.shards.update(dt, this.glassGlint);
    this.plastic.update(dt, null);
    this.metal.update(dt, null);
    this.clods.update(dt, null);
    this.glints.update(dt, this.camPos, this.wind);
    for (const w of this.loose) w.update(dt, this);
    this.skids.flush();
    if (this.warmFrames > 0) { this.warmFrames--; this.forceWarm(); }
  }

  clear() {
    this.smoke.clear(); this.sparks.clear(); this.glints.clear(); this.skids.clear();
    this.shards.clear(); this.plastic.clear(); this.metal.clear(); this.clods.clear();
    for (const w of this.loose) w.dispose();
    this.loose = [];
    this.sources.length = 0;
    this.unforceWarm();
    this.warmFrames = 3;
    this.forceWarm();
  }
}
