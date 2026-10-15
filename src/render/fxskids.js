// Tyre marks: one continuous ribbon per wheel, written into a fixed ring buffer of
// quads. Drawn right after the flat ground layers (no depth writes, same scheme as
// the ground) with a multiplicative blend, so marks darken whatever is underneath:
// soft-edged rubber with tread streaks on tarmac, darker torn ruts on grass and dirt.
// The oldest part of the buffer fades out before it is overwritten.
import * as THREE from 'three';
import { markRange } from './fxparticles.js';

const VS = `
attribute vec4 aMark;   // across 0..1, distance along (m), opacity, serial
attribute float aKind;  // 0 rubber, 1 grass, 2 dirt
varying vec4 vMark;
varying float vKind;
#include <fog_pars_vertex>
void main() {
  vMark = aMark;
  vKind = aKind;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FS = `
uniform sampler2D uNoise;
uniform float uSerial;
uniform vec2 uFade;
uniform vec3 uRubber;
uniform vec3 uGrass;
uniform vec3 uDirt;
varying vec4 vMark;
varying float vKind;
#include <fog_pars_fragment>
void main() {
  float u = vMark.x;
  float rut = step(0.5, vKind);
  float edge = smoothstep(0.0, mix(0.2, 0.38, rut), u) * smoothstep(1.0, mix(0.8, 0.62, rut), u);
  vec4 nz = texture2D(uNoise, vec2(u * 0.45, vMark.y * 0.11));
  float grain = mix(0.62 + 0.38 * nz.r, 0.75 + 0.25 * nz.b, rut);
  float breakup = texture2D(uNoise, vec2(vMark.y * 0.021, 0.37)).g;
  float a = vMark.z * edge * grain * (0.7 + 0.3 * breakup);
  a *= 1.0 - smoothstep(uFade.x, uFade.y, uSerial - vMark.w);
#ifdef USE_FOG
  #ifdef FOG_EXP2
  a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#endif
  vec3 mk = vKind < 0.5 ? uRubber : (vKind < 1.5 ? uGrass : uDirt);
  gl_FragColor = vec4(mix(vec3(1.0), mk, clamp(a, 0.0, 1.0)), 1.0);
  #include <colorspace_fragment>
}`;

const KIND = { asphalt: 0, concrete: 0, kerb: 0, grass: 1, dirt: 2 };


const MIN_SEG2 = 0.3 * 0.3;

export class SkidMarks {
  constructor(scene, max, noise) {
    this.max = max;
    const nv = max * 4;
    this.pos = new Float32Array(nv * 3);
    this.mark = new Float32Array(nv * 4);
    this.kind = new Float32Array(nv);
    const idx = nv <= 65536 ? new Uint16Array(max * 6) : new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) {
      const b = q * 4, o = q * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b + 1; idx[o + 4] = b + 3; idx[o + 5] = b + 2;
    }
    const g = this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aMark = new THREE.BufferAttribute(this.mark, 4).setUsage(THREE.DynamicDrawUsage);
    this.aKind = new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aMark', this.aMark);
    g.setAttribute('aKind', this.aKind);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uSerial: { value: 0 },
      uFade: { value: new THREE.Vector2(max * 0.7, max * 0.98) },
      uRubber: { value: new THREE.Color('#151617') },
      uGrass: { value: new THREE.Color('#4a4128') },
      uDirt: { value: new THREE.Color('#6e5c48') },
    }]);
    this.uniforms.uNoise = { value: noise };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, fog: true,
      transparent: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    // after the ground layers (renderOrder -10..-2), before everything that stands on them
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.cursor = 0;
    this.used = 0;
    this.serial = 0;
    this.recs = [];
    this.lastKey = -1; this.lastX = 0; this.lastZ = 0;
    this.lo = max; this.hi = -1;
  }

  rec(key) {
    let r = this.recs[key];
    if (!r) r = this.recs[key] = { on: false, x: 0, z: 0, y: 0, lx: 0, lz: 0, rx: 0, rz: 0, a: 0, d: 0, kind: 0 };
    return r;
  }

  // Surface hint from the effects (tyre smoke is emitted at the same contact point).
  hint(x, z, surface) {
    if (this.lastKey < 0 || x !== this.lastX || z !== this.lastZ) return;
    const k = KIND[surface];
    if (k !== undefined) this.rec(this.lastKey).kind = k;
  }

  // add a segment for a wheel key; intensity 0..1
  add(key, x, y, z, rx, rz, width, intensity) {
    this.lastKey = key; this.lastX = x; this.lastZ = z;
    const r = this.rec(key);
    if (!(intensity > 0.05) || !(width > 0)) { r.on = false; return; }
    const rut = r.kind > 0;
    const hw = width * (rut ? 0.62 : 0.5);
    const yy = y + 0.02;
    const target = rut ? Math.min(1, 0.3 + intensity * 1.4) : Math.min(0.92, 0.3 + intensity * 0.9);
    if (!r.on || (r.x - x) ** 2 + (r.z - z) ** 2 > 4) {
      r.on = true; r.x = x; r.z = z; r.y = yy;
      r.lx = x - rx * hw; r.lz = z - rz * hw; r.rx = x + rx * hw; r.rz = z + rz * hw;
      r.a = 0; r.d = 0;
      return;
    }
    const dx = x - r.x, dz = z - r.z, d2 = dx * dx + dz * dz;
    if (d2 < MIN_SEG2) return;
    const a = r.a + (target - r.a) * 0.6;
    const d = r.d + Math.sqrt(d2);
    const lx = x - rx * hw, lz = z - rz * hw, Rx = x + rx * hw, Rz = z + rz * hw;
    const q = this.cursor;
    this.cursor = (q + 1) % this.max;
    if (this.used < this.max) this.used++;
    const s = this.serial++;
    const P = this.pos, M = this.mark, K = this.kind;
    let o = q * 12;
    P[o] = r.lx; P[o + 1] = r.y; P[o + 2] = r.lz;
    P[o + 3] = r.rx; P[o + 4] = r.y; P[o + 5] = r.rz;
    P[o + 6] = lx; P[o + 7] = yy; P[o + 8] = lz;
    P[o + 9] = Rx; P[o + 10] = yy; P[o + 11] = Rz;
    o = q * 16;
    M[o] = 0; M[o + 1] = r.d; M[o + 2] = r.a; M[o + 3] = s;
    M[o + 4] = 1; M[o + 5] = r.d; M[o + 6] = r.a; M[o + 7] = s;
    M[o + 8] = 0; M[o + 9] = d; M[o + 10] = a; M[o + 11] = s;
    M[o + 12] = 1; M[o + 13] = d; M[o + 14] = a; M[o + 15] = s;
    o = q * 4;
    K[o] = K[o + 1] = K[o + 2] = K[o + 3] = r.kind;
    if (q < this.lo) this.lo = q;
    if (q > this.hi) this.hi = q;
    r.x = x; r.z = z; r.y = yy; r.lx = lx; r.lz = lz; r.rx = Rx; r.rz = Rz; r.a = a; r.d = d;
  }

  // once per frame: upload what changed
  flush() {
    if (this.hi < this.lo) return;
    const lo = this.lo, n = this.hi - this.lo + 1;
    markRange(this.aPos, lo * 12, n * 12);
    markRange(this.aMark, lo * 16, n * 16);
    markRange(this.aKind, lo * 4, n * 4);
    this.lo = this.max; this.hi = -1;
    this.uniforms.uSerial.value = this.serial;
    this.geo.setDrawRange(0, this.used * 6);
    this.mesh.visible = true;
  }

  clear() {
    this.pos.fill(0); this.mark.fill(0); this.kind.fill(0);
    for (const attr of [this.aPos, this.aMark, this.aKind]) { attr.clearUpdateRanges(); attr.needsUpdate = true; }
    for (const r of this.recs) if (r) r.on = false;
    this.cursor = 0; this.used = 0; this.lo = this.max; this.hi = -1;
    this.geo.setDrawRange(0, 0);
    this.mesh.visible = false;
  }
}
