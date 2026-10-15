// Procedural textures, so the game ships without image assets.
//
// Tileable surface maps are synthesised into typed arrays: albedo (sRGB), and
// normal maps that carry roughness in their alpha channel (read by the ground
// shader patch in envshader.js). A shared linear noise texture drives the
// large-scale variation that hides tiling. Signs, decals and doors use canvas 2D.
//
// Texture scale convention: geometry UVs are in "tiles", i.e. metres divided by
// the tile size listed in T.tile, so one GPU texture can be shared everywhere.
import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- periodic noise
// Value noise on an S x S grid with `cells` lattice cells per side; wraps seamlessly.
function vnoise(S, cells, r) {
  const L = new Float32Array(cells * cells);
  for (let i = 0; i < L.length; i++) L[i] = r();
  const out = new Float32Array(S * S);
  const k = cells / S;
  const I0 = new Int32Array(S), I1 = new Int32Array(S), TT = new Float32Array(S);
  for (let x = 0; x < S; x++) {
    const f = x * k, i = Math.floor(f), t = f - i;
    I0[x] = i % cells; I1[x] = (i + 1) % cells; TT[x] = t * t * (3 - 2 * t);
  }
  for (let y = 0; y < S; y++) {
    const r0 = I0[y] * cells, r1 = I1[y] * cells, ty = TT[y], row = y * S;
    for (let x = 0; x < S; x++) {
      const x0 = I0[x], x1 = I1[x], tx = TT[x];
      const a = L[r0 + x0], b = L[r0 + x1], c = L[r1 + x0], d = L[r1 + x1];
      const top = a + (b - a) * tx, bot = c + (d - c) * tx;
      out[row + x] = top + (bot - top) * ty;
    }
  }
  return out;
}

function fbm(S, cells, oct, r, gain = 0.5) {
  const out = new Float32Array(S * S);
  let amp = 1, norm = 0;
  for (let o = 0; o < oct && cells <= S; o++, cells *= 2) {
    const n = vnoise(S, cells, r);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// normalise to 0..1
function stretch(a) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k;
  return a;
}

// Shared fbm fields per size, re-used by several textures with a different
// roll / transpose each (k), which keeps start-up time down.
const FIELDS = new Map();
function field(S, kind, k) {
  let base = FIELDS.get(S + kind);
  if (!base) {
    const r = rng(S * 7 + kind.charCodeAt(0) * 131);
    if (kind === 'hi') base = stretch(fbm(S, S / 16, 2, r));
    else {
      // low-frequency fields are synthesised at <= 256 px and upsampled
      const s = Math.min(S, 256);
      const small = kind === 'lo' ? stretch(fbm(s, 4, 5, r)) : stretch(fbm(s, 16, 3, r));
      base = s === S ? small : upsample(small, s, S);
    }
    FIELDS.set(S + kind, base);
  }
  if (!k) return base;
  const out = new Float32Array(S * S), m = S - 1;
  const ox = Math.floor(S * 0.37 * k), oy = Math.floor(S * 0.61 * k);
  for (let y = 0; y < S; y++) {
    const src = ((y + oy) & m) * S, dst = y * S;
    for (let x = 0; x < S; x++) out[dst + x] = base[src + ((x + ox) & m)];
  }
  return out;
}

// periodic bilinear upsample s -> S
function upsample(a, s, S) {
  const out = new Float32Array(S * S), k = s / S;
  for (let y = 0; y < S; y++) {
    const fy = y * k, y0 = Math.floor(fy), ty = fy - y0, r0 = y0 * s, r1 = ((y0 + 1) % s) * s;
    for (let x = 0; x < S; x++) {
      const fx = x * k, x0 = Math.floor(fx), tx = fx - x0, x1 = (x0 + 1) % s;
      const top = a[r0 + x0] + (a[r0 + x1] - a[r0 + x0]) * tx, bot = a[r1 + x0] + (a[r1 + x1] - a[r1 + x0]) * tx;
      out[y * S + x] = top + (bot - top) * ty;
    }
  }
  return out;
}

// periodic Worley noise: nearest / second-nearest feature distance (pixels) and cell id
function worley(S, cells, r) {
  const fx = new Float32Array(cells * cells), fy = new Float32Array(cells * cells), fid = new Float32Array(cells * cells);
  for (let i = 0; i < fx.length; i++) { fx[i] = 0.1 + r() * 0.8; fy[i] = 0.1 + r() * 0.8; fid[i] = r(); }
  const f1 = new Float32Array(S * S), f2 = new Float32Array(S * S), id = new Float32Array(S * S);
  const cs = S / cells;
  for (let y = 0; y < S; y++) {
    const cy = Math.floor(y / cs);
    for (let x = 0; x < S; x++) {
      const cx = Math.floor(x / cs);
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox, gy = cy + oy;
        const n = ((gy + cells) % cells) * cells + ((gx + cells) % cells);
        const px = (gx + fx[n]) * cs, py = (gy + fy[n]) * cs;
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < d1) { d2 = d1; d1 = d; best = n; } else if (d < d2) d2 = d;
      }
      const i = y * S + x;
      f1[i] = Math.sqrt(d1); f2[i] = Math.sqrt(d2); id[i] = fid[best];
    }
  }
  return { f1, f2, id, cs };
}

// periodic separable box blur, in place
function blur(a, W, H, rad, passes = 2) {
  const tmp = new Float32Array(a.length);
  const n = rad * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let s = 0;
      for (let k = -rad; k <= rad; k++) s += a[row + ((k + W) % W)];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = s / n;
        s += a[row + ((x + rad + 1) % W)] - a[row + ((x - rad + W) % W)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) s += tmp[((k + H) % H) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = s / n;
        s += tmp[((y + rad + 1) % H) * W + x] - tmp[((y - rad + H) % H) * W + x];
      }
    }
  }
  return a;
}

// ---------------------------------------------------------------- packing
function packRGB(col, W, H, alpha = null) {
  const out = new Uint8Array(W * H * 4);
  for (let i = 0, j = 0; i < W * H; i++, j += 3) {
    out[i * 4] = clamp01(col[j]) * 255 + 0.5;
    out[i * 4 + 1] = clamp01(col[j + 1]) * 255 + 0.5;
    out[i * 4 + 2] = clamp01(col[j + 2]) * 255 + 0.5;
    out[i * 4 + 3] = alpha ? clamp01(alpha[i]) * 255 + 0.5 : 255;
  }
  return out;
}

// Height -> tangent-space normal (OpenGL convention, +v = +y), roughness in alpha.
function normalRGBA(Hh, W, H, strength, R) {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const ym = ((y - 1 + H) % H) * W, yp = ((y + 1) % H) * W, y0 = y * W;
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const nx = -(Hh[y0 + xp] - Hh[y0 + xm]) * strength;
      const ny = -(Hh[yp + x] - Hh[ym + x]) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y0 + x) * 4;
      out[o] = (nx * inv * 0.5 + 0.5) * 255 + 0.5;
      out[o + 1] = (ny * inv * 0.5 + 0.5) * 255 + 0.5;
      out[o + 2] = (inv * 0.5 + 0.5) * 255 + 0.5;
      out[o + 3] = R ? clamp01(R[y0 + x]) * 255 + 0.5 : 255;
    }
  }
  return out;
}

// normal maps are skipped entirely on the low tier (its materials don't use them)
let NORMALS = true;
function nmap(Hh, W, H, strength, R, aniso) {
  return NORMALS ? dtex(normalRGBA(Hh, W, H, strength, R), W, H, aniso) : null;
}

function dtex(data, W, H, aniso, srgb = false, wrap = true) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function ctex(c, aniso, srgb = true, wrap = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// draw helpers on float RGB images with wrap-around (W, H powers of two)
function splat(col, W, H, x, y, r, g, b, a) {
  const i = (((y | 0) & (H - 1)) * W + ((x | 0) & (W - 1))) * 3;
  col[i] += (r - col[i]) * a; col[i + 1] += (g - col[i + 1]) * a; col[i + 2] += (b - col[i + 2]) * a;
}

// meandering crack as a random walk; calls fn(index) per pixel touched
function crackWalk(W, H, r, steps, fn) {
  let x = r() * W, y = r() * H, a = r() * Math.PI * 2;
  for (let k = 0; k < steps; k++) {
    a += (r() - 0.5) * 0.7;
    x += Math.cos(a); y += Math.sin(a);
    fn((((y | 0) & (H - 1)) * W + ((x | 0) & (W - 1))));
    if (r() < 0.01) { // short branch
      let bx = x, by = y, ba = a + (r() < 0.5 ? 1 : -1) * (0.6 + r());
      for (let j = 0, n = 10 + r() * 40; j < n; j++) {
        ba += (r() - 0.5) * 0.8; bx += Math.cos(ba); by += Math.sin(ba);
        fn((((by | 0) & (H - 1)) * W + ((bx | 0) & (W - 1))));
      }
    }
  }
}

// ---------------------------------------------------------------- surfaces
function grassMaps(S, aniso) {
  const r = rng(11);
  const N = S * S;
  const clump = field(S, 'lo', 0);
  const fine = field(S, 'hi', 0);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const c = clump[i], f = fine[i];
    const k = 0.75 + 0.35 * c + 0.18 * (f - 0.5) + (r() - 0.5) * 0.12;
    const dry = smooth(0.55, 0.95, 1 - c) * 0.35;
    col[i * 3] = (0.19 + 0.20 * dry) * k;
    col[i * 3 + 1] = (0.28 + 0.06 * dry) * k;
    col[i * 3 + 2] = (0.10 + 0.04 * dry) * k;
  }
  // blades
  const blades = Math.floor(N * 0.075);
  const sc = S / 1024;
  for (let b = 0; b < blades; b++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI * 2;
    const len = (6 + r() * 12) * sc + 2;
    const u = r();
    let R, G, B;
    if (u < 0.5) { const t = r(); R = 0.24 + 0.10 * t; G = 0.36 + 0.12 * t; B = 0.12 + 0.05 * t; }
    else if (u < 0.78) { const t = r(); R = 0.36 + 0.10 * t; G = 0.47 + 0.08 * t; B = 0.17 + 0.05 * t; }
    else if (u < 0.92) { R = 0.12; G = 0.19; B = 0.07; }
    else if (u < 0.975) { const t = r(); R = 0.52 + 0.1 * t; G = 0.49 + 0.08 * t; B = 0.28; }
    else { R = 0.28; G = 0.23; B = 0.15; }
    const shade = 0.55 + 0.3 * clump[((y | 0) & (S - 1)) * S + ((x | 0) & (S - 1))];
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let k = 0; k < len; k++) {
      const t = k / len, br = (0.75 + 0.45 * t) * (0.8 + shade * 0.4);
      splat(col, S, S, x + dx * k, y + dy * k, R * br, G * br, B * br, 0.8);
    }
  }
  // clover / weed specks and bare soil in thin patches
  for (let k = 0, n = N * 0.004; k < n; k++) {
    const x = r() * S, y = r() * S;
    const thin = clump[((y | 0) & (S - 1)) * S + ((x | 0) & (S - 1))] < 0.3;
    if (thin) for (let j = 0; j < 4; j++) splat(col, S, S, x + (j & 1), y + (j >> 1), 0.30, 0.25, 0.16, 0.7);
    else if (r() < 0.25) for (let j = 0; j < 4; j++) splat(col, S, S, x + (j & 1), y + (j >> 1), 0.26, 0.40, 0.14, 0.6);
  }
  return dtex(packRGB(col, S, S), S, S, aniso, true);
}

function asphaltMaps(S, aniso, seed, base) {
  const r = rng(seed);
  const N = S * S;
  const mid = field(S, 'lo', 1);
  const fine = field(S, 'hi', 1);
  const col = new Float32Array(N * 3), H = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = base * (0.9 + 0.2 * mid[i]) + (fine[i] - 0.5) * 0.07 + (r() - 0.5) * 0.06;
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 1.03;
    H[i] = fine[i] * 0.35 + r() * 0.15;
    R[i] = 0.86 + r() * 0.1;
  }
  // exposed aggregate
  const stones = Math.floor(N * 0.05);
  for (let k = 0; k < stones; k++) {
    const x = (r() * S) | 0, y = (r() * S) | 0;
    const sz = r() < 0.8 ? 1 : 2;
    const b = base * 1.25 + r() * 0.26, w = (r() - 0.5) * 0.05;
    const hh = 0.65 + r() * 0.35, rr = 0.5 + r() * 0.22;
    for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz + (r() < 0.4 ? 1 : 0); dx++) {
      const i = ((y + dy) & (S - 1)) * S + ((x + dx) & (S - 1));
      col[i * 3] = b + w; col[i * 3 + 1] = b; col[i * 3 + 2] = b - w * 0.6;
      H[i] = hh; R[i] = rr;
    }
  }
  // pores (dark voids between stones)
  for (let k = 0, n = N * 0.02; k < n; k++) {
    const i = ((r() * S) | 0) * S + ((r() * S) | 0);
    col[i * 3] *= 0.55; col[i * 3 + 1] *= 0.55; col[i * 3 + 2] *= 0.55; H[i] = 0;
  }
  // a few hairline cracks
  for (let c = 0; c < 3; c++) crackWalk(S, S, r, S * 0.35, (i) => {
    col[i * 3] *= 0.5; col[i * 3 + 1] *= 0.5; col[i * 3 + 2] *= 0.5; H[i] = -0.4; R[i] = 0.96;
  });
  return {
    map: dtex(packRGB(col, S, S), S, S, aniso, true),
    normal: nmap(H, S, S, 1.1, R, aniso),
  };
}

function concreteMaps(S, aniso, slabs) {
  const r = rng(23);
  const N = S * S, slab = S / slabs;
  const mid = field(S, 'lo', 2);
  const fine = field(S, 'hi', 2);
  const col = new Float32Array(N * 3), H = new Float32Array(N), R = new Float32Array(N);
  const tone = [], dir = [];
  for (let k = 0; k < slabs * slabs; k++) { tone.push(0.93 + r() * 0.12); dir.push(r() < 0.5); }
  // broom texture: per-row/column streaks
  const streakX = new Float32Array(S), streakY = new Float32Array(S);
  for (let i = 0; i < S; i++) { streakX[i] = r(); streakY[i] = r(); }
  blur(streakX, S, 1, 1, 1); blur(streakY, S, 1, 1, 1);
  const jw = Math.max(1, S / 1024 * 1.4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const sx = Math.floor(x / slab), sy = Math.floor(y / slab), sId = sy * slabs + sx;
    const lx = x - sx * slab, ly = y - sy * slab;
    const d = Math.min(lx, slab - 1 - lx, ly, slab - 1 - ly);
    const broom = (dir[sId] ? streakX[x] : streakY[y]) - 0.5;
    let v = 0.62 * tone[sId] * (0.92 + 0.14 * mid[i]) + (fine[i] - 0.5) * 0.06 + broom * 0.035 + (r() - 0.5) * 0.04;
    let h = 0.5 + fine[i] * 0.2 + broom * 0.15 + r() * 0.05;
    let rough = 0.8 + fine[i] * 0.12;
    if (d < jw) { v *= 0.35; h = -0.6; rough = 0.95; }
    else if (d < jw * 3.5) { v *= 0.86; h = 0.3; rough = 0.72; } // sealant / trowelled edge
    else if (d < jw * 7) { h += 0.05; rough = 0.74; }
    col[i * 3] = v * 1.01; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 0.96;
    H[i] = h; R[i] = rough;
  }
  // bug holes and chips
  for (let k = 0, n = N * 0.0016; k < n; k++) {
    const x = (r() * S) | 0, y = (r() * S) | 0, s = r() < 0.8 ? 1 : 2;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const i = ((y + dy) & (S - 1)) * S + ((x + dx) & (S - 1));
      col[i * 3] *= 0.6; col[i * 3 + 1] *= 0.6; col[i * 3 + 2] *= 0.6; H[i] = 0.1;
    }
  }
  // a couple of cracked slabs
  for (let c = 0; c < 2; c++) crackWalk(S, S, r, slab * 0.9, (i) => {
    col[i * 3] *= 0.55; col[i * 3 + 1] *= 0.55; col[i * 3 + 2] *= 0.55; H[i] = -0.3; R[i] = 0.95;
  });
  return {
    map: dtex(packRGB(col, S, S), S, S, aniso, true),
    normal: nmap(H, S, S, 1.6, R, aniso),
  };
}

function dirtMaps(S, aniso) {
  const r = rng(31);
  const N = S * S;
  const big = field(S, 'lo', 3);
  const clod = field(S, 'mid', 3);
  const col = new Float32Array(N * 3), H = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = big[i] * 0.7 + clod[i] * 0.3;
    const k = 0.92 + (r() - 0.5) * 0.1;
    col[i * 3] = (0.36 + 0.20 * t) * k;
    col[i * 3 + 1] = (0.28 + 0.17 * t) * k;
    col[i * 3 + 2] = (0.20 + 0.13 * t) * k;
    H[i] = big[i] * 0.4 + clod[i] * 0.6;
    R[i] = 0.92 + r() * 0.06;
  }
  const sc = S / 1024;
  for (let k = 0, n = N * 0.0012; k < n; k++) { // pebbles
    const x = r() * S, y = r() * S, rad = (1 + r() * 2.5) * sc + 0.6;
    const g = 0.3 + r() * 0.14, w = r() * 0.04;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const q = 1 - (dx * dx + dy * dy) / (rad * rad);
      if (q <= 0) continue;
      const i = (((y + dy) | 0) & (S - 1)) * S + (((x + dx) | 0) & (S - 1));
      const sh = 0.8 + 0.25 * q;
      col[i * 3] = (g + w) * sh; col[i * 3 + 1] = g * sh; col[i * 3 + 2] = (g - w) * sh;
      H[i] = 1 + q * 0.8; R[i] = 0.7;
    }
  }
  return {
    map: dtex(packRGB(col, S, S), S, S, aniso, true),
    normal: nmap(H, S, S, 2.2, R, aniso),
  };
}

function gravelMaps(S, aniso) {
  const r = rng(41);
  const N = S * S;
  const W = worley(S, Math.round(S / 6), r);
  const pal = [[0.70, 0.64, 0.54], [0.60, 0.58, 0.55], [0.66, 0.56, 0.44], [0.48, 0.46, 0.43], [0.76, 0.72, 0.64]];
  const col = new Float32Array(N * 3), H = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const id = W.id[i];
    const p = pal[Math.floor(id * 97) % pal.length];
    const h = Math.sqrt(clamp01(1 - W.f1[i] / (W.cs * 0.72)));
    const gap = smooth(0.4, 1.6, W.f2[i] - W.f1[i]);
    const k = (0.55 + 0.5 * h) * (0.35 + 0.65 * gap) * (0.9 + id * 0.2);
    col[i * 3] = p[0] * k; col[i * 3 + 1] = p[1] * k; col[i * 3 + 2] = p[2] * k;
    H[i] = h * gap;
    R[i] = 0.62 + ((id * 13) % 1) * 0.3;
  }
  return {
    map: dtex(packRGB(col, S, S), S, S, aniso, true),
    normal: nmap(H, S, S, 2.0, R, aniso),
  };
}

// kerb: u across (0 = track side), v along; one red and one white block per tile
function kerbMap(aniso) {
  const W = 128, H = 512;
  const r = rng(51);
  const wear = field(512, 'mid', 0);
  const col = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const red = y < H / 2;
    let c = red ? [0.66, 0.09, 0.08] : [0.86, 0.86, 0.83];
    const wv = wear[(y % 512) * 512 + (x * 4) % 512];
    const u = x / W;
    // worn paint reveals the concrete
    const worn = smooth(0.62, 0.78, wv + (1 - u) * 0.12);
    c = c.map((v, k) => v + ([0.5, 0.49, 0.47][k] - v) * worn * 0.8);
    // rubber on the track side, dust on the grass side
    const rub = smooth(0.55, 0.0, u) * (0.35 + 0.4 * wv);
    const dust = smooth(0.7, 1.0, u) * 0.3;
    const edge = Math.min(H / 2 - 1 - (y % (H / 2)), y % (H / 2)) < 3 ? 0.85 : 1;
    for (let k = 0; k < 3; k++) {
      let v = c[k] * (1 - rub * 0.75) * edge;
      v += ([0.55, 0.47, 0.36][k] - v) * dust;
      col[i * 3 + k] = v * (0.96 + r() * 0.08);
    }
  }
  return dtex(packRGB(col, W, H), W, H, aniso, true);
}

// tyre-wall conveyor belt: u along 2.4 m (two panels), v up 1.2 m
function beltMaps(aniso) {
  const W = 512, H = 256;
  const r = rng(61);
  const n = field(512, 'mid', 1);
  const col = new Float32Array(W * H * 3), Hh = new Float32Array(W * H), R = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const v = y / H, u = x / W;
    const panel = u < 0.5 ? [0.62, 0.07, 0.06] : [0.84, 0.84, 0.81];
    const seam = Math.min(x % (W / 2), W / 2 - (x % (W / 2)));
    const hem = v < 0.05 || v > 0.95;
    let c = hem ? [0.06, 0.06, 0.065] : panel;
    if (seam < 3) c = [0.05, 0.05, 0.05];
    const nn = n[(y * 2 % 512) * 512 + x];
    const dirt = smooth(0.35, 0.0, v) * 0.55 + nn * 0.12;
    const scuff = smooth(0.62, 0.8, n[((y * 7) % 512) * 512 + ((x * 3) % 512)]) * smooth(0.1, 0.25, v) * smooth(0.65, 0.45, v);
    for (let k = 0; k < 3; k++) {
      let val = c[k] + ([0.32, 0.27, 0.2][k] - c[k]) * dirt;
      val *= 1 - scuff * 0.8;
      col[i * 3 + k] = val * (0.95 + r() * 0.1);
    }
    // bulges over the tyre layers behind the belt (5 per tile)
    Hh[i] = Math.sin(v * Math.PI * 10) * 0.5 + (seam < 3 ? -1 : 0) + nn * 0.1;
    R[i] = hem || seam < 3 ? 0.85 : 0.62 + nn * 0.15;
  }
  // bolts along the seams
  for (let s = 0; s < 2; s++) for (let b = 0; b < 8; b++) {
    const bx = s * W / 2, by = (b + 0.5) * H / 8;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 9) continue;
      const i = (((by + dy) | 0) & (H - 1)) * W + ((bx + dx + W) % W);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.55; Hh[i] = 1.2; R[i] = 0.4;
    }
  }
  return { map: dtex(packRGB(col, W, H), W, H, aniso, true), normal: nmap(Hh, W, H, 1.5, R, aniso) };
}

// cast-in-place concrete wall: u along, v up from the ground, 4 m x 4 m per tile
function wallMaps(aniso) {
  const S = 512;
  const r = rng(71);
  const N = S * S;
  const mid = field(S, 'lo', 0);
  const fine = field(S, 'hi', 0);
  const streak = new Float32Array(S);
  for (let i = 0; i < S; i++) streak[i] = r();
  blur(streak, S, 1, 2, 2);
  stretch(streak);
  const col = new Float32Array(N * 3), H = new Float32Array(N), R = new Float32Array(N);
  const scuffN = field(S, 'mid', 2);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const hgt = y / S * 4; // metres above the ground
    let v = 0.6 * (0.9 + 0.16 * mid[i]) + (fine[i] - 0.5) * 0.05 + (r() - 0.5) * 0.03;
    let h = fine[i] * 0.3;
    // formwork panel joints
    const jy = Math.abs(((hgt + 0.6) % 1.2) - 0.6) * S / 4, jx = Math.abs(((x / S * 4) % 2.4) - 1.2) * S / 4;
    const joint = (Math.abs(jy - 0.6 * S / 4) < 1.2) || (Math.abs(jx - 1.2 * S / 4) < 1.2);
    if (joint) { v *= 0.78; h = -0.5; }
    // rain streaks
    v *= 1 - smooth(0.7, 1.0, streak[x]) * 0.12 * (0.5 + 0.5 * mid[i]);
    // ground splash
    v *= 1 - smooth(0.45, 0.0, hgt) * 0.25;
    // rubber scuffs where bumpers and tyres hit
    const sc = smooth(0.68, 0.85, scuffN[((y * 6) & (S - 1)) * S + x]) * smooth(0.12, 0.25, hgt) * smooth(0.8, 0.5, hgt);
    v *= 1 - sc * 0.7;
    col[i * 3] = v * 1.01; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 0.97;
    H[i] = h; R[i] = 0.82 + fine[i] * 0.12;
  }
  // tie holes
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 6; gx++) {
    const cx = (gx + 0.5) * S / 6, cy = (gy + 0.5) * S / 6 + 6;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 5) continue;
      const i = (((cy + dy) | 0) & (S - 1)) * S + (((cx + dx) | 0) & (S - 1));
      col[i * 3] *= 0.5; col[i * 3 + 1] *= 0.5; col[i * 3 + 2] *= 0.5; H[i] = -1;
    }
  }
  return { map: dtex(packRGB(col, S, S), S, S, aniso, true), normal: nmap(H, S, S, 1.4, R, aniso) };
}

// shared linear noise: R,G,B = fbm at increasing frequency, A = high-frequency
function noiseMap(S) {
  const r = rng(91);
  const a = stretch(fbm(S, 4, 4, r)), b = stretch(fbm(S, 8, 4, r)), c = stretch(fbm(S, 16, 3, r)), d = stretch(fbm(S, 32, 2, r));
  const out = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    out[i * 4] = a[i] * 255; out[i * 4 + 1] = b[i] * 255; out[i * 4 + 2] = c[i] * 255; out[i * 4 + 3] = d[i] * 255;
  }
  const t = dtex(out, S, S, 1);
  return t;
}

// worn paint: white with alpha holes
function paintMap(S) {
  const r = rng(101);
  const n = stretch(fbm(S, 8, 5, r));
  const out = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const wear = smooth(0.58, 0.82, n[i]) * 0.85 + (r() < 0.04 ? 0.5 : 0);
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255 * (0.9 + r() * 0.1);
    out[i * 4 + 3] = clamp01(1 - wear) * 255;
  }
  return dtex(out, S, S, 4);
}

// galvanised chain-link mesh (alpha)
function fenceMap() {
  const S = 64;
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = Math.abs(((x + y) % 32) - 16), b = Math.abs(((x - y + 64) % 32) - 16);
    const d = Math.min(16 - a, 16 - b);
    const cov = clamp01(1.8 - d);
    const o = (y * S + x) * 4;
    out[o] = 150; out[o + 1] = 156; out[o + 2] = 152; out[o + 3] = cov * 255;
  }
  return dtex(out, S, S, 4, true);
}

// ---------------------------------------------------------------- canvas art
function hazardTex(aniso) {
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = '#e8ad0c'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#141414';
  for (let i = -2; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 32, 64); ctx.lineTo(i * 32 + 16, 64); ctx.lineTo(i * 32 + 16 + 64, 0); ctx.lineTo(i * 32 + 64, 0);
    ctx.fill();
  }
  // grime
  const r = rng(5);
  for (let k = 0; k < 400; k++) { ctx.fillStyle = `rgba(40,30,20,${r() * 0.12})`; ctx.fillRect(r() * 256, r() * 64, 1 + r() * 4, 1 + r() * 3); }
  return ctex(c, aniso);
}

function targetTex(aniso) {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#f2b705'; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#121212';
  ctx.beginPath(); ctx.moveTo(128, 128); ctx.arc(128, 128, 120, 0, Math.PI / 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(128, 128); ctx.arc(128, 128, 120, Math.PI, Math.PI * 1.5); ctx.fill();
  ctx.strokeStyle = '#121212'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(4, 4, 248, 248);
  return ctex(c, aniso, true, false);
}

function checkerTex(aniso) {
  const [c, ctx] = canvas(256, 64);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = (x + y) % 2 ? '#141414' : '#e8e8e2'; ctx.fillRect(x * 32, y * 32, 32, 32); }
  const r = rng(6);
  for (let k = 0; k < 600; k++) { ctx.fillStyle = `rgba(20,20,20,${r() * 0.25})`; ctx.fillRect(r() * 256, r() * 64, 1 + r() * 3, 1 + r() * 2); }
  return ctex(c, aniso);
}

const ADS = [
  { bg: '#16325f', fg: '#ffffff', ac: '#f2b705', text: 'APEX TYRES', sub: 'GRIP THAT HOLDS' },
  { bg: '#f2b705', fg: '#141414', ac: '#141414', text: 'VALLEY FUEL', sub: 'RACE GRADE' },
  { bg: '#a81f22', fg: '#ffffff', ac: '#ffffff', text: 'TORQUE OIL', sub: 'MOTOR LUBRICANTS' },
  { bg: '#f1f1ec', fg: '#141414', ac: '#d23b1e', text: 'CRUMPLE VALLEY', sub: 'PROVING GROUND' },
  { bg: '#141414', fg: '#f4f4f0', ac: '#ff6a13', text: 'KESTREL BRAKES', sub: 'STOP HARDER' },
  { bg: '#1d6a3c', fg: '#ffffff', ac: '#cde8d4', text: 'BUCKLE UP', sub: 'SAFETY FIRST' },
  { bg: '#e9e9e4', fg: '#16325f', ac: '#16325f', text: 'NORTHGATE', sub: 'TIMING SYSTEMS' },
  { bg: '#ff6a13', fg: '#141414', ac: '#ffffff', text: 'RIDGEWAY', sub: 'TRUCK & TRAILER' },
];

// billboard atlas: 8 boards stacked vertically (each 1024 x 128, ~8:1)
function adsTex(aniso) {
  const [c, ctx] = canvas(1024, 1024);
  ADS.forEach((a, k) => {
    const y = k * 128;
    ctx.fillStyle = a.bg; ctx.fillRect(0, y, 1024, 128);
    ctx.fillStyle = a.ac;
    ctx.beginPath(); ctx.moveTo(0, y + 128); ctx.lineTo(60, y); ctx.lineTo(96, y); ctx.lineTo(36, y + 128); ctx.fill();
    ctx.beginPath(); ctx.moveTo(1024 - 36, y + 128); ctx.lineTo(1024 - 96 + 60, y); ctx.lineTo(1024, y); ctx.lineTo(1024, y + 128); ctx.fill();
    ctx.fillStyle = a.fg;
    ctx.textBaseline = 'middle';
    ctx.font = '900 70px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    const w = ctx.measureText(a.text).width;
    const sw = Math.min(1, 640 / w);
    ctx.save(); ctx.translate(130, y + 58); ctx.scale(sw, 1); ctx.fillText(a.text, 0, 0); ctx.restore();
    ctx.font = '700 30px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(a.sub, 960, y + 66);
    ctx.textAlign = 'left';
  });
  return ctex(c, aniso, true, false);
}

// white glyphs / shapes on transparent, tinted by vertex colour; regions in uv space
export const DECALS = {};
function decalTex(aniso) {
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const reg = (name, x, y, w, h) => { DECALS[name] = [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S]; };
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const text = (name, s, x, y, w, h, size) => {
    ctx.font = `800 ${size}px "Arial Narrow", Arial, sans-serif`;
    const tw = ctx.measureText(s).width;
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.scale(Math.min(1, (w - 8) / tw), 1); ctx.fillText(s, 0, 4); ctx.restore();
    reg(name, x, y, w, h);
  };
  // numbers in a row of 128 x 128 cells
  ['10', '20', '30', '40', '50', '60', '1', '2'].forEach((s, k) => text('n' + s, s, k * 128, 0, 128, 128, 112));
  ['3', '4', '5', 'P'].forEach((s, k) => text('n' + s, s, k * 128, 128, 128, 128, 112));
  text('STOP', 'STOP', 512, 128, 512, 128, 120);
  text('SKIDPAD', 'SKID PAD', 0, 256, 1024, 128, 120);
  text('CRASHLAB', 'IMPACT ZONE', 0, 384, 1024, 128, 120);
  text('PITLANE', 'PIT LANE', 0, 512, 512, 128, 110);
  text('SLOW', 'SLOW', 512, 512, 512, 128, 120);
  // arrow
  ctx.beginPath();
  ctx.moveTo(64, 640 + 120); ctx.lineTo(64, 640 + 50); ctx.lineTo(20, 640 + 50); ctx.lineTo(128, 640 + 4);
  ctx.lineTo(236, 640 + 50); ctx.lineTo(192, 640 + 50); ctx.lineTo(192, 640 + 120); ctx.closePath(); ctx.fill();
  reg('arrow', 0, 640, 256, 128);
  // crash calibration grid: black and white 8 x 4 squares (opaque)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#2a2a2a' : '#d9d9d3';
    ctx.fillRect(260 + x * 16, 640 + y * 16, 16, 16);
  }
  reg('calib', 260, 640, 256, 128);
  // grid slot bracket for the start grid (u runs back towards the car, v across)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(808, 648, 22, 368); ctx.fillRect(808, 648, 112, 14); ctx.fillRect(808, 1002, 112, 14);
  reg('slot', 800, 640, 128, 384);
  // generic white square for painted boxes
  ctx.fillRect(964, 652, 40, 40);
  reg('white', 970, 658, 28, 28);
  const t = ctex(c, aniso, true, false);
  return t;
}

function doorTex(aniso) {
  const [c, ctx] = canvas(256, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#9da3a8'); g.addColorStop(1, '#868c91');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 8) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, y, 256, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, y + 6, 256, 2);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 248, 256, 8);
  ctx.fillStyle = '#2b2f33'; ctx.fillRect(0, 0, 6, 256); ctx.fillRect(250, 0, 6, 256);
  return ctex(c, aniso);
}

function glassTex(aniso) {
  const [c, ctx] = canvas(256, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#6f8597'); g.addColorStop(0.55, '#2c3a46'); g.addColorStop(1, '#1d262e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(k * 70, 0); ctx.lineTo(k * 70 + 30, 0); ctx.lineTo(k * 70 - 20, 128); ctx.lineTo(k * 70 - 50, 128); ctx.fill(); }
  ctx.fillStyle = '#b9bec2';
  for (let x = 0; x <= 256; x += 64) ctx.fillRect(x - 3, 0, 6, 128);
  ctx.fillRect(0, 0, 256, 5); ctx.fillRect(0, 123, 256, 5);
  return ctex(c, aniso);
}

function claddingTex(aniso) {
  const [c, ctx] = canvas(128, 128);
  for (let x = 0; x < 128; x++) {
    const s = Math.sin(x / 128 * Math.PI * 16);
    const v = 200 + s * 22;
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 4})`; ctx.fillRect(x, 0, 1, 128);
  }
  const r = rng(8);
  for (let k = 0; k < 120; k++) { ctx.fillStyle = `rgba(80,80,70,${r() * 0.08})`; ctx.fillRect(r() * 128, r() * 128, 1, 4 + r() * 30); }
  return ctex(c, aniso);
}

function honeycombTex(aniso) {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#8f969c'; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#d7dce0'; ctx.lineWidth = 2;
  const R = 8, h = R * Math.sqrt(3);
  for (let row = -1; row < 10; row++) for (let col = -1; col < 10; col++) {
    const cx = col * R * 3 + (row % 2 ? R * 1.5 : 0), cy = row * h / 2;
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) { const a = k * Math.PI / 3; ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
    ctx.stroke();
  }
  return ctex(c, aniso);
}

// foliage atlas: left half a leaf cluster with alpha (for crown cards), right
// half solid white (trunks / inner crown, tinted by vertex colour)
function leafTex(aniso) {
  const [c, ctx] = canvas(512, 256);
  ctx.clearRect(0, 0, 512, 256);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(256, 0, 256, 256);
  const r = rng(13);
  // twigs
  ctx.strokeStyle = 'rgba(70,58,40,0.9)'; ctx.lineWidth = 2;
  for (let k = 0; k < 9; k++) {
    const a = r() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(128 + Math.cos(a) * 95, 128 + Math.sin(a) * 95); ctx.stroke();
  }
  // leaves: inner and lower ones darker, outer / upper ones lighter
  for (let k = 0; k < 1500; k++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 112;
    const x = 128 + Math.cos(a) * rad, y = 128 + Math.sin(a) * rad;
    const t = rad / 112, up = 1 - y / 256;
    const l = 15 + t * 11 + up * 9 + (r() - 0.5) * 9;
    ctx.fillStyle = `hsl(${84 + r() * 26}, ${30 + r() * 16}%, ${l}%)`;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + (r() - 0.5) * 1.6);
    ctx.beginPath(); ctx.ellipse(0, 0, 6 + r() * 5, 2.6 + r() * 1.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  const t = ctex(c, aniso, true, false);
  return t;
}

// distant crowd for the stands: heads and shirts on dark seats
function crowdTex(aniso) {
  const [c, ctx] = canvas(512, 128);
  ctx.fillStyle = '#23272c'; ctx.fillRect(0, 0, 512, 128);
  const r = rng(9);
  const shirts = ['#b9b9b4', '#8f2d24', '#2a4f8a', '#b89a35', '#2a2a2e', '#4d6e3d', '#b8692a', '#3b3b40', '#d0d0cc', '#1d2d4a', '#5a5a5e', '#1a1a1c'];
  for (let row = 0; row < 8; row++) for (let x = 2; x < 512; x += 7 + r() * 4) {
    if (r() < 0.22) continue;
    const y = row * 16 + 3;
    ctx.fillStyle = shirts[(r() * shirts.length) | 0]; ctx.fillRect(x, y + 5, 6, 8);
    ctx.fillStyle = ['#e2b896', '#c8946c', '#8a5a3c', '#f0cfb0'][(r() * 4) | 0]; ctx.fillRect(x + 1, y, 4, 5);
  }
  return ctex(c, aniso);
}

// ---------------------------------------------------------------- entry point
export function makeTextures(renderer, quality = 'high') {
  const hi = quality !== 'low';
  const maxA = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
  const aniso = Math.min(maxA, quality === 'high' ? 8 : 4);
  const big = quality === 'high' ? 1024 : 512;
  NORMALS = hi;
  const T = {};
  // metres per texture tile (geometry uvs are metres / tile)
  T.tile = { grass: 3, asphalt: 4, concrete: 12, dirt: 6, gravel: 2, kerb: 2, belt: 2.4, wall: 4, paint: 3, fence: 0.25, hazard: 1 };
  T.noise = noiseMap(hi ? 256 : 128);
  T.grass = grassMaps(big, aniso);
  const a = asphaltMaps(big, aniso, 17, 0.27);
  T.asphalt = a.map; T.asphaltN = a.normal;
  const cc = concreteMaps(big, aniso, 3);
  T.concrete = cc.map; T.concreteN = cc.normal;
  const d = dirtMaps(hi ? 1024 : 512, aniso);
  T.dirt = d.map; T.dirtN = d.normal;
  const g = gravelMaps(hi ? 512 : 256, aniso);
  T.gravel = g.map; T.gravelN = g.normal;
  T.kerb = kerbMap(aniso);
  const b = beltMaps(aniso);
  T.belt = b.map; T.beltN = b.normal;
  const w = wallMaps(aniso);
  T.wall = w.map; T.wallN = w.normal;
  T.paint = paintMap(256);
  T.fence = fenceMap();
  T.hazard = hazardTex(aniso);
  T.target = targetTex(aniso);
  T.checker = checkerTex(aniso);
  T.ads = adsTex(aniso);
  T.adCount = ADS.length;
  T.decals = decalTex(aniso);
  T.door = doorTex(aniso);
  T.glass = glassTex(aniso);
  T.cladding = claddingTex(aniso);
  T.honeycomb = honeycombTex(aniso);
  T.crowd = crowdTex(aniso);
  T.leaves = leafTex(aniso);
  FIELDS.clear();
  return T;
}
