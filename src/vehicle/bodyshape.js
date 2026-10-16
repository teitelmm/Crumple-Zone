// Procedural car body for the render mesh.
//
// The lower body is a loft of cross-section rings from tail to nose: underbody, wheel
// wells with liners, flared arch lips, rocker, door surface, shoulder crease, upper
// shoulder and hood / deck. The ends are closed by per-height plan-view rounding, so
// the nose and tail follow a side silhouette. The greenhouse is a grid between a base
// loop on the belt line and the roof edge loop, closed by the roof cap; pillars, glass
// and trim are bands of that grid. Lights, grilles, plates and panel gaps are decals
// snapped onto the surface, and mirrors, handles, exhaust tips and a simple interior are
// small solids. Every vertex is bound to a tetrahedron of lattice nodes, so the whole
// mesh deforms exactly with the soft body when the car crumples.
//
// Shape data lives in spec.visual (specs.js). Triangles are grouped by material slot.

import { axles } from './specs.js';

export const C = {
  PAINT: 0, TRIM: 1, PLASTIC: 2, GRILLE: 3, SOFT: 4, INTERIOR: 5, CHROME: 6, LAMP: 7,
  AMBER: 8, HEAD: 9, TAIL: 10, TAILLED: 11, PLATE: 12, GLASS: 13,
};
export const SLOT_COUNT = 14;
export const PANELS = ['windshield', 'rearGlass', 'leftGlass', 'rightGlass'];
const SLOT = {
  paint: C.PAINT, trim: C.TRIM, plastic: C.PLASTIC, gap: C.PLASTIC, grille: C.GRILLE, soft: C.SOFT,
  interior: C.INTERIOR, chrome: C.CHROME, lamp: C.LAMP, amber: C.AMBER, head: C.HEAD,
  tail: C.TAIL, tailled: C.TAILLED, plate: C.PLATE, glass: C.GLASS,
};

// ring points per half section: under (0-3), arch lip / rocker (4-5), side (6-11),
// shoulder crease (12-14), belt edge (15), top surface to the centre line (16-21)
const NS = 22, SIDE0 = 6, NSIDE = 6, CREASE = SIDE0 + NSIDE, BELT = CREASE + 3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const SE = (t, n) => (t <= 0 ? 1 : t >= 1 ? 0 : Math.pow(1 - Math.pow(t, n), 1 / n));

// --- small vector helpers (arrays) ---
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Monotone cubic interpolation through [[k, v], ...] (any order); clamps outside.
function curve(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const n = p.length, xs = p.map(q => q[0]), ys = p.map(q => q[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// ------------------------------------------------------------------ mesh builder
class Builder {
  constructor() {
    this.pos = []; this.uv = [];
    this.idx = Array.from({ length: SLOT_COUNT }, () => []);
    this.glass = { windshield: [], rearGlass: [], leftGlass: [], rightGlass: [] };
    this.keys = new Map();
    this.surf = []; // triangles decals may snap to
    // decal vertices glued to the skin: [vertex, a, b, c] + frame coefficients [s, t, h]
    // (see glueInto); glueOf: vertex -> record
    this.glueV = []; this.glueW = []; this.glueOf = new Map();
  }
  glue(v, a, b, c) {
    const P = this.pos, p = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const A = p(a), e1 = sub(p(b), A), e2 = sub(p(c), A), nn = cross(e1, e2), l = len(nn);
    if (l < 1e-10) return;
    const n = scl(nn, 1 / l), d = sub(p(v), A), h = dot(d, n), q = sub(d, scl(n, h));
    const e11 = dot(e1, e1), e12 = dot(e1, e2), e22 = dot(e2, e2), det = e11 * e22 - e12 * e12;
    if (det < 1e-16) return;
    const q1 = dot(q, e1), q2 = dot(q, e2);
    this.glueOf.set(v, this.glueV.length / 4);
    this.glueV.push(v, a, b, c);
    this.glueW.push((q1 * e22 - q2 * e12) / det, (q2 * e11 - q1 * e12) / det, h);
  }
  v(x, y, z, u = 0, w = 0) { this.pos.push(x, y, z); this.uv.push(u, w); return this.pos.length / 3 - 1; }
  kv(key, x, y, z, u, w) {
    let i = this.keys.get(key);
    if (i === undefined) { i = this.v(x, y, z, u, w); this.keys.set(key, i); }
    return i;
  }
  // nref: optional outward reference normal used to fix the winding
  tri(slot, a, b, c, panel = null, surf = false, nref = null) {
    const P = this.pos;
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const n = cross(e1, e2);
    if (len(n) < 2e-9) return; // degenerate
    if (nref && dot(n, nref) < 0) { const t = b; b = c; c = t; }
    if (slot === C.GLASS) this.glass[panel].push(a, b, c);
    else this.idx[slot].push(a, b, c);
    if (surf) this.surf.push(a, b, c);
  }
}

// A detached piece of geometry (decal or solid), emitted once or mirrored. Decal points
// made by the detail kit's off() carry the skin triangle they sit on (p.tri); those
// vertices are glued to that triangle so they follow the crumpled skin exactly.
class Part {
  constructor() { this.v = []; this.t = []; }
  add(p, u = 0, w = 0) { this.v.push([p[0], p[1], p[2], u, w, p.tri || null]); return this.v.length - 1; }
  tri(slot, a, b, c, nref) { this.t.push([slot, a, b, c, nref]); }
  quad(slot, a, b, c, d, nref) { this.tri(slot, a, b, c, nref); this.tri(slot, a, c, d, nref); }
}
function emitPart(B, part, mirror, surf) {
  const base = B.pos.length / 3;
  const s = mirror ? -1 : 1;
  for (const v of part.v) {
    const i = B.v(v[0], v[1], v[2] * s, v[3], v[4]);
    const t = v[5];
    if (!t || !surf) continue;
    const m = mirror ? t.map(k => surf.mirror(k)) : t;
    if (m[0] >= 0 && m[1] >= 0 && m[2] >= 0) B.glue(i, m[0], m[1], m[2]);
  }
  for (const [slot, a, b, c, nref] of part.t) {
    const nr = nref ? [nref[0], nref[1], nref[2] * s] : null;
    B.tri(slot, base + a, base + b, base + c, null, false, nr);
  }
}

// ------------------------------------------------------------------ shape functions
function makeShape(spec, lod) {
  const V = spec.visual, d = spec.dims;
  const { fa, ra } = axles(spec);
  const width = curve(V.width), sill = curve(V.sill), shoulder = curve(V.shoulder);
  const belt = curve(V.belt), hood = curve(V.hood), inset = curve(V.inset);
  const dome = V.dome ? curve(V.dome) : null;
  const lowerLine = V.lowerLine ? curve(V.lowerLine.y) : null;
  const tipF = curve(V.nose.tip), tipR = curve(V.tail.tip);
  const archR = d.wheelRadius + V.arch.gap, archY = d.wheelRadius + V.arch.lift;
  const minTipF = Math.min(...V.nose.tip.map(p => p[1]));
  const maxTipR = Math.max(...V.tail.tip.map(p => p[1]));
  const Rf = Math.max(0.12, Math.min(V.nose.R, minTipF - (fa + archR) - 0.03));
  const Rr = Math.max(0.12, Math.min(V.tail.R, (ra - archR) - maxTipR - 0.03));
  const xMainF = minTipF - Rf, xMainR = maxTipR + Rr;
  const zLin = [d.trackF / 2 - d.tireWidth / 2 - 0.07, d.trackR / 2 - d.tireWidth / 2 - 0.07];

  const flare = (x, y) => {
    let a = 0;
    const A = V.arch.flare, w = V.arch.flareW;
    for (const ax of [fa, ra]) {
      const dd = Math.hypot(x - ax, Math.max(0, y - archY)) - archR;
      if (dd < 4 * w) a += A * Math.exp(-((Math.max(0, dd) / w) ** 2));
    }
    if (V.haunch) {
      const H = V.haunch;
      const fy = smoothstep(H.y0 - 0.12, H.y0 + 0.08, y) * (1 - smoothstep(H.y1 - 0.08, H.y1 + 0.01, y));
      a += H.A * Math.exp(-(((x - ra) / H.wx) ** 2)) * fy;
    }
    return a;
  };
  const topY = (x, z, zb, yB, yT) => {
    const u = zb > 1e-6 ? clamp(z / zb, 0, 1) : 0;
    let y = yT + (yB - yT) * u * u;
    if (dome) y += dome(x) * Math.exp(-((z / (V.domeW || 0.26)) ** 2));
    return y;
  };

  // half cross-section at station x: NS points [z, y] from bottom centre to top centre
  const section = (x, archMode = null) => {
    const W = width(x), yS = sill(x);
    const yF = Math.max(V.floor, yS - 0.05);
    let well = null;
    for (let k = 0; k < 2; k++) {
      const dx = x - (k === 0 ? fa : ra), adx = Math.abs(dx);
      if (adx < archR - 1e-6 || (adx <= archR + 1e-6 && archMode === 'in')) {
        well = { yW: archY + Math.sqrt(Math.max(0, archR * archR - dx * dx)), zL: zLin[k] };
      }
    }
    const zL = Math.min(well ? well.zL : zLin[x > 0 ? 0 : 1], W - 0.12);
    const yE = well ? well.yW : yS;
    const ySh = Math.max(shoulder(x), yE + 0.05);
    const yB = Math.max(belt(x), ySh + 0.03);
    const yT = hood(x), ins = inset(x);
    const tuckH = Math.max(0.05, ySh - yS);
    // optional lower character line: the door surface below it is recessed
    const y0 = yE + 0.022;
    const yL = lowerLine && !well ? lowerLine(x) : null;
    const lineOn = yL !== null && yL > y0 + 0.03 && yL < ySh - 0.12;
    const side = (y) => W - V.tuck * Math.pow(clamp((ySh - y) / tuckH, 0, 1), 2) + flare(x, y)
      - (lineOn ? V.lowerLine.d * smoothstep(yL - 0.003, yL - 0.035, y) : 0);
    const s = new Array(NS);
    s[0] = [0, yF];
    s[1] = [zL, yF];
    if (well) { s[2] = [zL, well.yW - 0.02]; s[3] = [side(yE) - 0.03, yE]; }
    else { s[2] = [zL, yF]; s[3] = [W - V.tuck - 0.025, yS - 0.008]; }
    s[4] = [side(yE) - 0.012, yE];
    s[5] = [side(y0) - 0.002, y0];
    const fr = [0.15, 0.32, 0.5, 0.66, 0.8, 0.91];
    for (let k = 0; k < NSIDE; k++) {
      let y = y0 + (ySh - y0) * fr[k];
      if (lineOn) y = k === 0 ? yL - 0.03 : k === 1 ? yL : yL + (ySh - yL) * [0, 0, 0.22, 0.46, 0.7, 0.88][k];
      s[SIDE0 + k] = [side(y), y];
    }
    s[CREASE] = [side(ySh) + V.crease, ySh];
    s[CREASE + 1] = [W - 0.006 + flare(x, ySh) * 0.5, ySh + 0.012];
    s[CREASE + 2] = [W - ins * 0.55, ySh + (yB - ySh) * 0.62];
    const zb = W - ins;
    s[BELT] = [zb, yB];
    const tf = [0.86, 0.7, 0.52, 0.33, 0.15, 0];
    for (let k = 0; k < 6; k++) { const z = zb * tf[k]; s[BELT + 1 + k] = [z, topY(x, z, zb, yB, yT)]; }
    return s;
  };
  const topAt = (x, z) => { const s = section(x); return topY(x, z, s[BELT][0], s[BELT][1], hood(x)); };
  const beltAt = (x) => section(x)[BELT]; // [z, y] of the belt edge

  // rings, tail tip -> nose tip
  const ringNose = (t, front) => {
    const pts = [];
    const n = front ? V.nose.n : V.tail.n;
    for (let j = 0; j < NS; j++) {
      let x = front ? xMainF : xMainR, s;
      for (let it = 0; it < 3; it++) {
        s = section(x)[j];
        x = front ? tipF(s[1]) - Rf + Rf * t : tipR(s[1]) + Rr - Rr * t;
      }
      s = section(x)[j];
      const xt = front ? tipF(s[1]) : tipR(s[1]);
      pts.push([front ? Math.min(x, xt) : Math.max(x, xt), s[1], s[0] * SE(t, n)]);
    }
    return { pts, end: front ? 1 : -1 };
  };
  const ringMain = (x, mode) => ({ pts: section(x, mode).map(([z, y]) => [x, y, z]), end: 0, mode });

  // station spacing: coarse along the straight doors, finer where the profiles curve
  const doors = x => x > ra + archR + 0.05 && x < fa - archR - 0.05;
  const step = x => (lod === 'low' ? 0.17 : 0.11) * (doors(x) ? 2 : 1);
  const K = lod === 'low' ? 8 : 12;
  const keys = [[xMainR, null], [xMainF, null]];
  for (const ax of [ra, fa]) {
    keys.push([ax - archR, 'out'], [ax - archR, 'in']);
    for (let k = 1; k < K; k++) keys.push([ax - archR * Math.cos(Math.PI * k / K), null]);
    keys.push([ax + archR, 'in'], [ax + archR, 'out']);
  }
  const g = V.gh;
  const fixed = keys.length;
  for (const gx of [g.xA, g.cowl, g.xC, g.deck]) keys.push([gx, null]);
  // drop optional stations that sit on top of another one
  const opt = keys.slice(fixed).filter(([x]) => keys.slice(0, fixed).every(([y]) => Math.abs(x - y) > 0.02));
  const st = [...keys.slice(0, fixed), ...opt].sort((a, b) => a[0] - b[0]);
  const stations = [];
  for (let i = 0; i < st.length; i++) {
    stations.push(st[i]);
    const nx = st[i + 1];
    if (!nx) break;
    const gap = nx[0] - st[i][0], h = step((nx[0] + st[i][0]) / 2);
    if (gap > h) {
      const n = Math.ceil(gap / h);
      for (let k = 1; k < n; k++) stations.push([st[i][0] + gap * k / n, null]);
    }
  }
  const rings = [];
  const Kn = lod === 'low' ? 7 : 11, Kt = lod === 'low' ? 6 : 9;
  for (let k = Kt; k >= 1; k--) rings.push(ringNose(Math.sin(Math.PI / 2 * k / Kt), false));
  for (const [x, mode] of stations) rings.push(ringMain(x, mode));
  for (let k = 1; k <= Kn; k++) rings.push(ringNose(Math.sin(Math.PI / 2 * k / Kn), true));

  return { V, d, fa, ra, archR, archY, section, topAt, beltAt, rings, hood, lod };
}

// ------------------------------------------------------------------ lower body loft
function buildLoft(B, S) {
  const { V, rings, fa, ra, archR } = S;
  const g = V.gh;
  const zA = S.beltAt(g.xA)[0], zC = S.beltAt(g.xC)[0];
  const inCabin = (x, z) => {
    const cowlX = g.cowl + (g.xA - g.cowl) * Math.min(1, (z / zA) ** 2);
    const deckX = g.deck + (g.xC - g.deck) * Math.min(1, (z / zC) ** 2);
    return x < cowlX - 0.004 && x > deckX + 0.004;
  };
  const low = V.lower;
  // Grille openings: skin quads lying wholly inside a grille outline (in its view) are
  // given the grille slot, so there is no painted shell under the grille decal that a
  // few mm of crush could push through it.
  const PROJ = { f: p => [p[2], p[1]], r: p => [p[2], p[1]], t: p => [p[0], p[2]], s: p => [p[0], p[1]] };
  const AXIS = { f: 0, r: 0, t: 1, s: 2 };
  const openings = [];
  for (const e of V.details) {
    if (e.t !== 'fill' || e.m !== 'grille' || ![...e.top, ...e.bot].every(p => !p[2])) continue;
    const poly = [...e.top, ...[...e.bot].reverse()].map(p => [p[0], p[1]]);
    openings.push({ v: e.v, poly });
    if (e.mir) openings.push({ v: e.v, poly: poly.map(([a, b]) => (e.v === 't' ? [a, -b] : [-a, b])) });
  }
  const inPoly = (poly, a, b) => {
    let inside = false;
    for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
      const [ai, bi] = poly[i], [ak, bk] = poly[k];
      if ((bi > b) !== (bk > b) && a < ai + (ak - ai) * (b - bi) / (bk - bi)) inside = !inside;
    }
    return inside;
  };
  const inOpening = (q) => {
    if (!openings.length) return false;
    const n = norm(cross(sub(q[2], q[0]), sub(q[1], q[0])));
    const c = scl(add(add(q[0], q[1]), add(q[2], q[3])), 0.25);
    return openings.some(({ v, poly }) => {
      if (Math.abs(n[AXIS[v]]) < (v === 't' ? 0.5 : 0.25)) return false;
      if ((v === 'f' && c[0] < fa) || (v === 'r' && c[0] > ra) || (v === 't' && c[1] < 0.45)) return false;
      return q.every(p => { const [a, b] = PROJ[v](p); return inPoly(poly, a, b); });
    });
  };
  const mat = (r, j) => {
    if (j <= 3) return C.PLASTIC;
    const A = rings[r].pts, Bp = rings[r + 1].pts;
    const q = [A[j], A[j + 1], Bp[j], Bp[j + 1]];
    if (j < CREASE) {
      // black lower bumper (lip / diffuser) only on the rounded nose and tail caps
      const end = rings[r].end || rings[r + 1].end;
      const yc = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
      const lim = end > 0 ? low.front : end < 0 ? low.rear : low.side;
      if (inOpening(q)) return C.GRILLE;
      return yc < lim ? C.PLASTIC : C.PAINT;
    }
    if (j >= BELT && q.every(p => inCabin(p[0], p[2]))) return C.INTERIOR;
    if (inOpening(q)) return C.GRILLE;
    return C.PAINT;
  };
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < NS - 1; j++) {
      const m = mat(r, j);
      for (const side of [1, -1]) {
        const vid = (rr, jj) => {
          const p = rings[rr].pts[jj];
          const s = Math.abs(p[2]) < 1e-7 ? 0 : side;
          return B.kv(`L${rr}:${jj}:${s}:${m}`, p[0], p[1], p[2] * side);
        };
        const a = vid(r, j), b = vid(r + 1, j), c = vid(r + 1, j + 1), dd = vid(r, j + 1);
        const surf = m !== C.INTERIOR;
        if (side > 0) { B.tri(m, a, b, c, null, surf); B.tri(m, a, c, dd, null, surf); }
        else { B.tri(m, a, c, b, null, surf); B.tri(m, a, dd, c, null, surf); }
      }
    }
  }
}

// ------------------------------------------------------------------ greenhouse
function buildGreenhouse(B, S) {
  const { V, d, lod } = S;
  const g = V.gh, rf = g.roof, H = d.height;
  const soft = !!g.soft;
  const xm = (rf.xf + rf.xr) / 2, hl = (rf.xf - rf.xr) / 2;
  const drop = rf.drop ?? 0.02;
  // optional rearDrop: the roof falls away behind its middle (fabric top over the bows)
  const roofY = (x, z) => H - (H - rf.edge) * (z / rf.z) ** 2 - drop * ((x - xm) / hl) ** 2 - (rf.rearDrop || 0) * Math.max(0, (xm - x) / hl) ** 2;
  const zA = S.beltAt(g.xA)[0], zC = S.beltAt(g.xC)[0];
  const baseFront = f => { const x = g.cowl + (g.xA - g.cowl) * f * f, z = zA * f; return [x, S.topAt(x, z) + 0.003, z]; };
  const topFront = f => { const x = rf.xfc + (rf.xf - rf.xfc) * f * f, z = rf.z * f; return [x, roofY(x, z), z]; };
  const baseRear = f => { const x = g.deck + (g.xC - g.deck) * f * f, z = zC * f; return [x, S.topAt(x, z) + 0.003, z]; };
  const topRear = f => { const x = rf.xrc + (rf.xr - rf.xrc) * f * f, z = rf.z * f; return [x, roofY(x, z), z]; };
  const baseSide = x => { const [z, y] = S.beltAt(x); return [x, y + 0.003, z]; };
  const topSide = x => [x, roofY(x, rf.z), rf.z];

  const FR = lod === 'low' ? [0, 0.3, 0.6, 0.85, 0.955, 0.985] : [0, 0.17, 0.34, 0.51, 0.67, 0.81, 0.92, 0.955, 0.985];
  const samples = [];
  // windshield / backlight curvature fades into the pillars so the corners stay clean
  const taper = (b, f) => g.bulge.side + (b - g.bulge.side) * (1 - smoothstep(0.6, 1, f));
  for (const f of FR) samples.push({ B: baseFront(f), T: topFront(f), seg: 'front', f, kind: f < 0.95 ? 'ws' : f < 0.98 ? 'frit' : 'bevelA', bulge: taper(g.bulge.front, f) });
  const L = g.lines;
  for (let i = 0; i < L.length; i++) {
    const [xb, xt, kind] = L[i];
    if (kind === null) { samples.push({ B: baseSide(xb), T: topSide(xt), seg: 'side', f: 1, kind: 'bevelC', bulge: g.bulge.side }); break; }
    const [nxb, nxt] = L[i + 1];
    const span = xb - nxb;
    const n = kind === 'glass' || kind === 'soft' || (kind === 'paint' && span > 0.3) ? Math.max(1, Math.round(span / (lod === 'low' ? 0.45 : 0.22))) : 1;
    for (let k = 0; k < n; k++) {
      const t = k / n, bx = xb + (nxb - xb) * t, tx = xt + (nxt - xt) * t;
      samples.push({ B: baseSide(bx), T: topSide(tx), seg: 'side', f: (g.xA - bx) / (g.xA - g.xC), kind, bulge: g.bulge.side });
    }
  }
  for (const f of [...FR].reverse()) {
    let kind = f >= 0.98 ? 'frit' : 'rg';
    if (soft) kind = f >= 0.6 ? 'soft' : 'rgSoft';
    samples.push({ B: baseRear(f), T: topRear(f), seg: 'rear', f, kind, bulge: taper(g.bulge.rear, f) });
  }

  const [vb, vt] = g.bands;
  const VL = lod === 'low' ? [0, vb, 0.3, 0.78, vt, 1] : [0, vb, 0.3, 0.55, 0.78, vt, 1];
  const RL = lod === 'low' ? [0.5, 1] : [0.3, 0.6, 0.85, 1];
  const levels = [...VL, ...RL.map(w => 1 + w)];

  // outward directions and grid points (right half)
  const ns = samples.length;
  const pts = samples.map((s, i) => {
    const prev = samples[Math.max(0, i - 1)].B, next = samples[Math.min(ns - 1, i + 1)].B;
    let tan = sub(next, prev);
    if (i === 0) tan = [0, 0, 1];
    if (i === ns - 1) tan = [0, 0, -1];
    const up = sub(s.T, s.B);
    const out = norm(cross(up, tan));
    s.out = out;
    return levels.map(v => {
      if (v <= 1) {
        const p = lerp3(s.B, s.T, v);
        const b = s.bulge * 4 * v * (1 - v);
        return add(p, scl(out, b));
      }
      const w = v - 1;
      const cx = clamp(s.T[0], rf.xr + 0.1, rf.xf - 0.1);
      const x = s.T[0] + (cx - s.T[0]) * w, z = s.T[2] * (1 - w);
      return [x, roofY(x, z), z];
    });
  });

  const trimBelt = SLOT[g.belt], trimFrame = SLOT[g.frame];
  const matOf = (kind, vlo, vhi, sideSign) => {
    if (vlo >= 1 - 1e-9) return [soft ? C.SOFT : C.PAINT];
    const band = vhi <= vb + 1e-9 ? 0 : vlo >= vt - 1e-9 ? 2 : 1;
    switch (kind) {
      case 'ws': return band === 0 ? [C.PLASTIC] : band === 2 ? [C.TRIM] : [C.GLASS, 'windshield'];
      case 'frit': return [soft && band !== 1 ? C.SOFT : band === 0 ? C.PLASTIC : C.TRIM];
      case 'bevelA': case 'paint': return [C.PAINT];
      case 'glass': return band === 0 ? [trimBelt] : band === 2 ? [trimFrame] : [C.GLASS, sideSign > 0 ? 'rightGlass' : 'leftGlass'];
      case 'black': return [band === 0 ? trimBelt : C.TRIM];
      case 'soft': return [C.SOFT];
      case 'bevelC': return [soft ? C.SOFT : C.PAINT];
      case 'rg': return band === 1 ? [C.GLASS, 'rearGlass'] : [C.TRIM];
      case 'rgSoft': return vlo >= 0.28 && vhi <= 0.8 ? [C.GLASS, 'rearGlass'] : [C.SOFT];
    }
    return [C.PAINT];
  };
  const uvOf = (i, j, side) => {
    const s = samples[i], v = clamp((levels[j] - vb) / (vt - vb), 0, 1);
    if (s.seg === 'side') return [s.f, v];
    if (s.seg === 'rear' && soft) return [0.5 + 0.5 * s.f / 0.6 * side, clamp((levels[j] - 0.3) / 0.48, 0, 1)];
    return [0.5 + 0.5 * s.f * side, v];
  };
  for (let i = 0; i < ns - 1; i++) {
    const kind = samples[i].kind;
    for (let j = 0; j < levels.length - 1; j++) {
      for (const side of [1, -1]) {
        const [m, panel] = matOf(kind, levels[j], levels[j + 1], side);
        const vid = (ii, jj) => {
          const p = pts[ii][jj];
          const s = Math.abs(p[2]) < 1e-7 ? 0 : side;
          const uv = m === C.GLASS ? uvOf(ii, jj, side) : [0, 0];
          return B.kv(`G${ii}:${jj}:${s}:${m}:${panel || ''}`, p[0], p[1], p[2] * side, uv[0], uv[1]);
        };
        const nref = levels[j] >= 1 ? [0, 1, 0] : (() => { const o = samples[i].out, o2 = samples[i + 1].out; return [o[0] + o2[0], o[1] + o2[1], (o[2] + o2[2]) * side]; })();
        const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), dd = vid(i, j + 1);
        B.tri(m, a, b, c, panel, true, nref);
        B.tri(m, a, c, dd, panel, true, nref);
      }
    }
  }
  return { roofY, samples };
}

// ------------------------------------------------------------------ surface queries
class Surface {
  constructor(B) {
    const P = B.pos, T = B.surf;
    this.P = P; this.T = T;
    const nv = P.length / 3;
    const N = new Float64Array(nv * 3);
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const n = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
      for (const i of [a, b, c]) { N[i] += n[0]; N[i + 1] += n[1]; N[i + 2] += n[2]; }
    }
    // merge normals of coincident vertices (material seams)
    const acc = new Map();
    const key = i => `${Math.round(P[i * 3] * 2e4)},${Math.round(P[i * 3 + 1] * 2e4)},${Math.round(P[i * 3 + 2] * 2e4)}`;
    for (let i = 0; i < nv; i++) {
      const k = key(i); const a = acc.get(k);
      if (a) { a[0] += N[i * 3]; a[1] += N[i * 3 + 1]; a[2] += N[i * 3 + 2]; } else acc.set(k, [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]);
    }
    for (let i = 0; i < nv; i++) { const a = norm(acc.get(key(i))); N[i * 3] = a[0]; N[i * 3 + 1] = a[1]; N[i * 3 + 2] = a[2]; }
    this.N = N;
    // uniform grid for closest-point queries
    const h = this.h = 0.08;
    const cells = this.cells = new Map();
    this.box = [];
    for (let t = 0; t < T.length; t += 3) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const i = T[t + k] * 3;
        x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]);
        y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]);
        z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]);
      }
      this.box.push([x0, y0, z0, x1, y1, z1]);
      for (let ix = Math.floor(x0 / h); ix <= Math.floor(x1 / h); ix++)
        for (let iy = Math.floor(y0 / h); iy <= Math.floor(y1 / h); iy++)
          for (let iz = Math.floor(z0 / h); iz <= Math.floor(z1 / h); iz++) {
            const ck = this.ck(ix, iy, iz);
            let l = cells.get(ck); if (!l) cells.set(ck, l = []);
            l.push(t);
          }
    }
  }
  ck(ix, iy, iz) { return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512); }
  vtx(i) { return [this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2]]; }
  nrm(i) { return [this.N[i * 3], this.N[i * 3 + 1], this.N[i * 3 + 2]]; }
  interp(t, u, v, w) {
    const T = this.T;
    const a = T[t], b = T[t + 1], c = T[t + 2];
    const p = add(add(scl(this.vtx(a), u), scl(this.vtx(b), v)), scl(this.vtx(c), w));
    const n = norm(add(add(scl(this.nrm(a), u), scl(this.nrm(b), v)), scl(this.nrm(c), w)));
    return { p, n, tri: [a, b, c] };
  }
  // a skin vertex at the mirror image (z -> -z) of vertex i, or -1
  mirror(i) {
    if (!this.mir) {
      this.mir = new Map();
      for (const k of this.T) this.mir.set(this.pkey(this.P[k * 3], this.P[k * 3 + 1], this.P[k * 3 + 2]), k);
    }
    const j = this.mir.get(this.pkey(this.P[i * 3], this.P[i * 3 + 1], -this.P[i * 3 + 2]));
    return j === undefined ? -1 : j;
  }
  pkey(x, y, z) { return `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5) || 0}`; }
  // nearest hit along a ray (Moller-Trumbore), or null
  raycast(o, dir, far = false) {
    const T = this.T;
    let best = null, bestT = far ? -Infinity : Infinity;
    for (let t = 0, k = 0; t < T.length; t += 3, k++) {
      const bx = this.box[k];
      // cheap slab reject on the two axes perpendicular to an axis-aligned ray
      if (dir[0] === 0 && (o[0] < bx[0] - 1e-4 || o[0] > bx[3] + 1e-4)) continue;
      if (dir[1] === 0 && (o[1] < bx[1] - 1e-4 || o[1] > bx[4] + 1e-4)) continue;
      if (dir[2] === 0 && (o[2] < bx[2] - 1e-4 || o[2] > bx[5] + 1e-4)) continue;
      const A = this.vtx(T[t]), Bv = this.vtx(T[t + 1]), Cv = this.vtx(T[t + 2]);
      const e1 = sub(Bv, A), e2 = sub(Cv, A);
      const p = cross(dir, e2);
      const det = dot(e1, p);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, s = sub(o, A);
      const u = dot(s, p) * inv;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      const q = cross(s, e1);
      const v = dot(dir, q) * inv;
      if (v < -1e-6 || u + v > 1 + 1e-6) continue;
      const tt = dot(e2, q) * inv;
      if (tt <= 0) continue;
      if (far ? tt > bestT : tt < bestT) { bestT = tt; best = { t, u: 1 - u - v, v: u, w: v }; }
    }
    return best ? this.interp(best.t, best.u, best.v, best.w) : null;
  }
  closest(p) {
    const h = this.h, T = this.T;
    const ix = Math.floor(p[0] / h), iy = Math.floor(p[1] / h), iz = Math.floor(p[2] / h);
    let best = null, bestD = Infinity;
    for (let r = 1; r <= 3 && !best; r++) {
      const seen = new Set();
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
        const l = this.cells.get(this.ck(ix + a, iy + b, iz + c));
        if (!l) continue;
        for (const t of l) {
          if (seen.has(t)) continue;
          seen.add(t);
          const bc = closestOnTri(p, this.vtx(T[t]), this.vtx(T[t + 1]), this.vtx(T[t + 2]));
          if (bc.d < bestD) { bestD = bc.d; best = { t, bc }; }
        }
      }
    }
    if (!best) return { p: p.slice(), n: [0, 1, 0] };
    return this.interp(best.t, best.bc.u, best.bc.v, best.bc.w);
  }
}

function closestOnTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const res = (u, v, w) => { const q = add(add(scl(a, u), scl(b, v)), scl(c, w)); const dd = sub(p, q); return { u, v, w, d: dot(dd, dd) }; };
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return res(1, 0, 0);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return res(0, 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return res(1 - v, v, 0); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return res(0, 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return res(1 - w, 0, w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return res(0, 1 - w, w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return res(1 - v - w, v, w);
}

// ------------------------------------------------------------------ decals & solids
function makeDetailKit(S, surf) {
  const xF = S.d.length / 2;
  const RAY = {
    f: (a, b) => [[6, b, a], [-1, 0, 0]],
    r: (a, b) => [[-6, b, a], [1, 0, 0]],
    s: (a, b) => [[a, b, 4], [0, 0, -1]],
    t: (a, b) => [[a, 4, b], [0, -1, 0]],
  };
  const FALLBACK = { f: (a, b) => [xF, b, a], r: (a, b) => [-xF, b, a], s: (a, b) => [a, b, 1], t: (a, b) => [a, 1, b] };
  const anchor = (view, pt) => {
    const v = pt[2] || view;
    const [o, dir] = RAY[v](pt[0], pt[1]);
    const hit = surf.raycast(o, dir);
    return hit ? hit.p : surf.closest(FALLBACK[v](pt[0], pt[1])).p;
  };
  const resample = (pts, n) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
    const L = cum[cum.length - 1], out = [];
    for (let k = 0; k < n; k++) {
      const s = n === 1 ? 0 : L * k / (n - 1);
      let i = 1;
      while (i < pts.length - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1];
      out.push(lerp3(pts[i - 1], pts[i], seg > 0 ? (s - cum[i - 1]) / seg : 0));
    }
    return out;
  };
  const plen = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += len(sub(pts[i], pts[i - 1])); return l; };
  const snap = (p) => surf.closest(p);
  const offK = S.lod === 'low' ? 1.5 : 1;
  const off = (s, o) => { const p = add(s.p, scl(s.n, o * offK)); p.tri = s.tri; return p; };
  const centroid = pts => scl(pts.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / pts.length);
  const coarse = S.lod === 'low';

  // ruled patch between two chains; returns the snapped outline loop
  const fill = (part, e, slot) => {
    const top = e.top.map(p => anchor(e.v, p)), bot = e.bot.map(p => anchor(e.v, p));
    const W = Math.max(plen(top), plen(bot));
    const k = e.uv ? 1.3 : 1;
    const cols = clamp(Math.ceil(W / ((coarse ? 0.05 : 0.04) * k)), 1, 26);
    const T = resample(top, cols + 1), Bt = resample(bot, cols + 1);
    // rows from the tallest column (outlines that pinch to a point at the ends, like the
    // Audi grille, must not average down to a 2-row patch that the curved skin bulges
    // through); short spans keep the decal on the surface
    let Hmax = 0;
    for (let c = 0; c <= cols; c++) Hmax = Math.max(Hmax, len(sub(T[c], Bt[c])));
    const rows = clamp(Math.ceil(Hmax / (coarse ? 0.075 : 0.05)), 1, 12);
    // texture scale (slat / mesh pitch) as the outlines were tuned for
    const Hh = (len(sub(top[0], bot[0])) + len(sub(top[top.length - 1], bot[bot.length - 1])) + len(sub(top[top.length >> 1], bot[bot.length >> 1]))) / 3;
    const grid = [];
    for (let r = 0; r <= rows; r++) {
      const row = [];
      for (let c = 0; c <= cols; c++) {
        const s = snap(lerp3(T[c], Bt[c], r / rows));
        let u = c / cols, v = 1 - r / rows;
        if (e.uv) { u *= W / e.uv; v *= Hh / e.uv; }
        row.push({ s, i: part.add(off(s, e.off ?? 0.004), u, v) });
      }
      grid.push(row);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = grid[r][c], b = grid[r][c + 1], cc = grid[r + 1][c + 1], dd = grid[r + 1][c];
      part.quad(slot, a.i, b.i, cc.i, dd.i, norm(add(a.s.n, cc.s.n)));
    }
    // outline loop (surface samples, not offset)
    const loop = [...grid[0].map(g => g.s)];
    for (let r = 1; r <= rows; r++) loop.push(grid[r][cols].s);
    for (let c = cols - 1; c >= 0; c--) loop.push(grid[rows][c].s);
    for (let r = rows - 1; r >= 1; r--) loop.push(grid[r][0].s);
    return loop.filter((s, i) => len(sub(s.p, loop[(i + 1) % loop.length].p)) > 1e-4);
  };
  // frame around a loop, widened outward
  const ring = (part, loop, w, o, slot) => {
    const n = loop.length, ctr = centroid(loop.map(s => s.p));
    const inner = [], outer = [];
    for (let i = 0; i < n; i++) {
      const s = loop[i], tan = sub(loop[(i + 1) % n].p, loop[(i - 1 + n) % n].p);
      let side = norm(cross(s.n, tan));
      if (dot(side, sub(s.p, ctr)) < 0) side = scl(side, -1);
      inner.push(part.add(off(s, o)));
      outer.push(part.add(off(snap(add(s.p, scl(side, w))), o)));
    }
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      part.quad(slot, inner[i], inner[k], outer[k], outer[i], loop[i].n);
    }
  };
  // side wall of a raised decal (bezel / lens edge)
  const wall = (part, loop, o0, o1, slot) => {
    const n = loop.length, ctr = centroid(loop.map(s => s.p));
    const lo = loop.map(s => part.add(off(s, o0))), hi = loop.map(s => part.add(off(s, o1)));
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      part.quad(slot, lo[i], lo[k], hi[k], hi[i], sub(loop[i].p, ctr));
    }
  };
  // strip along a polyline
  const line = (part, e, slot) => {
    let pts;
    if (e.circle) {
      const [a, b, r] = e.circle, n = coarse ? 10 : 16;
      pts = [];
      for (let k = 0; k <= n; k++) { const t = 2 * Math.PI * k / n; pts.push(anchor(e.v, [a + Math.cos(t) * r, b + Math.sin(t) * r])); }
    } else pts = e.p.map(p => anchor(e.v, p));
    const L = plen(pts);
    const n = e.circle ? (coarse ? 11 : 17) : clamp(Math.ceil(L / ((coarse ? 0.06 : 0.035) * (e.m === 'gap' ? 1.7 : 1))) + 1, 2, 60);
    const P = resample(pts, n).map(snap);
    const w = e.w / 2, o = e.off ?? 0.002;
    let prevL = -1, prevR = -1;
    for (let i = 0; i < n; i++) {
      const tan = sub(P[Math.min(n - 1, i + 1)].p, P[Math.max(0, i - 1)].p);
      const side = norm(cross(P[i].n, tan));
      const l = part.add(off(snap(add(P[i].p, scl(side, w))), o)), r = part.add(off(snap(add(P[i].p, scl(side, -w))), o));
      if (prevL >= 0) part.quad(slot, prevL, l, r, prevR, P[i].n);
      prevL = l; prevR = r;
    }
  };
  const disc = (part, e, slot) => {
    const [a, b] = e.c, n = coarse || e.r < 0.015 ? 8 : 12;
    const c = snap(anchor(e.v, e.c));
    const ci = part.add(off(c, e.off ?? 0.005), 0.5, 0.5);
    const ring2 = [];
    for (let k = 0; k < n; k++) {
      const t = 2 * Math.PI * k / n;
      const s = snap(anchor(e.v, [a + Math.cos(t) * e.r, b + Math.sin(t) * e.r]));
      ring2.push(part.add(off(s, e.off ?? 0.005), 0.5 + 0.5 * Math.cos(t), 0.5 + 0.5 * Math.sin(t)));
    }
    for (let k = 0; k < n; k++) part.tri(slot, ci, ring2[k], ring2[(k + 1) % n], c.n);
  };
  return { anchor, snap, fill, ring, wall, line, disc, off, resample };
}

// superellipsoid solid; frame X,Y,Z (unit vectors), half sizes a,b,c; deform(local)->local
function blob(part, c, X, Y, Z, a, b, cz, e1, e2, nu, nv, slotFn, deform) {
  const sp = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
  const grid = [];
  for (let j = 0; j <= nv; j++) {
    const v = -Math.PI / 2 + Math.PI * j / nv, cv = Math.cos(v), sv = Math.sin(v);
    const row = [];
    for (let i = 0; i < nu; i++) {
      const u = -Math.PI + 2 * Math.PI * i / nu;
      let l = [a * sp(cv, e1) * sp(Math.cos(u), e2), b * sp(sv, e1), cz * sp(cv, e1) * sp(Math.sin(u), e2)];
      let tag = 0;
      if (deform) { const r = deform(l); l = r.l; tag = r.tag || 0; }
      const p = add(c, add(add(scl(X, l[0]), scl(Y, l[1])), scl(Z, l[2])));
      row.push({ i: part.add(p), p, tag, l });
    }
    grid.push(row);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const k = (i + 1) % nu;
    const q = [grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i]];
    const mid = scl(add(add(q[0].p, q[1].p), add(q[2].p, q[3].p)), 0.25);
    const slot = slotFn ? slotFn(q) : C.TRIM;
    part.quad(slot, q[0].i, q[1].i, q[2].i, q[3].i, sub(mid, c));
  }
}

function buildDetails(B, S, surf) {
  const V = S.V, kit = makeDetailKit(S, surf);
  const hi = S.lod !== 'low';
  for (const e of V.details) {
    if (!hi && (e.m === 'gap' || (e.t === 'line' && e.m === 'plastic') || e.t === 'fin')) continue;
    const part = new Part();
    const slot = SLOT[e.m] ?? C.TRIM;
    switch (e.t) {
      case 'fill': {
        const loop = kit.fill(part, e, slot);
        if (e.ring) kit.ring(part, loop, e.ring.w, e.ring.off ?? (e.off ?? 0.004) + 0.002, SLOT[e.ring.m]);
        if (e.wall && hi) kit.wall(part, loop, 0.0005, e.off ?? 0.009, SLOT[e.wall]);
        break;
      }
      case 'line': kit.line(part, e, slot); break;
      case 'disc': kit.disc(part, e, slot); break;
      case 'plate': {
        const [z, y] = e.c, w = 0.305 / 2, h = 0.152 / 2, f = e.v === 'f' ? -1 : 1;
        const pe = { v: e.v, off: 0.009, top: [[z - w * f, y + h], [z + w * f, y + h]], bot: [[z - w * f, y - h], [z + w * f, y - h]] };
        const loop = kit.fill(part, pe, C.PLATE);
        kit.ring(part, loop, 0.01, 0.0075, C.TRIM);
        if (hi) kit.wall(part, loop, 0.0005, 0.0075, C.TRIM);
        break;
      }
      case 'mirror': buildMirror(part, S, kit, e); break;
      case 'handle': {
        const s = kit.snap(kit.anchor('s', e.c));
        const Z = s.n, X = norm(cross([0, 1, 0], Z)), Y = norm(cross(Z, X));
        blob(part, kit.off(s, 0.006), scl(X, -1), Y, Z, 0.085, 0.017, 0.012, 0.35, 0.3, 8, 4, () => slot);
        break;
      }
      case 'exhaust': buildExhaust(part, S, kit, e); break;
      case 'fin': {
        const s = kit.snap(kit.anchor('t', [e.x, 0]));
        blob(part, add(s.p, [0, 0.002, 0]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.09, 0.055, 0.022, 0.5, 0.6, 12, 6, () => slot, (l) => {
          const t = clamp((l[0] / 0.09 + 1) / 2, 0, 1); // 0 rear .. 1 front
          return { l: [l[0], Math.max(0, l[1]) * (1 - 0.75 * t), l[2] * (1 - 0.4 * t)] };
        });
        break;
      }
    }
    const both = e.side !== -1 && (e.mir || e.t === 'mirror' || e.t === 'handle');
    if (e.side === -1) emitPart(B, part, true, surf);
    else {
      emitPart(B, part, false, surf);
      if (both) emitPart(B, part, true, surf);
    }
  }
}

function buildMirror(part, S, kit, e) {
  const s = kit.snap(kit.anchor('s', e.c));
  const hz = norm([s.n[0] * 0.3, 0, Math.max(0.3, s.n[2])]);
  const X = [1, 0, 0], Y = [0, 1, 0];
  const hi = S.lod !== 'low';
  const arm = add(s.p, add(scl(hz, 0.045), [-0.015, -0.005, 0]));
  blob(part, arm, X, Y, hz, 0.045, 0.02, 0.055, 0.5, 0.5, hi ? 8 : 6, 3, () => C.TRIM);
  const ctr = add(s.p, add(scl(hz, 0.15), [-0.03, 0.035, 0]));
  const back = -0.022;
  blob(part, ctr, X, Y, hz, 0.058, 0.064, 0.115, 0.62, 0.55, hi ? 12 : 8, hi ? 7 : 5,
    q => (q.every(v => v.tag) ? C.TRIM : SLOT[e.m] ?? C.PAINT),
    l => (l[0] < back ? { l: [back, l[1] * 0.93, l[2] * 0.95], tag: 1 } : { l, tag: 0 }));
}

function buildExhaust(part, S, kit, e) {
  const s = kit.snap(kit.anchor('r', e.c));
  const r = e.r, rz = r * (e.oval || 1);
  const n = S.lod === 'low' ? 10 : 16;
  const x0 = s.p[0] + 0.07, x1 = s.p[0] - 0.018;
  const ringPts = (x, k, sh) => { const t = 2 * Math.PI * k / n; return [x, e.c[1] + Math.sin(t) * r * sh, e.c[0] + Math.cos(t) * rz * sh]; };
  const rows = [[x0, 1], [x1, 1], [x1 + 0.002, 0.86], [x1 + 0.04, 0.84]];
  const ids = rows.map(([x, sh]) => Array.from({ length: n }, (_, k) => part.add(ringPts(x, k, sh))));
  const ax = [e.c[1], e.c[0]];
  for (let rI = 0; rI < rows.length - 1; rI++) {
    const slot = rI < 2 ? C.CHROME : C.PLASTIC;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const t = 2 * Math.PI * (k + 0.5) / n;
      const radial = [0, Math.sin(t), Math.cos(t)];
      const nref = rI === 0 ? radial : rI === 1 ? [-1, 0, 0] : scl(radial, -1);
      part.quad(slot, ids[rI][k], ids[rI + 1][k], ids[rI + 1][k2], ids[rI][k2], nref);
    }
  }
  const cap = part.add([x1 + 0.04, ax[0], ax[1]]);
  for (let k = 0; k < n; k++) part.tri(C.PLASTIC, cap, ids[3][k], ids[3][(k + 1) % n], [-1, 0, 0]);
}

function buildInterior(B, S, gh) {
  const I = S.V.interior;
  if (!I || S.lod === 'low') return;
  const part = new Part();
  const shelf = x => S.topAt(x, 0);
  const g = S.V.gh;
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const lean = 0.22, Xl = [Math.cos(lean), Math.sin(lean), 0], Yl = [-Math.sin(lean), Math.cos(lean), 0];
  const box = () => C.INTERIOR;
  for (const sz of [-I.seatZ, I.seatZ]) {
    const y0 = shelf(I.seatX) - 0.12, h = (I.seatTop - y0) / 2;
    blob(part, [I.seatX, y0 + h, sz], Xl, Yl, Z, 0.06, h, 0.24, 0.35, 0.3, 8, 4, box);
    blob(part, [I.seatX - 0.035 - Math.sin(lean) * h, I.seatTop + 0.075, sz], Xl, Yl, Z, 0.045, 0.075, 0.125, 0.4, 0.4, 8, 4, box);
  }
  if (I.rearX) {
    const y0 = shelf(I.rearX) - 0.1, h = (I.rearTop - y0) / 2;
    blob(part, [I.rearX, y0 + h, 0], Xl, Yl, Z, 0.07, h, 0.62, 0.3, 0.25, 10, 4, box);
    for (const sz of [-0.4, 0.4]) blob(part, [I.rearX - 0.03 - Math.sin(lean) * h, I.rearTop + 0.06, sz], Xl, Yl, Z, 0.045, 0.065, 0.12, 0.4, 0.4, 8, 4, box);
  }
  // dashboard
  const [dx0, dx1, dy] = I.dash;
  const zb = S.beltAt((dx0 + dx1) / 2)[0];
  blob(part, [(dx0 + dx1) / 2, dy - 0.05, 0], X, Y, Z, (dx0 - dx1) / 2, 0.06, zb * 0.97, 0.3, 0.25, 10, 4, box);
  // steering wheel (torus facing the driver)
  const [wx, wy, wz] = I.wheel;
  const tilt = 1.1, Nw = [Math.cos(tilt), Math.sin(tilt), 0], U = [-Math.sin(tilt), Math.cos(tilt), 0];
  const R = 0.18, rr = 0.016, nu = 14, nv = 4;
  const ids = [];
  for (let i = 0; i < nu; i++) {
    const th = 2 * Math.PI * i / nu, row = [];
    const dir = add(scl(U, Math.cos(th)), scl(Z, Math.sin(th)));
    for (let j = 0; j < nv; j++) {
      const ph = 2 * Math.PI * j / nv;
      row.push(part.add(add([wx, wy, wz], add(scl(dir, R + rr * Math.cos(ph)), scl(Nw, rr * Math.sin(ph))))));
    }
    ids.push({ row, dir });
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const i2 = (i + 1) % nu, j2 = (j + 1) % nv;
    const ph = 2 * Math.PI * (j + 0.5) / nv;
    const nref = add(scl(ids[i].dir, Math.cos(ph)), scl(Nw, Math.sin(ph)));
    part.quad(C.INTERIOR, ids[i].row[j], ids[i2].row[j], ids[i2].row[j2], ids[i].row[j2], nref);
  }
  // rear-view mirror below the header
  const rx = g.roof.xfc + 0.05;
  blob(part, [rx, gh.roofY(rx, 0) - 0.075, 0], X, Y, Z, 0.018, 0.032, 0.11, 0.4, 0.4, 6, 3, () => C.TRIM);
  emitPart(B, part, false);
}

// ------------------------------------------------------------------ assembly
export function buildBodyMesh(spec, tpl, lod = 'high') {
  const S = makeShape(spec, lod);
  const B = new Builder();
  const stats = {};
  const mark = (k) => { stats[k] = B.pos.length / 3 - Object.values(stats).reduce((a, b) => a + b, 0); };
  buildLoft(B, S); mark('loft');
  const gh = buildGreenhouse(B, S); mark('greenhouse');
  const surf = new Surface(B);
  buildDetails(B, S, surf); mark('details');
  buildInterior(B, S, gh); mark('interior');
  stats.rings = S.rings.length;
  splitBySlot(B);

  const positions = new Float32Array(B.pos);
  const nv = positions.length / 3;
  const groups = [];
  const all = [];
  for (const s of SLOT_ORDER) {
    const start = all.length;
    if (s === C.GLASS) {
      const glass = {};
      for (const p of PANELS) { glass[p] = { start: all.length, count: B.glass[p].length }; for (const i of B.glass[p]) all.push(i); }
      groups.push({ start, count: all.length - start, slot: s });
      groups.glass = glass;
    } else {
      for (const i of B.idx[s]) all.push(i);
      groups.push({ start, count: all.length - start, slot: s });
    }
  }
  const indices = nv < 65536 ? Uint16Array.from(all) : Uint32Array.from(all);
  const binding = bindToLattice(positions, tpl);
  const glue = { v: Int32Array.from(B.glueV), w: Float32Array.from(B.glueW) };
  stats.glued = B.glueV.length / 4;
  return { positions, uvs: new Float32Array(B.uv), indices, groups, glass: groups.glass, binding, glue, vertexCount: nv, stats };
}

// Index-buffer order of the material slots. Slots the renderer may draw with one shared
// vertex-attribute material (see carmaterials.js BAKED) sit next to each other so their
// draw groups merge: textured slots first, then the clear-coated ones the high tier keeps
// separate, then the plain ones; interior (skipped on phones) last before the glass.
export const SLOT_ORDER = [C.PAINT, C.GRILLE, C.PLATE, C.TRIM, C.LAMP, C.TAIL, C.SOFT, C.PLASTIC,
  C.CHROME, C.AMBER, C.HEAD, C.TAILLED, C.INTERIOR, C.GLASS];

// Give every vertex a single material slot (solids such as mirrors and exhausts share
// vertices between slots), so per-slot vertex attributes are well defined.
function splitBySlot(B) {
  const owner = new Map(), dup = new Map();
  const claim = (v, s) => {
    const o = owner.get(v);
    if (o === undefined) { owner.set(v, s); return v; }
    if (o === s) return v;
    const k = v * 16 + s;
    let n = dup.get(k);
    if (n === undefined) {
      n = B.v(B.pos[v * 3], B.pos[v * 3 + 1], B.pos[v * 3 + 2], B.uv[v * 2], B.uv[v * 2 + 1]);
      dup.set(k, n);
      const g = B.glueOf.get(v);
      if (g !== undefined) {
        B.glueOf.set(n, B.glueV.length / 4);
        B.glueV.push(n, B.glueV[g * 4 + 1], B.glueV[g * 4 + 2], B.glueV[g * 4 + 3]);
        B.glueW.push(B.glueW[g * 3], B.glueW[g * 3 + 1], B.glueW[g * 3 + 2]);
      }
    }
    return n;
  };
  for (let s = 0; s < SLOT_COUNT; s++) {
    const list = s === C.GLASS ? PANELS.map(p => B.glass[p]) : [B.idx[s]];
    for (const l of list) for (let i = 0; i < l.length; i++) l[i] = claim(l[i], s);
  }
}

// --- tetrahedral binding ---
// Each vertex gets the four lattice nodes (out of its nine nearest) whose tetrahedron
// encloses it best; barycentric weights then carry it along with any deformation.
// Tetrahedron constants depend only on the node set, which neighbouring vertices share,
// so they are computed once per set.
function bindToLattice(positions, tpl) {
  const lat = tpl.groups.lattice;
  const NP = lat.length;
  const np = new Float64Array(NP * 3);
  lat.forEach((i, k) => { np[k * 3] = tpl.nodes[i].x; np[k * 3 + 1] = tpl.nodes[i].y; np[k * 3 + 2] = tpl.nodes[i].z; });
  const nv = positions.length / 3;
  const idx = new Int32Array(nv * 4);
  const wts = new Float32Array(nv * 4);
  const K = 9;
  const combos = [];
  for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) for (let c = b + 1; c < K; c++) for (let e = c + 1; e < K; e++) combos.push(a, b, c, e);
  const dist = new Float64Array(NP), order = new Int32Array(NP);
  const posCache = new Map(), setCache = new Map();
  const near = new Int32Array(K);
  const l2 = (a, b) => { const x = np[a] - np[b], y = np[a + 1] - np[b + 1], z = np[a + 2] - np[b + 2]; return x * x + y * y + z * z; };
  // per node set: [nodeA..D, Ax, Ay, Az, c23/det (3), c31/det (3), c12/det (3), quality] for each usable tetrahedron
  const tetsFor = () => {
    const key = near.join(',');
    let T = setCache.get(key);
    if (T) return T;
    T = [];
    for (let ci = 0; ci < combos.length; ci += 4) {
      const A = near[combos[ci]] * 3, Bn = near[combos[ci + 1]] * 3, Cn = near[combos[ci + 2]] * 3, D = near[combos[ci + 3]] * 3;
      const e1 = [np[Bn] - np[A], np[Bn + 1] - np[A + 1], np[Bn + 2] - np[A + 2]];
      const e2 = [np[Cn] - np[A], np[Cn + 1] - np[A + 1], np[Cn + 2] - np[A + 2]];
      const e3 = [np[D] - np[A], np[D + 1] - np[A + 1], np[D + 2] - np[A + 2]];
      const c23 = cross(e2, e3), c31 = cross(e3, e1), c12 = cross(e1, e2);
      const det = dot(e1, c23);
      const maxE2 = Math.max(l2(Bn, A), l2(Cn, A), l2(D, A), l2(Cn, Bn), l2(D, Bn), l2(D, Cn));
      const q = Math.abs(det) / Math.pow(maxE2, 1.5);
      if (q < 0.03) continue;
      const k = 1 / det;
      T.push([near[combos[ci]], near[combos[ci + 1]], near[combos[ci + 2]], near[combos[ci + 3]], np[A], np[A + 1], np[A + 2],
        c23[0] * k, c23[1] * k, c23[2] * k, c31[0] * k, c31[1] * k, c31[2] * k, c12[0] * k, c12[1] * k, c12[2] * k, q]);
    }
    setCache.set(key, T);
    return T;
  };
  for (let v = 0; v < nv; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const key = `${Math.round(px * 1e4)},${Math.round(py * 1e4)},${Math.round(pz * 1e4)}`;
    const hit = posCache.get(key);
    if (hit !== undefined) {
      for (let k = 0; k < 4; k++) { idx[v * 4 + k] = idx[hit * 4 + k]; wts[v * 4 + k] = wts[hit * 4 + k]; }
      continue;
    }
    posCache.set(key, v);
    for (let k = 0; k < NP; k++) {
      const dx = np[k * 3] - px, dy = np[k * 3 + 1] - py, dz = np[k * 3 + 2] - pz;
      dist[k] = dx * dx + dy * dy + dz * dz; order[k] = k;
    }
    // partial selection sort for the K nearest, then a canonical order for the set cache
    for (let i = 0; i < K; i++) {
      let m = i;
      for (let j = i + 1; j < NP; j++) if (dist[order[j]] < dist[order[m]]) m = j;
      const t = order[i]; order[i] = order[m]; order[m] = t;
      near[i] = order[i];
    }
    near.sort();
    let bestScore = -Infinity, best = null, bw = null;
    for (const t of tetsFor()) {
      const rx = px - t[4], ry = py - t[5], rz = pz - t[6];
      const b1 = rx * t[7] + ry * t[8] + rz * t[9];
      const b2 = rx * t[10] + ry * t[11] + rz * t[12];
      const b3 = rx * t[13] + ry * t[14] + rz * t[15];
      const b0 = 1 - b1 - b2 - b3;
      const score = Math.min(b0, b1, b2, b3) + t[16] * 0.3;
      if (score > bestScore) { bestScore = score; best = t; bw = [b0, b1, b2, b3]; }
    }
    if (!best) { best = [near[0], near[0], near[0], near[0]]; bw = [1, 0, 0, 0]; } // degenerate neighbourhood
    for (let k = 0; k < 4; k++) {
      idx[v * 4 + k] = lat[best[k]];
      wts[v * 4 + k] = bw[k];
    }
  }
  return { idx, wts };
}

// Deform: write positions for every vertex from the current node positions.
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

// Glue decal vertices (lights, grilles, plates, panel gaps, trim strips) to the deformed
// skin: each sits at fixed coordinates in the frame of the skin triangle it was snapped
// to (two edges + unit normal), so it keeps its few-mm offset above the paint however
// the panel crumples. Run after deformInto, on the same array.
export function glueInto(out, glue) {
  const V = glue.v, W = glue.w;
  for (let k = 0, j = 0; k < V.length; k += 4, j += 3) {
    const a = V[k + 1] * 3, b = V[k + 2] * 3, c = V[k + 3] * 3;
    const ax = out[a], ay = out[a + 1], az = out[a + 2];
    const e1x = out[b] - ax, e1y = out[b + 1] - ay, e1z = out[b + 2] - az;
    const e2x = out[c] - ax, e2y = out[c + 1] - ay, e2z = out[c + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-9) continue; // collapsed triangle: keep the skinned position
    const s = W[j], t = W[j + 1], h = W[j + 2] / l, v = V[k] * 3;
    out[v] = ax + s * e1x + t * e2x + h * nx;
    out[v + 1] = ay + s * e1y + t * e2y + h * ny;
    out[v + 2] = az + s * e1z + t * e2z + h * nz;
  }
}
