// Buildings and set dressing: start/finish gantry, pit building with garages
// and race control tower, grandstands with roof and crowd, floodlight masts,
// infield proving-ground markings and cones, derby bowl dressing and the crash
// test facility. All visual only (no colliders); placed clear of the drivable
// lines and registered with env.block so trees keep out.
import * as THREE from 'three';
import { TRACK_WIDTH } from '../world/map.js';
import { Batch, trs, boxUV, rng } from './envgeom.js';

const HW = TRACK_WIDTH / 2;
const SHIRTS = ['#1b1c1e', '#232427', '#2c2d30', '#e4e4df', '#d6d6d0', '#8d9093', '#5c6066', '#2b3a55', '#3b4f6e', '#4a5d7a',
  '#26324a', '#6b3a2a', '#8f1d1d', '#b02a24', '#c8a43a', '#2f5d3a', '#d06a1e', '#1f4f9a', '#5a4632', '#c9c2b0'];
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// multi-material batch: one merged mesh per material key
export class Kit {
  constructor(env) { this.env = env; this.b = {}; }
  add(key, geo, m = null, color = null, uvFn = null) {
    (this.b[key] || (this.b[key] = new Batch())).add(geo, m, color, uvFn);
    return this;
  }
  // axis-aligned box in the frame m (default world): centre x,z, bottom y
  box(key, x, y, z, w, h, d, color = null, m = null, uvFn = null) {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
    return this.add(key, g, m, color, uvFn);
  }
  flush({ cast = true, receive = true } = {}) {
    const out = [];
    for (const key in this.b) {
      const mat = this.env.M[key];
      const mesh = new THREE.Mesh(this.b[key].build(!!mat.vertexColors), mat);
      mesh.castShadow = cast && this.env.q !== 'low' && !mat.transparent;
      mesh.receiveShadow = receive;
      this.env.scene.add(mesh);
      out.push(mesh);
    }
    this.b = {};
    return out;
  }
}

// lattice tower / truss helpers (thin boxes)
function bar(kit, key, a, b, t, color, m) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  const mm = new THREE.Matrix4().compose(a.clone().addScaledVector(d, 0.5), q, new THREE.Vector3(1, 1, 1));
  kit.add(key, g, m ? m.clone().multiply(mm) : mm, color);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function latticeTower(kit, key, x, z, w, h, color, m) {
  const s = w / 2;
  const cs = [[-s, -s], [s, -s], [s, s], [-s, s]];
  for (const [a, b] of cs) bar(kit, key, V(x + a, 0, z + b), V(x + a, h, z + b), 0.1, color, m);
  const lv = Math.max(2, Math.round(h / 1.4));
  for (let k = 0; k <= lv; k++) {
    const y = h * k / lv;
    for (let e = 0; e < 4; e++) {
      const [a0, b0] = cs[e], [a1, b1] = cs[(e + 1) % 4];
      bar(kit, key, V(x + a0, y, z + b0), V(x + a1, y, z + b1), 0.05, color, m);
      if (k < lv) bar(kit, key, V(x + a0, y, z + b0), V(x + a1, y + h / lv, z + b1), 0.035, color, m);
    }
  }
}

// floodlight mast: tapered pole and a lamp head aimed along yaw (three.js yaw)
export function lightMast(kit, x, z, yaw, h = 24) {
  const m = trs(x, 0, z, yaw);
  kit.add('steel', new THREE.CylinderGeometry(0.17, 0.3, h, 8).translate(0, h / 2, 0), m);
  kit.add('wall', new THREE.CylinderGeometry(0.55, 0.65, 0.5, 10).translate(0, 0.25, 0), m, [0.9, 0.9, 0.88]);
  kit.box('paintVC', 0, h - 0.4, 0.35, 3.4, 0.12, 0.7, lin('#5d6266'), m);
  kit.box('paintVC', 0, h + 1.9, 0.35, 3.4, 0.12, 0.7, lin('#5d6266'), m);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const px = -1.2 + c * 0.8, py = h - 0.2 + r * 0.7;
    const lm = m.clone().multiply(trs(px, py, 0.55, 0).multiply(new THREE.Matrix4().makeRotationX(0.35)));
    kit.box('paintVC', 0, 0, 0, 0.66, 0.5, 0.22, lin('#2a2d30'), lm);
    kit.add('lamp', new THREE.PlaneGeometry(0.56, 0.4).translate(0, 0.25, 0.115), lm);
  }
}

// ---------------------------------------------------------------- start gantry
export function buildGantry(env, kit) {
  const s = env.world.spawns.start;
  const m = trs(s.x, 0, s.z, -s.heading); // local x forward, z right
  const Z = HW + 2.4, H = 7.6;
  const grey = lin('#c9ccce');
  for (const side of [-1, 1]) {
    latticeTower(kit, 'steelVC', 0, side * Z, 1.1, H, grey, m);
    kit.box('wall', 0, 0, side * Z, 1.6, 0.35, 1.6, [0.85, 0.85, 0.83], m, boxUV(4));
  }
  // box truss beam
  const y0 = H - 1.1, y1 = H;
  for (const [cx, cy] of [[-0.5, y0], [0.5, y0], [-0.5, y1], [0.5, y1]]) bar(kit, 'steelVC', V(cx, cy, -Z), V(cx, cy, Z), 0.12, grey, m);
  const nb = Math.round(Z * 2 / 1.2);
  for (let k = 0; k <= nb; k++) {
    const z = -Z + k * Z * 2 / nb;
    for (const cx of [-0.5, 0.5]) {
      bar(kit, 'steelVC', V(cx, y0, z), V(cx, y1, z), 0.05, grey, m);
      if (k < nb) bar(kit, 'steelVC', V(cx, y0, z), V(cx, y1, z + Z * 2 / nb), 0.04, grey, m);
    }
    bar(kit, 'steelVC', V(-0.5, y1, z), V(0.5, y1, z), 0.04, grey, m);
  }
  // banner on both faces (ads atlas row 3: proving ground)
  const ad = 3, n = env.T.adCount;
  for (const dir of [-1, 1]) {
    const g = new THREE.PlaneGeometry(Z * 1.6, 1.5).rotateY(dir < 0 ? -Math.PI / 2 : Math.PI / 2).translate(dir * 0.62, y0 + 0.55, 0);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (ad + 1 - uv.getY(i)) / n);
    kit.add('ads', g, m);
  }
  // start light pod facing the grid (local -x)
  kit.box('paintVC', 0, y0 - 1.3, 0, 0.5, 1.2, 4.4, lin('#1a1c1e'), m);
  for (let c = 0; c < 5; c++) for (let r = 0; r < 2; r++) {
    const g = new THREE.CircleGeometry(0.17, 12).rotateY(-Math.PI / 2).translate(-0.26, y0 - 0.95 + r * 0.45, -1.6 + c * 0.8);
    kit.add('redLamp', g, m);
  }
  env.block(s.x, s.z - Z, 3); env.block(s.x, s.z + Z, 3);
}

// ---------------------------------------------------------------- pits
export function buildPits(env, kit) {
  const T = env.T;
  const Z0 = -216.5, Z1 = -206; // pit lane between the pit wall and garages
  const blocks = [[-104, -44], [-16, 92]];
  const D = 14, G = Z1 + 0.5, BZ = G + D; // garages from z = G to BZ
  // pit lane asphalt + entry / exit tapers to the track edge
  const lane = new Batch();
  const tile = T.tile.asphalt;
  const uvW = boxUV(tile);
  lane.add(new THREE.PlaneGeometry(200, Z1 - Z0).rotateX(-Math.PI / 2).translate(-6, 0, (Z0 + Z1) / 2), null, null, uvW);
  const pts = env.world.track.pts;
  const edgeAt = (x) => { // inner track edge z near a given x on the start straight
    let best = null, bd = 1e9;
    for (const p of pts) if (p.z < -200 && Math.abs(p.x - x) < bd) { bd = Math.abs(p.x - x); best = p; }
    return best.z + best.tx * (HW - 0.2);
  };
  for (const [xa, xb] of [[-156, -106], [94, 144]]) {
    const ea = edgeAt(xa), eb = edgeAt(xb);
    const inA = xa < 0; // entry at the west end
    const P = inA
      ? [xa, 0, ea, xb, 0, Z0, xb, 0, Z1, xa, 0, ea + 4]
      : [xa, 0, Z0, xb, 0, eb, xb, 0, eb + 4, xa, 0, Z1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    lane.add(g, null, null, uvW);
  }
  env.addGround(new THREE.Mesh(lane.build(false), env.padMat));
  // pit lane paint: fast-lane line, garage boxes, entry text
  env.paintLine(-104, (Z0 + Z1) / 2 - 1.2, 92, (Z0 + Z1) / 2 - 1.2, 0.15, 0xe9e9e4);
  env.paintLine(-104, Z1 - 0.3, 92, Z1 - 0.3, 0.12, 0xe8b400);
  for (const [xa, xb] of blocks) for (let x = xa + 3; x < xb - 3; x += 6) {
    env.paintRect(x, Z1 - 3.2, 4.6, 5.2, 0, 0xe9e9e4, 0.1);
  }
  env.decal('PITLANE', -118, (Z0 + Z1) / 2, 7, 1.8, 0, 0xe9e9e4);
  // pit wall (concrete with a fence on top)
  kit.box('wall', -6, 0, Z0 - 0.4, 200, 1.05, 0.5, [0.93, 0.93, 0.91], null, boxUV(4));
  kit.box('paintVC', -6, 1.05, Z0 - 0.4, 200, 0.08, 0.56, lin('#d9d9d4'));
  for (let x = -105; x <= 93; x += 3) kit.box('steel', x, 1.1, Z0 - 0.4, 0.06, 2.2, 0.06);
  env.fenceStrip(-106, Z0 - 0.4, 94, Z0 - 0.4, 1.1, 2.2);
  // timing stand on the pit wall at the line
  kit.box('paintVC', 3, 1.05, Z0 - 0.9, 8, 2.4, 1.2, lin('#2d3135'));
  kit.add('glass', new THREE.PlaneGeometry(7.6, 1.2).rotateY(Math.PI).translate(3, 2.6, Z0 - 1.51));

  const white = lin('#e6e7e4'), darkGrey = lin('#3a3f44'), steelC = lin('#aab0b4');
  for (const [xa, xb] of blocks) {
    const W = xb - xa, cx = (xa + xb) / 2;
    // ground floor: garage bays with roller doors
    kit.box('cladding', cx, 0, (G + BZ) / 2, W, 4.8, D, white, null, boxUV(3));
    for (let x = xa + 3; x < xb - 2.9; x += 6) {
      kit.add('door', new THREE.PlaneGeometry(4.6, 4.0).rotateY(Math.PI).translate(x, 2.0, G - 0.02));
      kit.box('paintVC', x - 2.75, 0, G - 0.15, 0.6, 4.8, 0.3, darkGrey);
    }
    kit.box('paintVC', cx, 4.0, G - 0.12, W, 0.8, 0.26, lin('#1d4f91'));
    // upper floor: glazed hospitality level with a balcony
    kit.box('paintVC', cx, 4.8, (G + BZ) / 2, W, 0.35, D, darkGrey);
    kit.add('glass', new THREE.BoxGeometry(W - 0.4, 3.6, D - 2).translate(cx, 5.15 + 1.8, (G + BZ) / 2 + 0.5), null, null, boxUV(4, 3.6));
    kit.box('steel', cx, 5.15, G + 0.1, W, 1.05, 0.05);
    for (let x = xa; x <= xb; x += 6) kit.box('steel', x, 5.15, G + 0.1, 0.06, 1.05, 0.06);
    // roof slab with a canopy over the pit lane
    kit.box('paintVC', cx, 8.75, (G + BZ) / 2 - 1.5, W + 1, 0.45, D + 4, lin('#d4d5d2'));
    kit.box('paintVC', cx, 9.2, BZ - 0.4, W + 1, 0.6, 0.6, lin('#d4d5d2'));
    for (let x = xa + 1; x < xb; x += 12) kit.box('steel', x, 0, G - 2.9, 0.2, 8.75, 0.2);
    // rooftop plant
    for (let x = xa + 8; x < xb - 6; x += 22) kit.box('paintVC', x, 9.2, BZ - 4, 4, 1.6, 3, steelC);
    // paddock side: office windows above, service doors below
    kit.add('glass', new THREE.PlaneGeometry(W - 2, 1.6).translate(cx, 6.6, BZ + 0.03), null, null, boxUV(4, 1.6));
    for (let x = xa + 3; x < xb - 2.9; x += 6) {
      kit.add('door', new THREE.PlaneGeometry(3.2, 3.4).translate(x, 1.7, BZ + 0.03));
      kit.box('paintVC', x, 3.4, BZ + 0.15, 3.6, 0.2, 0.3, darkGrey);
    }
    env.blockRect(xa - 2, G - 4, xb + 2, BZ + 3);
    env.shadeRects.push([cx, (G + BZ) / 2, W + 6, D + 8, 0.6]);
  }
  // race control tower on the start line
  const tx = 6, tz = G + 6;
  kit.box('cladding', tx, 9.2, tz, 8, 9, 8, white, null, boxUV(3));
  kit.add('glass', new THREE.BoxGeometry(11, 3.4, 10).translate(tx, 18.2 + 1.7, tz - 1), null, null, boxUV(4, 3.4));
  kit.box('paintVC', tx, 18.0, tz - 1, 11.6, 0.3, 10.6, darkGrey);
  kit.box('paintVC', tx, 21.6, tz - 1, 12.4, 0.5, 11.4, lin('#d4d5d2'));
  kit.box('paintVC', tx, 22.1, tz - 1, 1.2, 3.5, 1.2, steelC);
  // sign on the tower
  {
    const g = new THREE.PlaneGeometry(10, 1.3).rotateY(Math.PI).translate(tx, 16.6, tz - 4.06);
    const uv = g.attributes.uv, n = T.adCount, ad = 6;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (ad + 1 - uv.getY(i)) / n);
    kit.add('ads', g);
  }
  // paddock transporters behind the garages
  const r = rng(12);
  const liveries = ['#c8202a', '#1f4f9a', '#e9e9e6', '#1c1c1e', '#f0a020', '#2e7d4f'];
  for (let k = 0; k < 6; k++) {
    const x = -96 + k * 31 + r() * 4, z = BZ + 9 + r() * 6;
    if (Math.abs(x + 30) < 12) continue;
    const c = lin(liveries[k % liveries.length]);
    kit.box('paintVC', x, 1.1, z, 2.5, 3.0, 13.5, c);
    kit.box('paintVC', x, 0.6, z - 8.0, 2.5, 2.7, 2.4, c);
    kit.box('glass', x, 2.0, z - 9.25, 2.3, 1.0, 0.05);
    kit.box('rubber', x, 0, z + 3, 2.6, 1.0, 5);
    kit.box('rubber', x, 0, z - 7.4, 2.6, 1.0, 1.4);
  }
  env.blockRect(-110, BZ, 100, BZ + 26);
}

// ---------------------------------------------------------------- grandstands
// Built in a local frame (x along the straight, +z away from the track) and
// turned to face the track.
export function buildGrandstands(env, kit) {
  const T = env.T;
  const rows = 12, rowD = 0.85, rowH = 0.48, front = -253, podium = 2.0;
  const stands = [[-95, -13], [13, 95]];
  const concrete = [0.92, 0.92, 0.9];
  const seatCols = [lin('#2a5aa0'), lin('#c9cdd2')];
  const steelC = [0.75, 0.77, 0.8];
  const crowd = [];
  const r = rng(77);
  const fill = env.q === 'high' ? 0.72 : env.q === 'medium' ? 0.45 : 0;
  const depth = 0.6 + rows * rowD, topY = podium + rows * rowH;
  for (const [xa, xb] of stands) {
    const W = xb - xa, cx = (xa + xb) / 2;
    const m = trs(cx, 0, front, Math.PI); // local (x, y, z) -> world (cx - x, y, front - z)
    // podium front wall with ad boards facing the track (local -z)
    kit.box('wall', 0, 0, 0.3, W, podium, 0.6, concrete, m, boxUV(4));
    const nAds = Math.floor(W / 9);
    for (let k = 0; k < nAds; k++) {
      const x = -W / 2 + (k + 0.5) * W / nAds;
      const g = new THREE.PlaneGeometry(8.4, 1.3).rotateY(Math.PI).translate(x, 0.95, -0.03);
      const uv = g.attributes.uv, n = T.adCount, ad = (k + (xa > 0 ? 3 : 0)) % n;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (ad + 1 - uv.getY(i)) / n);
      kit.add('ads', g, m);
    }
    // stepped terraces with the crowd texture on the treads
    for (let k = 0; k < rows; k++) {
      const z0 = 0.6 + k * rowD, y = podium + k * rowH;
      kit.box('wall', 0, 0, z0 + rowD / 2, W, y, rowD, concrete, m, boxUV(4));
      const shade = k > rows - 7 ? 0.62 : 0.85; // under the roof
      const tread = new THREE.PlaneGeometry(W, rowD).rotateX(-Math.PI / 2).translate(0, y + 0.01, z0 + rowD / 2);
      const uv = tread.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 8, (uv.getY(i) + k) / 8);
      kit.add('crowd', tread, m, [shade, shade, shade]);
      kit.box('paintVC', 0, y, z0 + rowD - 0.1, W, 0.42, 0.06, seatCols[k % 2].map(v => v * shade), m);
      if (fill > 0) {
        for (let x = -W / 2 + 0.4; x < W / 2 - 0.3; x += 0.55) {
          if (((x + W / 2) % 20) < 1.4) continue; // aisles
          if (r() > fill) continue;
          const local = trs(x + (r() - 0.5) * 0.1, y, z0 + rowD - 0.32, (r() - 0.5) * 0.5, 1, 0.92 + r() * 0.16, 1);
          // mostly neutral clothing (black, grey, white, denim), some team colours
          const c = new THREE.Color(SHIRTS[(r() * SHIRTS.length) | 0]).multiplyScalar(0.8 + r() * 0.35);
          crowd.push({ m: m.clone().multiply(local), c: c.multiplyScalar(shade) });
        }
      }
    }
    // back wall and stair towers at the ends
    kit.box('wall', 0, 0, depth + 0.25, W, topY + 1.2, 0.5, concrete, m, boxUV(4));
    for (const x of [-W / 2 + 1.5, W / 2 - 1.5]) kit.box('wall', x, 0, depth / 2, 3, topY + 1.2, depth, [0.85, 0.85, 0.83], m, boxUV(4));
    // roof: columns at the back, cantilever trusses, sloped sheet roof
    const roofY = topY + 4.2, zb = depth + 0.6, zf = -1.0;
    for (let x = -W / 2 + 1.5; x <= W / 2 - 1.4; x += 10) {
      kit.box('steel', x, 0, zb, 0.4, roofY + 1.7, 0.4, null, m);
      bar(kit, 'steelVC', V(x, roofY + 0.2, zb), V(x, roofY - 0.5, zf), 0.18, steelC, m);
      bar(kit, 'steelVC', V(x, roofY + 1.6, zb), V(x, roofY - 0.3, zf), 0.14, steelC, m);
      for (let t = 1; t < 5; t++) {
        const zz = zb + (zf - zb) * t / 5;
        bar(kit, 'steelVC', V(x, roofY + 0.2 - 0.7 * t / 5, zz), V(x, roofY + 1.6 - 1.9 * t / 5, zz), 0.06, steelC, m);
      }
    }
    const roof = new THREE.BoxGeometry(W + 1, 0.22, zb - zf + 1.2);
    const tilt = new THREE.Matrix4().makeRotationX(0.07);
    kit.add('cladding', roof, m.clone().multiply(trs(0, roofY - 0.05, (zb + zf) / 2).multiply(tilt)), [0.85, 0.86, 0.88], boxUV(3));
    env.blockRect(xa - 2, front - depth - 4, xb + 2, front + 2);
    env.shadeRects.push([cx, front - depth / 2, W + 4, depth + 6, 0.65]);
  }
  if (crowd.length) {
    // bodies take the shirt colour; heads are a second instanced set
    const g = new Batch();
    g.add(new THREE.BoxGeometry(0.42, 0.5, 0.26).translate(0, 0.42, 0));
    g.add(new THREE.BoxGeometry(0.4, 0.17, 0.42).translate(0, 0.08, -0.1), null, [0.3, 0.32, 0.36]);
    env.instances(g.build(), env.M.people, crowd, 60, { castShadow: false });
    env.instances(new THREE.OctahedronGeometry(0.12, 0).translate(0, 0.8, -0.02), env.M.skin, crowd.map(c => ({ m: c.m })), 60, { castShadow: false });
  }
  // floodlight masts behind the stands and behind the pits, aimed at the straight
  for (const x of [-104, -10, 104]) lightMast(kit, x, front - depth - 7, 0, 26);
  for (const x of [-75, 75]) lightMast(kit, x, -188, Math.PI, 24);
}

// ---------------------------------------------------------------- cones
export function coneGeometry() {
  const b = new Batch();
  const orange = lin('#ff5a0a'), white = lin('#f0f0ea');
  b.add(new THREE.BoxGeometry(0.38, 0.03, 0.38).translate(0, 0.015, 0), null, lin('#1c1c1c'));
  const segs = [[0.0, 0.18, orange], [0.18, 0.3, white], [0.3, 0.42, orange], [0.42, 0.52, white], [0.52, 0.7, orange]];
  for (const [y0, y1, c] of segs) {
    const r0 = 0.15 - y0 * 0.17, r1 = 0.15 - y1 * 0.17;
    b.add(new THREE.CylinderGeometry(r1, r0, y1 - y0, 10, 1, y1 < 0.7).translate(0, 0.03 + (y0 + y1) / 2, 0), null, c);
  }
  return b.build();
}

// ---------------------------------------------------------------- infield
export function buildInfield(env, kit, cones) {
  const z = env.world.zones.infield;
  const W = 0xe9e9e4, Y = 0xe8b400;
  // skid pad
  const sp = [25, -100];
  env.paintArc(sp[0], sp[1], 28, 0.25, 0, Math.PI * 2, W);
  env.paintArc(sp[0], sp[1], 14, 0.2, 0, Math.PI * 2, Y);
  env.paintArc(sp[0], sp[1], 28.9, 0.12, 0, Math.PI * 2, W);
  env.decal('SKIDPAD', sp[0], sp[1] + 34, 12, 1.5, 0, W);
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2;
    cones.push([sp[0] + Math.cos(a) * 30.5, sp[1] + Math.sin(a) * 30.5]);
  }
  // rubber: circles on the skid pad, donuts, braking streaks
  for (let k = 0; k < 7; k++) {
    const a0 = k * 1.9, len = 2.5 + (k % 3) * 1.4;
    env.rubberArc(sp[0], sp[1], 24 + (k % 4) * 2.4, a0, a0 + len, k);
  }
  for (let k = 0; k < 4; k++) env.rubberArc(sp[0], sp[1], 10 + k * 1.2, k, k + 4.5, k + 3);
  for (const [dx, dz] of [[-48, -22], [-41, -18]]) env.rubberArc(dx, dz, 4.5, 0, Math.PI * 2, 5, 1.5);
  for (const zz of [-148, -144, -140]) env.rubberLine(38 + (zz % 3), zz, 64, zz, 1.55);
  for (const c of env.world.colliders) {
    if (!c.ramp) continue;
    const r = c.ramp, fx = Math.cos(r.heading), fz = Math.sin(r.heading);
    const lx = r.x + fx * (r.run + 9), lz = r.z + fz * (r.run + 9);
    env.rubberLine(lx, lz, lx + fx * 14, lz + fz * 14, 1.6);
  }
  // braking lanes along the south edge with distance boards
  const lz = [-150, -146, -142, -138];
  for (const zz of lz) env.paintLine(-125, zz, 62, zz, 0.15, W);
  for (let x = -100, k = 0; x <= 60; x += 10, k++) {
    env.paintLine(x, lz[0], x, lz[3], 0.12, k % 5 === 0 ? Y : W);
  }
  ['n10', 'n20', 'n30', 'n40', 'n50', 'n60'].forEach((nm, k) => env.decal(nm, -100 + (k + 1) * 20 - 3, -135.6, 2.2, 2.2, 0, W));
  env.decal('STOP', 66, -144, 8, 2, 0, Y);
  ['n1', 'n2', 'n3'].forEach((nm, k) => env.decal(nm, -128.5, -148 + k * 4, 1.8, 1.8, 0, W));
  for (const zz of lz) cones.push([-125, zz], [62, zz]);
  // slalom
  for (let k = 0; k < 7; k++) cones.push([-118 + k * 9, 18 + (k % 2) * 0.01]);
  env.paintLine(-124, 14, -60, 14, 0.12, W); env.paintLine(-124, 22, -60, 22, 0.12, W);
  // crash wall approach lane
  env.paintLine(-30, 14, 38, 14, 0.2, Y); env.paintLine(-30, 26, 38, 26, 0.2, Y);
  for (let x = -20; x < 36; x += 6) env.paintLine(x, 18, x + 3, 22, 0.25, Y), env.paintLine(x, 22, x + 3, 18, 0.25, Y);
  env.decal('CRASHLAB', 26, 20, 10, 1.4, 0, W);
  // ramp approaches: arrows and chevrons
  for (const c of env.world.colliders) {
    if (!c.ramp) continue;
    const r = c.ramp, fx = Math.cos(r.heading), fz = Math.sin(r.heading);
    for (let k = 1; k <= 3; k++) env.decal('arrow', r.x - fx * (k * 7), r.z - fz * (k * 7), 1.6, 2.6, r.heading, Y);
    env.paintRect(r.x - fx * 1, r.z - fz * 1, r.width + 0.6, 0.3, -r.heading + Math.PI / 2, Y);
    cones.push([r.x - fx * 3 - fz * (r.width / 2 + 1), r.z - fz * 3 + fx * (r.width / 2 + 1)]);
    cones.push([r.x - fx * 3 + fz * (r.width / 2 + 1), r.z - fz * 3 - fx * (r.width / 2 + 1)]);
  }
  // lamp post service road edge line and parking bays
  env.paintLine(-108, -132, -108, 50, 0.15, W);
  for (let k = 0; k < 8; k++) env.paintRect(-125, -40 + k * 3, 6, 0.1, 0, W);
  // pad edge lines
  const x0 = z.x - z.w / 2 + 1.5, x1 = z.x + z.w / 2 - 1.5, z0 = z.z - z.l / 2 + 1.5, z1 = z.z + z.l / 2 - 1.5;
  env.paintLine(x0, z0, x1, z0, 0.2, W); env.paintLine(x1, z0, x1, z1, 0.2, W);
  env.paintLine(x1, z1, x0, z1, 0.2, W); env.paintLine(x0, z1, x0, z0, 0.2, W);
  // test control cabin + flag poles off the west edge
  const cx = -150, cz = 30;
  kit.box('cladding', cx, 0.3, cz, 3, 2.8, 9, lin('#e8e8e4'), null, boxUV(3));
  kit.box('paintVC', cx, 3.1, cz, 3.4, 0.15, 9.4, lin('#5b6166'));
  kit.add('glass', new THREE.PlaneGeometry(6, 1.1).rotateY(Math.PI / 2).translate(cx + 1.52, 1.9, cz));
  kit.box('paintVC', cx + 1.55, 0.3, cz - 3.4, 0.05, 2.1, 0.95, lin('#2f3236'));
  for (let k = 0; k < 4; k++) kit.box('wall', cx, 0, cz - 3.5 + k * 2.33, 2.6, 0.3, 0.4, [0.8, 0.8, 0.78], null, boxUV(4));
  env.blockRect(cx - 4, cz - 7, cx + 4, cz + 7);
  env.shadeRects.push([cx, cz, 5, 11, 0.5]);
}

// ---------------------------------------------------------------- derby bowl
export function buildDerbyProps(env, kit) {
  const d = env.world.zones.derby;
  for (const a of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4 - 0.25, -3 * Math.PI / 4 + 0.25]) {
    const x = d.x + Math.cos(a) * (d.r + 13), z = d.z + Math.sin(a) * (d.r + 13);
    // aim the head at the arena centre
    lightMast(kit, x, z, Math.atan2(d.x - x, d.z - z), 22);
    env.block(x, z, 4);
  }
  // spectator bank on the north side
  const by = d.z + d.r + 9, W = 34;
  for (let k = 0; k < 6; k++) {
    kit.box('wall', d.x, 0, by + k * 0.9, W, 0.5 + k * 0.45, 0.9, [0.88, 0.88, 0.86], null, boxUV(4));
    kit.box('paintVC', d.x, 0.5 + k * 0.45, by + k * 0.9 + 0.2, W, 0.06, 0.35, lin('#9aa1a7'));
  }
  for (let x = -W / 2; x <= W / 2; x += 5.6) kit.box('steel', d.x + x, 0, by + 5.6, 0.12, 3.6, 0.12);
  kit.box('cladding', d.x, 3.6, by + 3.2, W + 1, 0.15, 6.4, lin('#c9ccd0'), null, boxUV(3));
  env.blockRect(d.x - W / 2 - 3, by - 2, d.x + W / 2 + 3, by + 8);
  // perimeter catch fence around the bowl
  const n = 48, R = d.r + 3.2;
  for (let k = 0; k < n; k++) {
    const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
    if (Math.abs(Math.sin(a0) + 1) < 0.02) continue;
    env.fenceStrip(d.x + Math.cos(a0) * R, d.z + Math.sin(a0) * R, d.x + Math.cos(a1) * R, d.z + Math.sin(a1) * R, 0, 3.0);
    kit.box('steel', d.x + Math.cos(a0) * R, 0, d.z + Math.sin(a0) * R, 0.09, 3.1, 0.09);
  }
}

// ---------------------------------------------------------------- crash lab
export function buildLabProps(env, kit, cones) {
  const lab = env.world.zones.lab;
  const x0 = lab.x + 40, z0 = lab.z; // impact point used by the crash test mode
  const W = 0xe9e9e4, Y = 0xe8b400;
  // lane markings
  for (const s of [-1, 1]) env.paintLine(lab.x - lab.w / 2 + 2, z0 + s * 3.2, lab.x + lab.w / 2 - 2, z0 + s * 3.2, 0.15, Y, 3, 2);
  for (const s of [-1, 1]) env.paintLine(lab.x - lab.w / 2 + 2, z0 + s * (lab.l / 2 - 2), lab.x + lab.w / 2 - 2, z0 + s * (lab.l / 2 - 2), 0.2, W);
  env.rubberLine(x0 - 60, z0, x0 - 2, z0, 1.6, 0.18);
  // calibration grid ahead of the barrier and distance marks on the run-up
  env.decal('calib', x0 - 5, z0, 8, 4, Math.PI / 2, 0xffffff);
  for (let k = 1; k <= 6; k++) {
    const x = x0 - 2 - k * 10;
    env.paintLine(x, z0 - 6, x, z0 + 6, 0.12, W);
    env.decal('n' + k * 10, x - 1.6, z0 + 8, 2, 2, 0, W);
  }
  env.decal('CRASHLAB', x0 - 12, z0 - 9, 10, 1.4, -Math.PI / 2, W);
  // camera / light gantry over the impact zone
  const gx = x0 + 1.5;
  for (const s of [-1, 1]) latticeTower(kit, 'steelVC', gx, z0 + s * 9.5, 0.9, 7.5, [0.85, 0.86, 0.88]);
  for (const [dx, y] of [[-0.45, 6.7], [0.45, 6.7], [-0.45, 7.5], [0.45, 7.5]]) bar(kit, 'steelVC', V(gx + dx, y, z0 - 9.5), V(gx + dx, y, z0 + 9.5), 0.1, [0.85, 0.86, 0.88]);
  for (let k = 0; k < 4; k++) {
    const zz = z0 - 6 + k * 4;
    kit.box('paintVC', gx, 6.0, zz, 0.5, 0.6, 0.5, lin('#202326'));
    kit.box('paintVC', gx, 5.75, zz, 0.2, 0.25, 0.2, lin('#101112'));
  }
  for (const s of [-1, 1]) {
    // side light rigs aimed at the barrier
    const z = z0 + s * 9.5;
    for (let k = 0; k < 3; k++) {
      const lx = x0 - 10 + k * 5;
      kit.box('steel', lx, 0, z, 0.12, 4.2, 0.12);
      const lm = trs(lx, 4.2, z, s > 0 ? Math.PI : 0).multiply(new THREE.Matrix4().makeRotationX(0.75));
      kit.box('paintVC', 0, 0, 0, 1.2, 0.7, 0.3, lin('#26292c'), lm);
      for (const dx of [-0.3, 0.3]) kit.add('lamp', new THREE.PlaneGeometry(0.46, 0.5).translate(dx, 0.35, 0.155), lm);
    }
    // calibration target boards on stands
    for (const dx of [-4, 4]) {
      const bx = x0 + dx, bz = z0 + s * 7;
      kit.box('steel', bx, 0, bz, 0.08, 1.2, 0.08);
      kit.add('target', new THREE.PlaneGeometry(1.1, 1.1).rotateY(s > 0 ? Math.PI : 0).translate(bx, 1.75, bz));
    }
  }
  // big target boards at the strip ends (as before)
  for (const s of [-1, 1]) kit.add('target', new THREE.PlaneGeometry(4, 4).rotateY(s > 0 ? Math.PI : 0).translate(lab.x + 120, 3, lab.z + s * (lab.l / 2 + 1.4)));
  for (const s of [-1, 1]) kit.box('steel', lab.x + 120, 0, lab.z + s * (lab.l / 2 + 1.5), 3.6, 1.0, 0.1);
  // test hall south of the strip with offices
  const hz0 = lab.z - lab.l / 2 - 12, hz1 = hz0 - 26;
  const hx0 = x0 - 20, hx1 = x0 + 50;
  const wallC = lin('#d8dadc');
  kit.box('cladding', (hx0 + hx1) / 2, 0, (hz0 + hz1) / 2, hx1 - hx0, 12, hz0 - hz1, wallC, null, boxUV(3));
  kit.box('paintVC', (hx0 + hx1) / 2, 12, (hz0 + hz1) / 2, hx1 - hx0 + 0.6, 0.6, hz0 - hz1 + 0.6, lin('#4a4f55'));
  for (let k = 0; k < 2; k++) {
    const dx = hx0 + 12 + k * 18;
    kit.add('door', new THREE.PlaneGeometry(10, 7.5).translate(dx, 3.75, hz0 + 0.03));
    kit.box('paintVC', dx, 7.5, hz0 + 0.2, 10.6, 0.5, 0.4, lin('#2d3135'));
  }
  kit.box('paintVC', hx0 + 44, 8.6, hz0 + 0.08, 22, 2.2, 0.15, lin('#1d4f91'));
  {
    const g = new THREE.PlaneGeometry(20, 1.8).translate(hx0 + 44, 9.7, hz0 + 0.17);
    const uv = g.attributes.uv, n = env.T.adCount, ad = 3;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (ad + 1 - uv.getY(i)) / n);
    kit.add('ads', g);
  }
  // office annex
  const ox = hx1 + 9;
  kit.box('cladding', ox, 0, hz0 - 8, 18, 7.6, 16, wallC, null, boxUV(3));
  kit.add('glass', new THREE.BoxGeometry(18.1, 2.4, 16.1).translate(ox, 4.6, hz0 - 8), null, null, boxUV(4, 2.4));
  kit.add('glass', new THREE.BoxGeometry(18.1, 1.8, 16.1).translate(ox, 1.2, hz0 - 8), null, null, boxUV(4, 1.8));
  kit.box('paintVC', ox, 7.6, hz0 - 8, 18.6, 0.4, 16.6, lin('#4a4f55'));
  env.blockRect(hx0 - 4, hz1 - 4, ox + 12, hz0 + 4);
  env.shadeRects.push([(hx0 + ox + 9) / 2, (hz0 + hz1) / 2, ox + 9 - hx0 + 6, hz0 - hz1 + 8, 0.55]);
  // light towers along the strip
  for (const x of [lab.x - 120, lab.x - 40, lab.x + 120]) lightMast(kit, x, lab.z - lab.l / 2 - 5, 0, 20);
  // cones marking the run-off past the barrier
  for (let k = 0; k < 6; k++) cones.push([x0 + 14 + k * 4, z0 - 5], [x0 + 14 + k * 4, z0 + 5]);
}
