// Builds the node/beam "jbeam" for a car spec: a 2-layer lattice (floor pan +
// belt line) along a set of stations, a roof cage, and four suspension hubs.

import { axles, halfWidthAt, topAt } from './specs.js';

const R_FLOOR = 0.16, R_BELT = 0.2, R_ROOF = 0.15, R_HUB = 0.11;
const HUB_MASS = 38;

// Beam materials by zone: stiffness k (N/m), yield strain, tension break
// (permanent stretch ratio), damping (N·s/m).
export const MAT = {
  front: { k: 2.2e6, yield: 0.009, brk: 0.4, damp: 400 },
  engine: { k: 3.6e6, yield: 0.012, brk: 0.35, damp: 400 },
  cabin: { k: 7.0e6, yield: 0.022, brk: 0.3, damp: 500 },
  rear: { k: 2.6e6, yield: 0.010, brk: 0.4, damp: 400 },
  roof: { k: 2.4e6, yield: 0.012, brk: 0.35, damp: 400 },
  hub: { k: 1.0e7, yield: 0.02, brk: 0.12, cbrk: 0.3, damp: 800 },
};

export function buildTemplate(spec) {
  let seed = [...spec.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const d = spec.dims;
  const g = spec.greenhouse;
  const { fa, ra } = axles(spec);
  const halfL = d.length / 2;

  // stations along the car; higher priority survives a merge
  const raw = [
    { x: halfL - 0.24, pri: 3 },
    { x: fa, pri: 2 },
    { x: g.aBase, pri: 1 },
    { x: (g.roofFront + g.roofRear) / 2, pri: 1 },
    { x: g.cBase, pri: 1 },
    { x: ra, pri: 2 },
    { x: -halfL + 0.24, pri: 3 },
  ].sort((a, b) => b.x - a.x);
  // extra stations in long crumple zones give the metal room to buckle
  const withMid = [];
  for (let i = 0; i < raw.length; i++) {
    withMid.push(raw[i]);
    const nx = raw[i + 1];
    if (nx && raw[i].x - nx.x > 0.75 && (raw[i].pri >= 2 || nx.pri >= 2)) withMid.push({ x: (raw[i].x + nx.x) / 2, pri: 0 });
  }
  raw.length = 0; raw.push(...withMid);
  const cols = [];
  for (const c of raw) {
    const last = cols[cols.length - 1];
    if (last && last.x - c.x < 0.4) {
      if (c.pri > last.pri) { last.x = c.x; last.pri = c.pri; }
      else if (c.pri === last.pri) last.x = (last.x + c.x) / 2;
    } else cols.push({ ...c });
  }

  const nodes = [];
  const grid = []; // grid[col][layer][side]
  const floorY = d.clearance + R_FLOOR;
  for (let ci = 0; ci < cols.length; ci++) {
    const x = cols[ci].x;
    const hw = halfWidthAt(spec, x);
    const beltY = Math.max(floorY + 0.24, topAt(spec, x) - R_BELT);
    const layers = [];
    for (let L = 0; L < 2; L++) {
      const r = L === 0 ? R_FLOOR : R_BELT;
      const y = L === 0 ? floorY : beltY;
      const zs = Math.max(0.25, hw - r);
      const row = [];
      for (let s = 0; s < 3; s++) {
        const z = (s - 1) * zs;
        row.push(nodes.length);
        nodes.push({ x, y, z, radius: r, kind: L === 0 ? 'floor' : 'belt', col: ci, side: s });
      }
      layers.push(row);
    }
    grid.push(layers);
  }

  // roof cage: two rows (front/rear) x three across
  const roofRows = [];
  const roofY = d.height - R_ROOF;
  for (const rx of [g.roofFront - 0.04, g.roofRear + 0.04]) {
    const row = [];
    const zs = g.roofHalf - R_ROOF * 0.6;
    for (let s = 0; s < 3; s++) {
      row.push(nodes.length);
      nodes.push({ x: rx, y: roofY, z: (s - 1) * zs, radius: R_ROOF, kind: 'roof', side: s, roofRow: roofRows.length });
    }
    roofRows.push(row);
  }

  // suspension hubs
  const sp = spec.susp;
  const hubs = [];
  for (const [ax, track, axle] of [[fa, d.trackF, 0], [ra, d.trackR, 1]]) {
    for (const side of [-1, 1]) {
      const y = d.wheelRadius + sp.restLen - sp.staticComp;
      const z = side * (track / 2 - 0.12);
      hubs.push({ node: nodes.length, axle, side, wheelOffset: 0.12 });
      nodes.push({ x: ax, y, z, radius: R_HUB, kind: 'hub', axle, side });
    }
  }

  // --- masses: weight by layer, then tilt to hit the target weight distribution
  const base = nodes.map(n => n.kind === 'floor' ? 1.0 : n.kind === 'belt' ? 0.62 : n.kind === 'roof' ? 0.22 : 0);
  // engine block sits low between the front axle and the firewall
  nodes.forEach((n, i) => {
    if (n.kind === 'floor' && n.x > g.aBase - 0.1 && n.x < halfL - 0.3) base[i] *= 2.4;
  });
  const sprung = spec.mass - HUB_MASS * 4;
  const xTarget = ra + d.wheelbase * spec.frontWeight;
  const massFor = beta => {
    let s = 0;
    const w = base.map((b, i) => { const v = b * Math.max(0.05, 1 + beta * nodes[i].x); s += v; return v; });
    return w.map(v => v / s * sprung);
  };
  const comX = beta => {
    const m = massFor(beta);
    let sx = 0, sm = 0;
    m.forEach((v, i) => { sx += v * nodes[i].x; sm += v; });
    sx += HUB_MASS * 2 * (fa + ra); sm += HUB_MASS * 4;
    return sx / sm;
  };
  let lo = -0.45, hi = 0.45;
  for (let it = 0; it < 50; it++) {
    const mid = (lo + hi) / 2;
    if (comX(mid) < xTarget) lo = mid; else hi = mid;
  }
  const masses = massFor((lo + hi) / 2);
  nodes.forEach((n, i) => { n.mass = n.kind === 'hub' ? HUB_MASS : masses[i]; });

  // --- beams
  const beams = [];
  const seen = new Set();
  const zoneOf = (x) => x > fa + 0.05 ? 'front' : x > g.aBase - 0.05 ? 'engine' : x >= Math.max(g.cBase, ra) - 0.05 ? 'cabin' : 'rear';
  const addBeam = (a, b, zone) => {
    if (a === b) return;
    const key = a < b ? a + ':' + b : b + ':' + a;
    if (seen.has(key)) return;
    seen.add(key);
    const na = nodes[a], nb = nodes[b];
    const rest = Math.hypot(na.x - nb.x, na.y - nb.y, na.z - nb.z);
    const z = zone || zoneOf((na.x + nb.x) / 2);
    const m = MAT[z];
    let k = m.k;
    if (z === 'roof' && g.softTop) k *= 0.7;
    // small manufacturing scatter so panels fold unevenly instead of like an accordion
    const jitter = z === 'hub' ? 1 : 0.75 + 0.5 * rand();
    beams.push({ a, b, rest, k, yield: m.yield * jitter, brk: m.brk, cbrk: m.cbrk, damp: m.damp, zone: z });
  };
  const colNodes = ci => [...grid[ci][0], ...grid[ci][1]];
  for (let ci = 0; ci < cols.length; ci++) {
    const cn = colNodes(ci);
    for (let i = 0; i < cn.length; i++) for (let j = i + 1; j < cn.length; j++) addBeam(cn[i], cn[j]);
    if (ci + 1 < cols.length) {
      const nn = colNodes(ci + 1);
      for (const a of cn) for (const b of nn) addBeam(a, b);
    }
  }
  const roofAll = [...roofRows[0], ...roofRows[1]];
  for (let i = 0; i < roofAll.length; i++) for (let j = i + 1; j < roofAll.length; j++) addBeam(roofAll[i], roofAll[j], 'roof');
  for (const row of roofRows) {
    const rx = nodes[row[0]].x;
    const near = cols.map((c, ci) => ({ ci, d: Math.abs(c.x - rx) })).sort((a, b) => a.d - b.d).slice(0, 2);
    for (const { ci } of near) for (const a of row) for (const b of grid[ci][1]) addBeam(a, b, 'roof');
  }
  // hubs mount to their own axle column plus the next column inboard, so the
  // wheel can be shoved back in a crash instead of bracing the crumple zone
  const fwdCol = cols.findIndex(c => Math.abs(c.x - fa) < 1e-6);
  const rearCol = cols.findIndex(c => Math.abs(c.x - ra) < 1e-6);
  for (const hub of hubs) {
    const ci = hub.axle === 0 ? fwdCol : rearCol;
    const inner = hub.axle === 0 ? ci + 1 : ci - 1;
    const s = hub.side < 0 ? 0 : 2;
    const mounts = [grid[ci][0][s], grid[ci][1][s], grid[ci][0][1], grid[inner][0][s], grid[inner][1][s]];
    hub.attach = [hub.node, grid[ci][0][s], grid[ci][1][s]];
    for (const m of mounts) addBeam(hub.node, m, 'hub');
  }

  // groups used by the vehicle model
  const last = cols.length - 1;
  const groups = {
    // floor-pan nodes only: they share one height at rest, so the frame is level
    front: grid[fwdCol][0],
    rear: grid[rearCol][0],
    left: grid.map(c => c[0][0]),
    right: grid.map(c => c[0][2]),
    noseCenter: grid[0][0][1],
    tailCenter: grid[last][0][1],
    lattice: nodes.map((n, i) => i).filter(i => nodes[i].kind !== 'hub'),
  };
  // nodes ahead/behind each hub on its side, used to measure toe after damage
  for (const hub of hubs) {
    const ci = hub.axle === 0 ? fwdCol : rearCol;
    const s = hub.side < 0 ? 0 : 2;
    const a = Math.max(0, ci - 1), b = Math.min(last, ci + 1);
    hub.toeA = grid[a][0][s];
    hub.toeB = grid[b][0][s];
  }

  // beam groups for damage reporting
  const beamIdx = pred => beams.map((b, i) => (pred(b) ? i : -1)).filter(i => i >= 0);
  const roofSet = new Set(roofAll);
  const damageGroups = {
    engine: beamIdx(b => b.zone === 'front' || b.zone === 'engine'),
    radiator: beamIdx(b => b.zone === 'front'),
    windshield: beamIdx(b => b.zone === 'roof' && (roofRows[0].includes(b.a) || roofRows[0].includes(b.b)) && !(roofSet.has(b.a) && roofSet.has(b.b))),
    rearGlass: beamIdx(b => b.zone === 'roof' && (roofRows[1].includes(b.a) || roofRows[1].includes(b.b)) && !(roofSet.has(b.a) && roofSet.has(b.b))),
    leftGlass: beamIdx(b => b.zone === 'roof' && (nodes[b.a].z < -0.1 || nodes[b.b].z < -0.1)),
    rightGlass: beamIdx(b => b.zone === 'roof' && (nodes[b.a].z > 0.1 || nodes[b.b].z > 0.1)),
  };

  return { spec, nodes, beams, hubs, groups, cols, roofRows, damageGroups };
}
