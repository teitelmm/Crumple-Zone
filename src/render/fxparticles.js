// GPU-instanced particle pools.
//  - BillboardPool: camera-facing rotated quads. 'lit' pools (smoke, dust, steam)
//    shade a normal+density atlas with the scene's sun and sky, sort back to front
//    and erode their edges as they age; unlit pools (glints) are additive HDR.
//  - StreakPool: velocity-stretched additive streaks (sparks) that bounce on the ground.
// Each pool is one draw call with a fixed-size ring buffer of particles; the live
// particles are packed into the instance attributes every frame (no allocations).
import * as THREE from 'three';

const FOG_FACTOR = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#else
  float fogF = 0.0;
#endif`;

function quadGeometry(x0, x1) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, -1, 0, x1, -1, 0, x1, 1, 0, x0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = 0;
  return g;
}

function instAttr(g, name, n, size) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(name, a);
  return a;
}

// Mark [start, start+count) of an attribute for upload. If an earlier range has
// not been uploaded yet (several updates between two renders), grow it instead of
// replacing it; three.js clears the ranges once it has uploaded them.
export function markRange(attr, start, count) {
  const r = attr.updateRanges;
  if (r.length > 0) {
    const s = Math.min(r[0].start, start), e = Math.max(r[0].start + r[0].count, start + count);
    r[0].start = s; r[0].count = e - s;
    r.length = 1;
  } else attr.addUpdateRange(start, count);
  attr.needsUpdate = true;
}

function flush(attr, count) {
  if (count > 0) markRange(attr, 0, count * attr.itemSize);
}

// ================================================================ billboards
const BB_VS = `
attribute vec4 aPosSize;   // xyz, radius
attribute vec4 aParams;    // rotation, alpha, atlas frame + seed, erosion
attribute vec3 aColor;
uniform vec3 uSunDir;
uniform float uLift;
uniform vec2 uNearFade;
varying vec2 vUv;
varying vec2 vLocal;
varying vec3 vColor;
varying vec4 vMisc;        // alpha, erosion, seed
varying vec3 vLight;
varying vec3 vUp;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(aPosSize.xyz, 1.0);
  float r = aPosSize.w;
  float c = cos(aParams.x), s = sin(aParams.x);
  vec2 ax = vec2(c, s), ay = vec2(-s, c);
  vec2 corner = position.xy;
  float dist = -mvPosition.z;
  mvPosition.xy += (ax * corner.x + ay * corner.y) * r;
  mvPosition.z += r * uLift;
  float fade = smoothstep(uNearFade.x, uNearFade.y, dist - r * 0.5);
  float frame = floor(aParams.z);
  vec2 cell = vec2(mod(frame, 2.0), floor(frame * 0.5));
  vLocal = corner;
  vUv = (corner * 0.5 + 0.5 + cell) * 0.5;
  vColor = aColor;
  vMisc = vec4(aParams.y * fade, aParams.w, fract(aParams.z), 0.0);
#ifdef LIT
  vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  vLight = vec3(dot(L.xy, ax), dot(L.xy, ay), L.z);
  vec3 U = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  vUp = vec3(dot(U.xy, ax), dot(U.xy, ay), U.z);
#endif
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const BB_FS = `
uniform sampler2D uMap;
uniform sampler2D uDetail;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uTime;
varying vec2 vUv;
varying vec2 vLocal;
varying vec3 vColor;
varying vec4 vMisc;
varying vec3 vLight;
varying vec3 vUp;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
#ifdef LIT
  float dens = t.a;
  #ifdef DETAIL
  float d = texture2D(uDetail, vLocal * 0.32 + vec2(vMisc.z * 5.3, vMisc.z * 2.9 - uTime * 0.015)).g;
  dens *= 0.62 + 0.76 * d;
  #endif
  float e = vMisc.y;
  float a = clamp((dens - e) / (1.0 - e), 0.0, 1.0) * vMisc.x;
  if (a < 0.003) discard;
  vec3 n = vec3(t.rg * 2.0 - 1.0, 0.0);
  n.z = sqrt(max(0.05, 1.0 - dot(n.xy, n.xy)));
  float ndl = dot(n, vLight);
  float sun = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
  float up = clamp(dot(n, vUp) * 0.5 + 0.5, 0.0, 1.0);
  float occ = 0.55 + 0.45 * t.b;
  vec3 amb = mix(uGroundColor, uSkyColor, up) * occ;
  // thin smoke glows when it sits between the camera and the sun
  float fwd = pow(clamp(-vLight.z, 0.0, 1.0), 4.0) * (1.0 - dens) * 1.4;
  vec3 col = vColor * (amb + uSunColor * (sun * sun * occ + fwd));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
#else
  float a = t.a * vMisc.x;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${FOG_FACTOR}
  gl_FragColor.a *= 1.0 - fogF;
#endif
}`;

export class BillboardPool {
  // opts: { max, map, detail, lit, additive, lift, nearFade:[a,b], renderOrder }
  constructor(scene, opts) {
    const n = this.max = opts.max;
    this.lit = !!opts.lit;
    this.sorted = this.lit;
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.col2 = new Float32Array(n * 3); // colour at end of life
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);   // 0 = dead
    this.r0 = new Float32Array(n);
    this.r1 = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.fadeIn = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.rotV = new Float32Array(n);
    this.frame = new Float32Array(n);
    this.erode = new Float32Array(n);
    this.buoy = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.windK = new Float32Array(n);
    this.turb = new Float32Array(n);
    this.keys = new Uint32Array(n);
    this.cursor = 0;
    this.live = 0;
    this.time = 0;

    const g = this.geo = quadGeometry(-1, 1);
    this.aPosSize = instAttr(g, 'aPosSize', n, 4);
    this.aParams = instAttr(g, 'aParams', n, 4);
    this.aColor = instAttr(g, 'aColor', n, 3);
    const defines = {};
    if (this.lit) defines.LIT = '';
    if (this.lit && opts.detail) defines.DETAIL = '';
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uSunDir: { value: new THREE.Vector3(0.6, 0.7, 0.35).normalize() },
      uSunColor: { value: new THREE.Color(0.85, 0.8, 0.72) },
      uSkyColor: { value: new THREE.Color(0.55, 0.62, 0.72) },
      uGroundColor: { value: new THREE.Color(0.3, 0.29, 0.25) },
      uLift: { value: opts.lift ?? 0 },
      uNearFade: { value: new THREE.Vector2(...(opts.nearFade || [0.3, 1.2])) },
      uTime: { value: 0 },
    }]);
    this.uniforms.uMap = { value: opts.map };
    this.uniforms.uDetail = { value: opts.detail || opts.map };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, defines, vertexShader: BB_VS, fragmentShader: BB_FS,
      transparent: true, depthWrite: false, fog: true,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = opts.renderOrder ?? 2;
    scene.add(this.mesh);
  }

  // Emit one particle. Shape/behaviour comes from the preset `k` (a plain object made once).
  emit(x, y, z, vx, vy, vz, k, sizeMul, alphaMul, col, col2 = col) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    if (this.life[i] <= 0) this.live++;
    const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.col[i3] = col[0]; this.col[i3 + 1] = col[1]; this.col[i3 + 2] = col[2];
    this.col2[i3] = col2[0]; this.col2[i3 + 1] = col2[1]; this.col2[i3 + 2] = col2[2];
    this.age[i] = 0;
    this.life[i] = k.life[0] + Math.random() * (k.life[1] - k.life[0]);
    this.r0[i] = k.r0 * sizeMul * (0.8 + Math.random() * 0.4);
    this.r1[i] = k.r1 * sizeMul * (0.75 + Math.random() * 0.5);
    this.a0[i] = k.alpha * alphaMul;
    this.fadeIn[i] = k.fadeIn ?? 0.1;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.rotV[i] = (Math.random() - 0.5) * (k.spin ?? 0.8);
    this.frame[i] = Math.floor(Math.random() * 4) + Math.random() * 0.98;
    this.erode[i] = k.erode ?? 0.5;
    this.buoy[i] = k.buoy ?? 0;
    this.drag[i] = k.drag ?? 1;
    this.windK[i] = k.wind ?? 1;
    this.turb[i] = k.turb ?? 0.5;
  }

  update(dt, cam, wind) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (this.live === 0) { this.mesh.visible = false; return; }
    const { p, v, age, life, keys } = this;
    const n = this.max;
    const wx = wind.x, wz = wind.z;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    let live = 0;
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) { keys[i] = 0xffffffff; continue; }
      const a = age[i] + dt;
      if (a >= life[i]) { life[i] = 0; keys[i] = 0xffffffff; continue; }
      age[i] = a;
      const i3 = i * 3;
      const k = 1 - Math.exp(-this.drag[i] * dt);
      const wk = this.windK[i];
      // gentle swirl so plumes do not move as rigid sheets
      const tb = this.turb[i], ph = this.frame[i] * 7.1 + a * 1.3;
      v[i3] += (wx * wk - v[i3]) * k + Math.sin(ph) * tb * dt;
      v[i3 + 2] += (wz * wk - v[i3 + 2]) * k + Math.cos(ph * 0.9) * tb * dt;
      v[i3 + 1] += -v[i3 + 1] * k * 0.6 + this.buoy[i] * dt;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      this.rot[i] += this.rotV[i] * dt;
      if (this.sorted) {
        const dx = p[i3] - cx, dy = p[i3 + 1] - cy, dz = p[i3 + 2] - cz;
        const q = Math.min(65534, Math.floor(Math.sqrt(dx * dx + dy * dy + dz * dz) * 64));
        keys[i] = (65534 - q) * 65536 + i;
      } else keys[i] = i;
      live++;
    }
    this.live = live;
    if (live === 0) { this.mesh.visible = false; return; }
    if (this.sorted) keys.sort();
    const PS = this.aPosSize.array, PR = this.aParams.array, CO = this.aColor.array;
    let j = 0;
    for (let s = 0; s < n && j < live; s++) {
      const key = keys[s];
      if (key === 0xffffffff) continue;
      const i = this.sorted ? key & 0xffff : key;
      const i3 = i * 3;
      const t = age[i] / life[i];
      const e = 1 - (1 - t) * (1 - t);
      const r = this.r0[i] + (this.r1[i] - this.r0[i]) * e;
      // stay above the ground; the ground has no depth so a sunk puff would just look flat
      if (p[i3 + 1] < r * 0.3) { p[i3 + 1] = r * 0.3; if (v[i3 + 1] < 0) v[i3 + 1] = 0; }
      const fi = Math.min(1, age[i] / this.fadeIn[i]);
      const alpha = this.a0[i] * fi * fi * (3 - 2 * fi) * Math.pow(1 - t, 1.3);
      const o4 = j * 4, o3 = j * 3;
      PS[o4] = p[i3]; PS[o4 + 1] = p[i3 + 1]; PS[o4 + 2] = p[i3 + 2]; PS[o4 + 3] = r;
      PR[o4] = this.rot[i]; PR[o4 + 1] = alpha; PR[o4 + 2] = this.frame[i]; PR[o4 + 3] = this.erode[i] * Math.pow(t, 1.4);
      const c1 = this.col, c2 = this.col2;
      CO[o3] = c1[i3] + (c2[i3] - c1[i3]) * t;
      CO[o3 + 1] = c1[i3 + 1] + (c2[i3 + 1] - c1[i3 + 1]) * t;
      CO[o3 + 2] = c1[i3 + 2] + (c2[i3 + 2] - c1[i3 + 2]) * t;
      j++;
    }
    flush(this.aPosSize, j); flush(this.aParams, j); flush(this.aColor, j);
    this.geo.instanceCount = j;
    this.mesh.visible = j > 0;
  }

  // sunDir: world vector towards the sun; colours are linear radiance multipliers
  setLighting(sunDir, sun, sky, ground) {
    const u = this.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sun);
    u.uSkyColor.value.copy(sky);
    u.uGroundColor.value.copy(ground);
  }

  clear() { this.life.fill(0); this.live = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// ================================================================ streaks
const ST_VS = `
attribute vec4 aHead;   // xyz, heat 0..1
attribute vec4 aVel;    // velocity, alpha
uniform float uViewHeight;
uniform float uStreakTime;
uniform float uWidth;
uniform float uMinPx;
varying vec2 vCoord;
varying float vHeat;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vec4 hv = modelViewMatrix * vec4(aHead.xyz, 1.0);
  vec4 tv = modelViewMatrix * vec4(aHead.xyz - aVel.xyz * uStreakTime, 1.0);
  if (tv.z > -0.1) tv = hv;
  vec4 hc = projectionMatrix * hv, tc = projectionMatrix * tv;
  vec2 res = vec2(uViewHeight * projectionMatrix[1][1] / projectionMatrix[0][0], uViewHeight) * 0.5;
  vec2 hs = hc.xy / hc.w * res, ts = tc.xy / tc.w * res;
  vec2 d = hs - ts;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float wTrue = uWidth * projectionMatrix[1][1] * res.y / hc.w;
  float wpx = max(uMinPx, wTrue) * 3.0;
  float along = position.x;
  vec4 cc = mix(tc, hc, along);
  vec2 off = (nrm * position.y + dir * (along * 2.0 - 1.0)) * wpx * 0.5;
  cc.xy += off / res * cc.w;
  gl_Position = cc;
  vCoord = vec2(along, position.y);
  vHeat = aHead.w;
  // sub-pixel sparks get dimmer instead of thinner; short streaks keep their energy
  vAlpha = aVel.w * clamp(wTrue * 3.0 / wpx * 1.6, 0.3, 1.0);
  vec4 mvPosition = hv;
  #include <fog_vertex>
}`;

const ST_FS = `
uniform float uIntensity;
varying vec2 vCoord;
varying float vHeat;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  // hot core a third of the quad wide plus a soft orange halo (cheap stand-in for bloom)
  float y = abs(vCoord.y);
  float core = smoothstep(0.36, 0.0, y);
  float halo = (1.0 - y) * (1.0 - y);
  float along = vCoord.x;
  float tail = 0.12 + 0.88 * along * along;
  vec3 hot = vec3(1.0, 0.62, 0.24) * 3.6;
  vec3 warm = vec3(1.0, 0.27, 0.04) * 1.9;
  vec3 col = mix(warm, hot, vHeat * vHeat) * core + vec3(1.0, 0.32, 0.06) * (0.55 * vHeat) * halo;
  gl_FragColor = vec4(col * uIntensity * tail, vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${FOG_FACTOR}
  gl_FragColor.a *= 1.0 - fogF;
}`;

export class StreakPool {
  constructor(scene, max) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.heat0 = new Float32Array(max);
    this.bounces = new Uint8Array(max);
    this.cursor = 0;
    this.live = 0;
    const g = this.geo = quadGeometry(0, 1);
    this.aHead = instAttr(g, 'aHead', max, 4);
    this.aVel = instAttr(g, 'aVel', max, 4);
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uViewHeight: { value: 720 },
      uStreakTime: { value: 0.03 },
      uWidth: { value: 0.022 },
      uMinPx: { value: 2.2 },
      uIntensity: { value: 1 },
    }]);
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: ST_VS, fragmentShader: ST_FS,
      transparent: true, depthWrite: false, fog: true, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  emit(x, y, z, vx, vy, vz, life, heat) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    if (this.life[i] <= 0) this.live++;
    const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.heat0[i] = heat; this.bounces[i] = 0;
  }

  update(dt) {
    if (this.live === 0) { this.mesh.visible = false; return; }
    const { p, v, age, life } = this;
    const H = this.aHead.array, V = this.aVel.array;
    const drag = Math.exp(-0.9 * dt);
    let j = 0;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      const a = age[i] + dt;
      if (a >= life[i]) { life[i] = 0; continue; }
      age[i] = a;
      const i3 = i * 3;
      v[i3] *= drag; v[i3 + 2] *= drag;
      v[i3 + 1] = v[i3 + 1] * drag - 9.81 * dt;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (p[i3 + 1] < 0.01 && v[i3 + 1] < 0) {
        // bounce and skitter along the ground, losing heat each time
        p[i3 + 1] = 0.01;
        v[i3 + 1] *= -(0.3 + Math.random() * 0.25);
        v[i3] *= 0.75; v[i3 + 2] *= 0.75;
        this.bounces[i]++;
        life[i] = Math.min(life[i], a + 0.35 / this.bounces[i]);
      }
      const t = a / life[i];
      const heat = this.heat0[i] * (1 - t * 0.85) / (1 + this.bounces[i] * 0.6);
      const o = j * 4;
      H[o] = p[i3]; H[o + 1] = p[i3 + 1]; H[o + 2] = p[i3 + 2]; H[o + 3] = heat;
      V[o] = v[i3]; V[o + 1] = v[i3 + 1]; V[o + 2] = v[i3 + 2]; V[o + 3] = 1 - t * t;
      j++;
    }
    this.live = j;
    flush(this.aHead, j); flush(this.aVel, j);
    this.geo.instanceCount = j;
    this.mesh.visible = j > 0;
  }

  setViewHeight(h) { this.uniforms.uViewHeight.value = h; }
  clear() { this.life.fill(0); this.live = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}
