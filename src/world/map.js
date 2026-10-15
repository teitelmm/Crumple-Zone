// "Crumple Valley": one flat world holding a road circuit, a proving-ground
// infield (ramps, crash wall, lamp posts), a demolition derby bowl and a crash
// test strip. Pure data + physics colliders; the renderer builds visuals from it.

import { BoxCollider, CylinderCollider } from '../physics/colliders.js';

export const SURFACES = [
  { type: 'grass', mu: 0.62, roll: 0.06 },
  { type: 'asphalt', mu: 1.0, roll: 0.015 },
  { type: 'concrete', mu: 0.95, roll: 0.015 },
  { type: 'dirt', mu: 0.72, roll: 0.035 },
  { type: 'kerb', mu: 0.9, roll: 0.02 },
];
const S = { grass: 0, asphalt: 1, concrete: 2, dirt: 3, kerb: 4 };

const TRACK_PTS = [
  [0, -230], [120, -236], [222, -214], [286, -145], [292, -55], [246, 4], [176, 22], [134, 72], [150, 140],
  [228, 168], [262, 228], [204, 292], [84, 298], [-18, 254], [-80, 186], [-168, 204], [-252, 172], [-292, 92],
  [-272, 4], [-204, -40], [-232, -122], [-202, -202], [-112, -236],
];
export const TRACK_WIDTH = 13;

export const ZONES = {
  infield: { x: -30, z: -40, w: 210, l: 230 },
  derby: { x: 0, z: 440, r: 44 },
  lab: { x: 0, z: -390, w: 360, l: 44 },
};

const GRID_HALF = 800, CELL = 2, GN = (GRID_HALF * 2) / CELL;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

function buildTrack() {
  const n = TRACK_PTS.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = TRACK_PTS[(i - 1 + n) % n], p1 = TRACK_PTS[i], p2 = TRACK_PTS[(i + 1) % n], p3 = TRACK_PTS[(i + 2) % n];
    for (let k = 0; k < 40; k++) dense.push(catmull(p0, p1, p2, p3, k / 40));
  }
  // resample at ~2 m spacing
  let total = 0;
  const segLen = dense.map((p, i) => { const q = dense[(i + 1) % dense.length]; const l = Math.hypot(q[0] - p[0], q[1] - p[1]); total += l; return l; });
  const step = 2;
  const count = Math.floor(total / step);
  const pts = [];
  let seg = 0, acc = 0;
  for (let k = 0; k < count; k++) {
    const target = k * total / count;
    while (acc + segLen[seg] < target) { acc += segLen[seg]; seg++; }
    const t = (target - acc) / segLen[seg];
    const a = dense[seg], b = dense[(seg + 1) % dense.length];
    pts.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, s: target });
  }
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz);
    pts[i].tx = tx / l; pts[i].tz = tz / l;
    pts[i].heading = Math.atan2(tz, tx);
  }
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 3 + N) % N], b = pts[(i + 3) % N];
    let dh = b.heading - a.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    pts[i].curv = dh / (b.s - a.s + (b.s < a.s ? total : 0)); // +ve = turning right (toward local +z)
  }
  // AI target speed from curvature, then a backward braking pass
  for (const p of pts) p.vmax = Math.min(70, Math.sqrt(1.12 * 9.81 / Math.max(1e-4, Math.abs(p.curv))));
  for (let pass = 0; pass < 2; pass++)
    for (let i = N - 1; i >= 0; i--) {
      const nx = pts[(i + 1) % N];
      const lim = Math.sqrt(nx.vmax * nx.vmax + 2 * 7.0 * step);
      if (pts[i].vmax > lim) pts[i].vmax = lim;
    }
  return { pts, length: total, width: TRACK_WIDTH };
}

export function buildWorld() {
  const colliders = [];
  const props = [];
  const track = buildTrack();
  const grid = new Uint8Array(GN * GN);

  const mark = (x, z, type) => {
    const gx = Math.floor((x + GRID_HALF) / CELL), gz = Math.floor((z + GRID_HALF) / CELL);
    if (gx < 0 || gz < 0 || gx >= GN || gz >= GN) return;
    grid[gz * GN + gx] = type;
  };
  const markRect = (cx, cz, w, l, type) => {
    for (let x = cx - w / 2; x <= cx + w / 2; x += CELL) for (let z = cz - l / 2; z <= cz + l / 2; z += CELL) mark(x, z, type);
  };
  const markDisc = (cx, cz, r, type) => {
    for (let x = cx - r; x <= cx + r; x += CELL) for (let z = cz - r; z <= cz + r; z += CELL)
      if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) mark(x, z, type);
  };

  // paved areas first, track on top
  const inf = ZONES.infield;
  markRect(inf.x, inf.z, inf.w, inf.l, S.asphalt);
  markRect(ZONES.lab.x, ZONES.lab.z, ZONES.lab.w, ZONES.lab.l, S.concrete);
  markDisc(ZONES.derby.x, ZONES.derby.z, ZONES.derby.r + 2, S.dirt);
  // access roads
  markRect(-30, -170, 14, 60, S.asphalt);
  markRect(0, -305, 14, 130, S.asphalt);
  markRect(0, 350, 14, 120, S.asphalt);
  for (const p of track.pts) {
    const nx = -p.tz, nz = p.tx;
    for (let o = -TRACK_WIDTH / 2; o <= TRACK_WIDTH / 2; o += 1) mark(p.x + nx * o, p.z + nz * o, S.asphalt);
    if (Math.abs(p.curv) > 1 / 110) {
      const sideSign = p.curv > 0 ? 1 : -1; // kerb on the inside of the corner
      for (let o = TRACK_WIDTH / 2; o <= TRACK_WIDTH / 2 + 1.5; o += 0.5) mark(p.x + nx * o * sideSign, p.z + nz * o * sideSign, S.kerb);
    }
  }

  const surfaceAt = (x, z) => {
    const gx = Math.floor((x + GRID_HALF) / CELL), gz = Math.floor((z + GRID_HALF) / CELL);
    if (gx < 0 || gz < 0 || gx >= GN || gz >= GN) return SURFACES[0];
    return SURFACES[grid[gz * GN + gx]];
  };

  // ---- tyre walls on the outside of corners
  const N = track.pts.length;
  const barrierOffset = TRACK_WIDTH / 2 + 9;
  for (let i = 0; i < N; i += 4) {
    const p = track.pts[i];
    if (Math.abs(p.curv) < 1 / 140) continue;
    const out = p.curv > 0 ? 1 : -1; // turning right -> outside is left (-z local)... see below
    // local right = (-tz, tx); turning right means centre of curvature on the right, outside on the left
    const nx = -p.tz * -out, nz = p.tx * -out;
    const cx = p.x + nx * barrierOffset, cz = p.z + nz * barrierOffset;
    if (insideZone(cx, cz, 6)) continue;
    colliders.push(new BoxCollider({ x: cx, y: 0.55, z: cz, hx: 4.4, hy: 0.55, hz: 0.65, heading: p.heading, mu: 0.8, tag: 'tyres' }));
  }

  // ---- outer boundary
  const B = 720;
  for (const [x, z, hx, hz] of [[0, B, B, 2], [0, -B, B, 2], [B, 0, 2, B], [-B, 0, 2, B]])
    colliders.push(new BoxCollider({ x, y: 2, z, hx, hy: 2, hz, tag: 'boundary', mu: 0.6 }));

  // ---- infield proving ground
  const wallX = inf.x + 70, wallZ = inf.z + 60;
  colliders.push(new BoxCollider({ x: wallX, y: 1.6, z: wallZ, hx: 0.8, hy: 1.6, hz: 9, tag: 'concrete', mu: 0.6 }));
  // jersey barrier lane
  for (let k = 0; k < 6; k++)
    colliders.push(new BoxCollider({ x: inf.x - 20 + k * 6.5, y: 0.45, z: inf.z + 95, hx: 3, hy: 0.45, hz: 0.35, tag: 'jersey', mu: 0.6 }));
  // lamp posts
  for (let z = inf.z - 90; z <= inf.z + 80; z += 14)
    colliders.push(new CylinderCollider({ x: inf.x - 85, z, radius: 0.17, y1: 7.5, tag: 'pole' }));
  // ramps (slab whose top face starts at ground level)
  const ramp = (x, z, heading, len, width, deg) => {
    const p = deg * Math.PI / 180, th = 1.0;
    const c = Math.cos(heading), s = Math.sin(heading);
    const along = len / 2 * Math.cos(p) + th / 2 * Math.sin(p);
    const up = len / 2 * Math.sin(p) - th / 2 * Math.cos(p);
    const col = new BoxCollider({ x: x + c * along, y: up, z: z + s * along, hx: len / 2, hy: th / 2, hz: width / 2, heading, pitch: p, tag: 'ramp', mu: 0.9 });
    col.ramp = { x, z, heading, len, width, deg, height: len * Math.sin(p), run: len * Math.cos(p) };
    colliders.push(col);
  };
  ramp(inf.x - 40, inf.z - 70, 0, 10, 6, 11);
  ramp(inf.x + 20, inf.z - 30, 0, 13, 7, 17);
  ramp(inf.x - 30, inf.z + 30, Math.PI, 9, 6, 14);
  // tyre stacks marking the pad corners
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    colliders.push(new CylinderCollider({ x: inf.x + dx * (inf.w / 2 - 6), z: inf.z + dz * (inf.l / 2 - 6), radius: 0.7, y1: 1.2, tag: 'tyrestack', mu: 0.9 }));

  // ---- derby bowl
  const dz = ZONES.derby;
  const segs = 36;
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * Math.PI * 2;
    const r = dz.r + 1;
    const segLen = 2 * Math.PI * r / segs;
    colliders.push(new BoxCollider({ x: dz.x + Math.cos(a) * r, y: 0.9, z: dz.z + Math.sin(a) * r, hx: segLen / 2 + 0.2, hy: 0.9, hz: 0.6, heading: a + Math.PI / 2, tag: 'concrete', mu: 0.6 }));
  }

  // ---- crash lab boundary rails
  const lab = ZONES.lab;
  for (const side of [-1, 1])
    colliders.push(new BoxCollider({ x: lab.x, y: 0.5, z: lab.z + side * (lab.l / 2 + 1), hx: lab.w / 2, hy: 0.5, hz: 0.4, tag: 'jersey', mu: 0.6 }));

  // spawns
  const startIdx = 0;
  const gridSpots = [];
  for (let k = 0; k < 8; k++) {
    const idx = (N - 6 - k * 5) % N;
    const p = track.pts[(idx + N) % N];
    const off = (k % 2 === 0 ? -1 : 1) * 3.2;
    gridSpots.push({ x: p.x - p.tz * off, z: p.z + p.tx * off, heading: p.heading });
  }
  const derbySpots = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    derbySpots.push({ x: dz.x + Math.cos(a) * (dz.r - 9), z: dz.z + Math.sin(a) * (dz.r - 9), heading: a + Math.PI });
  }
  const spawns = {
    free: { x: inf.x - 60, z: inf.z - 70, heading: 0 },
    grid: gridSpots,
    derby: derbySpots,
    lab: { x: lab.x - 60, z: lab.z, heading: 0 },
    start: track.pts[startIdx],
  };

  return { colliders, props, track, surfaceAt, spawns, zones: ZONES, grid, gridInfo: { half: GRID_HALF, cell: CELL, n: GN } };

  function insideZone(x, z, pad) {
    return Math.abs(x - inf.x) < inf.w / 2 + pad && Math.abs(z - inf.z) < inf.l / 2 + pad;
  }
}

// Nearest point on the track to (x, z), searching around a hint index.
export function trackProgress(track, x, z, hint = -1) {
  const pts = track.pts, N = pts.length;
  let best = -1, bd = Infinity;
  const scan = (i0, i1) => {
    for (let k = i0; k <= i1; k++) {
      const i = ((k % N) + N) % N;
      const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  };
  if (hint >= 0) scan(hint - 30, hint + 60);
  if (hint < 0 || bd > 30 * 30) scan(0, N - 1);
  return { index: best, dist: Math.sqrt(bd) };
}
