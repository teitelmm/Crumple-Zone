// Landscape: rolling terrain and mountain ridges beyond the boundary walls,
// instanced trees (several species, forest clusters), bushes and grass tufts,
// the perimeter fence and the world map texture the grass shader samples
// (distance to the track for verges / mowing stripes, shade under trees).
import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { TRACK_WIDTH } from '../world/map.js';
import { envMaterial, patchMaterial } from './envshader.js';
import { rng, trs, chunkedInstances, Batch } from './envgeom.js';

const HW = TRACK_WIDTH / 2;
export const FLAT = 756;      // terrain is flat (y = 0) inside this squircle radius
const EDGE = 1850;            // terrain / mountain extent (keeps it inside the far plane)

// distant haze shared by the terrain and the trees standing on it (envshader.js)
export const HAZE = { scale: 0.5, max: 0.64, alt: 0.0003 };

const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
// squircle distance: ~max(|x|, |z|) with rounded corners (the boundary corner
// at 720,720 measures 751, so everything inside the walls stays flat)
const sq = (x, z) => Math.pow(Math.pow(Math.abs(x) / 1000, 16) + Math.pow(Math.abs(z) / 1000, 16), 1 / 16) * 1000;

export function makeTerrain() {
  const perlin = new ImprovedNoise();
  const fbm = (x, z, oct, seed) => {
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { s += a * perlin.noise(x * f, z * f, seed + o * 7.13); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  };
  const height = (x, z) => {
    const d = sq(x, z);
    if (d <= FLAT) return 0;
    const m = smooth(FLAT, 1100, d);
    const hills = fbm(x / 520, z / 520, 4, 0.5) * 0.5 + 0.5;
    const ridge = 1 - Math.abs(fbm(x / 1100 + 3.1, z / 1100 - 1.7, 3, 4.5));
    const amp = 12 + (d - FLAT) * 0.06;
    let h = m * (amp * (hills * 0.75 + ridge * ridge * 0.6) + 3);
    // spurs and gullies on the hillsides
    h += m * smooth(800, 1050, d) * fbm(x / 190, z / 190, 3, 2.2) * 16;
    // mountain range behind the hills: ridged noise, broken into massifs with
    // lower gaps, so the skyline has layers instead of one even wall
    const r = Math.hypot(x, z);
    const mt = smooth(1320, 1760, r);
    if (mt > 0) {
      const a = Math.atan2(z, x);
      const massif = smooth(-0.3, 0.4, fbm(Math.cos(a) * 1.3 + 3, Math.sin(a) * 1.3 + 1, 2, 8.5));
      let rg = 0, w = 1, f = 1, nw = 0;
      for (let o = 0; o < 5; o++) {
        const n = 1 - Math.abs(perlin.noise(x / 430 * f + 9.3, z / 430 * f - 4.1, 2.5 + o * 3.1));
        rg += n * n * w; nw += w; w *= 0.5; f *= 2.1;
      }
      rg /= nw;
      h += mt * (22 + massif * (45 + 285 * rg * rg));
    }
    return h;
  };
  const forest = (x, z) => fbm(x / 260 + 11, z / 260 - 7, 3, 1.5) * 0.5 + 0.5;
  return { height, forest, fbm };
}

// ---------------------------------------------------------------- ground maps
export function grassOptions(env) {
  return {
    noise: env.T.noise,
    macro: { amp: 0.18, s1: 47, s2: 263 },
    tint: { a: '#e2d38f', b: '#ffffff', scale: 520 },
    detail: env.q === 'high' ? { scale: 0.31, mix: 0.55 } : null,
    grass: { map: env.worldMap, x0: -800, z0: -800, size: 1600, stripe: 4.5 },
  };
}

export function buildTerrain(env, TR) {
  const q = env.q;
  const step = q === 'high' ? 25 : q === 'medium' ? 32 : 46;
  const n = Math.ceil(EDGE * 2 / step) + 1;
  const P = new Float32Array(n * n * 3), C = new Float32Array(n * n * 3), U = new Float32Array(n * n * 2);
  const keep = new Uint8Array(n * n);
  const tile = env.T.tile.grass;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -EDGE + i * step, z = -EDGE + j * step;
    const k = j * n + i;
    const h = TR.height(x, z);
    P[k * 3] = x; P[k * 3 + 1] = h; P[k * 3 + 2] = z;
    U[k * 2] = x / tile; U[k * 2 + 1] = z / tile;
    keep[k] = sq(x, z) > FLAT - step * 1.5 && Math.hypot(x, z) < EDGE + step ? 1 : 0;
  }
  const I = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    if (!keep[a] && !keep[b] && !keep[c] && !keep[d]) continue;
    if (sq(-EDGE + (i + 1) * step - step / 2, -EDGE + (j + 1) * step - step / 2) < FLAT - step) continue;
    I.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  // vertex colours: dry meadows and alpine grass; aEnv: forest canopy cover
  // and bare rock (shaded in envshader.js)
  const N = g.attributes.normal;
  const E = new Float32Array(n * n * 2);
  for (let k = 0; k < n * n; k++) {
    const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
    const d = sq(x, z);
    const inner = smooth(FLAT, 820, d);
    const slope = 1 - N.getY(k);
    const f = TR.forest(x, z);
    const rad = Math.hypot(x, z);
    const wob = TR.fbm(x / 140, z / 140, 2, 5.7) * 40;
    let r = 1, gg = 1, b = 1;
    const dry = (smooth(0.0, 0.6, TR.fbm(x / 300, z / 300, 2, 3.3)) * 0.16 + smooth(120, 220, y + wob) * 0.22) * inner;
    r += dry; gg += dry * 0.45; b -= dry * 0.2;
    // forest where the tree placement noise is high (the 3D trees stand on it),
    // denser on the far hills, thinning out toward a ragged tree line
    const cover = smooth(0.4, 0.56, f + smooth(850, 1400, rad) * 0.22) * inner * (1 - smooth(150, 240, y + wob)) * (1 - smooth(0.42, 0.6, slope));
    const rock = Math.max(smooth(0.38, 0.62, slope), smooth(190, 300, y + wob * 1.5)) * inner;
    C[k * 3] = r; C[k * 3 + 1] = gg; C[k * 3 + 2] = b;
    E[k * 2] = cover * 0.96; E[k * 2 + 1] = rock * 0.9;
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aEnv', new THREE.BufferAttribute(E, 2));
  g.computeBoundingSphere();
  // the terrain is matte: the low tier shades it with Lambert (much cheaper on
  // phones, where the hills can cover a good part of the screen)
  const opts = { ...grassOptions(env), canopy: true, haze: HAZE };
  const mat = q === 'low'
    ? patchMaterial(new THREE.MeshLambertMaterial({ map: env.T.grass, vertexColors: true }), opts)
    : envMaterial({ map: env.T.grass, vertexColors: true, roughness: 0.95 }, opts);
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = q !== 'low';
  env.scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------- tree shapes
function jitter(g, amt, r) {
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
    let o = seen.get(key);
    if (!o) seen.set(key, o = [(r() - 0.5) * amt, (r() - 0.5) * amt * 0.6, (r() - 0.5) * amt]);
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  return g;
}

// spherical normals around c (soft canopy shading) and vertical colour gradient
function canopy(g, cx, cy, cz, col, r, shadeLow = 0.55) {
  const p = g.attributes.position;
  const nrm = new Float32Array(p.count * 3), C = new Float32Array(p.count * 3);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < p.count; i++) { minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i)); }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - cx, y = p.getY(i) - cy, z = p.getZ(i) - cz;
    const l = Math.hypot(x, y, z) || 1;
    nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
    const t = (p.getY(i) - minY) / Math.max(0.01, maxY - minY);
    const k = (shadeLow + (1 - shadeLow) * t) * (0.92 + r() * 0.16);
    C[i * 3] = col[0] * k; C[i * 3 + 1] = col[1] * k; C[i * 3 + 2] = col[2] * k;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return g;
}

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// uv into the solid half of the foliage atlas (trunks, cores, conifers)
function solidUV(g) {
  const n = g.attributes.position.count, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = 0.75; uv[i * 2 + 1] = 0.5; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function branch(b, x0, y0, z0, x1, y1, z1, r0) {
  const a = new THREE.Vector3(x0, y0, z0), d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
  const g = new THREE.CylinderGeometry(r0 * 0.5, r0, d.length(), 4, 1, true).translate(0, d.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())).translate(a.x, a.y, a.z);
  const C = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < C.length; i += 3) { C[i] = 0.075; C[i + 1] = 0.058; C[i + 2] = 0.042; }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  b.add(solidUV(g));
}

// Alpha-tested leaf cards scattered through an ellipsoidal crown around a dark
// core. Normals point away from the crown centre (soft, volumetric light) and
// the colour darkens toward the bottom and the inside.
function cardCrown(b, r, o) {
  const { cx, cy, cz, rx, ry, rz, cards, size, col, core = 0.55 } = o;
  const coreG = jitter(new THREE.IcosahedronGeometry(1, 0).scale(rx * 0.5, ry * 0.5, rz * 0.5).translate(cx, cy, cz), 0.25, r);
  const coreCol = lin('#2b3f1d').map((v, i) => v * col[i] * core * 1.6);
  b.add(solidUV(canopy(coreG, cx, cy, cz, coreCol, r, 0.6)));
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let k = 0; k < cards; k++) {
    let u, v, w, l2;
    do { u = r() * 2 - 1; v = r() * 2 - 1; w = r() * 2 - 1; l2 = u * u + v * v + w * w; } while (l2 > 1 || l2 < 0.2);
    const px = cx + u * rx * 0.8, py = cy + v * ry * 0.8, pz = cz + w * rz * 0.8;
    const sz = size * (0.75 + r() * 0.5);
    const g = new THREE.PlaneGeometry(sz, sz);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5);
    g.applyQuaternion(q.setFromEuler(e.set(r() * Math.PI, r() * Math.PI * 2, r() * Math.PI))).translate(px, py, pz);
    const p = g.attributes.position, n = p.count;
    const N = new Float32Array(n * 3), C = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const dx = p.getX(i) - cx, dy = p.getY(i) - cy, dz = p.getZ(i) - cz;
      const l = Math.hypot(dx / rx, dy / ry, dz / rz) || 1;
      const nx = dx / rx, ny = dy / ry + 0.25, nz = dz / rz, nl = Math.hypot(nx, ny, nz) || 1;
      N[i * 3] = nx / nl; N[i * 3 + 1] = ny / nl; N[i * 3 + 2] = nz / nl;
      const t = Math.min(1, Math.max(0, (dy / ry + 1) / 2));
      const k2 = (0.55 + 0.45 * t) * (0.7 + 0.3 * Math.min(1, l));
      C[i * 3] = col[0] * k2; C[i * 3 + 1] = col[1] * k2; C[i * 3 + 2] = col[2] * k2;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    b.add(g);
  }
}

function trunk(h, r0, r1, seg = 5) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, true).translate(0, h / 2, 0);
  const C = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < C.length; i += 3) { C[i] = 0.075; C[i + 1] = 0.058; C[i + 2] = 0.042; }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return solidUV(g);
}

function spruce(r, lod) {
  const b = new Batch();
  b.add(trunk(3, 0.28, 0.18, lod ? 4 : 6));
  const tiers = lod ? 3 : 6;
  const col = lin('#2c4626');
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const rad = (2.7 - f * 2.0) * (0.9 + r() * 0.2), y0 = 1.5 + f * 7.6, h = 3.4 - f * 0.9;
    // star-shaped, drooping tiers read as branches rather than smooth cones
    const cg = new THREE.ConeGeometry(rad, h, lod ? 6 : 12, 1, false);
    const cp = cg.attributes.position, tw = r() * 6.28, pts = lod ? 3 : 6;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), z = cp.getZ(i), rr = Math.hypot(x, z);
      if (rr < 1e-3) continue;
      const a = Math.atan2(z, x) + tw, bump = Math.cos(a * pts);
      const k = 1 + 0.16 * bump;
      cp.setXYZ(i, x * k, cp.getY(i) - 0.35 * Math.max(0, bump) * (rr / rad), z * k);
    }
    const cone = jitter(cg.toNonIndexed().translate(0, y0 + h / 2, 0), 0.45, r);
    b.add(solidUV(canopy(cone, 0, y0 - 0.6, 0, col, r, 0.35)));
  }
  return b.build();
}

function pine(r, lod, cards) {
  const b = new Batch();
  b.add(trunk(8, 0.3, 0.14, lod ? 4 : 6));
  if (cards) {
    branch(b, 0, 5.5, 0, 1.8, 8.4, 0.4, 0.12);
    branch(b, 0, 6.4, 0, -1.5, 9.2, -0.9, 0.1);
    cardCrown(b, r, { cx: 0, cy: 9.0, cz: 0, rx: 3.0, ry: 3.0, rz: 3.0, cards: 18, size: 2.8, col: [0.62, 0.72, 0.6], core: 0.8 });
    return b.build();
  }
  const col = lin('#2f4a27');
  const blobs = lod ? 3 : 6;
  for (let k = 0; k < blobs; k++) {
    const t = k / Math.max(1, blobs - 1);
    const a = k * 2.3 + r(), d = (1 - t) * 1.3 + 0.2;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 6.5 + t * 6.0;
    const s = 2.3 - t * 1.2;
    const g = jitter(new THREE.IcosahedronGeometry(1, 0).scale(s, s * 0.7, s).translate(cx, cy, cz), 0.45, r);
    b.add(solidUV(canopy(g, 0, 7.5, 0, col, r, 0.45)));
  }
  return b.build();
}

function broadleaf(r, lod, cards) {
  const b = new Batch();
  b.add(trunk(3.4, 0.3, 0.18, lod ? 4 : 6));
  if (cards) {
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + r();
      branch(b, 0, 2.6 + k * 0.4, 0, Math.cos(a) * 2.0, 5.2 + r(), Math.sin(a) * 2.0, 0.13);
    }
    cardCrown(b, r, { cx: 0, cy: 6.3, cz: 0, rx: 3.5, ry: 3.0, rz: 3.5, cards: 22, size: 3.2, col: [1, 1, 0.92] });
    return b.build();
  }
  const col = lin('#46642d');
  const blobs = lod ? 4 : 9;
  for (let k = 0; k < blobs; k++) {
    const a = k * 2.4 + r() * 0.8;
    const t = k === 0 ? 0.5 : (k % 3) / 2.5 + r() * 0.2;
    const ring = k === 0 ? 0 : Math.sin(Math.PI * Math.min(1, t)) * (1.8 + r() * 0.7);
    const cx = Math.cos(a) * ring, cz = Math.sin(a) * ring, cy = 3.6 + t * 4.4;
    const s = k === 0 ? 2.8 : 1.6 + r() * 0.8;
    const g = jitter(new THREE.IcosahedronGeometry(1, 0).scale(s, s * 0.9, s).translate(cx, cy, cz), lod ? 0.55 : 0.45, r);
    b.add(solidUV(canopy(g, 0, 5.4, 0, col, r, 0.5)));
  }
  return b.build();
}

function poplar(r, lod, cards) {
  const b = new Batch();
  b.add(trunk(2.2, 0.25, 0.16, lod ? 4 : 5));
  if (cards) {
    cardCrown(b, r, { cx: 0, cy: 8.2, cz: 0, rx: 1.7, ry: 5.8, rz: 1.7, cards: 18, size: 2.3, col: [0.95, 1, 0.9] });
    return b.build();
  }
  const col = lin('#45632e');
  const n = lod ? 3 : 7;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const a = k * 2.5, d = 0.35 + r() * 0.35;
    const cy = 3.2 + t * 9.5, s = (1.55 - Math.abs(t - 0.35) * 1.3) * (0.85 + r() * 0.3);
    const g = jitter(new THREE.IcosahedronGeometry(1, 0).scale(s, s * 1.5, s).translate(Math.cos(a) * d, cy, Math.sin(a) * d), 0.3, r);
    b.add(solidUV(canopy(g, 0, 7, 0, col, r, 0.5)));
  }
  return b.build();
}

function bush(r, cards) {
  const b = new Batch();
  if (cards) {
    cardCrown(b, r, { cx: 0, cy: 0.75, cz: 0, rx: 1.25, ry: 0.85, rz: 1.25, cards: 9, size: 1.5, col: [1, 1, 0.9] });
    return b.build();
  }
  const col = lin('#4d6c33');
  for (let k = 0; k < 4; k++) {
    const a = k * 2.2, d = k ? 0.6 : 0;
    const s = k ? 0.6 + r() * 0.2 : 0.85;
    const g = jitter(new THREE.IcosahedronGeometry(1, 0).scale(s, s * 0.85, s).translate(Math.cos(a) * d, 0.55 * s + (k ? 0 : 0.15), Math.sin(a) * d), 0.22, r);
    b.add(solidUV(canopy(g, 0, -0.2, 0, col, r, 0.55)));
  }
  return b.build();
}

// Clump of uncut grass: tapered, curving blades (two triangles each) fanning
// out from the base, a few of them dry. Normals lean up so the clump lights
// like the lawn it stands in (the material keeps them on back faces too).
function tuft(r) {
  const P = [], C = [], Nn = [];
  const blades = 10;
  for (let k = 0; k < blades; k++) {
    const a = k / blades * Math.PI * 2 + r() * 0.5;
    const ca = Math.cos(a), sa = Math.sin(a);
    const h = 0.22 + r() * 0.3, lean = 0.06 + r() * 0.16, w = 0.022 + r() * 0.012;
    const d0 = r() * 0.07, bx = ca * d0, bz = sa * d0;
    const px = -sa * w, pz = ca * w; // blade width direction
    const dry = r() < 0.22;
    const g = 0.85 + r() * 0.3;
    const base = [0.05 * g, 0.075 * g, 0.022 * g];
    const tip = dry ? [0.30 * g, 0.26 * g, 0.12 * g] : [0.14 * g, 0.20 * g, 0.05 * g];
    const midC = base.map((v, i) => v + (tip[i] - v) * 0.6);
    // base, middle (bent outward), tip (bent further and drooping)
    const m = [bx + ca * lean * 0.35, h * 0.55, bz + sa * lean * 0.35], t = [bx + ca * lean, h, bz + sa * lean];
    const quad = [[bx - px, 0, bz - pz], [bx + px, 0, bz + pz], [m[0] + px * 0.6, m[1], m[2] + pz * 0.6], [m[0] - px * 0.6, m[1], m[2] - pz * 0.6]];
    P.push(...quad[0], ...quad[1], ...quad[2], ...quad[0], ...quad[2], ...quad[3], ...quad[3], ...quad[2], ...t);
    C.push(...base, ...base, ...midC, ...base, ...midC, ...midC, ...midC, ...midC, ...tip);
    const nx = ca * 0.35, nz = sa * 0.35, ny = 0.94;
    for (let v = 0; v < 9; v++) Nn.push(nx, ny, nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  return g;
}

// ---------------------------------------------------------------- placement
export function buildFlora(env, TR, A) {
  const q = env.q, world = env.world;
  const r = rng(2024);
  const hiQ = q !== 'low';
  const counts = {
    inner: q === 'high' ? 1300 : q === 'medium' ? 900 : 450,
    outer: q === 'high' ? 3000 : q === 'medium' ? 2000 : 900,
    bush: q === 'high' ? 420 : q === 'medium' ? 260 : 110,
    tuft: q === 'high' ? 5200 : q === 'medium' ? 2000 : 0,
  };
  const pts = world.track.pts;
  // coarse grid of distance to the track centre line for fast rejection
  const near = (x, z, d) => {
    for (let i = 0; i < pts.length; i += 2) if ((pts[i].x - x) ** 2 + (pts[i].z - z) ** 2 < d * d) return true;
    return false;
  };
  const zones = world.zones;
  const clearOf = (x, z, pad) => {
    if (world.surfaceAt(x, z).type !== 'grass') return false;
    if (Math.hypot(x - zones.derby.x, z - zones.derby.z) < zones.derby.r + 16 + pad) return false;
    if (Math.abs(z - zones.lab.z) < zones.lab.l / 2 + 22 + pad && Math.abs(x - zones.lab.x) < zones.lab.w / 2 + 30 + pad) return false;
    if (Math.abs(x - zones.infield.x) < zones.infield.w / 2 + 12 + pad && Math.abs(z - zones.infield.z) < zones.infield.l / 2 + 12 + pad) return false;
    if (env.blocked(x, z, 4 + pad)) return false;
    return true;
  };

  // one instanced set per species and quadrant keeps draw calls low;
  // broadleaf variety (oak / beech / birch tones) comes from instance tints
  const species = [
    { name: 'spruce', make: spruce, w: 0.34, conifer: true },
    { name: 'pine', make: pine, w: 0.12, conifer: true },
    { name: 'broadleaf', make: broadleaf, w: 0.42, tints: [[0.31, 0.45], [0.22, 0.55], [0.17, 0.5]] },
  ];
  if (q !== 'low') species.push({ name: 'poplar', make: poplar, w: 0.08 });
  const pick = (conifery) => {
    const ws = species.map(s => s.w * (s.conifer ? 0.4 + conifery : 1.4 - conifery));
    let u = r() * ws.reduce((a, b) => a + b, 0);
    for (let k = 0; k < species.length; k++) { u -= ws[k]; if (u <= 0) return species[k]; }
    return species[0];
  };
  const inner = new Map(), outer = new Map();
  const add = (map, sp, x, y, z, sc) => {
    if (!map.has(sp)) map.set(sp, []);
    let tint;
    if (sp.tints) {
      const [h, l] = sp.tints[(r() * sp.tints.length) | 0];
      tint = new THREE.Color().setHSL(h + (r() - 0.5) * 0.04, 0.35 + r() * 0.25, l + (r() - 0.5) * 0.12);
      tint.lerp(new THREE.Color(1, 1, 1), 0.45);
    } else {
      tint = new THREE.Color().setHSL(0.24 + (r() - 0.5) * 0.06, 0.25 + r() * 0.3, 0.42 + (r() - 0.5) * 0.18);
      tint.lerp(new THREE.Color(1, 1, 1), 0.55);
    }
    // instance colour multiplies the vertex colour, so it stays near white
    map.get(sp).push({ m: trs(x, y - 0.1, z, r() * 6.28, sc * (0.85 + r() * 0.3), sc * (0.85 + r() * 0.35), sc * (0.85 + r() * 0.3)), c: tint, x, z, s: sc });
  };

  // inside the boundary: clusters plus scattered singles
  const treePos = [];
  let guard = 0, placed = 0;
  while (placed < counts.inner && guard++ < counts.inner * 60) {
    let x = (r() - 0.5) * 1420, z = (r() - 0.5) * 1420;
    // a third of the trees form a belt inside the perimeter fence
    const belt = placed % 3 === 0;
    if (belt) {
      const side = (r() * 4) | 0, along = (r() - 0.5) * 1420, inset = 690 + Math.pow(r(), 0.6) * 24;
      x = side === 0 ? inset : side === 1 ? -inset : along;
      z = side === 2 ? inset : side === 3 ? -inset : along;
    }
    const f = TR.forest(x, z);
    if (!belt && r() > smooth(0.45, 0.62, f) * 0.985 + 0.015) continue;
    if (belt && r() > smooth(0.3, 0.55, f) * 0.9 + 0.1) continue;
    if (!clearOf(x, z, 0) || near(x, z, HW + 24)) continue;
    const sp = pick(smooth(0.3, 0.8, TR.forest(x * 0.5 + 300, z * 0.5)));
    const sc = 0.75 + r() * 0.6;
    add(inner, sp, x, 0, z, sc);
    treePos.push([x, z, sc * (sp.conifer ? 2.2 : 3.2)]);
    placed++;
  }
  // beyond the boundary on the hills
  guard = 0; placed = 0;
  while (placed < counts.outer && guard++ < counts.outer * 30) {
    const x = (r() - 0.5) * 3200, z = (r() - 0.5) * 3200;
    const d = sq(x, z);
    if (d < 730 || Math.hypot(x, z) > 1150) continue;
    if (r() > 1 - (d - 730) / 900) continue; // denser close to the boundary
    const f = TR.forest(x, z);
    if (r() > smooth(0.38, 0.6, f)) continue;
    const y = TR.height(x, z);
    if (y > 230) continue;
    const sp = pick(smooth(20, 120, y) * 0.8 + 0.1);
    const sc = 0.8 + r() * 0.7;
    add(outer, sp, x, y, z, sc);
    if (d < 800) treePos.push([x, z, sc * 3]);
    placed++;
  }
  const treeMat = env.M.foliage, farMat = env.M.foliageFar;
  const cards = hiQ; // leaf-card crowns need the alpha-tested foliage material
  for (const sp of species) {
    const gi = sp.make(rng(7 + species.indexOf(sp)), false, cards);
    const go = sp.make(rng(17 + species.indexOf(sp)), true, false);
    // quadrant chunks (cell larger than the half-extent of each region)
    if (inner.has(sp)) env.scene.add(chunkedInstances(gi, treeMat, inner.get(sp), 720, { castShadow: false }).group);
    if (outer.has(sp)) env.scene.add(chunkedInstances(go, farMat, outer.get(sp), 1700, { castShadow: false }).group);
  }

  // bushes: along fences, near buildings and scattered on verges
  const bushes = [];
  guard = 0;
  while (bushes.length < counts.bush && guard++ < counts.bush * 60) {
    const i = (r() * pts.length) | 0, p = pts[i];
    const side = r() < 0.5 ? -1 : 1, o = HW + 19 + r() * 22;
    const x = p.x - p.tz * o * side, z = p.z + p.tx * o * side;
    if (!clearOf(x, z, -2) || near(x, z, HW + 17)) continue;
    const sc = 0.6 + r() * 0.8;
    bushes.push({ m: trs(x, 0, z, r() * 6.28, sc * (1 + r() * 0.5), sc, sc * (1 + r() * 0.5)), c: new THREE.Color().setRGB(0.85 + r() * 0.3, 0.85 + r() * 0.3, 0.8 + r() * 0.2) });
    treePos.push([x, z, sc * 1.3]);
  }
  if (bushes.length) env.scene.add(chunkedInstances(bush(rng(5), cards), treeMat, bushes, 720, { castShadow: false }).group);

  // Uncut grass in clumps where the mowers don't reach: along the foot of the
  // barriers and fences, around posts, and in the rough beyond the verge. The
  // mown verge next to the track only gets the odd small clump.
  if (counts.tuft) {
    const tufts = [];
    guard = 0;
    while (tufts.length < counts.tuft && guard++ < counts.tuft * 4) {
      const i = (r() * pts.length) | 0, p = pts[i];
      const side = r() < 0.5 ? -1 : 1;
      const u = r();
      let o, n, spread;
      if (u < 0.55) { o = r() < 0.5 ? HW + 8.1 + r() * 0.35 : HW + 10.1 + r() * 0.8; n = 3 + (r() * 5 | 0); spread = 0.5; }
      else if (u < 0.85) { o = HW + 16 + r() * 18; n = 2 + (r() * 6 | 0); spread = 1.2; }
      else { o = HW + 2.6 + r() * 4; n = 1 + (r() * 2 | 0); spread = 0.3; }
      // not on gravel (outside of corners), kerbs or roads
      if (A.gravel[i] === side && o < HW + 8.6) continue;
      const cx = p.x - p.tz * o * side, cz = p.z + p.tx * o * side;
      if (world.surfaceAt(cx, cz).type !== 'grass' || env.blocked(cx, cz, 0.5)) continue;
      for (let k = 0; k < n && tufts.length < counts.tuft; k++) {
        // barrier clumps stretch along the barrier foot, the others are round
        const along = (r() - 0.5) * 2 * spread * (u < 0.55 ? 3 : 1), across = (r() - 0.5) * 2 * spread * (u < 0.55 ? 0.4 : 1);
        const x = cx + p.tx * along - p.tz * side * across, z = cz + p.tz * along + p.tx * side * across;
        const sc = (u < 0.85 ? 0.8 : 0.55) + r() * 0.6;
        tufts.push({ m: trs(x, 0, z, r() * 6.28, sc, sc * (0.75 + r() * 0.6), sc) });
      }
    }
    env.scene.add(chunkedInstances(tuft(rng(3)), env.M.tuft, tufts, 300, { castShadow: false }).group);
  }
  return treePos;
}

// perimeter fence on the boundary walls (the walls themselves are invisible)
export function buildPerimeter(env) {
  const B = 721.5, H = 2.4;
  const fence = new Batch();
  const posts = new Batch();
  const postGeo = new THREE.BoxGeometry(0.07, H + 0.1, 0.07).translate(0, (H + 0.1) / 2, 0);
  const tile = env.T.tile.fence;
  for (const [x0, z0, x1, z1] of [[-B, -B, B, -B], [B, -B, B, B], [B, B, -B, B], [-B, B, -B, -B]]) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.PlaneGeometry(L, H);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / tile, uv.getY(i) * H / tile);
    const yaw = -Math.atan2(z1 - z0, x1 - x0);
    fence.add(g, trs((x0 + x1) / 2, H / 2 + 0.05, (z0 + z1) / 2, yaw));
    const n = Math.floor(L / 4);
    for (let k = 0; k <= n; k++) posts.add(postGeo, trs(x0 + (x1 - x0) * k / n, 0, z0 + (z1 - z0) * k / n, yaw));
  }
  env.scene.add(new THREE.Mesh(fence.build(false), env.M.fence));
  env.scene.add(new THREE.Mesh(posts.build(false), env.M.steel));
}

// ---------------------------------------------------------------- world map
// 512 x 512 over |x|,|z| < 800: R = distance to the nearest track edge (0..64 m),
// G = shade under trees and bushes, B = worn / dry ground.
export function fillWorldMap(env, treePos) {
  const S = 512, X0 = -800, SIZE = 1600, px = SIZE / S;
  const data = env.worldMap.image.data;
  const dist = new Float32Array(S * S).fill(64);
  const R = Math.ceil((64 + HW) / px);
  // squared distances in pixels first (every other track point is plenty at 3 m/px)
  const d2 = new Float32Array(S * S).fill(1e9);
  const pts = env.world.track.pts;
  for (let n = 0; n < pts.length; n += 2) {
    const p = pts[n];
    const cx = (p.x - X0) / px - 0.5, cz = (p.z - X0) / px - 0.5;
    const i0 = Math.max(0, Math.floor(cx - R)), i1 = Math.min(S - 1, Math.ceil(cx + R));
    const j0 = Math.max(0, Math.floor(cz - R)), j1 = Math.min(S - 1, Math.ceil(cz + R));
    for (let j = j0; j <= j1; j++) {
      const dz = j - cz, row = j * S;
      for (let i = i0; i <= i1; i++) {
        const dx = i - cx, v = dx * dx + dz * dz;
        if (v < d2[row + i]) d2[row + i] = v;
      }
    }
  }
  for (let k = 0; k < S * S; k++) dist[k] = Math.min(64, Math.sqrt(d2[k]) * px - HW);
  const shade = new Float32Array(S * S);
  for (const [x, z, rad] of treePos) {
    const cx = (x - X0) / px, cz = (z - X0) / px, rr = rad * 1.25 / px + 0.8;
    for (let j = Math.max(0, Math.floor(cz - rr)); j <= Math.min(S - 1, Math.ceil(cz + rr)); j++)
      for (let i = Math.max(0, Math.floor(cx - rr)); i <= Math.min(S - 1, Math.ceil(cx + rr)); i++) {
        const t = 1 - Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / rr;
        if (t > 0) shade[j * S + i] = Math.min(1, shade[j * S + i] + t * 0.8);
      }
  }
  for (const [x, z, w, l, v] of env.shadeRects) {
    for (let j = Math.max(0, Math.floor((z - l / 2 - X0) / px)); j <= Math.min(S - 1, Math.ceil((z + l / 2 - X0) / px)); j++)
      for (let i = Math.max(0, Math.floor((x - w / 2 - X0) / px)); i <= Math.min(S - 1, Math.ceil((x + w / 2 - X0) / px)); i++)
        shade[j * S + i] = Math.max(shade[j * S + i], v);
  }
  for (let k = 0; k < S * S; k++) {
    data[k * 4] = Math.max(0, Math.min(1, dist[k] / 64)) * 255;
    data[k * 4 + 1] = shade[k] * 255;
    data[k * 4 + 2] = 0;
    data[k * 4 + 3] = 255;
  }
  env.worldMap.needsUpdate = true;
}

export function makeWorldMap() {
  const S = 512;
  const t = new THREE.DataTexture(new Uint8Array(S * S * 4), S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
