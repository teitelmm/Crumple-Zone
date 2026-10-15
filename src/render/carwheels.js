// Wheels: lathe-profiled tyre (rounded shoulders, sidewall bulge, tread grooves and a
// tread normal map), per-car extruded rim (spoke windows, dished face, lip, barrel,
// centre cap and lug nuts) drawn as one mesh with its finish and cavity shading baked
// into vertex colours, brake disc and caliper. Draws per wheel: tyre + rim (+ brake on
// high/medium).
// Local frame: Z = axle, outer face +Z; left wheels are mirrored with scale.z = -1 by the
// caller. The `spin` child rotates about Z; brakes stay put.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const geoCache = new Map();
const matCache = new Map();

let treadTex = null;
function treadNormalMap() {
  if (treadTex) return treadTex;
  // tile: x = around the tyre (one tread block pitch), y = across the width
  const W = 32, H = 128;
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = y / H; // 0 inner .. 1 outer edge of the tyre profile
    const tread = v > 0.18 && v < 0.82;
    let d = 0;
    if (tread) {
      // slanted lateral sipes, offset between the ribs
      const rib = Math.floor((v - 0.18) / 0.16);
      const sx = (x + y * 0.35 + rib * 9) % W;
      if (sx < 3) d = -1;
    }
    h[y * W + x] = d;
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const hx = h[y * W + ((x + 1) % W)] - h[y * W + ((x - 1 + W) % W)];
    const hy = h[Math.min(H - 1, y + 1) * W + x] - h[Math.max(0, y - 1) * W + x];
    let nx = -hx * 0.9, ny = -hy * 0.9, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * W + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = nz * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  treadTex = new THREE.CanvasTexture(c);
  treadTex.wrapS = THREE.RepeatWrapping;
  treadTex.wrapT = THREE.ClampToEdgeWrapping;
  treadTex.anisotropy = 4;
  return treadTex;
}

function tyreGeometry(R, W, rimR, hi) {
  const hw = W / 2, h = R - rimR;
  const side = (s) => [
    [rimR + 0.006, s * hw * 0.84], [rimR + h * 0.22, s * hw * 0.96], [rimR + h * 0.52, s * hw], [rimR + h * 0.8, s * hw * 0.97],
    [R - 0.014, s * hw * 0.9], [R - 0.004, s * hw * 0.8],
  ];
  const tread = [];
  const grooves = hi ? [-0.42, -0.14, 0.14, 0.42] : [];
  tread.push([R, -hw * 0.7]);
  for (const g of grooves) {
    const z = g * hw;
    tread.push([R, z - 0.011], [R - 0.008, z - 0.007], [R - 0.008, z + 0.007], [R, z + 0.011]);
  }
  tread.push([R, hw * 0.7]);
  const prof = [[rimR - 0.004, -hw * 0.78], ...side(-1), ...tread, ...side(1).reverse(), [rimR - 0.004, hw * 0.78]];
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), hi ? 56 : 24);
  // uv: u around (tread blocks repeat), v across the width
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, pos.getY(i) / W + 0.5);
  geo.rotateX(Math.PI / 2);
  return geo;
}

// spoke windows: list of hole polygons (THREE.Path) for the rim face
function rimHoles(style, rimR) {
  const rOut = rimR - 0.026, rIn = rimR * 0.44;
  const spokes = [];
  const radial = (a, w0, w1) => ({ ang: () => a, w: r => w0 + (w1 - w0) * (r - rIn) / (rOut - rIn) });
  if (style === 'double5') {
    const rM = rimR * 0.52;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + Math.PI / 2;
      for (const s of [-1, 1]) spokes.push({ ang: r => a + s * 0.15 * Math.max(0, (r - rM) / (rOut - rM)), w: r => 0.019 + 0.012 * (rOut - r) / (rOut - rIn) });
    }
  } else if (style === 'ten') {
    for (let k = 0; k < 10; k++) spokes.push(radial((k / 10) * Math.PI * 2 + Math.PI / 2, 0.034, 0.02));
  } else {
    for (let k = 0; k < 5; k++) spokes.push(radial((k / 5) * Math.PI * 2 + Math.PI / 2, 0.072, 0.046));
  }
  spokes.sort((p, q) => p.ang(rOut) - q.ang(rOut));
  const holes = [];
  const N = 22;
  for (let i = 0; i < spokes.length; i++) {
    const A = spokes[i], B = spokes[(i + 1) % spokes.length];
    const wrap = i === spokes.length - 1 ? Math.PI * 2 : 0;
    const left = r => A.ang(r) + Math.asin(Math.min(0.9, A.w(r) / 2 / r));
    const right = r => B.ang(r) + wrap - Math.asin(Math.min(0.9, B.w(r) / 2 / r));
    // walk inward until the window closes
    const radii = [];
    for (let k = 0; k <= N; k++) radii.push(rOut - (rOut - rIn) * k / N);
    const open = radii.filter(r => right(r) - left(r) > 0.012 / r);
    if (open.length < 2) continue;
    const rMin = open[open.length - 1];
    const pts = [];
    const arc = (r, a0, a1, n) => { for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)); } };
    arc(rOut, left(rOut), right(rOut), 8);
    for (const r of open.slice(1)) pts.push(new THREE.Vector2(Math.cos(right(r)) * r, Math.sin(right(r)) * r));
    arc(rMin, right(rMin), left(rMin), 3);
    for (const r of open.slice(1, -1).reverse()) pts.push(new THREE.Vector2(Math.cos(left(r)) * r, Math.sin(left(r)) * r));
    holes.push(new THREE.Path(pts));
  }
  return holes;
}

function splitGroups(geo) {
  // ExtrudeGeometry: group 0 = caps, group 1 = side walls (non-indexed)
  const out = [];
  for (const gr of geo.groups) {
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = geo.attributes[name];
      g.setAttribute(name, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
    }
    out[gr.materialIndex] = out[gr.materialIndex] ? mergeGeometries([out[gr.materialIndex], g]) : g;
  }
  return out;
}

function rimGeometry(spec, hi) {
  const d = spec.dims, wv = spec.visual.wheel;
  const R = d.wheelRadius, W = d.tireWidth, hw = W / 2;
  const rimR = wv.rim * 0.0254 / 2;
  const zFace = hw * 0.74, dish = wv.style === 'five' ? 0.032 : wv.style === 'ten' ? 0.018 : 0.024;
  const shape = new THREE.Shape();
  const n = hi ? 72 : 40;
  for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI * 2; const p = [Math.cos(a) * (rimR - 0.008), Math.sin(a) * (rimR - 0.008)]; k ? shape.lineTo(...p) : shape.moveTo(...p); }
  // spoke windows plus the hub opening (the hub is a separate dished lathe, so the cap
  // triangulation never spans the centre)
  const rHub = rimR * 0.44 - 0.012;
  const hub = new THREE.Path();
  const nh = hi ? 40 : 24;
  for (let k = 0; k <= nh; k++) { const a = -(k / nh) * Math.PI * 2; const p = [Math.cos(a) * rHub, Math.sin(a) * rHub]; k ? hub.lineTo(...p) : hub.moveTo(...p); }
  shape.holes = [...rimHoles(wv.style, rimR), hub];
  const depth = 0.02;
  const ext = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: hi, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 1, curveSegments: 4 });
  ext.translate(0, 0, -depth);
  const [faceG, wallG] = splitGroups(ext);
  const dishZ = (g) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i));
      p.setZ(i, p.getZ(i) + zFace - dish * Math.pow(Math.min(1, Math.max(0, (rimR - r) / (rimR - rHub))), 1.2));
    }
    g.computeVertexNormals();
  };
  dishZ(faceG); dishZ(wallG);
  // lip + barrel (seen through the spokes)
  const barrel = new THREE.LatheGeometry([
    [rimR - 0.02, -hw * 0.78], [rimR - 0.014, -hw * 0.7], [rimR - 0.012, hw * 0.3], [rimR - 0.004, zFace - 0.006], [rimR + 0.004, zFace],
    [rimR + 0.013, zFace + 0.004], [rimR + 0.015, zFace - 0.01],
  ].map(([r, y]) => new THREE.Vector2(r, y)), hi ? 56 : 28).rotateX(Math.PI / 2);
  // hub: slightly domed disc inside the spokes, centre cap and lug nuts
  const hubZ = zFace - dish;
  const hubG = new THREE.LatheGeometry([
    [0.0, hubZ - 0.004], [0.04, hubZ - 0.004], [rHub * 0.7, hubZ - 0.002], [rHub - 0.004, hubZ], [rHub + 0.002, hubZ - 0.012],
  ].map(([r, y]) => new THREE.Vector2(r, y)), hi ? 40 : 24).rotateX(Math.PI / 2);
  const cap = new THREE.CylinderGeometry(0.03, 0.033, 0.016, hi ? 20 : 12).rotateX(Math.PI / 2).translate(0, 0, hubZ + 0.002);
  const parts = [hubG, cap];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 10;
    parts.push(new THREE.CylinderGeometry(0.009, 0.0105, 0.016, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.057, Math.sin(a) * 0.057, hubZ - 0.002));
  }
  // one draw for the whole rim: the finish colour is baked per vertex together with
  // cavity darkening (spoke sides, the barrel seen through the windows, the hub well),
  // so the windows read as openings instead of a bright solid dish
  const F = FINISH[wv.face], Wc = FINISH[wv.walls];
  const cFace = new THREE.Color(F.color), cWall = new THREE.Color(Wc.color);
  const cDeep = cWall.clone().multiplyScalar(0.22);
  const tint = (g, fn) => {
    const n2 = clean(g), p = n2.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), c); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    n2.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return n2;
  };
  const faceT = tint(faceG, (x, y, z, c) => c.copy(cFace));
  // spoke side walls: the finish of the pockets, darker toward the back edge
  const wallT = tint(wallG, (x, y, z, c) => c.copy(cWall).lerp(cDeep, 0.25 + 0.5 * clamp01((zFace - z) / 0.04)));
  const barrelT = tint(barrel, (x, y, z, c) => {
    const r = Math.hypot(x, y);
    if (r >= rimR - 0.001) return c.copy(cFace); // polished lip
    c.copy(cDeep).lerp(cWall, 0.55 * clamp01((z - (zFace - 0.07)) / 0.065));
  });
  const hubT = tint(hubG, (x, y, z, c) => c.copy(cWall).multiplyScalar(0.55));
  const capT = tint(cap, (x, y, z, c) => c.copy(cFace).multiplyScalar(0.8));
  const nutsT = parts.slice(2).map(g => tint(g, (x, y, z, c) => c.set('#c6c9cd')));
  return mergeGeometries([faceT, wallT, barrelT, hubT, capT, ...nutsT]);
}
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
function clean(g) {
  const n2 = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n2.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n2.deleteAttribute(k);
  return n2;
}

function brakeGeometry(spec, rimR) {
  const discR = rimR * 0.78;
  const disc = new THREE.RingGeometry(0.075, discR, 36, 1).translate(0, 0, -0.012);
  const hat = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 20, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.012);
  const sh = new THREE.Shape();
  const a0 = Math.PI * 0.62, a1 = Math.PI * 0.92, r0 = discR - 0.05, r1 = discR + 0.014;
  const n = 10;
  for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; k ? sh.lineTo(Math.cos(a) * r1, Math.sin(a) * r1) : sh.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); }
  for (let k = n; k >= 0; k--) { const a = a0 + (a1 - a0) * k / n; sh.lineTo(Math.cos(a) * r0, Math.sin(a) * r0); }
  const cal = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 }).translate(0, 0, -0.04);
  const col = (g, hex) => {
    const n2 = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n2.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n2.deleteAttribute(k);
    const c = new THREE.Color(hex), arr = new Float32Array(n2.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    n2.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return n2;
  };
  return mergeGeometries([col(disc, '#8a8c8f'), col(hat, '#55575a'), col(cal, spec.visual.wheel.caliper)]);
}

function geometries(spec, hi) {
  const key = spec.id + (hi ? ':hi' : ':lo');
  if (geoCache.has(key)) return geoCache.get(key);
  const d = spec.dims, rimR = spec.visual.wheel.rim * 0.0254 / 2;
  const rim = rimGeometry(spec, hi);
  const g = {
    tyre: tyreGeometry(d.wheelRadius, d.tireWidth, rimR, hi),
    rim,
    brake: hi ? brakeGeometry(spec, rimR) : null,
  };
  geoCache.set(key, g);
  return g;
}

const FINISH = {
  silver: { color: '#b4b8bd', metalness: 0.78, roughness: 0.36 },
  gunmetal: { color: '#62666c', metalness: 0.85, roughness: 0.34 },
  machined: { color: '#c9ccd0', metalness: 0.9, roughness: 0.24 },
  dark: { color: '#1b1d20', metalness: 0.7, roughness: 0.38 },
};
function materials(spec, hi) {
  const key = spec.id + (hi ? ':hi' : ':lo');
  if (matCache.has(key)) return matCache.get(key);
  const wv = spec.visual.wheel;
  const tyre = new THREE.MeshStandardMaterial({ color: '#1c1c1d', roughness: 0.88, metalness: 0 });
  if (hi) { tyre.normalMap = treadNormalMap(); tyre.normalMap.repeat.set(60, 1); tyre.normalScale.set(0.9, 0.9); }
  const F = FINISH[wv.face], Wf = FINISH[wv.walls];
  const rim = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: (F.metalness + Wf.metalness) / 2, roughness: (F.roughness + Wf.roughness) / 2, side: THREE.DoubleSide });
  const brake = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.45 });
  const m = { tyre, rim, brake };
  matCache.set(key, m);
  return m;
}

export function makeWheelMesh(spec, quality = 'high') {
  const hi = quality !== 'low';
  const g = geometries(spec, hi), m = materials(spec, hi);
  const grp = new THREE.Group();
  const spin = new THREE.Group();
  const tyre = new THREE.Mesh(g.tyre, m.tyre);
  tyre.castShadow = true;
  spin.add(tyre);
  spin.add(new THREE.Mesh(g.rim, m.rim));
  grp.add(spin);
  if (g.brake) grp.add(new THREE.Mesh(g.brake, m.brake));
  grp.userData.spin = spin;
  return grp;
}
