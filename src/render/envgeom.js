// Geometry helpers for the static world: merged batches, profile sweeps and
// spatially chunked instancing (so frustum and shadow culling still work).
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3(), _c = new THREE.Color();

// Accumulates transformed geometry into one BufferGeometry (position, normal,
// uv, color). add() returns the vertex range so a piece can be hidden later.
export class Batch {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.I = []; this.count = 0; }

  // color: THREE.Color | hex | [r,g,b] (linear); uvFn(out[2], worldPos, worldNormal, srcU, srcV)
  add(geo, matrix = null, color = null, uvFn = null) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv, col = geo.attributes.color;
    const start = this.count;
    if (matrix) _nm.getNormalMatrix(matrix);
    const c = color == null ? null : Array.isArray(color) ? color : (_c.set(color), [_c.r, _c.g, _c.b]);
    const tuv = [0, 0];
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      if (matrix) _v.applyMatrix4(matrix);
      if (n) { _n.fromBufferAttribute(n, i); if (matrix) _n.applyMatrix3(_nm).normalize(); } else _n.set(0, 1, 0);
      this.P.push(_v.x, _v.y, _v.z);
      this.N.push(_n.x, _n.y, _n.z);
      const su = uv ? uv.getX(i) : 0, sv = uv ? uv.getY(i) : 0;
      if (uvFn) { uvFn(tuv, _v, _n, su, sv); this.U.push(tuv[0], tuv[1]); } else this.U.push(su, sv);
      let r = 1, g = 1, b = 1;
      if (col) { r = col.getX(i); g = col.getY(i); b = col.getZ(i); }
      if (c) { r *= c[0]; g *= c[1]; b *= c[2]; }
      this.C.push(r, g, b);
    }
    const flip = matrix && matrix.determinant() < 0;
    if (geo.index) {
      const ix = geo.index.array;
      for (let i = 0; i < ix.length; i += 3) {
        if (flip) this.I.push(start + ix[i], start + ix[i + 2], start + ix[i + 1]);
        else this.I.push(start + ix[i], start + ix[i + 1], start + ix[i + 2]);
      }
    } else {
      for (let i = 0; i < p.count; i += 3) {
        if (flip) this.I.push(start + i, start + i + 2, start + i + 1);
        else this.I.push(start + i, start + i + 1, start + i + 2);
      }
    }
    this.count += p.count;
    return [start, p.count];
  }

  get empty() { return this.count === 0; }

  build(colors = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Batches bucketed by world position (cell metres), one mesh per bucket, so
// long runs of merged geometry still benefit from frustum / shadow culling.
export class BucketBatch {
  constructor(cell) { this.cell = cell; this.b = new Map(); }
  add(x, z, geo, matrix, color, uvFn) {
    const k = Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell);
    let b = this.b.get(k);
    if (!b) this.b.set(k, b = new Batch());
    b.add(geo, matrix, color, uvFn);
  }
  get empty() { return this.b.size === 0; }
  meshes(mat, colors = true) { return [...this.b.values()].map(b => new THREE.Mesh(b.build(colors), mat)); }
}

// collapse a vertex range of a built geometry (hides a merged piece)
export function hideRange(geo, [start, count]) {
  const p = geo.attributes.position;
  const x = p.getX(start), y = p.getY(start), z = p.getZ(start);
  for (let i = start; i < start + count; i++) p.setXYZ(i, x, y, z);
  p.needsUpdate = true;
}

// world-projected uvs in metres / tile, picking the plane from the dominant normal axis
export function boxUV(tile, tileY = tile) {
  return (out, p, n) => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ay >= ax && ay >= az) { out[0] = p.x / tile; out[1] = p.z / tile; }
    else if (ax >= az) { out[0] = p.z / tile; out[1] = p.y / tileY; }
    else { out[0] = p.x / tile; out[1] = p.y / tileY; }
  };
}

// Box with uvs in metres / tile per face (side faces: v measured from the box
// bottom + y0, divided by tileV).
export function meterBox(w, h, d, tile = 1, y0 = 0, tileV = tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    const flat = f === 2 || f === 3;
    const vy = flat ? uv.getY(i) * dims[f][1] / tile : (uv.getY(i) * h + y0) / tileV;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, vy);
  }
  return g;
}

// Sweep a 2D profile [[lateral, height, u], ...] along a path of
// {x, z, y?, nx, nz, s} samples (n = unit horizontal normal); v = s / tileV.
// closed: path wraps around. Face normals follow cross(profile step, path step):
// a profile rising along the path faces the path's left; flip reverses that.
export function sweep(path, profile, { tileV = 1, closed = false, y = 0, flatShade = false, flip = false } = {}) {
  const P = [], U = [], I = [];
  const np = profile.length, ns = path.length;
  for (let i = 0; i < ns; i++) {
    const q = path[i];
    const by = (q.y ?? 0) + y;
    for (let k = 0; k < np; k++) {
      const [o, h, u] = profile[k];
      P.push(q.x + q.nx * o, by + h, q.z + q.nz * o);
      U.push(u ?? k / (np - 1), q.s / tileV);
    }
  }
  const segs = closed ? ns : ns - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * np, b = ((i + 1) % ns) * np;
    for (let k = 0; k < np - 1; k++) {
      if (flip) I.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
      else I.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  if (flatShade) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

// Instances bucketed into a grid of InstancedMeshes. items: [{m: Matrix4, c?: Color}]
// Returns { group, meshes, slots } where slots[i] = [mesh, index] for items[i].
export function chunkedInstances(geo, mat, items, cell, { castShadow = false, receiveShadow = true, name = '' } = {}) {
  const buckets = new Map();
  const pos = new THREE.Vector3();
  items.forEach((it, i) => {
    pos.setFromMatrixPosition(it.m);
    const key = Math.floor(pos.x / cell) + ',' + Math.floor(pos.z / cell);
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = []);
    b.push(i);
  });
  const group = new THREE.Group();
  const meshes = [], slots = new Array(items.length);
  const useColor = items.some(it => it.c);
  for (const idx of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, mat, idx.length);
    idx.forEach((i, k) => {
      im.setMatrixAt(k, items[i].m);
      if (useColor) im.setColorAt(k, items[i].c || _c.setRGB(1, 1, 1));
      slots[i] = [im, k];
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = castShadow;
    im.receiveShadow = receiveShadow;
    im.name = name;
    group.add(im);
    meshes.push(im);
  }
  return { group, meshes, slots };
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
export function hideInstance([mesh, index]) {
  mesh.setMatrixAt(index, ZERO);
  mesh.instanceMatrix.needsUpdate = true;
}

// matrix from position, yaw (rotation about +y, radians) and scale
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export function trs(x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.set(sx, sy, sz));
}

// Game heading (local +x forward -> (cos h, 0, sin h)) as a three.js yaw.
export const yawOf = (heading) => -heading;

// Lathe helper: profile [[radius, y], ...] around +y
export function lathe(profile, segments) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

// random generator shared by world builders
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
