// Node–beam soft-body solver (XPBD, "small steps" variant: many substeps, one
// constraint pass each). Every vehicle is a lattice of point masses connected
// by beams that are elastic up to a yield strain, then deform plastically
// (their rest length changes permanently) and finally break.

import { aabbOverlap } from './colliders.js';

const GRAVITY = -9.81;
const MAX_SPEED = 160;
const GROUND_MU = 0.5; // metal on asphalt

export class SoftBody {
  constructor(tpl) {
    this.tpl = tpl;
    const n = tpl.nodes.length;
    const m = tpl.beams.length;
    this.n = n;
    this.x = new Float64Array(n * 3);
    this.p = new Float64Array(n * 3);
    this.v = new Float64Array(n * 3);
    this.a = new Float64Array(n * 3); // external acceleration, cleared every substep
    this.w = new Float64Array(n);
    this.mass = new Float64Array(n);
    this.r = new Float64Array(n);
    this.active = new Uint8Array(n);
    this.grounded = new Uint8Array(n);

    this.nb = m;
    this.ba = new Int32Array(m);
    this.bb = new Int32Array(m);
    this.rest = new Float64Array(m);
    this.rest0 = new Float64Array(m);
    this.comp = new Float64Array(m);
    this.yld = new Float64Array(m);
    this.brk = new Float64Array(m);
    this.cbrk = new Float64Array(m);
    this.dmp = new Float64Array(m);
    this.minR = new Float64Array(m);
    this.broken = new Uint8Array(m);
    for (let k = 0; k < m; k++) {
      const b = tpl.beams[k];
      this.ba[k] = b.a; this.bb[k] = b.b;
      this.comp[k] = 1 / b.k;
      this.yld[k] = b.yield;
      this.brk[k] = b.brk;
      this.cbrk[k] = b.cbrk ?? 10;
      this.dmp[k] = b.damp;
      this.minR[k] = b.minRatio ?? 0.18;
    }
    this.totalMass = 0;
    for (let i = 0; i < n; i++) {
      this.mass[i] = tpl.nodes[i].mass;
      this.r[i] = tpl.nodes[i].radius;
      this.totalMass += this.mass[i];
    }
    this.aabb = new Float64Array(6);
    this.near = [];
    this.plasticFrame = 0;   // metres of beam deformation this frame
    this.plasticTotal = 0;
    this.scrapes = [];       // spark candidates this frame
    this.contactFrame = 0;   // summed collision correction this frame (impacts)
    this.onSubstep = null;
    this.userData = null;
  }

  // Place the template in the world: local (x fwd, y up, z right) -> world.
  place(px, py, pz, heading, vx = 0, vy = 0, vz = 0) {
    const ch = Math.cos(heading), sh = Math.sin(heading);
    const nodes = this.tpl.nodes;
    for (let i = 0; i < this.n; i++) {
      const nd = nodes[i];
      const wx = px + nd.x * ch - nd.z * sh;
      const wy = py + nd.y;
      const wz = pz + nd.x * sh + nd.z * ch;
      this.x[i * 3] = wx; this.x[i * 3 + 1] = wy; this.x[i * 3 + 2] = wz;
      this.p[i * 3] = wx; this.p[i * 3 + 1] = wy; this.p[i * 3 + 2] = wz;
      this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
      this.a[i * 3] = this.a[i * 3 + 1] = this.a[i * 3 + 2] = 0;
      this.w[i] = 1 / this.mass[i];
      this.active[i] = 1;
    }
    for (let k = 0; k < this.nb; k++) {
      const b = this.tpl.beams[k];
      this.rest[k] = b.rest;
      this.rest0[k] = b.rest;
      this.broken[k] = 0;
    }
    this.plasticTotal = 0;
    this.computeAABB();
  }

  computeAABB() {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const x = this.x;
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      const r = this.r[i];
      const a = x[i * 3], b = x[i * 3 + 1], c = x[i * 3 + 2];
      if (a - r < x0) x0 = a - r; if (a + r > x1) x1 = a + r;
      if (b - r < y0) y0 = b - r; if (b + r > y1) y1 = b + r;
      if (c - r < z0) z0 = c - r; if (c + r > z1) z1 = c + r;
    }
    const bb = this.aabb;
    bb[0] = x0; bb[1] = y0; bb[2] = z0; bb[3] = x1; bb[4] = y1; bb[5] = z1;
  }

  maxSpeed() {
    let m = 0;
    const v = this.v;
    for (let i = 0; i < this.n; i++) {
      const s = v[i * 3] * v[i * 3] + v[i * 3 + 1] * v[i * 3 + 1] + v[i * 3 + 2] * v[i * 3 + 2];
      if (s > m) m = s;
    }
    return Math.sqrt(m);
  }

  integrate(h) {
    const { x, p, v, a, w, active } = this;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      if (!active[i] || w[i] === 0) { a[i3] = a[i3 + 1] = a[i3 + 2] = 0; continue; }
      v[i3] += h * a[i3];
      v[i3 + 1] += h * (GRAVITY + a[i3 + 1]);
      v[i3 + 2] += h * a[i3 + 2];
      a[i3] = a[i3 + 1] = a[i3 + 2] = 0;
      p[i3] = x[i3]; p[i3 + 1] = x[i3 + 1]; p[i3 + 2] = x[i3 + 2];
      x[i3] += h * v[i3]; x[i3 + 1] += h * v[i3 + 1]; x[i3 + 2] += h * v[i3 + 2];
      this.grounded[i] = 0;
    }
  }

  solveBeams(h, reverse) {
    const { x, w, ba, bb, rest, rest0, comp, yld, brk, cbrk, minR, broken } = this;
    const ih2 = 1 / (h * h);
    const m = this.nb;
    let plastic = 0;
    for (let q = 0; q < m; q++) {
      const k = reverse ? m - 1 - q : q;
      if (broken[k]) continue;
      const i = ba[k] * 3, j = bb[k] * 3;
      const dx = x[j] - x[i], dy = x[j + 1] - x[i + 1], dz = x[j + 2] - x[i + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-9) continue;
      let r = rest[k];
      const r0 = rest0[k];
      const y = yld[k] * r0;
      let C = len - r;
      if (C > y) {
        const nr = len - y;
        plastic += nr - r;
        r = nr;
        if (r > r0 * (1 + brk[k])) { broken[k] = 1; rest[k] = r; continue; }
      } else if (C < -y) {
        let nr = len + y;
        const lo = r0 * minR[k];
        if (nr < lo) nr = lo;
        if (nr < r) { plastic += r - nr; r = nr; }
        if (r < r0 * (1 - cbrk[k])) { broken[k] = 1; rest[k] = r; continue; }
      }
      rest[k] = r;
      C = len - r;
      const wi = w[ba[k]], wj = w[bb[k]];
      const den = wi + wj + comp[k] * ih2;
      if (den === 0) continue;
      const dl = -C / den / len;
      x[i] -= wi * dl * dx; x[i + 1] -= wi * dl * dy; x[i + 2] -= wi * dl * dz;
      x[j] += wj * dl * dx; x[j + 1] += wj * dl * dy; x[j + 2] += wj * dl * dz;
    }
    this.plasticFrame += plastic;
    this.plasticTotal += plastic;
  }

  collideStatic(h, surfaceMu) {
    const { x, p, r, active } = this;
    const out = [0, 0, 0];
    const near = this.near;
    for (let i = 0; i < this.n; i++) {
      if (!active[i]) continue;
      const i3 = i * 3;
      const ri = r[i];
      // ground plane y = 0
      if (x[i3 + 1] < ri) {
        const pen = ri - x[i3 + 1];
        x[i3 + 1] = ri;
        this.grounded[i] = 1;
        this.contactFrame += pen;
        frictionPlane(x, p, i3, 0, 1, 0, pen, GROUND_MU * surfaceMu, this, h);
      }
      for (let c = 0; c < near.length; c++) {
        const col = near[c];
        const d = col.contact(x[i3], x[i3 + 1], x[i3 + 2], ri, out);
        if (d > 0) {
          x[i3] += out[0] * d; x[i3 + 1] += out[1] * d; x[i3 + 2] += out[2] * d;
          this.contactFrame += d;
          if (out[1] > 0.5) this.grounded[i] = 1;
          frictionPlane(x, p, i3, out[0], out[1], out[2], d, col.mu, this, h);
        }
      }
    }
  }

  updateVelocities(h) {
    const { x, p, v, active } = this;
    const ih = 1 / h;
    for (let i = 0; i < this.n; i++) {
      if (!active[i]) continue;
      const i3 = i * 3;
      let vx = (x[i3] - p[i3]) * ih, vy = (x[i3 + 1] - p[i3 + 1]) * ih, vz = (x[i3 + 2] - p[i3 + 2]) * ih;
      const s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > MAX_SPEED * MAX_SPEED) {
        const f = MAX_SPEED / Math.sqrt(s2);
        vx *= f; vy *= f; vz *= f;
      }
      v[i3] = vx; v[i3 + 1] = vy; v[i3 + 2] = vz;
    }
  }

  dampBeams(h) {
    const { x, v, w, ba, bb, dmp, broken } = this;
    for (let k = 0; k < this.nb; k++) {
      if (broken[k]) continue;
      const a = ba[k], b = bb[k];
      const i = a * 3, j = b * 3;
      const dx = x[j] - x[i], dy = x[j + 1] - x[i + 1], dz = x[j + 2] - x[i + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-9) continue;
      const nx = dx / len, ny = dy / len, nz = dz / len;
      const vrel = (v[j] - v[i]) * nx + (v[j + 1] - v[i + 1]) * ny + (v[j + 2] - v[i + 2]) * nz;
      const ws = w[a] + w[b];
      if (ws === 0) continue;
      let f = dmp[k] * h * ws;
      if (f > 0.5) f = 0.5;
      const imp = vrel * f / ws;
      v[i] += w[a] * imp * nx; v[i + 1] += w[a] * imp * ny; v[i + 2] += w[a] * imp * nz;
      v[j] -= w[b] * imp * nx; v[j + 1] -= w[b] * imp * ny; v[j + 2] -= w[b] * imp * nz;
    }
  }

  // velocity of the mass centre
  centerVelocity(out) {
    let sx = 0, sy = 0, sz = 0, mt = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      const m = this.mass[i];
      sx += this.v[i * 3] * m; sy += this.v[i * 3 + 1] * m; sz += this.v[i * 3 + 2] * m;
      mt += m;
    }
    out[0] = sx / mt; out[1] = sy / mt; out[2] = sz / mt;
    return out;
  }

  centerPosition(out) {
    let sx = 0, sy = 0, sz = 0, mt = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      const m = this.mass[i];
      sx += this.x[i * 3] * m; sy += this.x[i * 3 + 1] * m; sz += this.x[i * 3 + 2] * m;
      mt += m;
    }
    out[0] = sx / mt; out[1] = sy / mt; out[2] = sz / mt;
    return out;
  }

  hasNaN() {
    for (let i = 0; i < this.x.length; i++) if (!Number.isFinite(this.x[i])) return true;
    return false;
  }
}

// Position-based Coulomb friction against a contact plane with normal n.
function frictionPlane(x, p, i3, nx, ny, nz, pen, mu, body, h) {
  const dx = x[i3] - p[i3], dy = x[i3 + 1] - p[i3 + 1], dz = x[i3 + 2] - p[i3 + 2];
  const dn = dx * nx + dy * ny + dz * nz;
  const tx = dx - dn * nx, ty = dy - dn * ny, tz = dz - dn * nz;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (tl < 1e-12) return;
  const lim = mu * pen;
  if (tl <= lim) {
    x[i3] -= tx; x[i3 + 1] -= ty; x[i3 + 2] -= tz;
  } else {
    const f = lim / tl;
    x[i3] -= tx * f; x[i3 + 1] -= ty * f; x[i3 + 2] -= tz * f;
    const speed = tl / h;
    if (speed > 4 && body.scrapes.length < 6) body.scrapes.push(x[i3], x[i3 + 1], x[i3 + 2], speed);
  }
}

function collideBodies(A, B, margin) {
  const bbA = A.aabb, bbB = B.aabb;
  const xa = A.x, xb = B.x;
  let total = 0;
  for (let i = 0; i < A.n; i++) {
    if (!A.active[i]) continue;
    const i3 = i * 3;
    const px = xa[i3], py = xa[i3 + 1], pz = xa[i3 + 2], ri = A.r[i];
    if (px + ri < bbB[0] - margin || px - ri > bbB[3] + margin ||
        py + ri < bbB[1] - margin || py - ri > bbB[4] + margin ||
        pz + ri < bbB[2] - margin || pz - ri > bbB[5] + margin) continue;
    const wi = A.w[i];
    for (let j = 0; j < B.n; j++) {
      if (!B.active[j]) continue;
      const j3 = j * 3;
      const dx = xb[j3] - xa[i3], dy = xb[j3 + 1] - xa[i3 + 1], dz = xb[j3 + 2] - xa[i3 + 2];
      const rr = ri + B.r[j];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const pen = rr - d;
      const wj = B.w[j];
      const ws = wi + wj;
      if (ws === 0) continue;
      const s = pen / d / ws;
      xa[i3] -= dx * s * wi; xa[i3 + 1] -= dy * s * wi; xa[i3 + 2] -= dz * s * wi;
      xb[j3] += dx * s * wj; xb[j3 + 1] += dy * s * wj; xb[j3 + 2] += dz * s * wj;
      total += pen;
    }
  }
  if (total > 0) {
    A.contactFrame += total; B.contactFrame += total;
    A.touching = B; B.touching = A;
  }
}

export class PhysicsWorld {
  constructor({ colliders = [], surfaceAt = null, substeps = 16 } = {}) {
    this.bodies = [];
    this.colliders = colliders;
    this.surfaceAt = surfaceAt || (() => ({ mu: 1, roll: 0.015, type: 'asphalt' }));
    this.substeps = substeps;
    this.time = 0;
  }

  add(body) { this.bodies.push(body); return body; }
  remove(body) { const i = this.bodies.indexOf(body); if (i >= 0) this.bodies.splice(i, 1); }

  raycast(body, ox, oy, oz, dx, dy, dz, tmax, out) {
    // ground plane
    let best = Infinity;
    if (dy < -1e-6) {
      const t = oy / -dy;
      if (t >= 0 && t <= tmax) { best = t; out[0] = 0; out[1] = 1; out[2] = 0; }
    }
    const tmp = [0, 0, 0];
    const near = body ? body.near : this.colliders;
    for (let c = 0; c < near.length; c++) {
      const t = near[c].raycast(ox, oy, oz, dx, dy, dz, tmax, tmp);
      if (t < best) { best = t; out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2]; }
    }
    return best;
  }

  step(dt) {
    const bodies = this.bodies;
    const n = this.substeps;
    const h = dt / n;
    // broad phase (once per frame)
    const pairs = [];
    for (const b of bodies) {
      b.computeAABB();
      b.plasticFrame = 0;
      b.contactFrame = 0;
      b.scrapes.length = 0;
      b.touching = null;
      const margin = b.maxSpeed() * dt + 0.5;
      b.near = this.colliders.filter(c => aabbOverlap(b.aabb, c.aabb, margin));
      const cx = (b.aabb[0] + b.aabb[3]) / 2, cz = (b.aabb[2] + b.aabb[5]) / 2;
      b.surfaceMu = this.surfaceAt(cx, cz).mu;
      b.frameMargin = margin;
    }
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const m = bodies[i].frameMargin + bodies[j].frameMargin;
        if (aabbOverlap(bodies[i].aabb, bodies[j].aabb, m)) pairs.push([bodies[i], bodies[j]]);
      }

    for (let s = 0; s < n; s++) {
      for (const b of bodies) if (b.onSubstep) b.onSubstep(h, s);
      for (const b of bodies) b.integrate(h);
      for (const b of bodies) b.solveBeams(h, (s & 1) === 1);
      for (const [a, b] of pairs) {
        if (pairs.length && (s & 3) === 0) { a.computeAABB(); b.computeAABB(); }
        collideBodies(a, b, 0.1);
      }
      for (const b of bodies) b.collideStatic(h, b.surfaceMu);
      for (const b of bodies) { b.updateVelocities(h); b.dampBeams(h); }
    }
    for (const b of bodies) b.computeAABB();
    this.time += dt;
  }
}
