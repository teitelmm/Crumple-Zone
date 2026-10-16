// Instanced rigid fragments (glass shards, plastic and metal debris) that tumble,
// bounce on the ground plane, settle flat and eventually shrink away. One
// InstancedMesh per pool, fixed ring buffer, no per-frame allocations.
import * as THREE from 'three';
import { markRange } from './fxparticles.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _id = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// Irregular convex chunk with radius ~0.5 so instance scale = size in metres.
export function chunkGeometry(seed = 1) {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // icosahedron from three is non-indexed: displace shared corners consistently
  const moved = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!moved.has(key)) moved.set(key, 0.72 + rnd() * 0.42);
    const k = moved.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

// Thin triangular splinter (glass): local Y is the thickness axis.
export function shardGeometry() {
  const t = 0.5;
  const top = [[0.5, 0.42], [-0.5, 0.18], [0.05, -0.5]];
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const v = (k, y) => [top[k][0], y, top[k][1]];
  tri(v(0, t), v(1, t), v(2, t));
  tri(v(0, -t), v(2, -t), v(1, -t));
  for (let k = 0; k < 3; k++) {
    const n = (k + 1) % 3;
    tri(v(k, -t), v(n, -t), v(n, t));
    tri(v(k, -t), v(n, t), v(k, t));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class RigidPool {
  // opts: { max, geometry, material, castShadow, restLife, bounce, colors: bool }
  constructor(scene, opts) {
    const n = this.max = opts.max;
    this.restLife = opts.restLife ?? 20;
    this.bounce = opts.bounce ?? 0.3;
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.q = new Float32Array(n * 4);
    this.w = new Float32Array(n * 3);
    this.s = new Float32Array(n * 3);
    this.state = new Uint8Array(n);    // 0 free, 1 flying, 2 resting
    this.timer = new Float32Array(n);  // time spent resting
    this.cursor = 0;
    this.active = 0;
    this.mesh = new THREE.InstancedMesh(opts.geometry, opts.material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, ZERO);
    if (opts.colors) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    }
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!opts.castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    // only the slots up to the highest live one are drawn (dead slots below it are
    // zero-scale); the ring cursor restarts at 0 whenever the pool empties
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.dirtyLo = n; this.dirtyHi = -1;
    this.colorDirty = false;
  }

  // sx, sy, sz: size in metres (sy = thickness); hex: optional sRGB colour
  emit(x, y, z, vx, vy, vz, sx, sy, sz, hex) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    if (this.state[i] === 0) this.active++;
    const i3 = i * 3, i4 = i * 4;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.s[i3] = sx; this.s[i3 + 1] = sy; this.s[i3 + 2] = sz;
    _a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    _q.setFromAxisAngle(_a, Math.random() * Math.PI * 2);
    this.q[i4] = _q.x; this.q[i4 + 1] = _q.y; this.q[i4 + 2] = _q.z; this.q[i4 + 3] = _q.w;
    const spin = 8 + Math.random() * 22;
    this.w[i3] = (Math.random() - 0.5) * spin; this.w[i3 + 1] = (Math.random() - 0.5) * spin; this.w[i3 + 2] = (Math.random() - 0.5) * spin;
    this.state[i] = 1;
    this.timer[i] = 0;
    if (hex !== undefined && this.mesh.instanceColor) {
      _c.setHex(hex);
      this.mesh.setColorAt(i, _c);
      this.colorDirty = true;
    }
    if (i >= this.mesh.count) this.mesh.count = i + 1;
    this.mesh.visible = true;
  }

  // glint: optional { rateFly, rateRest, emit(x,y,z,vx,vy,vz) }
  update(dt, glint) {
    if (this.active === 0) return;
    const { p, v, q, w, s, state, timer } = this;
    const arr = this.mesh.instanceMatrix.array;
    const air = Math.exp(-0.25 * dt);
    let lo = this.dirtyLo, hi = this.dirtyHi, active = 0, top = -1;
    for (let i = 0; i < this.max; i++) {
      const st = state[i];
      if (st === 0) continue;
      active++;
      const i3 = i * 3, i4 = i * 4;
      let scale = 1;
      if (st === 2) {
        timer[i] += dt;
        const left = this.restLife - timer[i];
        if (left <= 0) {
          state[i] = 0; active--;
          ZERO.toArray(arr, i * 16);
          if (i < lo) lo = i; if (i > hi) hi = i;
          continue;
        }
        if (glint && glint.rateRest > 0 && Math.random() < glint.rateRest * dt) glint.emit(p[i3], p[i3 + 1] + 0.01, p[i3 + 2], 0, 0, 0);
        if (left > 1.5) { top = i; continue; } // static: matrix already written
        scale = left / 1.5;
      } else {
        // flying / tumbling
        v[i3] *= air; v[i3 + 2] *= air;
        v[i3 + 1] = v[i3 + 1] * air - 9.81 * dt;
        p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
        _q.set(q[i4], q[i4 + 1], q[i4 + 2], q[i4 + 3]);
        const wl = Math.hypot(w[i3], w[i3 + 1], w[i3 + 2]);
        if (wl > 1e-4) {
          _a.set(w[i3] / wl, w[i3 + 1] / wl, w[i3 + 2] / wl);
          _dq.setFromAxisAngle(_a, wl * dt);
          _q.premultiply(_dq);
        }
        // support height of the ellipsoid along world Y
        const x = _q.x, y = _q.y, z = _q.z, qw = _q.w;
        const xy = 2 * (x * y + qw * z), yy = 1 - 2 * (x * x + z * z), zy = 2 * (y * z - qw * x);
        const sx = s[i3], sy = s[i3 + 1], sz = s[i3 + 2];
        const h = 0.5 * Math.sqrt(sx * sx * xy * xy + sy * sy * yy * yy + sz * sz * zy * zy);
        if (p[i3 + 1] < h) {
          p[i3 + 1] = h;
          if (v[i3 + 1] < 0) {
            const impact = -v[i3 + 1];
            v[i3 + 1] = impact > 0.6 ? impact * this.bounce * (0.6 + Math.random() * 0.8) : 0;
            v[i3] *= 0.55; v[i3 + 2] *= 0.55;
            // knocks change the tumble
            const kick = Math.min(1, impact * 0.15);
            w[i3] = w[i3] * 0.5 + (Math.random() - 0.5) * 20 * kick;
            w[i3 + 1] = w[i3 + 1] * 0.5 + (Math.random() - 0.5) * 10 * kick;
            w[i3 + 2] = w[i3 + 2] * 0.5 + (Math.random() - 0.5) * 20 * kick;
            if (glint && impact > 1.5 && Math.random() < 0.3) glint.emit(p[i3], p[i3 + 1], p[i3 + 2], v[i3], v[i3 + 1], v[i3 + 2]);
          } else {
            const f = Math.exp(-6 * dt);
            v[i3] *= f; v[i3 + 2] *= f;
          }
          const speed = Math.hypot(v[i3], v[i3 + 1], v[i3 + 2]);
          if (speed < 1.2) {
            // settle: damp the spin and lay the thin axis flat on the ground
            const f = Math.exp(-10 * dt);
            w[i3] *= f; w[i3 + 1] *= f; w[i3 + 2] *= f;
            _a.set(2 * (x * y - qw * z), yy, 2 * (y * z + qw * x));
            _b.set(0, yy >= 0 ? 1 : -1, 0);
            _dq.setFromUnitVectors(_a, _b);
            _id.identity().slerp(_dq, Math.min(1, dt * 9));
            _q.premultiply(_id);
            if (speed < 0.15 && Math.abs(yy) > 0.985) {
              state[i] = 2; v[i3] = v[i3 + 1] = v[i3 + 2] = 0; w[i3] = w[i3 + 1] = w[i3 + 2] = 0;
              p[i3 + 1] = sy * 0.5;
            }
          }
        } else if (glint && glint.rateFly > 0 && Math.random() < glint.rateFly * dt) {
          glint.emit(p[i3], p[i3 + 1], p[i3 + 2], v[i3], v[i3 + 1], v[i3 + 2]);
        }
        q[i4] = _q.x; q[i4 + 1] = _q.y; q[i4 + 2] = _q.z; q[i4 + 3] = _q.w;
      }
      top = i;
      _p.set(p[i3], p[i3 + 1], p[i3 + 2]);
      _q.set(q[i4], q[i4 + 1], q[i4 + 2], q[i4 + 3]);
      _s.set(s[i3] * scale, s[i3 + 1] * scale, s[i3 + 2] * scale);
      _m.compose(_p, _q, _s).toArray(arr, i * 16);
      if (i < lo) lo = i; if (i > hi) hi = i;
    }
    this.active = active;
    if (hi >= lo) markRange(this.mesh.instanceMatrix, lo * 16, (hi - lo + 1) * 16);
    this.dirtyLo = this.max; this.dirtyHi = -1;
    if (this.colorDirty) {
      this.mesh.instanceColor.needsUpdate = true;
      this.colorDirty = false;
    }
    this.mesh.count = top + 1;
    if (active === 0) { this.mesh.visible = false; this.cursor = 0; }
  }

  clear() {
    const arr = this.mesh.instanceMatrix.array;
    for (let i = 0; i < this.max; i++) ZERO.toArray(arr, i * 16);
    this.state.fill(0);
    this.active = 0;
    this.cursor = 0;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = false;
  }
}
