// Static world colliders: oriented boxes (walls, ramps, blocks) and vertical
// cylinders (poles, tyre stacks). Pure math, no rendering dependencies.
//
// Heading convention used everywhere in the game: heading θ maps local +x
// (forward) to world (cosθ, 0, sinθ) and local +z (right) to (-sinθ, 0, cosθ).

export function headingBasis(theta, pitch = 0, roll = 0) {
  // R = H(theta) * Rz(pitch) * Rx(roll); returned row-major 3x3.
  const ch = Math.cos(theta), sh = Math.sin(theta);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // H columns: X=(ch,0,sh) Y=(0,1,0) Z=(-sh,0,ch)
  const H = [ch, 0, -sh, 0, 1, 0, sh, 0, ch];
  // Rz(pitch) columns: (cp,sp,0) (-sp,cp,0) (0,0,1)
  const Rz = [cp, -sp, 0, sp, cp, 0, 0, 0, 1];
  // Rx(roll) columns: (1,0,0) (0,cr,sr) (0,-sr,cr)
  const Rx = [1, 0, 0, 0, cr, -sr, 0, sr, cr];
  return mul3(mul3(H, Rz), Rx);
}

function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

let nextId = 1;

export class BoxCollider {
  constructor({ x, y, z, hx, hy, hz, heading = 0, pitch = 0, roll = 0, mu = 0.6, tag = 'wall', visual = null }) {
    this.id = nextId++;
    this.type = 'box';
    this.cx = x; this.cy = y; this.cz = z;
    this.hx = hx; this.hy = hy; this.hz = hz;
    this.heading = heading; this.pitch = pitch; this.roll = roll;
    this.R = headingBasis(heading, pitch, roll);
    this.mu = mu;
    this.tag = tag;
    this.visual = visual;
    const R = this.R;
    const ex = Math.abs(R[0]) * hx + Math.abs(R[1]) * hy + Math.abs(R[2]) * hz;
    const ey = Math.abs(R[3]) * hx + Math.abs(R[4]) * hy + Math.abs(R[5]) * hz;
    const ez = Math.abs(R[6]) * hx + Math.abs(R[7]) * hy + Math.abs(R[8]) * hz;
    this.aabb = [x - ex, y - ey, z - ez, x + ex, y + ey, z + ez];
  }

  // Sphere contact. Writes outward normal into out[0..2]; returns depth (>0 on contact).
  contact(px, py, pz, r, out) {
    const R = this.R;
    const dx = px - this.cx, dy = py - this.cy, dz = pz - this.cz;
    // local = R^T d
    const lx = R[0] * dx + R[3] * dy + R[6] * dz;
    const ly = R[1] * dx + R[4] * dy + R[7] * dz;
    const lz = R[2] * dx + R[5] * dy + R[8] * dz;
    const hx = this.hx, hy = this.hy, hz = this.hz;
    if (lx > hx + r || lx < -hx - r || ly > hy + r || ly < -hy - r || lz > hz + r || lz < -hz - r) return 0;
    const qx = lx < -hx ? -hx : lx > hx ? hx : lx;
    const qy = ly < -hy ? -hy : ly > hy ? hy : ly;
    const qz = lz < -hz ? -hz : lz > hz ? hz : lz;
    let nx, ny, nz, depth;
    if (qx === lx && qy === ly && qz === lz) {
      // centre inside: push out along the axis of least penetration
      const px_ = hx - Math.abs(lx), py_ = hy - Math.abs(ly), pz_ = hz - Math.abs(lz);
      if (px_ <= py_ && px_ <= pz_) { nx = Math.sign(lx) || 1; ny = 0; nz = 0; depth = px_ + r; }
      else if (py_ <= pz_) { nx = 0; ny = Math.sign(ly) || 1; nz = 0; depth = py_ + r; }
      else { nx = 0; ny = 0; nz = Math.sign(lz) || 1; depth = pz_ + r; }
    } else {
      const ex = lx - qx, ey = ly - qy, ez = lz - qz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 >= r * r) return 0;
      const d = Math.sqrt(d2) || 1e-9;
      nx = ex / d; ny = ey / d; nz = ez / d;
      depth = r - d;
    }
    out[0] = R[0] * nx + R[1] * ny + R[2] * nz;
    out[1] = R[3] * nx + R[4] * ny + R[5] * nz;
    out[2] = R[6] * nx + R[7] * ny + R[8] * nz;
    return depth;
  }

  // Ray (o + t d), d unit. Returns t of entry or Infinity; writes normal to out.
  raycast(ox, oy, oz, dx, dy, dz, tmax, out) {
    const R = this.R;
    const rx = ox - this.cx, ry = oy - this.cy, rz = oz - this.cz;
    const o = [R[0] * rx + R[3] * ry + R[6] * rz, R[1] * rx + R[4] * ry + R[7] * rz, R[2] * rx + R[5] * ry + R[8] * rz];
    const d = [R[0] * dx + R[3] * dy + R[6] * dz, R[1] * dx + R[4] * dy + R[7] * dz, R[2] * dx + R[5] * dy + R[8] * dz];
    const h = [this.hx, this.hy, this.hz];
    let tmin = -Infinity, tfar = Infinity, axis = -1, sgn = 0;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-12) {
        if (o[i] < -h[i] || o[i] > h[i]) return Infinity;
      } else {
        let t1 = (-h[i] - o[i]) / d[i], t2 = (h[i] - o[i]) / d[i];
        let s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = i; sgn = s; }
        if (t2 < tfar) tfar = t2;
        if (tmin > tfar) return Infinity;
      }
    }
    if (tmin < 0 || tmin > tmax || axis < 0) return Infinity;
    const ln = [0, 0, 0];
    ln[axis] = sgn;
    out[0] = R[0] * ln[0] + R[1] * ln[1] + R[2] * ln[2];
    out[1] = R[3] * ln[0] + R[4] * ln[1] + R[5] * ln[2];
    out[2] = R[6] * ln[0] + R[7] * ln[1] + R[8] * ln[2];
    return tmin;
  }
}

export class CylinderCollider {
  constructor({ x, z, radius, y0 = 0, y1 = 6, mu = 0.5, tag = 'pole', visual = null }) {
    this.id = nextId++;
    this.type = 'cyl';
    this.cx = x; this.cz = z; this.radius = radius; this.y0 = y0; this.y1 = y1;
    this.mu = mu; this.tag = tag; this.visual = visual;
    this.aabb = [x - radius, y0, z - radius, x + radius, y1, z + radius];
  }

  contact(px, py, pz, r, out) {
    if (py + r < this.y0 || py - r > this.y1) return 0;
    const dx = px - this.cx, dz = pz - this.cz;
    const rr = this.radius + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) return 0;
    // top cap
    const topPen = this.y1 - (py - r);
    const d = Math.sqrt(d2) || 1e-9;
    const sidePen = rr - d;
    if (topPen < sidePen && py > this.y1) {
      out[0] = 0; out[1] = 1; out[2] = 0;
      return topPen;
    }
    out[0] = dx / d; out[1] = 0; out[2] = dz / d;
    return sidePen;
  }

  raycast(ox, oy, oz, dx, dy, dz, tmax, out) {
    // only the top cap matters for wheels
    if (dy >= 0 || oy < this.y1) return Infinity;
    const t = (oy - this.y1) / -dy;
    if (t > tmax) return Infinity;
    const hx = ox + dx * t - this.cx, hz = oz + dz * t - this.cz;
    if (hx * hx + hz * hz > this.radius * this.radius) return Infinity;
    out[0] = 0; out[1] = 1; out[2] = 0;
    return t;
  }
}

export function aabbOverlap(a, b, margin = 0) {
  return a[0] - margin <= b[3] && a[3] + margin >= b[0] &&
         a[1] - margin <= b[4] && a[4] + margin >= b[1] &&
         a[2] - margin <= b[5] && a[5] + margin >= b[2];
}
