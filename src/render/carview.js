// Deformable car mesh + wheels, driven by the soft-body node positions.
//
// The body mesh lives in the car's own frame (a rigid fit to the floor nodes), so when
// the lattice hasn't changed shape since the last frame only the object matrix moves:
// vertex skinning, normals and the GPU upload are skipped. When it has, every vertex is
// re-skinned from its tetrahedron of nodes, decals are re-glued to the skin and normals
// are rebuilt from flat arrays. A per-vertex damage value (from beam strain) drives the
// creased / scuffed paint.
//
// Draw calls: plain body slots share one baked material (carmaterials.js), on tiers with
// a shadow map one depth-only proxy casts the body's shadow in a single draw, and every
// car's ground blobs are one instanced draw for the whole scene.
import * as THREE from 'three';
import { buildBodyMesh, deformInto, glueInto, C, PANELS } from '../vehicle/bodyshape.js';
import { makeCarMaterials, bakeAttributes, CRACKED, GLASS_BACK } from './carmaterials.js';
import { makeWheelMesh as buildWheel, wheelParts } from './carwheels.js';
import { SUN_DIR } from './sky.js';

const meshCache = new Map();
function getMesh(spec, tpl, lod) {
  const key = spec.id + ':' + lod;
  if (!meshCache.has(key)) {
    const m = buildBodyMesh(spec, tpl, lod);
    // positive, normalised skinning weights for spreading node damage onto vertices
    const w = m.binding.wts, dw = new Float32Array(w.length);
    for (let v = 0; v < w.length; v += 4) {
      let s = 0;
      for (let k = 0; k < 4; k++) { dw[v + k] = Math.max(0, w[v + k]); s += dw[v + k]; }
      for (let k = 0; k < 4; k++) dw[v + k] = s > 0 ? dw[v + k] / s : 0.25;
    }
    m.dmgW = dw;
    meshCache.set(key, m);
  }
  return meshCache.get(key);
}

// Loose wheels (effects.js) call makeWheelMesh(spec) without a tier, so they follow the
// tier the cars were built with: phones get the cheap wheel there too.
let lastQuality = 'high';
export function makeWheelMesh(spec, quality = lastQuality) {
  return buildWheel(spec, quality);
}

// metres of local node motion before the mesh is re-skinned (coarser on phones)
const REDEFORM = { low: 0.005, medium: 0.002, high: 0.002 };
// a node further than this from its rest place (local frame) is drawn there: a vertex
// flung tens of metres by a wreck would otherwise stretch the body into a huge sheet
const MAX_NODE_OFFSET = 1.5;

// soft contact shadow / ambient occlusion under the car (a flat ground layer: no depth
// writes, drawn with the transparent ground decals just before the skid marks)
let shadowTex = null;
function contactShadowTexture() {
  if (shadowTex) return shadowTex;
  const W = 128, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = Math.abs((x + 0.5) / W * 2 - 1), v = Math.abs((y + 0.5) / H * 2 - 1);
    const dx = Math.max(0, u - 0.72), dy = Math.max(0, v - 0.6);
    const d = Math.hypot(dx / 0.28, dy / 0.4);
    const edge = 1 - Math.min(1, d);
    const core = 1 - Math.min(1, Math.hypot(u / 0.95, v / 0.85));
    const a = edge * edge * (0.45 + 0.55 * core);
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
    img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

// Instanced draws shared by every car in a scene. Slots are handed out per car and freed
// (zero-scaled) when it goes; `alpha` adds a per-instance opacity (`czA`).
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
class InstanceBatch {
  constructor(scene, geometry, material, cap, alpha = false) {
    if (alpha) {
      geometry = geometry.clone();
      this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('czA', this.alpha);
    }
    const mesh = this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, _zero);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false; // instances spread over the whole map
    mesh.matrixAutoUpdate = false;
    this.cap = cap;
    this.used = [];
    scene.add(mesh);
  }
  alloc() {
    let i = this.used.indexOf(false);
    if (i < 0) { if (this.used.length >= this.cap) return -1; i = this.used.length; this.used.push(true); } else this.used[i] = true;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    this.mesh.visible = true;
    return i;
  }
  free(i) {
    if (i < 0) return;
    this.used[i] = false;
    this.set(i, _zero, 0);
    while (this.used.length && !this.used[this.used.length - 1]) this.used.pop();
    this.mesh.count = this.used.length;
    this.mesh.visible = this.mesh.count > 0; // no empty instanced draw
  }
  set(i, m, a) {
    if (i < 0) return;
    this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.alpha) { this.alpha.array[i] = a; this.alpha.needsUpdate = true; }
  }
}
const batches = new WeakMap(); // scene -> Map(key -> InstanceBatch)
function batch(scene, key, make) {
  let m = batches.get(scene);
  if (!m) batches.set(scene, m = new Map());
  if (!m.has(key)) m.set(key, make());
  return m.get(key);
}

// Every car's ground blobs in one draw: the contact shadow under the body and, on the
// shadow-map-less low tier, a softer blob stretched away from the sun so cars don't float.
function blobShader(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float czA;\nvarying float vCzA;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCzA = czA;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vCzA;')
    .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vCzA;');
}
function blobBatch(scene) {
  return batch(scene, 'blobs', () => {
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, map: contactShadowTexture(), transparent: true, depthWrite: false });
    mat.onBeforeCompile = blobShader;
    const b = new InstanceBatch(scene, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, 48, true);
    b.mesh.renderOrder = 0.5;
    b.mesh.userData.czCat = 'blobs';
    return b;
  });
}
// Every wheel of one model, tier and side in one draw (the spinning tyre + rim).
function wheelBatch(scene, spec, quality, left) {
  return batch(scene, `wheel:${spec.id}:${quality}:${left ? 'L' : 'R'}`, () => {
    const p = wheelParts(spec, quality, left);
    const b = new InstanceBatch(scene, p.wheel, p.material, 32);
    b.mesh.castShadow = p.castShadow;
    b.mesh.receiveShadow = true;
    b.mesh.userData.czCat = 'wheels';
    return b;
  });
}

// Shadow-map caster: the whole body as one depth-only draw instead of one per material
// group. three tests layers against the main camera in the shadow pass too, so the proxy
// can't be hidden from the main pass that way; it is drawn there with a depth test that
// never passes and no colour or depth writes (no fragment work), and skipped by the AO
// pre-pass (userData.noAO).
const casterMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthFunc: THREE.NeverDepth, fog: false });

function computeNormals(pos, idx, out) {
  out.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const e1x = pos[b] - ax, e1y = pos[b + 1] - ay, e1z = pos[b + 2] - az;
    const e2x = pos[c] - ax, e2y = pos[c + 1] - ay, e2z = pos[c + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i], y = out[i + 1], z = out[i + 2];
    const l = Math.sqrt(x * x + y * y + z * z);
    if (l > 0) { const s = 1 / l; out[i] = x * s; out[i + 1] = y * s; out[i + 2] = z * s; } else out[i + 1] = 1;
  }
}

// mean position of nodes `ids` of x into o
function avgInto(x, ids, o) {
  let a = 0, b = 0, c = 0;
  for (let k = 0; k < ids.length; k++) { const i = ids[k] * 3; a += x[i]; b += x[i + 1]; c += x[i + 2]; }
  o[0] = a / ids.length; o[1] = b / ids.length; o[2] = c / ids.length;
  return o;
}

const _m = new THREE.Matrix4(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
// ground direction the low-tier sun blob stretches toward (away from the sun) and the
// sun's slope: a point h above the ground casts its shadow h / SUN_TAN further along it
const SUN_U = [-SUN_DIR.x, -SUN_DIR.z], SUN_TAN = SUN_DIR.y / Math.hypot(SUN_DIR.x, SUN_DIR.z);
{ const l = Math.hypot(SUN_U[0], SUN_U[1]) || 1; SUN_U[0] /= l; SUN_U[1] /= l; }

export class CarView {
  constructor(scene, vehicle, quality = 'high') {
    this.scene = scene;
    this.quality = lastQuality = quality;
    this.vehicle = vehicle;
    const spec = vehicle.spec, tpl = vehicle.tpl;
    const low = quality === 'low';
    const src = this.src = getMesh(spec, tpl, low ? 'low' : 'high');
    const nv = src.vertexCount;
    this.redeform = REDEFORM[quality] ?? REDEFORM.high;

    const g = this.geometry = new THREE.BufferGeometry();
    this.posArr = new Float32Array(nv * 3);
    this.nrmArr = new Float32Array(nv * 3);
    this.dmgArr = new Float32Array(nv);
    const baked = bakeAttributes(src, quality);
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrmArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(baked.uv || src.uvs, 2));
    g.setAttribute('damage', new THREE.BufferAttribute(this.dmgArr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(baked.color, 3));
    g.setAttribute('czRM', new THREE.BufferAttribute(baked.czRM, 2));
    g.setAttribute('czEmit', new THREE.BufferAttribute(baked.czEmit, 4));
    g.setIndex(new THREE.BufferAttribute(src.indices, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), spec.dims.length * 0.6);

    this.mats = makeCarMaterials(spec, quality, vehicle.color);
    this.mesh = new THREE.Mesh(g, this.mats.list);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.receiveShadow = true;
    if (!low) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', g.attributes.position);
      pg.setIndex(g.index);
      pg.boundingSphere = g.boundingSphere;
      const caster = this.caster = new THREE.Mesh(pg, casterMat);
      caster.castShadow = true;
      caster.matrixAutoUpdate = false;
      caster.userData.noAO = true;
      caster.userData.czCat = 'caster';
      this.mesh.add(caster);
    }
    scene.add(this.mesh);

    // local frame reference: midpoint of the front and rear floor rows at rest
    const n = tpl.nodes, gr = tpl.groups;
    const avg0 = ids => ids.reduce((a, i) => [a[0] + n[i].x / ids.length, a[1] + n[i].y / ids.length, a[2] + n[i].z / ids.length], [0, 0, 0]);
    const F0 = avg0(gr.front), R0 = avg0(gr.rear);
    this.ref0 = [(F0[0] + R0[0]) / 2, (F0[1] + R0[1]) / 2, (F0[2] + R0[2]) / 2];
    this.localX = new Float64Array(n.length * 3);
    this.restX = new Float64Array(n.length * 3);
    for (let i = 0; i < n.length; i++) { this.restX[i * 3] = n[i].x; this.restX[i * 3 + 1] = n[i].y; this.restX[i * 3 + 2] = n[i].z; }
    this.lastX = new Float64Array(n.length * 3).fill(1e9);
    this.nodeDmg = new Float32Array(n.length);
    this.shownDmg = new Float32Array(n.length).fill(-1);
    this.fr = { c: [0, 0, 0], f: [1, 0, 0], u: [0, 1, 0], r: [0, 0, 1] };
    this._F = [0, 0, 0]; this._R = [0, 0, 0]; this._L = [0, 0, 0]; this._Rt = [0, 0, 0];

    const d = spec.dims;
    this.blobs = blobBatch(scene);
    this.contactBlob = this.blobs.alloc();
    this.contactAlpha = low ? 0.75 : 0.6;
    this.contactSize = [d.length + 0.7, d.width + 0.55];
    this.sunBlob = low ? this.blobs.alloc() : -1;
    this.footprint = [d.length + 0.2, d.width + 0.1];
    this._bm = new THREE.Matrix4();

    // wheels: an instance slot in the shared wheel draw; brakes (high) are plain meshes
    const wp = wheelParts(spec, quality);
    this.wheels = vehicle.wheels.map(w => {
      const b = wheelBatch(scene, spec, quality, w.side < 0);
      let brake = null;
      if (wp.brake) {
        brake = new THREE.Mesh(wp.brake, wp.brakeMaterial);
        if (w.side < 0) brake.scale.z = -1;
        scene.add(brake);
      }
      return { batch: b, slot: b.alloc(), brake };
    });
    this._wm = new THREE.Matrix4();
    this.brakeOn = null;
    this.shattered = {};
    for (const p of PANELS) this.shattered[p] = false;
    this.frame = 0;
    this.dmgDirty = true;
    this.buildGroups();
    this.update(true);
  }

  // draw groups: one per material slot (glass split by panel so a shattered panel can
  // switch material); adjacent groups sharing a material are merged into one draw. On
  // high the intact glass is drawn twice, inner faces first.
  buildGroups() {
    const g = this.geometry, src = this.src, list = this.mats.list;
    const low = this.quality === 'low';
    const runs = [];
    for (const gr of src.groups) {
      if (!gr.count || (low && gr.slot === C.INTERIOR)) continue;
      if (gr.slot === C.GLASS) {
        if (this.mats.doubleGlass) {
          for (const p of PANELS) {
            const r = src.glass[p];
            if (r.count && !this.shattered[p]) runs.push({ start: r.start, count: r.count, mi: GLASS_BACK });
          }
        }
        for (const p of PANELS) {
          const r = src.glass[p];
          if (r.count) runs.push({ start: r.start, count: r.count, mi: this.shattered[p] ? CRACKED : C.GLASS });
        }
      } else runs.push({ start: gr.start, count: gr.count, mi: gr.slot });
    }
    g.clearGroups();
    let cur = null;
    for (const r of runs) {
      if (cur && list[cur.mi] === list[r.mi] && cur.start + cur.count === r.start) { cur.count += r.count; continue; }
      if (cur) g.addGroup(cur.start, cur.count, cur.mi);
      cur = { ...r };
    }
    if (cur) g.addGroup(cur.start, cur.count, cur.mi);
  }

  // rigid frame from the floor nodes (same construction as Vehicle.computeFrame)
  fitFrame(x) {
    const gr = this.vehicle.tpl.groups, fr = this.fr;
    const F = avgInto(x, gr.front, this._F), R = avgInto(x, gr.rear, this._R);
    const L = avgInto(x, gr.left, this._L), Rt = avgInto(x, gr.right, this._Rt);
    let fx = F[0] - R[0], fy = F[1] - R[1], fz = F[2] - R[2];
    let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    let rx = Rt[0] - L[0], ry = Rt[1] - L[1], rz = Rt[2] - L[2];
    let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    rx = fy * uz - fz * uy; ry = fz * ux - fx * uz; rz = fx * uy - fy * ux;
    fr.f[0] = fx; fr.f[1] = fy; fr.f[2] = fz;
    fr.u[0] = ux; fr.u[1] = uy; fr.u[2] = uz;
    fr.r[0] = rx; fr.r[1] = ry; fr.r[2] = rz;
    fr.c[0] = (F[0] + R[0]) / 2; fr.c[1] = (F[1] + R[1]) / 2; fr.c[2] = (F[2] + R[2]) / 2;
  }

  // positions: Float64Array of node positions (live or replay)
  update(force = false, positions = null, wheelStates = null) {
    const v = this.vehicle;
    const x = positions || v.body.x;
    this.frame++;
    this.fitFrame(x);
    const fr = this.fr, ref = this.ref0;
    const lat = v.tpl.groups.lattice, L = this.localX, last = this.lastX, rest = this.restX;
    const MAX2 = MAX_NODE_OFFSET * MAX_NODE_OFFSET;
    let moved = 0;
    for (let k = 0; k < lat.length; k++) {
      const i3 = lat[k] * 3;
      const dx = x[i3] - fr.c[0], dy = x[i3 + 1] - fr.c[1], dz = x[i3 + 2] - fr.c[2];
      let lx = dx * fr.f[0] + dy * fr.f[1] + dz * fr.f[2] + ref[0];
      let ly = dx * fr.u[0] + dy * fr.u[1] + dz * fr.u[2] + ref[1];
      let lz = dx * fr.r[0] + dy * fr.r[1] + dz * fr.r[2] + ref[2];
      const ox = lx - rest[i3], oy = ly - rest[i3 + 1], oz = lz - rest[i3 + 2], o2 = ox * ox + oy * oy + oz * oz;
      if (o2 > MAX2) {
        const s = MAX_NODE_OFFSET / Math.sqrt(o2);
        lx = rest[i3] + ox * s; ly = rest[i3 + 1] + oy * s; lz = rest[i3 + 2] + oz * s;
      }
      L[i3] = lx; L[i3 + 1] = ly; L[i3 + 2] = lz;
      const m = Math.max(Math.abs(lx - last[i3]), Math.abs(ly - last[i3 + 1]), Math.abs(lz - last[i3 + 2]));
      if (m > moved) moved = m;
    }
    if (force || moved > this.redeform) {
      const P = this.posArr;
      deformInto(P, this.src.binding, L);
      glueInto(P, this.src.glue);
      computeNormals(P, this.src.indices, this.nrmArr);
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.normal.needsUpdate = true;
      last.set(L);
      // bounds for frustum (and shadow) culling, from the vertices themselves
      let r2 = 0;
      for (let i = 0; i < P.length; i += 3) {
        const px = P[i], py = P[i + 1] - 0.7, pz = P[i + 2], q = px * px + py * py + pz * pz;
        if (q > r2) r2 = q;
      }
      this.geometry.boundingSphere.radius = Math.sqrt(r2) + 0.05;
      this.dmgDirty = true;
    }
    // object matrix: local -> world
    const tx = fr.c[0] - (fr.f[0] * ref[0] + fr.u[0] * ref[1] + fr.r[0] * ref[2]);
    const ty = fr.c[1] - (fr.f[1] * ref[0] + fr.u[1] * ref[1] + fr.r[1] * ref[2]);
    const tz = fr.c[2] - (fr.f[2] * ref[0] + fr.u[2] * ref[1] + fr.r[2] * ref[2]);
    this.mesh.matrix.set(fr.f[0], fr.u[0], fr.r[0], tx, fr.f[1], fr.u[1], fr.r[1], ty, fr.f[2], fr.u[2], fr.r[2], tz, 0, 0, 0, 1);
    this.mesh.matrixWorldNeedsUpdate = true;

    this.updateBlobs();

    if (this.dmgDirty && (force || this.frame % 4 === 0)) { this.dmgDirty = false; this.updateDamage(x, force); }

    const braking = v.brkEff > 0.05 && !v.engineDead;
    if (braking !== this.brakeOn || force) {
      this.brakeOn = braking;
      this.mats.setBrake(braking);
    }
    let glassChanged = false;
    for (const k of PANELS) {
      const s = !!v.glass[k];
      if (s !== this.shattered[k]) { this.shattered[k] = s; glassChanged = true; }
    }
    if (glassChanged) this.buildGroups();

    const wheels = v.wheels, wm = this._wm, e = wm.elements;
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i], wv = this.wheels[i];
      const st = wheelStates ? wheelStates[i] : null;
      if (st ? st.detached : w.detached) {
        wv.batch.set(wv.slot, _zero);
        if (wv.brake) wv.brake.visible = false;
        continue;
      }
      let c, spin;
      if (st) {
        _f.set(st.fwd[0], st.fwd[1], st.fwd[2]).normalize();
        _u.set(st.up[0], st.up[1], st.up[2]).normalize();
        _r.crossVectors(_f, _u);
        c = st.center; spin = st.spin;
      } else {
        _f.set(w.fwd[0], w.fwd[1], w.fwd[2]);
        _u.set(w.up[0], w.up[1], w.up[2]);
        _r.set(w.right[0], w.right[1], w.right[2]);
        c = w.center; spin = w.spinAngle;
      }
      // basis (fwd, up, right) times the spin about the axle (local z); left wheels use
      // mirrored geometry, and a z mirror commutes with that spin
      const cs = Math.cos(spin), sn = Math.sin(spin);
      e[0] = cs * _f.x - sn * _u.x; e[1] = cs * _f.y - sn * _u.y; e[2] = cs * _f.z - sn * _u.z; e[3] = 0;
      e[4] = sn * _f.x + cs * _u.x; e[5] = sn * _f.y + cs * _u.y; e[6] = sn * _f.z + cs * _u.z; e[7] = 0;
      e[8] = _r.x; e[9] = _r.y; e[10] = _r.z; e[11] = 0;
      e[12] = c[0]; e[13] = c[1]; e[14] = c[2]; e[15] = 1;
      wv.batch.set(wv.slot, wm);
      if (wv.brake) {
        wv.brake.visible = true;
        wv.brake.position.set(c[0], c[1], c[2]);
        _m.makeBasis(_f, _u, _r);
        wv.brake.quaternion.setFromRotationMatrix(_m);
      }
    }
  }

  // ground blobs under the frame centre, fading as the car leaves the ground or tips over
  updateBlobs() {
    const fr = this.fr, ref = this.ref0, m = this._bm, e = m.elements;
    const lift = fr.c[1] - ref[1];
    const fade = Math.max(0, Math.min(1, 1 - lift / 0.9)) * Math.max(0, Math.min(1, Math.abs(fr.u[1]) * 1.5));
    let fx = fr.f[0], fz = fr.f[2];
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = -fz, rz = fx; // ground-plane right
    const cx = fr.c[0], cz = fr.c[2];
    const [cl, cw] = this.contactSize;
    m.set(cl * fx, 0, cw * rx, cx, 0, 1, 0, 0.012, cl * fz, 0, cw * rz, cz, 0, 0, 0, 1);
    this.blobs.set(this.contactBlob, fade > 0.02 ? m : _zero, this.contactAlpha * fade);
    if (this.sunBlob < 0) return;
    // the body's footprint smeared away from the sun: from the sills (~0.25 m) up to the
    // roof the shadow lands 0.3-1.6 m further along the sun's ground direction
    const [L, W] = this.footprint, ux = SUN_U[0], uz = SUN_U[1];
    const ext = Math.abs(L * (fx * ux + fz * uz)) + Math.abs(W * (rx * ux + rz * uz));
    const sweep = 1.0 / SUN_TAN, k = (ext + sweep) / ext - 1;
    // stretch S = I + k u u^T applied to the footprint axes L f and W r
    const ax = L * fx, az = L * fz, bx = W * rx, bz = W * rz;
    const au = (ax * ux + az * uz) * k, bu = (bx * ux + bz * uz) * k;
    const off = 0.8 / SUN_TAN;
    e[0] = ax + au * ux; e[1] = 0; e[2] = az + au * uz;
    e[8] = bx + bu * ux; e[9] = 0; e[10] = bz + bu * uz;
    e[12] = cx + ux * off; e[14] = cz + uz * off;
    this.blobs.set(this.sunBlob, fade > 0.02 ? m : _zero, 0.5 * fade);
  }

  // node damage from beam strain (works for live and replayed positions alike)
  updateDamage(x, force) {
    const tpl = this.vehicle.tpl, beams = tpl.beams, nd = this.nodeDmg;
    nd.fill(0);
    for (let k = 0; k < beams.length; k++) {
      const b = beams[k], a3 = b.a * 3, b3 = b.b * 3;
      const dx = x[a3] - x[b3], dy = x[a3 + 1] - x[b3 + 1], dz = x[a3 + 2] - x[b3 + 2];
      const s = Math.abs(Math.sqrt(dx * dx + dy * dy + dz * dz) / b.rest - 1);
      if (s < 0.018) continue;
      const e = Math.min(1, (s - 0.018) / 0.12);
      if (e > nd[b.a]) nd[b.a] = e;
      if (e > nd[b.b]) nd[b.b] = e;
    }
    let diff = 0;
    for (let i = 0; i < nd.length; i++) diff = Math.max(diff, Math.abs(nd[i] - this.shownDmg[i]));
    if (diff < 0.03 && !force) return;
    this.shownDmg.set(nd);
    const { idx } = this.src.binding, w = this.src.dmgW, out = this.dmgArr;
    for (let v = 0, o = 0; v < out.length; v++, o += 4) {
      out[v] = nd[idx[o]] * w[o] + nd[idx[o + 1]] * w[o + 1] + nd[idx[o + 2]] * w[o + 2] + nd[idx[o + 3]] * w[o + 3];
    }
    this.geometry.attributes.damage.needsUpdate = true;
  }

  resetVisualState() {
    for (const k of PANELS) this.shattered[k] = false;
    this.buildGroups();
    this.shownDmg.fill(-1);
    this.update(true);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.blobs.free(this.contactBlob);
    this.blobs.free(this.sunBlob);
    this.contactBlob = this.sunBlob = -1;
    this.geometry.dispose();
    if (this.caster) this.caster.geometry.dispose();
    this.mats.release();
    for (const w of this.wheels) {
      w.batch.free(w.slot);
      if (w.brake) this.scene.remove(w.brake);
    }
  }
}
