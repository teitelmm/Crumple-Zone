// Procedural textures for the effects: lit smoke puffs (normal + density atlas),
// a tileable noise field, and a star-shaped glint. Everything is generated once
// at start-up into DataTextures; nothing here runs per frame.
import * as THREE from 'three';

// ---------------------------------------------------------------- noise
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Periodic value noise on a 256-wide lattice: noise(x, y, period) tiles every `period` cells.
function makeNoise(seed) {
  const r = rng(seed);
  const L = new Float32Array(256 * 256);
  for (let i = 0; i < L.length; i++) L[i] = r();
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, P = 256) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = fade(x - xi), fy = fade(y - yi);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P;
    const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a = L[y0 * 256 + x0], b = L[y0 * 256 + x1], c = L[y1 * 256 + x0], d = L[y1 * 256 + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbm(noise, x, y, oct, P) {
  let s = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    s += noise(x * f, y * f, P ? P * f : 256) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function dataTexture(data, size, opts = {}) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.wrapS = t.wrapT = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- smoke puffs
// 2x2 atlas of billowy puffs. RG = surface normal (quad space, xy), B = cavity
// occlusion, A = opacity. The normal lets the shader light each puff from the sun
// (bright tops, darker undersides) instead of drawing a flat disc.
export function makePuffAtlas(cell = 128) {
  const size = cell * 2;
  const data = new Uint8Array(size * size * 4);
  const noise = makeNoise(7), noise2 = makeNoise(19);
  const H = new Float32Array(cell * cell);
  const D = new Float32Array(cell * cell);
  const O = new Float32Array(cell * cell);
  for (let f = 0; f < 4; f++) {
    const r = rng(101 + f * 37);
    // a cluster of overlapping blobs makes a cauliflower outline
    const blobs = [];
    const nb = 8 + Math.floor(r() * 4);
    for (let b = 0; b < nb; b++) {
      const a = r() * Math.PI * 2, d = b === 0 ? 0 : 0.2 + r() * 0.38;
      const br = b === 0 ? 0.52 : 0.2 + r() * 0.2;
      blobs.push([Math.cos(a) * d, Math.sin(a) * d * 0.9, Math.min(br, 0.97 - d), 0.5 + r() * 0.6]);
    }
    const ox = r() * 50, oy = r() * 50;
    for (let j = 0; j < cell; j++) {
      for (let i = 0; i < cell; i++) {
        const u = ((i + 0.5) / cell) * 2 - 1, v = ((j + 0.5) / cell) * 2 - 1;
        let field = 0;
        for (const [bx, by, br, w] of blobs) {
          const dx = (u - bx) / br, dy = (v - by) / br;
          const q = 1 - dx * dx - dy * dy;
          if (q > 0) field += w * q * q * 1.3;
        }
        const lo = fbm(noise, u * 1.8 + ox, v * 1.8 + oy, 3);
        const hi = fbm(noise2, u * 4.5 + ox, v * 4.5 + oy, 4);
        const rr = Math.sqrt(u * u + v * v);
        const shape = field * (0.45 + 1.1 * lo) * smooth(1.0, 0.8, rr);
        const k = j * cell + i;
        D[k] = shape * (0.55 + 0.9 * hi);
        H[k] = Math.sqrt(Math.max(0, shape));
        O[k] = hi;
      }
    }
    const cx = (f % 2) * cell, cy = Math.floor(f / 2) * cell;
    const scale = cell / 2; // height units -> quad units
    for (let j = 0; j < cell; j++) {
      for (let i = 0; i < cell; i++) {
        const k = j * cell + i;
        const hl = H[j * cell + Math.max(0, i - 1)], hr = H[j * cell + Math.min(cell - 1, i + 1)];
        const hd = H[Math.max(0, j - 1) * cell + i], hu = H[Math.min(cell - 1, j + 1) * cell + i];
        let nx = -(hr - hl) * scale * 0.22, ny = -(hu - hd) * scale * 0.22;
        // blend towards a spherical normal so the lighting reads as a round volume
        const u = ((i + 0.5) / cell) * 2 - 1, v = ((j + 0.5) / cell) * 2 - 1;
        nx = nx * 0.7 + u * 0.5; ny = ny * 0.7 + v * 0.5;
        let nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l;
        const alpha = 1 - Math.exp(-D[k] * 1.5);
        const ao = 0.45 + 0.55 * smooth(0.2, 0.8, O[k]);
        const p = ((cy + j) * size + cx + i) * 4;
        data[p] = Math.round((nx * 0.5 + 0.5) * 255);
        data[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[p + 2] = Math.round(ao * 255);
        data[p + 3] = Math.round(Math.min(1, alpha) * 255);
      }
    }
  }
  return dataTexture(data, size);
}

// ---------------------------------------------------------------- tileable noise
// R: streaky fbm (skid mark grain), G: billowy detail (smoke), B: fine grain.
export function makeNoiseTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const n1 = makeNoise(3), n2 = makeNoise(11), n3 = makeNoise(29);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = i / size, y = j / size;
      const a = fbm(n1, x * 8, y * 8, 4, 8);
      const b = fbm(n2, x * 4, y * 4, 5, 4);
      const c = fbm(n3, x * 16, y * 16, 2, 16);
      const p = (j * size + i) * 4;
      data[p] = Math.round(smooth(0.2, 0.8, a) * 255);
      data[p + 1] = Math.round(smooth(0.15, 0.85, b) * 255);
      data[p + 2] = Math.round(c * 255);
      data[p + 3] = 255;
    }
  }
  return dataTexture(data, size, { repeat: true });
}

// ---------------------------------------------------------------- glint
// Four-point star with a soft core, stored in alpha.
export function makeGlintTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * 2 - 1, v = ((j + 0.5) / size) * 2 - 1;
      const r2 = u * u + v * v;
      const core = Math.exp(-r2 * 28) + 0.35 * Math.exp(-r2 * 6);
      const ray = Math.exp(-Math.abs(v) * 42) * Math.max(0, 1 - Math.abs(u)) ** 2
        + Math.exp(-Math.abs(u) * 42) * Math.max(0, 1 - Math.abs(v)) ** 2;
      const du = (u + v) * 0.7071, dv = (u - v) * 0.7071;
      const diag = 0.3 * (Math.exp(-Math.abs(dv) * 50) * Math.max(0, 1 - Math.abs(du) * 1.6) ** 2
        + Math.exp(-Math.abs(du) * 50) * Math.max(0, 1 - Math.abs(dv) * 1.6) ** 2);
      const a = Math.min(1, core + ray * 0.9 + diag) * smooth(1.0, 0.85, Math.sqrt(r2));
      const p = (j * size + i) * 4;
      data[p] = data[p + 1] = data[p + 2] = 255;
      data[p + 3] = Math.round(a * 255);
    }
  }
  return dataTexture(data, size);
}

// sRGB hex -> linear [r, g, b]
export function linearRGB(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
