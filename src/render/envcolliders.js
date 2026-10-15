// Visuals for physics colliders. Every collider-backed object is drawn exactly
// inside its collider. Static colliders (present at start-up) are merged or
// instanced by kind; colliders added later (crash-lab obstacles) get their own
// meshes. Both kinds can be removed again by collider id.
import * as THREE from 'three';
import { Batch, hideRange, chunkedInstances, hideInstance, meterBox, lathe } from './envgeom.js';

function colliderMatrix(c) {
  const R = c.R;
  return new THREE.Matrix4().set(R[0], R[1], R[2], c.cx, R[3], R[4], R[5], c.cy, R[6], R[7], R[8], c.cz, 0, 0, 0, 1);
}

// Extrude a symmetric profile [[halfWidthFraction, heightFraction], ...] (bottom to
// top, one side) along local x, with end caps; uvs in metres / tile (u along, v up).
function extrudeProfile(len, W, H, prof, tile) {
  const side = prof.map(([w, h]) => [-w * W, h * H]);
  const loop = [...side, ...side.slice().reverse().map(([w, h]) => [-w, h])];
  const P = [], U = [], I = [];
  const x0 = -len / 2, x1 = len / 2;
  // sides: each loop edge as its own quad (flat normals keep the crease)
  for (let k = 0; k < loop.length - 1; k++) {
    const [za, ya] = loop[k], [zb, yb] = loop[k + 1];
    const b = P.length / 3;
    P.push(x0, ya, za, x1, ya, za, x0, yb, zb, x1, yb, zb);
    const va = ya / tile, vb = yb / tile + Math.abs(zb - za) / tile * 0.5;
    U.push(x0 / tile, va, x1 / tile, va, x0 / tile, vb, x1 / tile, vb);
    I.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  // caps (fan, convex profile)
  for (const [x, s] of [[x0, -1], [x1, 1]]) {
    const b = P.length / 3;
    for (const [z, y] of loop) { P.push(x, y, z); U.push(z / tile, y / tile); }
    for (let k = 1; k < loop.length - 1; k++) {
      if (s > 0) I.push(b, b + k, b + k + 1); else I.push(b, b + k + 1, b + k);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

const JERSEY = [[1, 0], [1, 0.09], [0.74, 0.36], [0.56, 0.94], [0.5, 1]];

// tyre geometry: a single tyre lying flat (radius 1 units, scaled) and a stack
function tyreRing(seg) {
  // only the visible upper part of the top layer
  return lathe([[0.58, 0.4], [0.68, 1.0], [0.93, 0.95], [1.0, 0.0]], seg);
}
function tyreStack(n, seg) {
  const prof = [[0.55, 0.0]];
  for (let j = 0; j < n; j++) {
    const y = j / n, h = 1 / n;
    prof.push([0.93, y + h * 0.03], [1.0, y + h * 0.5]);
  }
  prof.push([0.93, 1], [0.6, 0.98]);
  return lathe(prof, seg);
}

export class ColliderViews {
  constructor(env) {
    this.env = env;
    this.items = new Map(); // id -> { hide() }
    const q = env.q;
    this.hiQ = q !== 'low';
    const T = env.T, M = env.M;
    this.ringGeo = tyreRing(q === 'high' ? 9 : 7);
    this.stackGeo = tyreStack(4, q === 'high' ? 9 : 7);
    this.mats = { wall: M.wall, belt: M.belt, rubber: M.rubber, hazard: M.hazard, steel: M.steel, lamp: M.lamp, honey: M.honeycomb, deck: M.deck, paint: M.paintVC };
    this.buildStatic(env.world.colliders);
    void T;
  }

  // ---------------------------------------------------------------- static
  buildStatic(colliders) {
    const env = this.env;
    const batches = {}; // matKey -> Batch
    const owners = {};  // matKey -> [[id, range]]
    const inst = { ring: [], stack: [], belt: [] }; // instanced items with owner ids
    const addPart = (id, key, geo, matrix, color) => {
      const b = batches[key] || (batches[key] = new Batch());
      (owners[key] || (owners[key] = [])).push([id, b.add(geo, matrix, color)]);
    };
    for (const c of colliders) {
      if (c.tag === 'boundary') continue;
      this.parts(c, addPart, inst, true);
    }
    // merged meshes
    const ranges = new Map();
    for (const key in batches) {
      const geo = batches[key].build();
      const mesh = new THREE.Mesh(geo, this.mats[key]);
      mesh.castShadow = this.hiQ; mesh.receiveShadow = true;
      env.scene.add(mesh);
      for (const [id, range] of owners[key]) {
        if (!ranges.has(id)) ranges.set(id, []);
        ranges.get(id).push(() => hideRange(geo, range));
      }
    }
    // instanced tyres and belts
    const mk = (geo, mat, list, cell) => {
      if (!list.length) return;
      const r = chunkedInstances(geo, mat, list, cell, { castShadow: this.hiQ });
      env.scene.add(r.group);
      list.forEach((it, i) => {
        if (!ranges.has(it.id)) ranges.set(it.id, []);
        ranges.get(it.id).push(() => hideInstance(r.slots[i]));
      });
    };
    mk(this.ringGeo, this.mats.rubber, inst.ring, 250);
    mk(this.stackGeo, this.mats.rubber, inst.stack, 400);
    if (inst.belt.length) mk(inst.beltGeo, this.mats.belt, inst.belt, 300);
    for (const [id, fns] of ranges) this.items.set(id, { hide: () => fns.forEach(f => f()) });
  }

  // Emits the visual parts of collider c. addPart(id, matKey, geo, matrix, color)
  // for merged pieces; inst lists for instanced pieces (static build only).
  parts(c, addPart, inst, isStatic) {
    const tag = c.tag;
    if (c.type === 'box' && c.ramp) return this.ramp(c, addPart);
    if (c.type === 'box') {
      const M = colliderMatrix(c);
      if (tag === 'tyres') return this.tyreWall(c, M, addPart, inst, isStatic);
      if (tag === 'jersey') {
        addPart(c.id, 'wall', extrudeProfile(c.hx * 2, c.hz, c.hy * 2, JERSEY, 4).translate(0, -c.hy, 0), M, [0.92, 0.92, 0.9]);
        return;
      }
      if (tag === 'obstacle') return this.obstacle(c, M, addPart);
      if (tag === 'concrete') {
        const d = this.env.world.zones.derby;
        if (Math.hypot(c.cx - d.x, c.cz - d.z) < d.r + 6) return this.derbyWall(c, M, addPart, inst, isStatic);
        return this.crashWall(c, M, addPart);
      }
      addPart(c.id, 'wall', meterBox(c.hx * 2, c.hy * 2, c.hz * 2, 4, 0, 4).translate(0, 0, 0), M);
      return;
    }
    if (c.type === 'cyl') {
      if (tag === 'pole') return this.pole(c, addPart);
      // tyre stack (tyrestack and anything else round)
      const h = c.y1 - c.y0;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(c.cx, c.y0, c.cz), new THREE.Quaternion(), new THREE.Vector3(c.radius, h, c.radius));
      if (isStatic) inst.stack.push({ id: c.id, m });
      else addPart(c.id, 'rubber', this.stackGeo, m);
    }
  }

  tyreWall(c, M, addPart, inst, isStatic) {
    const env = this.env;
    const W = c.hx * 2, H = c.hy * 2, D = c.hz * 2;
    const geo = meterBox(W, H, D, env.T.tile.belt, 0, 1.2);
    // top face shows the dark hem of the belt texture (tyres sit on it)
    const uv = geo.attributes.uv;
    for (let i = 8; i < 12; i++) uv.setY(i, 0.02);
    const key = W.toFixed(2) + H.toFixed(2) + D.toFixed(2);
    if (isStatic && this.hiQ && (!inst.beltKey || inst.beltKey === key)) {
      if (!inst.beltGeo) { inst.beltGeo = geo; inst.beltKey = key; }
      inst.belt.push({ id: c.id, m: M });
      // top layer of tyres: two rows along the wall
      const n = Math.max(2, Math.round(W / 0.64));
      const rows = Math.max(1, Math.round(D / 0.64));
      const R = 0.31;
      for (let j = 0; j < rows; j++) for (let k = 0; k < n; k++) {
        const lx = -W / 2 + R + (W - 2 * R) * (n === 1 ? 0.5 : k / (n - 1));
        const lz = rows === 1 ? 0 : -D / 2 + R + (D - 2 * R) * j / (rows - 1);
        const local = new THREE.Matrix4().compose(new THREE.Vector3(lx, H / 2 - 0.15, lz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 1.3), new THREE.Vector3(R, 0.21, R));
        inst.ring.push({ id: c.id, m: M.clone().multiply(local) });
      }
    } else addPart(c.id, 'belt', geo, M);
  }

  derbyWall(c, M, addPart, inst, isStatic) {
    const d = this.env.world.zones.derby;
    const R = c.R;
    // which local z side faces the arena centre
    const zx = R[2], zz = R[8];
    const s = (zx * (d.x - c.cx) + zz * (d.z - c.cz)) > 0 ? 1 : -1;
    const W = c.hx * 2, H = c.hy * 2, D = c.hz * 2;
    const tyreD = 0.62, wallD = D - tyreD;
    const body = meterBox(W, H, wallD, 4, 0, 4).translate(0, 0, -s * tyreD / 2);
    addPart(c.id, 'wall', body, M, [0.95, 0.95, 0.93]);
    // painted cap
    addPart(c.id, 'paint', new THREE.BoxGeometry(W, 0.06, wallD + 0.04).translate(0, H / 2 + 0.03, -s * tyreD / 2), M, [0.75, 0.12, 0.08]);
    // tyre stacks lining the inner face (inside the collider footprint)
    const n = Math.max(1, Math.floor(W / 0.6));
    const zc = s * (D / 2 - 0.3);
    if (isStatic && this.hiQ) {
      for (let k = 0; k < n; k++) {
        const lx = -W / 2 + 0.3 + (W - 0.6) * (n === 1 ? 0.5 : k / (n - 1));
        const local = new THREE.Matrix4().compose(new THREE.Vector3(lx, -H / 2, zc), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 2.1), new THREE.Vector3(0.3, 0.98 + (k % 3) * 0.02, 0.3));
        inst.stack.push({ id: c.id, m: M.clone().multiply(local) });
      }
    } else {
      addPart(c.id, 'belt', meterBox(W, 1.0, tyreD, 2.4, 0, 1.2).translate(0, -H / 2 + 0.5, zc), M);
    }
  }

  crashWall(c, M, addPart) {
    const W = c.hx * 2, H = c.hy * 2, D = c.hz * 2;
    addPart(c.id, 'wall', meterBox(W, H, D, 4, 0, 4), M);
    // hazard bands near the top on both long faces
    const band = meterBox(W + 0.06, 0.45, D + 0.06, 1, 0, 0.45);
    addPart(c.id, 'hazard', band.translate(0, H / 2 - 0.4, 0), M);
  }

  obstacle(c, M, addPart) {
    // rigid block with a deformable honeycomb face toward -x (the approach side)
    const W = c.hx * 2, H = c.hy * 2, D = c.hz * 2;
    const face = Math.min(0.55, W * 0.3);
    addPart(c.id, 'wall', meterBox(W - face, H, D, 4, 0, 4).translate(face / 2, 0, 0), M, [0.9, 0.9, 0.88]);
    const honey = meterBox(face, H * 0.82, D, 0.6, 0, 0.6).translate(-W / 2 + face / 2, -H * 0.09, 0);
    addPart(c.id, 'honey', honey, M);
    addPart(c.id, 'hazard', meterBox(face + 0.02, H * 0.18, D + 0.02, 1, 0, 0.36).translate(-W / 2 + face / 2, H / 2 - H * 0.09, 0), M);
  }

  ramp(c, addPart) {
    const r = c.ramp;
    const L = r.run, W = r.width / 2, Hh = r.height;
    const M = new THREE.Matrix4().compose(new THREE.Vector3(r.x, 0, r.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -r.heading), new THREE.Vector3(1, 1, 1));
    const tri = (pts, uvs) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      return g;
    };
    const sl = Math.hypot(L, Hh);
    // deck (top), split so the hazard edges are their own strips
    const e = Math.min(0.35, W * 0.12);
    const deck = (z0, z1, key) => addPart(c.id, key, tri(
      [0, 0, z0, L, Hh, z1, L, Hh, z0, 0, 0, z0, 0, 0, z1, L, Hh, z1],
      key === 'hazard'
        ? [0, 0, sl, 0.25, sl, 0, 0, 0, 0, 0.25, sl, 0.25]
        : [0, z0 / 4, sl / 4, z1 / 4, sl / 4, z0 / 4, 0, z0 / 4, 0, z1 / 4, sl / 4, z1 / 4]), M);
    deck(-W, -W + e, 'hazard');
    deck(-W + e, W - e, 'deck');
    deck(W - e, W, 'hazard');
    // side plates
    addPart(c.id, 'paint', tri([0, 0, -W, L, Hh, -W, L, 0, -W, 0, 0, W, L, 0, W, L, Hh, W], [0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1]), M, [0.85, 0.62, 0.05]);
    // back face at the lip
    addPart(c.id, 'paint', tri([L, 0, -W, L, Hh, -W, L, Hh, W, L, 0, -W, L, Hh, W, L, 0, W], [0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]), M, [0.3, 0.31, 0.32]);
    // steel lip
    const lip = new THREE.BoxGeometry(0.16, 0.1, r.width).rotateZ(r.deg * Math.PI / 180).translate(L - 0.08, Hh - 0.03, 0);
    addPart(c.id, 'steel', lip, M);
  }

  pole(c, addPart) {
    const lab = this.env.world.zones.lab;
    const inLab = Math.abs(c.cx - lab.x) < lab.w / 2 && Math.abs(c.cz - lab.z) < lab.l / 2;
    const base = new THREE.Matrix4().makeTranslation(c.cx, 0, c.cz);
    if (inLab) {
      // rigid test pole: hazard-banded steel tube on a base plate
      const g = new THREE.CylinderGeometry(c.radius, c.radius, c.y1, 16, 1, true).translate(0, c.y1 / 2, 0);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * c.y1 * 1.5);
      addPart(c.id, 'hazard', g, base);
      addPart(c.id, 'steel', new THREE.BoxGeometry(1.2, 0.08, 1.2).translate(0, 0.04, 0), base);
      return;
    }
    // street lamp: tapered shaft, footing, bracket arm and LED head
    const H = c.y1;
    addPart(c.id, 'steel', new THREE.CylinderGeometry(c.radius * 0.55, c.radius, H, 8).translate(0, H / 2, 0), base);
    addPart(c.id, 'wall', new THREE.CylinderGeometry(c.radius + 0.12, c.radius + 0.16, 0.35, 10).translate(0, 0.175, 0), base);
    addPart(c.id, 'steel', new THREE.CylinderGeometry(0.04, 0.05, 1.7, 6).rotateZ(Math.PI / 2 - 0.12).translate(0.8, H - 0.05, 0), base);
    addPart(c.id, 'steel', new THREE.BoxGeometry(0.72, 0.1, 0.32).translate(1.65, H + 0.02, 0), base);
    addPart(c.id, 'lamp', new THREE.BoxGeometry(0.6, 0.02, 0.24).translate(1.65, H - 0.04, 0), base);
  }

  // ---------------------------------------------------------------- runtime
  add(c) {
    if (c.tag === 'boundary') { this.items.set(c.id, { hide() {} }); return null; }
    const groups = {};
    const addPart = (id, key, geo, matrix, color) => {
      (groups[key] || (groups[key] = new Batch())).add(geo, matrix, color);
    };
    this.parts(c, addPart, null, false);
    const root = new THREE.Group();
    for (const key in groups) {
      const mesh = new THREE.Mesh(groups[key].build(), this.mats[key]);
      mesh.castShadow = this.hiQ; mesh.receiveShadow = true;
      root.add(mesh);
    }
    this.env.scene.add(root);
    this.items.set(c.id, {
      hide: () => {
        this.env.scene.remove(root);
        root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      },
    });
    return root;
  }

  remove(c) {
    const it = this.items.get(c.id);
    if (it) { it.hide(); this.items.delete(c.id); }
  }
}
