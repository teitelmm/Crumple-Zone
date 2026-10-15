// Procedural canvas textures, so the game ships without image assets.
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function noiseFill(ctx, w, h, base, spread, seed, blobs = 0) {
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * spread;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  for (let k = 0; k < blobs; k++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, 4 + r() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
}

function tex(c, repeatX = 1, repeatY = 1, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeTextures() {
  const T = {};
  {
    const [c, ctx] = canvas(512, 512);
    noiseFill(ctx, 512, 512, '#55703a', 34, 1);
    const r = rng(7);
    for (let k = 0; k < 900; k++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(90,120,55,0.35)' : 'rgba(60,80,35,0.35)';
      ctx.fillRect(r() * 512, r() * 512, 2 + r() * 6, 2 + r() * 6);
    }
    T.grass = tex(c, 300, 300);
  }
  {
    const [c, ctx] = canvas(512, 512);
    noiseFill(ctx, 512, 512, '#3d3f42', 26, 2, 60);
    T.asphalt = tex(c, 30, 30);
  }
  {
    const [c, ctx] = canvas(512, 512);
    noiseFill(ctx, 512, 512, '#8e8f8a', 22, 3, 30);
    ctx.strokeStyle = 'rgba(40,40,40,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 128) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke(); }
    T.concrete = tex(c, 40, 6);
  }
  {
    const [c, ctx] = canvas(512, 512);
    noiseFill(ctx, 512, 512, '#7a6247', 40, 4, 120);
    T.dirt = tex(c, 12, 12);
  }
  {
    // track: asphalt with white edge lines; v runs along the track
    const [c, ctx] = canvas(256, 512);
    noiseFill(ctx, 256, 512, '#3a3c3f', 24, 5, 30);
    ctx.fillStyle = '#e9e9e2';
    ctx.fillRect(6, 0, 7, 512);
    ctx.fillRect(243, 0, 7, 512);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(70, 0, 30, 512);
    ctx.fillRect(156, 0, 30, 512);
    T.track = tex(c, 1, 1);
  }
  {
    const [c, ctx] = canvas(64, 256);
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#e8e6e0' : '#c7262a'; ctx.fillRect(0, i * 32, 64, 32); }
    T.kerb = tex(c, 1, 1);
  }
  {
    const [c, ctx] = canvas(256, 64);
    ctx.fillStyle = '#18191b'; ctx.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = '#26272a';
      ctx.beginPath(); ctx.ellipse(16 + i * 32, 32, 14, 28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0c0c0d';
      ctx.beginPath(); ctx.ellipse(16 + i * 32, 32, 6, 14, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#e4e4de'; ctx.fillRect(0, 26, 256, 10);
    T.tyres = tex(c, 1, 1);
  }
  {
    // concrete barrier with hazard chevrons along the top
    const [c, ctx] = canvas(512, 256);
    noiseFill(ctx, 512, 256, '#a3a29c', 22, 6, 20);
    for (let i = -2; i < 18; i++) {
      ctx.fillStyle = i % 2 ? '#f2b705' : '#151515';
      ctx.beginPath();
      ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32 + 32, 0); ctx.lineTo(i * 32 + 62, 40); ctx.lineTo(i * 32 + 30, 40);
      ctx.fill();
    }
    T.barrier = tex(c, 1, 1);
  }
  {
    // crash test target: yellow and black quadrants
    const [c, ctx] = canvas(256, 256);
    ctx.fillStyle = '#f2b705'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#121212';
    ctx.beginPath(); ctx.moveTo(128, 128); ctx.arc(128, 128, 120, 0, Math.PI / 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(128, 128); ctx.arc(128, 128, 120, Math.PI, Math.PI * 1.5); ctx.fill();
    ctx.strokeStyle = '#121212'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.stroke();
    T.target = tex(c, 1, 1);
    T.target.wrapS = T.target.wrapT = THREE.ClampToEdgeWrapping;
  }
  {
    const [c, ctx] = canvas(256, 256);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee'; ctx.fillRect(x * 32, y * 32, 32, 32); }
    T.checker = tex(c, 1, 1);
  }
  {
    // lane markings for the crash strip
    const [c, ctx] = canvas(64, 512);
    ctx.clearRect(0, 0, 64, 512);
    ctx.fillStyle = '#f2b705';
    for (let i = 0; i < 4; i++) ctx.fillRect(24, i * 128, 16, 80);
    T.dash = tex(c, 1, 30);
  }
  return T;
}
