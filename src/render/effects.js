// Particles (tyre smoke, steam, sparks, glass), skid marks and loose wheels.
import * as THREE from 'three';
import { makeSprite } from './textures.js';
import { makeWheelMesh } from './carview.js';

const VS = `
attribute float size; attribute float alpha; attribute vec3 tint;
varying float vAlpha; varying vec3 vTint;
uniform float scale;
void main(){
  vAlpha = alpha; vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform sampler2D map; varying float vAlpha; varying vec3 vTint;
void main(){
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vTint, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.sizeA = new Float32Array(max);
    this.alphaA = new Float32Array(max);
    this.tint = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.sizeA, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alphaA, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeSprite() }, scale: { value: 600 } },
      vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;
  }

  emit(x, y, z, vx, vy, vz, o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = o.life;
    this.size0[i] = o.size; this.grow[i] = o.grow || 0;
    this.alpha0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.tint[i * 3] = o.color[0]; this.tint[i * 3 + 1] = o.color[1]; this.tint[i * 3 + 2] = o.color[2];
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alphaA[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= dr; this.v[i * 3 + 1] = this.v[i * 3 + 1] * dr + this.grav[i] * dt; this.v[i * 3 + 2] *= dr;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.p[i * 3 + 1] < 0.02) { this.p[i * 3 + 1] = 0.02; this.v[i * 3 + 1] *= -0.3; }
      this.sizeA[i] = this.size0[i] + this.grow[i] * t;
      this.alphaA[i] = this.alpha0[i] * (1 - t) * Math.min(1, t * 8 + 0.2);
    }
    for (const k of ['position', 'size', 'alpha', 'tint']) this.geo.attributes[k].needsUpdate = true;
  }

  setScale(h) { this.mat.uniforms.scale.value = h; }
  clear() { this.life.fill(0); }
}

class SkidMarks {
  constructor(scene, max = 2400) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 3);
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) { const b = q * 4; idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], q * 6); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, blending: THREE.MultiplyBlending, premultipliedAlpha: true });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.cursor = 0;
    this.last = new Map();
    this.col.fill(1);
  }

  // add a segment for a wheel key; intensity 0..1
  add(key, x, y, z, rx, rz, width, intensity) {
    const prev = this.last.get(key);
    const lx = x - rx * width / 2, lz = z - rz * width / 2, Rx = x + rx * width / 2, Rz = z + rz * width / 2;
    const yy = y + 0.03;
    if (prev && intensity > 0.05 && (prev.x - x) ** 2 + (prev.z - z) ** 2 < 4) {
      if ((prev.x - x) ** 2 + (prev.z - z) ** 2 < 0.04) return;
      const q = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const P = this.pos;
      P.set([prev.lx, prev.y, prev.lz, prev.rx, prev.y, prev.rz, lx, yy, lz, Rx, yy, Rz], q * 12);
      const shade = 1 - 0.75 * Math.min(1, intensity);
      const ps = prev.shade ?? shade;
      this.col.set([ps, ps, ps, ps, ps, ps, shade, shade, shade, shade, shade, shade], q * 12);
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
      this.last.set(key, { x, z, y: yy, lx, lz, rx: Rx, rz: Rz, shade });
    } else if (intensity > 0.05) {
      this.last.set(key, { x, z, y: yy, lx, lz, rx: Rx, rz: Rz, shade: 1 });
    } else {
      this.last.delete(key);
    }
  }

  clear() { this.pos.fill(0); this.col.fill(1); this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.last.clear(); }
}

class LooseWheel {
  constructor(scene, spec, pos, vel, side) {
    this.mesh = makeWheelMesh(spec);
    if (side < 0) this.mesh.scale.z = -1;
    this.r = spec.dims.wheelRadius;
    this.p = new THREE.Vector3(...pos);
    this.v = new THREE.Vector3(...vel).add(new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3));
    this.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, 0));
    this.w = new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 12);
    this.scene = scene;
    scene.add(this.mesh);
    this.age = 0;
  }
  update(dt) {
    this.age += dt;
    this.v.y -= 9.81 * dt;
    this.p.addScaledVector(this.v, dt);
    if (this.p.y < this.r) {
      this.p.y = this.r;
      if (this.v.y < 0) this.v.y *= -0.35;
      this.v.x *= 0.985; this.v.z *= 0.985;
      this.w.multiplyScalar(0.97);
    }
    const wl = this.w.length();
    if (wl > 1e-4) this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(this.w.clone().divideScalar(wl), wl * dt));
    this.mesh.position.copy(this.p);
    this.mesh.quaternion.copy(this.q);
  }
  dispose() { this.scene.remove(this.mesh); }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new ParticlePool(scene, 900, false);
    this.sparks = new ParticlePool(scene, 400, true);
    this.skids = new SkidMarks(scene);
    this.loose = [];
  }

  setViewport(h, fov) {
    const s = h / (2 * Math.tan((fov * Math.PI / 180) / 2));
    this.smoke.setScale(s);
    this.sparks.setScale(s);
  }

  tyreSmoke(x, y, z, vx, vz, amount, surface) {
    const dirt = surface === 'grass' || surface === 'dirt';
    const col = dirt ? (surface === 'grass' ? [0.36, 0.33, 0.24] : [0.55, 0.45, 0.32]) : [0.82, 0.82, 0.8];
    this.smoke.emit(x + (Math.random() - 0.5) * 0.3, y + 0.15, z + (Math.random() - 0.5) * 0.3,
      vx * 0.25 + (Math.random() - 0.5), 0.6 + Math.random() * 0.6, vz * 0.25 + (Math.random() - 0.5),
      { life: 1.4 + Math.random() * 1.2, size: 0.6, grow: 3.5 * amount + 1, alpha: 0.3 * amount + 0.08, drag: 1.4, gravity: 0.3, color: col });
  }

  steam(x, y, z, dark) {
    const c = dark ? [0.12, 0.12, 0.12] : [0.9, 0.9, 0.9];
    this.smoke.emit(x, y, z, (Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6,
      { life: 1.6, size: 0.5, grow: 2.5, alpha: dark ? 0.35 : 0.25, drag: 0.8, gravity: 0.6, color: c });
  }

  spark(x, y, z, vx, vy, vz) {
    this.sparks.emit(x, y, z, vx + (Math.random() - 0.5) * 4, vy + Math.random() * 3, vz + (Math.random() - 0.5) * 4,
      { life: 0.25 + Math.random() * 0.35, size: 0.12, grow: -0.08, alpha: 1, drag: 0.6, gravity: -9.81, color: [1.0, 0.65, 0.25] });
  }

  glass(x, y, z, vx, vy, vz) {
    for (let k = 0; k < 40; k++)
      this.sparks.emit(x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.8,
        vx * 0.6 + (Math.random() - 0.5) * 5, vy + Math.random() * 3, vz * 0.6 + (Math.random() - 0.5) * 5,
        { life: 0.9 + Math.random() * 0.6, size: 0.07, grow: 0, alpha: 0.9, drag: 0.4, gravity: -9.81, color: [0.55, 0.7, 0.75] });
  }

  debrisDust(x, y, z, amount) {
    for (let k = 0; k < amount; k++)
      this.smoke.emit(x + (Math.random() - 0.5), y + Math.random() * 0.5, z + (Math.random() - 0.5),
        (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3,
        { life: 1.2 + Math.random(), size: 0.8, grow: 3, alpha: 0.18, drag: 1.5, gravity: 0.2, color: [0.6, 0.58, 0.54] });
  }

  looseWheel(spec, pos, vel, side) {
    this.loose.push(new LooseWheel(this.scene, spec, pos, vel, side));
    if (this.loose.length > 12) this.loose.shift().dispose();
  }

  update(dt) {
    this.smoke.update(dt);
    this.sparks.update(dt);
    for (const w of this.loose) w.update(dt);
  }

  clear() {
    this.smoke.clear(); this.sparks.clear(); this.skids.clear();
    for (const w of this.loose) w.dispose();
    this.loose = [];
  }
}
