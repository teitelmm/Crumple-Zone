// Procedural car body: a lofted lower body, a greenhouse, and decals (lights,
// grille, plates). Every vertex is bound to a tetrahedron of lattice nodes, so
// the mesh deforms exactly with the soft-body when the car crumples.

import { axles, halfWidthAt, topAt, bottomAt, noseXAt } from './specs.js';

export const C = {
  paint: 0, glass: 1, black: 2, chrome: 3, head: 4, tail: 5, plate: 6, under: 7, soft: 8, grille: 9,
};

const DECALS = {
  a4: {
    front: [
      { c: C.head, tag: 'head', m: 1, p: [[0.42, 0.64], [0.8, 0.6], [0.84, 0.68], [0.45, 0.7]] },
      { c: C.grille, p: [[-0.3, 0.68], [0.3, 0.68], [0.36, 0.55], [0.3, 0.3], [-0.3, 0.3], [-0.36, 0.55]] },
      { c: C.chrome, o: 2, p: [[-0.31, 0.69], [0.31, 0.69], [0.31, 0.675], [-0.31, 0.675]] },
      { c: C.plate, o: 2, p: [[-0.26, 0.36], [0.26, 0.36], [0.26, 0.47], [-0.26, 0.47]] },
      { c: C.black, m: 1, p: [[0.5, 0.3], [0.75, 0.3], [0.72, 0.44], [0.52, 0.44]] },
    ],
    rear: [
      { c: C.tail, tag: 'tail', m: 1, p: [[0.4, 0.8], [0.86, 0.77], [0.88, 0.87], [0.43, 0.89]] },
      { c: C.plate, p: [[-0.26, 0.62], [0.26, 0.62], [0.26, 0.73], [-0.26, 0.73]] },
      { c: C.black, p: [[-0.72, 0.3], [0.72, 0.3], [0.66, 0.42], [-0.66, 0.42]] },
      { c: C.chrome, o: 2, m: 1, p: [[0.42, 0.32], [0.6, 0.32], [0.6, 0.39], [0.42, 0.39]] },
    ],
    side: { seams: [0.58, -0.47, -1.33], glass: u => (u > 0.86 ? C.paint : u > 0.47 && u < 0.53 ? C.black : C.glass) },
  },
  miata: {
    front: [
      { c: C.head, tag: 'head', m: 1, p: [[0.36, 0.58], [0.76, 0.55], [0.78, 0.61], [0.4, 0.63]] },
      { c: C.grille, p: [[-0.38, 0.49], [0.38, 0.49], [0.45, 0.39], [0.38, 0.27], [-0.38, 0.27], [-0.45, 0.39]] },
      { c: C.plate, o: 2, p: [[-0.26, 0.31], [0.26, 0.31], [0.26, 0.42], [-0.26, 0.42]] },
    ],
    rear: [
      { c: C.tail, tag: 'tail', m: 1, p: [[0.46, 0.66], [0.78, 0.63], [0.79, 0.71], [0.5, 0.73]] },
      { c: C.plate, p: [[-0.26, 0.43], [0.26, 0.43], [0.26, 0.54], [-0.26, 0.54]] },
      { c: C.black, p: [[-0.6, 0.26], [0.6, 0.26], [0.55, 0.36], [-0.55, 0.36]] },
      { c: C.chrome, o: 2, m: 1, p: [[0.26, 0.28], [0.38, 0.28], [0.38, 0.35], [0.26, 0.35]] },
    ],
    side: { seams: [0.18, -0.95], glass: u => (u > 0.5 ? C.soft : C.glass) },
  },
  mustang: {
    front: [
      { c: C.head, tag: 'head', m: 1, p: [[0.5, 0.62], [0.88, 0.58], [0.9, 0.66], [0.55, 0.67]] },
      { c: C.grille, p: [[-0.42, 0.65], [0.42, 0.65], [0.5, 0.42], [-0.5, 0.42]] },
      { c: C.black, p: [[-0.56, 0.38], [0.56, 0.38], [0.5, 0.27], [-0.5, 0.27]] },
      { c: C.plate, o: 2, p: [[-0.26, 0.44], [0.26, 0.44], [0.26, 0.55], [-0.26, 0.55]] },
    ],
    rear: [
      { c: C.black, p: [[-0.86, 0.7], [0.86, 0.7], [0.86, 0.88], [-0.86, 0.88]] },
      { c: C.tail, tag: 'tail', o: 2, m: 1, p: [[0.44, 0.72], [0.52, 0.72], [0.52, 0.86], [0.44, 0.86]] },
      { c: C.tail, tag: 'tail', o: 2, m: 1, p: [[0.58, 0.72], [0.66, 0.72], [0.66, 0.86], [0.58, 0.86]] },
      { c: C.tail, tag: 'tail', o: 2, m: 1, p: [[0.72, 0.72], [0.8, 0.72], [0.8, 0.86], [0.72, 0.86]] },
      { c: C.plate, p: [[-0.26, 0.5], [0.26, 0.5], [0.26, 0.61], [-0.26, 0.61]] },
      { c: C.chrome, o: 2, m: 1, p: [[0.55, 0.3], [0.7, 0.3], [0.7, 0.38], [0.55, 0.38]] },
    ],
    side: { seams: [0.46, -1.0], glass: u => (u > 0.72 ? C.paint : C.glass) },
  },
};

class Builder {
  constructor() { this.pos = []; this.col = []; this.idx = []; this.tags = new Map(); }
  v(x, y, z, c, tag) {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.col.push(c);
    if (tag) { if (!this.tags.has(tag)) this.tags.set(tag, []); this.tags.get(tag).push(i); }
    return i;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  // bilinear patch with corners p00 (u0,v0) p10 p01 p11
  patch(p00, p10, p01, p11, nu, nv, colorFn, tag, bend) {
    const base = this.pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        const p = [0, 1, 2].map(k => (1 - u) * (1 - v) * p00[k] + u * (1 - v) * p10[k] + (1 - u) * v * p01[k] + u * v * p11[k]);
        if (bend) bend(p, u, v);
        this.v(p[0], p[1], p[2], colorFn(u, v), tag);
      }
    }
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i;
        this.quad(a, a + 1, a + nu + 2, a + nu + 1);
      }
  }
  poly(points, c, tag) {
    // convex polygon fan
    const base = this.pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (const p of points) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const n = points.length;
    this.v(cx / n, cy / n, cz / n, c, tag);
    for (const p of points) this.v(p[0], p[1], p[2], c, tag);
    for (let i = 0; i < n; i++) this.tri(base, base + 1 + i, base + 1 + ((i + 1) % n));
  }
  box(cx, cy, cz, sx, sy, sz, c) {
    const pts = [];
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const dz of [-1, 1]) pts.push(this.v(cx + dx * sx, cy + dy * sy, cz + dz * sz, c));
    const f = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    for (const q of f) this.quad(pts[q[0]], pts[q[1]], pts[q[2]], pts[q[3]]);
  }
}

export function buildBodyMesh(spec, tpl) {
  const d = spec.dims, g = spec.greenhouse;
  const B = new Builder();
  const xF = d.length / 2, xR = -d.length / 2;

  // ---- lower body loft
  const NS = 44;
  const ringSize = 18;
  for (let s = 0; s <= NS; s++) {
    const t = s / NS;
    const sc = (1 - Math.cos(Math.PI * t)) / 2;
    const x = xR + (xF - xR) * (0.5 * sc + 0.5 * t);
    const hw = halfWidthAt(spec, x);
    const yb = bottomAt(spec, x);
    const yt = Math.max(yb + 0.08, topAt(spec, x));
    const h = yt - yb;
    const right = [
      [0, yb, C.under], [0.8, yb, C.under], [0.96, yb + 0.025, C.under], [1, yb + Math.min(0.09, 0.2 * h), C.black],
      [1, yb + 0.5 * h, C.paint], [0.995, yt - Math.min(0.12, 0.3 * h), C.paint], [0.95, yt - 0.025, C.paint],
      [0.82, yt, C.paint], [0.45, yt + 0.012, C.paint], [0, yt + 0.015, C.paint],
    ];
    const ring = [...right, ...right.slice(1, 9).reverse().map(([u, y, c]) => [-u, y, c])];
    for (const [u, y, c] of ring) B.v(x, y, u * hw, c);
  }
  for (let s = 0; s < NS; s++) {
    const a = s * ringSize, b = (s + 1) * ringSize;
    for (let k = 0; k < ringSize; k++) {
      const k2 = (k + 1) % ringSize;
      B.quad(a + k, a + k2, b + k2, b + k);
    }
  }

  // ---- greenhouse
  const soft = !!g.softTop;
  const bf = topAt(spec, g.aBase) + 0.01, br = topAt(spec, g.cBase) + 0.01;
  const zbf = halfWidthAt(spec, g.aBase) * g.beltInset, zbr = halfWidthAt(spec, g.cBase) * g.beltInset;
  const H = d.height, zr = g.roofHalf;
  const BFL = [g.aBase, bf, -zbf], BFR = [g.aBase, bf, zbf];
  const BRL = [g.cBase, br, -zbr], BRR = [g.cBase, br, zbr];
  const RFL = [g.roofFront, H, -zr], RFR = [g.roofFront, H, zr];
  const RRL = [g.roofRear, H, -zr], RRR = [g.roofRear, H, zr];
  const roofC = soft ? C.soft : C.paint;
  const pillarC = soft ? C.black : C.paint;
  // windshield
  B.patch(BFL, BFR, RFL, RFR, 6, 4,
    (u, v) => (u < 0.07 || u > 0.93 ? pillarC : v > 0.95 ? roofC : C.glass), 'windshield',
    (p, u) => { p[0] += 0.04 * Math.sin(Math.PI * u); });
  // roof
  B.patch(RFL, RFR, RRL, RRR, 6, 4, () => roofC, null,
    (p, u) => { p[1] += 0.03 * Math.sin(Math.PI * u); });
  // rear glass / soft top
  B.patch(RRL, RRR, BRL, BRR, 6, 4,
    (u, v) => soft ? (u > 0.22 && u < 0.78 && v > 0.3 && v < 0.75 ? C.glass : C.soft)
      : (u < 0.08 || u > 0.92 || v < 0.06 ? roofC : C.glass), 'rearGlass',
    (p, u) => { p[1] += 0.02 * Math.sin(Math.PI * u); });
  // side windows
  const sideFn = DECALS[spec.id].side.glass;
  for (const side of [-1, 1]) {
    const pick = (L, R) => (side < 0 ? L : R);
    B.patch(pick(BFL, BFR), pick(BRL, BRR), pick(RFL, RFR), pick(RRL, RRR), 10, 3,
      (u, v) => (v > 0.9 ? roofC : sideFn(u)), side < 0 ? 'leftGlass' : 'rightGlass');
  }
  // mirrors
  for (const side of [-1, 1]) {
    const mz = side * (halfWidthAt(spec, g.aBase) * g.beltInset + 0.1);
    B.box(g.aBase - 0.12, bf + 0.08, mz, 0.08, 0.055, 0.09, C.paint);
  }

  // ---- decals on nose and tail
  const dec = DECALS[spec.id];
  const face = (list, front) => {
    for (const dcl of list) {
      const variants = dcl.m ? [1, -1] : [1];
      for (const mir of variants) {
        const off = (dcl.o || 1) * 0.011;
        const pts = dcl.p.map(([z, y]) => {
          const zz = z * mir;
          let x = noseXAt(spec, zz, front);
          const yt = topAt(spec, x) - 0.02, yb = bottomAt(spec, x) + 0.02;
          const yy = Math.min(yt, Math.max(yb, y));
          x += front ? off : -off;
          return [x, yy, zz];
        });
        B.poly(pts, dcl.c, dcl.tag);
      }
    }
  };
  face(dec.front, true);
  face(dec.rear, false);

  // door seams and handles on the flanks
  for (const side of [-1, 1]) {
    for (const sx of dec.side.seams) {
      const hw = halfWidthAt(spec, sx) + 0.004;
      const yb = bottomAt(spec, sx) + 0.12, yt = topAt(spec, sx) - 0.07;
      const w = 0.008;
      B.poly([[sx - w, yb, side * hw], [sx + w, yb, side * hw], [sx + w, yt, side * hw], [sx - w, yt, side * hw]], C.black);
    }
    const hx = dec.side.seams[0] - 0.42;
    const hhw = halfWidthAt(spec, hx) + 0.006, hy = topAt(spec, hx) - 0.13;
    B.poly([[hx - 0.09, hy, side * hhw], [hx + 0.09, hy, side * hhw], [hx + 0.09, hy + 0.03, side * hhw], [hx - 0.09, hy + 0.03, side * hhw]], C.chrome);
  }

  const positions = new Float32Array(B.pos);
  const binding = bindToLattice(positions, tpl);
  return {
    positions,
    colors: Uint8Array.from(B.col),
    indices: Uint32Array.from(B.idx),
    tags: Object.fromEntries(B.tags),
    binding,
  };
}

// --- tetrahedral binding ---
function bindToLattice(positions, tpl) {
  const nodes = tpl.groups.lattice.map(i => ({ i, p: [tpl.nodes[i].x, tpl.nodes[i].y, tpl.nodes[i].z] }));
  const nv = positions.length / 3;
  const idx = new Int32Array(nv * 4);
  const wts = new Float32Array(nv * 4);
  const K = 9;
  const combos = [];
  for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) for (let c = b + 1; c < K; c++) for (let e = c + 1; e < K; e++) combos.push([a, b, c, e]);
  for (let v = 0; v < nv; v++) {
    const P = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const near = nodes.map(n => ({ n, d: (n.p[0] - P[0]) ** 2 + (n.p[1] - P[1]) ** 2 + (n.p[2] - P[2]) ** 2 }))
      .sort((a, b) => a.d - b.d).slice(0, K).map(o => o.n);
    let best = null, bestScore = -Infinity;
    for (const cb of combos) {
      const [A, Bn, Cn, D] = cb.map(k => near[k].p);
      const e1 = sub(Bn, A), e2 = sub(Cn, A), e3 = sub(D, A);
      const det = dot(e1, cross(e2, e3));
      const maxE = Math.max(len(e1), len(e2), len(e3), len(sub(Cn, Bn)), len(sub(D, Bn)), len(sub(D, Cn)));
      const q = Math.abs(det) / (maxE ** 3);
      if (q < 0.03) continue;
      const r = sub(P, A);
      const b1 = dot(r, cross(e2, e3)) / det;
      const b2 = dot(e1, cross(r, e3)) / det;
      const b3 = dot(e1, cross(e2, r)) / det;
      const b0 = 1 - b1 - b2 - b3;
      const score = Math.min(b0, b1, b2, b3) + q * 0.3;
      if (score > bestScore) { bestScore = score; best = { cb, w: [b0, b1, b2, b3] }; }
    }
    for (let k = 0; k < 4; k++) {
      idx[v * 4 + k] = near[best.cb[k]].i;
      wts[v * 4 + k] = best.w[k];
    }
  }
  return { idx, wts };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);

// Deform: write world positions for every vertex from the current node positions.
export function deformInto(out, binding, x) {
  const { idx, wts } = binding;
  const nv = out.length / 3;
  for (let v = 0; v < nv; v++) {
    const o = v * 4;
    const a = idx[o] * 3, b = idx[o + 1] * 3, c = idx[o + 2] * 3, d = idx[o + 3] * 3;
    const wa = wts[o], wb = wts[o + 1], wc = wts[o + 2], wd = wts[o + 3];
    out[v * 3] = x[a] * wa + x[b] * wb + x[c] * wc + x[d] * wd;
    out[v * 3 + 1] = x[a + 1] * wa + x[b + 1] * wb + x[c + 1] * wc + x[d + 1] * wd;
    out[v * 3 + 2] = x[a + 2] * wa + x[b + 2] * wb + x[c + 2] * wc + x[d + 2] * wd;
  }
}
