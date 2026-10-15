// Deformable car mesh + wheels, driven by the soft-body node positions.
//
// The body mesh lives in the car's own frame (a rigid fit to the floor nodes), so when
// the lattice hasn't changed shape since the last frame only the object matrix moves:
// vertex skinning, normals and the GPU upload are skipped. When it has, every vertex is
// re-skinned from its tetrahedron of nodes and normals are rebuilt from flat arrays.
// A per-vertex damage value (from beam strain) drives the creased / scuffed paint.
import * as THREE from 'three';
import { buildBodyMesh, deformInto, C, PANELS } from '../vehicle/bodyshape.js';
import { makeCarMaterials, CRACKED } from './carmaterials.js';
import { makeWheelMesh as buildWheel } from './carwheels.js';

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

export function makeWheelMesh(spec, quality = 'high') {
  return buildWheel(spec, quality);
}

const REDEFORM = 0.002; // metres of local node motion before the mesh is re-skinned

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

const _m = new THREE.Matrix4(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();

export class CarView {
  constructor(scene, vehicle, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.vehicle = vehicle;
    const spec = vehicle.spec, tpl = vehicle.tpl;
    const src = this.src = getMesh(spec, tpl, quality === 'low' ? 'low' : 'high');
    const nv = src.vertexCount;

    const g = this.geometry = new THREE.BufferGeometry();
    this.posArr = new Float32Array(nv * 3);
    this.nrmArr = new Float32Array(nv * 3);
    this.dmgArr = new Float32Array(nv);
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrmArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(src.uvs, 2));
    g.setAttribute('damage', new THREE.BufferAttribute(this.dmgArr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(src.indices, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), spec.dims.length * 0.6);

    this.mats = makeCarMaterials(spec, quality, vehicle.color);
    this.mesh = new THREE.Mesh(g, this.mats.list);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // local frame reference: midpoint of the front and rear floor rows at rest
    const n = tpl.nodes, gr = tpl.groups;
    const avg0 = ids => ids.reduce((a, i) => [a[0] + n[i].x / ids.length, a[1] + n[i].y / ids.length, a[2] + n[i].z / ids.length], [0, 0, 0]);
    const F0 = avg0(gr.front), R0 = avg0(gr.rear);
    this.ref0 = [(F0[0] + R0[0]) / 2, (F0[1] + R0[1]) / 2, (F0[2] + R0[2]) / 2];
    this.localX = new Float64Array(n.length * 3);
    this.lastX = new Float64Array(n.length * 3).fill(1e9);
    this.nodeDmg = new Float32Array(n.length);
    this.shownDmg = new Float32Array(n.length).fill(-1);
    this.fr = { c: [0, 0, 0], f: [1, 0, 0], u: [0, 1, 0], r: [0, 0, 1] };

    const d = spec.dims;
    this.shadowBase = quality === 'low' ? 0.75 : 0.6;
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(d.length + 0.7, d.width + 0.55).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, map: contactShadowTexture(), transparent: true, opacity: this.shadowBase, depthWrite: false }));
    this.shadow.renderOrder = 0.5;
    scene.add(this.shadow);

    this.wheels = vehicle.wheels.map(w => {
      const m = makeWheelMesh(spec, quality);
      if (w.side < 0) m.scale.z = -1;
      scene.add(m);
      return m;
    });
    this.brakeOn = null;
    this.shattered = {};
    for (const p of PANELS) this.shattered[p] = false;
    this.frame = 0;
    this.dmgDirty = true;
    this.buildGroups();
    this.update(true);
  }

  // draw groups: one per material slot (glass split by panel so a shattered panel can
  // switch material); adjacent groups sharing a material are merged into one draw
  buildGroups() {
    const g = this.geometry, src = this.src, list = this.mats.list;
    const low = this.quality === 'low';
    const runs = [];
    for (const gr of src.groups) {
      if (!gr.count || (low && gr.slot === C.INTERIOR)) continue;
      if (gr.slot === C.GLASS) {
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
    const avg = (ids, o) => {
      let a = 0, b = 0, c = 0;
      for (const i of ids) { a += x[i * 3]; b += x[i * 3 + 1]; c += x[i * 3 + 2]; }
      o[0] = a / ids.length; o[1] = b / ids.length; o[2] = c / ids.length;
      return o;
    };
    const F = avg(gr.front, this._F || (this._F = [0, 0, 0])), R = avg(gr.rear, this._R || (this._R = [0, 0, 0]));
    const L = avg(gr.left, this._L || (this._L = [0, 0, 0])), Rt = avg(gr.right, this._Rt || (this._Rt = [0, 0, 0]));
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
    const lat = v.tpl.groups.lattice, L = this.localX, last = this.lastX;
    let moved = 0;
    for (let k = 0; k < lat.length; k++) {
      const i3 = lat[k] * 3;
      const dx = x[i3] - fr.c[0], dy = x[i3 + 1] - fr.c[1], dz = x[i3 + 2] - fr.c[2];
      const lx = dx * fr.f[0] + dy * fr.f[1] + dz * fr.f[2] + ref[0];
      const ly = dx * fr.u[0] + dy * fr.u[1] + dz * fr.u[2] + ref[1];
      const lz = dx * fr.r[0] + dy * fr.r[1] + dz * fr.r[2] + ref[2];
      L[i3] = lx; L[i3 + 1] = ly; L[i3 + 2] = lz;
      const m = Math.max(Math.abs(lx - last[i3]), Math.abs(ly - last[i3 + 1]), Math.abs(lz - last[i3 + 2]));
      if (m > moved) moved = m;
    }
    if (force || moved > REDEFORM) {
      deformInto(this.posArr, this.src.binding, L);
      computeNormals(this.posArr, this.src.indices, this.nrmArr);
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.normal.needsUpdate = true;
      last.set(L);
      // bounds for frustum culling (nodes can be flung far in a wreck)
      let r2 = 0;
      for (let k = 0; k < lat.length; k++) {
        const i3 = lat[k] * 3, dx = L[i3], dy = L[i3 + 1] - 0.7, dz = L[i3 + 2];
        r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
      }
      this.geometry.boundingSphere.radius = Math.sqrt(r2) + 0.75;
      this.dmgDirty = true;
    }
    // object matrix: local -> world
    const tx = fr.c[0] - (fr.f[0] * ref[0] + fr.u[0] * ref[1] + fr.r[0] * ref[2]);
    const ty = fr.c[1] - (fr.f[1] * ref[0] + fr.u[1] * ref[1] + fr.r[1] * ref[2]);
    const tz = fr.c[2] - (fr.f[2] * ref[0] + fr.u[2] * ref[1] + fr.r[2] * ref[2]);
    this.mesh.matrix.set(fr.f[0], fr.u[0], fr.r[0], tx, fr.f[1], fr.u[1], fr.r[1], ty, fr.f[2], fr.u[2], fr.r[2], tz, 0, 0, 0, 1);
    this.mesh.matrixWorldNeedsUpdate = true;

    // contact shadow: on the ground under the frame centre, fading as the car leaves it
    const lift = fr.c[1] - ref[1];
    const fade = Math.max(0, Math.min(1, 1 - lift / 0.9)) * Math.max(0, Math.min(1, Math.abs(fr.u[1]) * 1.5));
    this.shadow.visible = fade > 0.02;
    this.shadow.material.opacity = this.shadowBase * fade;
    this.shadow.position.set(fr.c[0], 0.012, fr.c[2]);
    this.shadow.rotation.y = -Math.atan2(fr.f[2], fr.f[0]);

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

    v.wheels.forEach((w, i) => {
      const mesh = this.wheels[i];
      const st = wheelStates ? wheelStates[i] : null;
      if (st ? st.detached : w.detached) { mesh.visible = false; return; }
      mesh.visible = true;
      if (st) {
        _f.set(st.fwd[0], st.fwd[1], st.fwd[2]).normalize();
        _u.set(st.up[0], st.up[1], st.up[2]).normalize();
        _r.crossVectors(_f, _u);
        mesh.position.set(st.center[0], st.center[1], st.center[2]);
        mesh.userData.spin.rotation.z = -st.spin;
      } else {
        _f.set(w.fwd[0], w.fwd[1], w.fwd[2]);
        _u.set(w.up[0], w.up[1], w.up[2]);
        _r.set(w.right[0], w.right[1], w.right[2]);
        mesh.position.set(w.center[0], w.center[1], w.center[2]);
        mesh.userData.spin.rotation.z = -w.spinAngle;
      }
      _m.makeBasis(_f, _u, _r);
      mesh.quaternion.setFromRotationMatrix(_m);
    });
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
    this.scene.remove(this.shadow);
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
    this.geometry.dispose();
    for (const m of this.mats.own) m.dispose();
    for (const w of this.wheels) this.scene.remove(w);
  }
}
