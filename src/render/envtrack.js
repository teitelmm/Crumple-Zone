// Circuit visuals: asphalt ribbon with painted lines and a rubbered racing
// line, raised kerbs, gravel traps, Armco, catch fences, billboards and
// marshal posts. Pure presentation; physics comes from src/world/map.js.
import * as THREE from 'three';
import { TRACK_WIDTH } from '../world/map.js';
import { groundMaterial } from './envshader.js';
import { sweep, Batch, BucketBatch, trs, rng } from './envgeom.js';

const HW = TRACK_WIDTH / 2;

function smoothLoop(arr, sigma) {
  const N = arr.length, R = Math.ceil(sigma * 2.5);
  const w = [];
  let ws = 0;
  for (let k = -R; k <= R; k++) { const v = Math.exp(-(k * k) / (2 * sigma * sigma)); w.push(v); ws += v; }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -R; k <= R; k++) s += arr[(i + k + N) % N] * w[k + R];
    out[i] = s / ws;
  }
  return out;
}

// Shared track analysis: racing line, braking zones, corner sides.
export function analyseTrack(world) {
  const pts = world.track.pts, N = pts.length;
  const curv = new Float32Array(N);
  for (let i = 0; i < N; i++) curv[i] = pts[i].curv;
  const S1 = smoothLoop(curv, 6);
  let line = new Float32Array(N);
  const lim = HW - 1.7;
  for (let i = 0; i < N; i++) {
    const v = 420 * (S1[i] - 0.45 * S1[(i + 18) % N] - 0.45 * S1[(i - 18 + N) % N]);
    line[i] = Math.max(-lim, Math.min(lim, v));
  }
  line = smoothLoop(line, 5);
  let brake = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const dv = pts[i].vmax - pts[(i + 22) % N].vmax;
    brake[i] = Math.max(0, Math.min(1, (dv - 1.5) / 10));
  }
  brake = smoothLoop(brake, 4);
  // the loop runs counter-clockwise in x/z, so the right-hand normal points inside
  const inf = world.zones.infield;
  const insideZone = (x, z, pad) => Math.abs(x - inf.x) < inf.w / 2 + pad && Math.abs(z - inf.z) < inf.l / 2 + pad;
  // corner flags as used by map.js for tyre walls (outside) and kerbs (inside)
  const tyreCorner = new Uint8Array(N), kerbCorner = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    if (Math.abs(p.curv) >= 1 / 140) {
      const out = p.curv > 0 ? -1 : 1;
      const cx = p.x - p.tz * out * (HW + 9), cz = p.z + p.tx * out * (HW + 9);
      if (!insideZone(cx, cz, 6)) tyreCorner[i] = 1;
    }
    if (Math.abs(p.curv) > 1 / 110) kerbCorner[i] = 1;
  }
  // gravel traps: outside of tyre-wall corners, dilated past the barrier ends;
  // value = side (+1 right / -1 left), 0 = none
  const gravel = new Int8Array(N);
  for (let i = 0; i < N; i++) if (tyreCorner[i]) {
    const side = pts[i].curv > 0 ? -1 : 1;
    for (let k = -10; k <= 14; k++) { const j = (i + k + N) % N; if (!gravel[j]) gravel[j] = side; }
  }
  return { pts, N, line, brake, tyreCorner, kerbCorner, gravel, insideZone, length: world.track.length };
}

// world-space point on the track: lateral offset o (+ = right / inside of the loop)
export function trackPoint(p, o) { return [p.x - p.tz * o, p.z + p.tx * o]; }

// near any paved access road (rects from map.js), with a margin
const ROADS = [[-30, -170, 14, 60], [0, -305, 14, 130], [0, 350, 14, 120]];
export function nearRoad(x, z, m) {
  return ROADS.some(([cx, cz, w, l]) => Math.abs(x - cx) < w / 2 + m && Math.abs(z - cz) < l / 2 + m);
}

export function buildTrack(env, A) {
  const { T } = env;
  const { pts, N } = A;
  // ---- asphalt ribbon
  const pos = [], uv = [], trk = [], idx = [];
  const tile = T.tile.asphalt;
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N];
    const s = i === N ? A.length : p.s;
    const [lx, lz] = trackPoint(p, -HW), [rx, rz] = trackPoint(p, HW);
    pos.push(lx, 0.025, lz, rx, 0.025, rz);
    uv.push(-HW / tile, s / tile, HW / tile, s / tile);
    const k = i % N;
    trk.push(-HW, A.line[k], A.brake[k], s, HW, A.line[k], A.brake[k], s);
    // counter-clockwise seen from above (left, right, next left ...)
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aTrack', new THREE.Float32BufferAttribute(trk, 4));
  g.setIndex(idx);
  const hiQ = env.q !== 'low';
  const mat = groundMaterial({
    map: T.asphalt, color: '#c4c4c6', roughness: 1,
    normalMap: hiQ ? T.asphaltN : null, normalScale: new THREE.Vector2(0.7, 0.7),
  }, {
    noise: T.noise, macro: { amp: 0.1, s1: 37, s2: 211 }, detail: env.q === 'high' ? { scale: 0.29, mix: 0.45 } : null,
    patches: { scale: 60, thresh: 0.78, dark: 0.2, rough: 1.08 }, cracks: hiQ ? { scale: 17, width: 0.0016, dark: 0.3, mask: 0.64 } : null,
    roughA: hiQ, track: { hw: HW, sigma: 1.6, rubber: 0.34, dust: 0.3 },
  }, 2);
  if (!hiQ) mat.roughness = 0.88;
  env.addGround(new THREE.Mesh(g, mat));

  buildKerbs(env, A);
  buildGravel(env, A);

  // ---- start / finish line and grid slots
  const s = env.world.spawns.start;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH - 0.6, 1.04).rotateX(-Math.PI / 2),
    groundMaterial({ map: T.checker, roughness: 0.6 }, { noise: T.noise, macro: { amp: 0.06 } }, 4));
  line.geometry.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 0) a[i] = v * 3; });
  line.position.set(s.x, 0.03, s.z);
  line.rotation.y = -s.heading + Math.PI / 2;
  env.addGround(line);
  for (const g2 of env.world.spawns.grid) {
    const fx = Math.cos(g2.heading), fz = Math.sin(g2.heading);
    env.decal('slot', g2.x + fx * 2.7, g2.z + fz * 2.7, 1.1, 3.0, g2.heading + Math.PI / 2, 0xe9e9e4);
  }
  // pit-straight markings: "SLOW" style text is avoided on the racing surface
}

function buildKerbs(env, A) {
  const { pts, N, kerbCorner } = A;
  const runs = [];
  let cur = null;
  for (let i = 0; i < N; i++) {
    if (kerbCorner[i]) {
      const side = pts[i].curv > 0 ? 1 : -1;
      if (cur && cur.end === i - 1 && cur.side === side) cur.end = i;
      else runs.push(cur = { start: i, end: i, side });
    }
  }
  // merge wrap-around
  if (runs.length > 1 && runs[0].start === 0 && runs[runs.length - 1].end === N - 1 && runs[0].side === runs[runs.length - 1].side) {
    const last = runs.pop(); runs[0].start = last.start - N;
  }
  const batch = new Batch();
  for (const r of runs) {
    const path = [];
    const a = r.start - 1, b = r.end + 1;
    let s0 = 0;
    for (let i = a; i <= b; i++) {
      const p = pts[(i + N) % N];
      // taper the ends
      const t = Math.min(i - a, b - i);
      const k = Math.min(1, t / 2);
      path.push({ x: p.x, z: p.z, nx: -p.tz * r.side, nz: p.tx * r.side, s: s0, k });
      s0 += 2;
    }
    // profile: track edge up to a raised outer lip, then down to the grass
    const prof = [[HW - 0.05, 0, 0], [HW + 0.2, 0.018, 0.13], [HW + 1.3, 0.055, 0.87], [HW + 1.5, 0.05, 1], [HW + 1.58, 0.0, 1]];
    const geo = sweep(path, prof, { tileV: env.T.tile.kerb, y: 0.03, flip: r.side < 0 });
    // flatten the tapered ends
    const P = geo.attributes.position;
    for (let i = 0; i < path.length; i++) for (let k = 0; k < prof.length; k++) {
      const j = i * prof.length + k;
      P.setY(j, 0.03 + (P.getY(j) - 0.03) * path[i].k);
    }
    geo.computeVertexNormals();
    batch.add(geo);
  }
  if (batch.empty) return;
  const m = groundMaterial({ map: env.T.kerb, roughness: 0.62 }, { noise: env.T.noise, macro: { amp: 0.08, s1: 23, s2: 97 } }, 3);
  env.addGround(new THREE.Mesh(batch.build(false), m));
}

function buildGravel(env, A) {
  const { pts, N } = A;
  const r = rng(77);
  const runs = [];
  let cur = null;
  for (let i = 0; i < N; i++) {
    const side = A.gravel[i];
    if (side) {
      if (cur && cur.end === i - 1 && cur.side === side) cur.end = i;
      else runs.push(cur = { start: i, end: i, side });
    }
  }
  const batch = new Batch();
  const tile = env.T.tile.gravel;
  for (const run of runs) {
    const side = run.side;
    const n = run.end - run.start + 1;
    if (n < 8) continue;
    const P = [], U = [], I = [];
    for (let j = 0; j < n; j++) {
      const p = pts[run.start + j];
      const t = Math.min(j, n - 1 - j) / 9;
      const ease = Math.min(1, t) ** 0.7;
      const inner = HW + 2.0 + (1 - ease) * 5.5 + (r() - 0.5) * 0.35;
      const outer = HW + 8.3;
      const [ix, iz] = trackPoint(p, inner * side), [ox, oz] = trackPoint(p, outer * side);
      P.push(ix, 0.015, iz, ox, 0.015, oz);
      U.push(ix / tile, iz / tile, ox / tile, oz / tile);
      if (j < n - 1) {
        const a = j * 2;
        if (side > 0) I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    batch.add(g);
  }
  if (batch.empty) return;
  const m = groundMaterial({ map: env.T.gravel, normalMap: env.q !== 'low' ? env.T.gravelN : null, roughness: 1, color: '#d8d2c6' },
    { noise: env.T.noise, macro: { amp: 0.12, s1: 19, s2: 83 }, roughA: env.q !== 'low' }, 0.5);
  env.addGround(new THREE.Mesh(batch.build(false), m));
}

// ---------------------------------------------------------------- barriers
// Armco on the outside of straights, catch fences behind corner tyre walls and
// along the main straight, posts, billboards and marshal posts.
export function buildTrackside(env, A) {
  const { pts, N, tyreCorner } = A;
  const hiQ = env.q !== 'low';
  const r = rng(31);
  const steelKit = new BucketBatch(300); // galvanised metal, vertex coloured
  const startX = 115;
  const onStartStraight = (p) => Math.abs(p.x) < startX && p.z < -222;

  // ---- Armco runs on the exterior (left) side where there is no tyre wall
  const ARMCO = HW + 9.2;
  const armcoFlag = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let near = false;
    for (let k = -8; k <= 8 && !near; k++) if (tyreCorner[(i + k + N) % N]) near = true;
    const p = pts[i];
    const [x, z] = trackPoint(p, -ARMCO);
    if (!near && !onStartStraight(p) && !nearRoad(x, z, 10) && !A.insideZone(x, z, 4)) armcoFlag[i] = 1;
  }
  const runs = flagRuns(armcoFlag, N, 6);
  const rail = [[0, 0.52, 0], [0.07, 0.57, 0.15], [0.07, 0.64, 0.4], [0.0, 0.69, 0.5], [0.07, 0.74, 0.6], [0.07, 0.81, 0.85], [0, 0.86, 1]];
  const postGeo = new THREE.BoxGeometry(0.1, 0.9, 0.16).translate(0, 0.45, 0);
  const posts = [];
  for (const run of runs) {
    const path = [];
    let s = 0;
    for (let i = run.start; i <= run.end; i++) {
      const p = pts[i % N];
      const [x, z] = trackPoint(p, -ARMCO);
      // lateral axis points back towards the track
      path.push({ x, z, nx: -p.tz, nz: p.tx, s });
      s += 2;
      if ((i - run.start) % 2 === 0) posts.push(trs(x - p.tz * 0.12, 0, z + p.tx * 0.12, -p.heading));
    }
    const mid = path[path.length >> 1];
    steelKit.add(mid.x, mid.z, sweep(path, rail, { tileV: 4, flip: true }), null, [0.78, 0.8, 0.82]);
  }

  // ---- catch fences behind tyre walls and along the start straight (spectator side)
  const fenceRuns = [];
  const FENCE = HW + 10.6;
  const fenceFlag = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (tyreCorner[i]) for (let k = -3; k <= 3; k++) fenceFlag[(i + k + N) % N] = 1;
  for (const run of flagRuns(fenceFlag, N, 4)) {
    let acc = 0;
    for (let i = run.start; i <= run.end; i++) acc += pts[i % N].curv > 0 ? -1 : 1;
    fenceRuns.push({ ...run, side: acc >= 0 ? 1 : -1, off: FENCE, h: 3.2 });
  }
  // start straight, exterior side in front of the grandstands
  {
    const flag = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      if (onStartStraight(p) && Math.abs(p.x) > 9) flag[i] = 1;
    }
    for (const run of flagRuns(flag, N, 3)) fenceRuns.push({ ...run, side: -1, off: HW + 7.5, h: 3.6 });
  }
  const fenceBatch = new Batch();
  const fenceTile = env.T.tile.fence;
  for (const fr of fenceRuns) {
    const top = [];
    let s = 0;
    for (let i = fr.start; i <= fr.end; i++) {
      const p = pts[i % N];
      const [x, z] = trackPoint(p, fr.off * fr.side);
      top.push({ x, z, s, p });
      if ((i - fr.start) % 2 === 0) posts.push(trs(x, 0, z, -p.heading, 0.9, fr.h / 0.9 * 1.04, 0.6));
      s += 2;
    }
    // mesh panel: vertical ribbon
    const P = [], U = [], I = [];
    top.forEach((q, j) => {
      P.push(q.x, 0.05, q.z, q.x, fr.h, q.z);
      U.push(q.s / fenceTile, 0, q.s / fenceTile, fr.h / fenceTile);
      if (j < top.length - 1) { const a = j * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    fenceBatch.add(g);
    // top and middle tension rails
    const path = top.map(q => ({ x: q.x, z: q.z, nx: -q.p.tz, nz: q.p.tx, s: q.s }));
    const tube = [[0, -0.03], [0.03, 0], [0, 0.03], [-0.03, 0], [0, -0.03]].map(([o, h], k) => [o, h, k / 4]);
    const mid = path[path.length >> 1];
    steelKit.add(mid.x, mid.z, sweep(path, tube, { y: fr.h, tileV: 4 }), null, [0.7, 0.72, 0.74]);
  }
  if (!fenceBatch.empty) {
    const fm = new THREE.MeshStandardMaterial({ map: env.T.fence, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5, alphaTest: 0.02 });
    const mesh = new THREE.Mesh(fenceBatch.build(false), fm);
    env.scene.add(mesh);
  }

  // posts (armco + fence) as one instanced set
  if (posts.length) env.instances(postGeo, env.M.steel, posts.map(m => ({ m })), 500, { castShadow: hiQ });
  for (const m of steelKit.meshes(env.M.steelVC)) {
    m.castShadow = hiQ; m.receiveShadow = true;
    env.scene.add(m);
  }

  buildBillboards(env, A, r);
  buildMarshalPosts(env, A);
}

// contiguous runs of set flags (indices may exceed N on wrap); minimum length
function flagRuns(flag, N, minLen) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < N; i++) {
    if (flag[i]) { if (cur && cur.end === i - 1) cur.end = i; else runs.push(cur = { start: i, end: i }); }
  }
  if (runs.length > 1 && runs[0].start === 0 && runs[runs.length - 1].end === N - 1) {
    const last = runs.pop();
    runs[0] = { start: last.start, end: runs[0].end + N };
  }
  return runs.filter(r => r.end - r.start + 1 >= minLen);
}

function buildBillboards(env, A, r) {
  const { pts, N, tyreCorner } = A;
  const B = new Batch(), frame = new Batch();
  const W = 8.5, H = 1.35, Y0 = 1.0;
  const n = env.T.adCount;
  let k = 0;
  const OFF = HW + 13.5;
  const spots = [];
  for (let i = 40; i < N; i += 55) {
    const p = pts[i];
    // prefer the outside of corners, otherwise the exterior side
    let side = -1;
    for (let j = -6; j <= 6; j++) if (tyreCorner[(i + j + N) % N]) side = pts[(i + j + N) % N].curv > 0 ? -1 : 1;
    const [x, z] = trackPoint(p, OFF * side);
    if (nearRoad(x, z, 10) || A.insideZone(x, z, 8)) continue;
    if (Math.abs(p.x) < 120 && p.z < -220) continue; // start straight has the grandstands
    if (env.blocked(x, z, 6)) continue;
    spots.push({ x, z, yaw: -p.heading + (side > 0 ? 0 : Math.PI) });
  }
  for (const s of spots) {
    const ad = k++ % n;
    const m = trs(s.x, 0, s.z, s.yaw);
    // board faces local -z (towards the track for both sides)
    const face = new THREE.PlaneGeometry(W, H).rotateY(Math.PI).translate(0, Y0 + H / 2, 0);
    const uv = face.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (ad + 1 - uv.getY(i)) / n);
    B.add(face, m);
    frame.add(new THREE.BoxGeometry(W + 0.2, H + 0.2, 0.08).translate(0, Y0 + H / 2, 0.06), m, [0.16, 0.17, 0.18]);
    for (const sx of [-W / 2 + 0.6, W / 2 - 0.6]) frame.add(new THREE.BoxGeometry(0.12, Y0 + H, 0.12).translate(sx, (Y0 + H) / 2, 0.15), m, [0.35, 0.36, 0.37]);
    env.block(s.x, s.z, 6);
  }
  if (B.empty) return;
  const bm = new THREE.MeshStandardMaterial({ map: env.T.ads, roughness: 0.55 });
  const mesh = new THREE.Mesh(B.build(false), bm);
  mesh.castShadow = env.q !== 'low';
  env.scene.add(mesh);
  const fm = new THREE.Mesh(frame.build(), env.M.paintVC);
  fm.castShadow = env.q !== 'low';
  env.scene.add(fm);
}

function buildMarshalPosts(env, A) {
  const { pts, N, tyreCorner } = A;
  const kit = new Batch();
  const glass = new Batch();
  let last = -999;
  for (let i = 0; i < N; i++) {
    if (!tyreCorner[i] || i - last < 120) continue;
    // just past the corner exit
    let j = i;
    while (j < N - 1 && tyreCorner[j]) j++;
    const p = pts[Math.min(N - 1, j + 4)];
    const side = pts[i].curv > 0 ? -1 : 1;
    const [x, z] = trackPoint(p, (HW + 12.5) * side);
    if (nearRoad(x, z, 6) || A.insideZone(x, z, 6) || env.blocked(x, z, 4)) continue;
    last = i;
    const m = trs(x, 0, z, -p.heading + (side > 0 ? 0 : Math.PI));
    kit.add(new THREE.BoxGeometry(2.2, 2.3, 1.8).translate(0, 1.15, 0), m, [0.95, 0.42, 0.08]);
    kit.add(new THREE.BoxGeometry(2.6, 0.12, 2.2).translate(0, 2.36, 0), m, [0.92, 0.92, 0.9]);
    kit.add(new THREE.BoxGeometry(2.0, 0.5, 0.02).translate(0, 1.45, -0.91), m, [0.15, 0.15, 0.16]);
    glass.add(new THREE.PlaneGeometry(1.9, 0.6).rotateY(Math.PI).translate(0, 1.6, -0.92), m);
    // flag stand
    kit.add(new THREE.BoxGeometry(0.06, 1.6, 0.06).translate(1.4, 0.8, -0.6), m, [0.4, 0.4, 0.42]);
    kit.add(new THREE.BoxGeometry(0.02, 0.5, 0.7).translate(1.4, 1.35, -0.25), m, [0.95, 0.78, 0.05]);
    env.block(x, z, 4);
  }
  if (kit.empty) return;
  const mesh = new THREE.Mesh(kit.build(), env.M.paintVC);
  mesh.castShadow = env.q !== 'low';
  env.scene.add(mesh);
  env.scene.add(new THREE.Mesh(glass.build(false), env.M.glass));
}
