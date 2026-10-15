// Car materials: clear-coated paint with a damage layer, tinted glass, trim, lights,
// plates. Shared materials are cached per quality tier; paint and tail lights are per car
// (colour and brake state differ).
import * as THREE from 'three';
import { C, SLOT_COUNT } from '../vehicle/bodyshape.js';

export const CRACKED = SLOT_COUNT; // material index of shattered glass

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c, { repeat = false, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}
// small deterministic PRNG so textures look the same every run
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

let plateTex = null;
function plateTexture() {
  if (plateTex) return plateTex;
  const c = canvas(256, 128), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#f4f4ef'); grd.addColorStop(1, '#dcdcd4');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#2b2f36'; g.lineWidth = 5; g.strokeRect(4, 4, 248, 120);
  g.fillStyle = '#2e4f8f'; g.font = 'bold 17px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('PROVING GROUND', 128, 22);
  g.fillStyle = '#1c222c'; g.font = 'bold 60px "Arial Narrow", Arial, Helvetica, sans-serif';
  g.fillText('CZ 2614', 128, 74);
  g.fillStyle = '#5a5f66'; g.font = '13px Arial, Helvetica, sans-serif';
  g.fillText('TEST VEHICLE', 128, 110);
  return (plateTex = tex(c));
}

const grilleTex = {};
function grilleTexture(kind) {
  if (grilleTex[kind]) return grilleTex[kind];
  const S = 128, c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#070809'; g.fillRect(0, 0, S, S);
  if (kind === 'slats') {
    for (let y = 0; y < S; y += 21.333) {
      const grd = g.createLinearGradient(0, y + 5, 0, y + 15);
      grd.addColorStop(0, '#8d9298'); grd.addColorStop(0.35, '#3a3e43'); grd.addColorStop(1, '#101113');
      g.fillStyle = grd; g.fillRect(0, y + 5, S, 10);
    }
  } else if (kind === 'honeycomb') {
    g.strokeStyle = '#34373b'; g.lineWidth = 5;
    const r = 16, w = r * Math.sqrt(3);
    for (let row = -1; row < 6; row++) for (let col = -1; col < 6; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0), cy = row * r * 1.5;
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      g.closePath(); g.stroke();
    }
  } else {
    g.strokeStyle = '#2c2f33'; g.lineWidth = 6;
    for (let k = -S; k < 2 * S; k += 32) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + S, S); g.stroke();
      g.beginPath(); g.moveTo(k + S, 0); g.lineTo(k, S); g.stroke();
    }
  }
  return (grilleTex[kind] = tex(c, { repeat: true }));
}

let crackTex = null;
function crackTexture() {
  if (crackTex) return crackTex;
  const S = 512, c = canvas(S, S), g = c.getContext('2d');
  const R = rng(7);
  g.fillStyle = '#8d979e'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${R() * 0.12})`; g.fillRect(R() * S, R() * S, 2, 2); }
  const cx = S * 0.42, cy = S * 0.55;
  const spokes = [];
  for (let k = 0; k < 16; k++) {
    let a = (k / 16) * Math.PI * 2 + R() * 0.3, x = cx, y = cy;
    const pts = [[x, y]];
    for (let s = 0; s < 14; s++) { a += (R() - 0.5) * 0.35; const l = 18 + R() * 30; x += Math.cos(a) * l; y += Math.sin(a) * l; pts.push([x, y]); }
    spokes.push(pts);
  }
  const strokeLine = (pts, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
  for (const p of spokes) { strokeLine(p, 'rgba(40,46,52,0.55)', 3); strokeLine(p, 'rgba(255,255,255,0.85)', 1.4); }
  for (let ring = 1; ring < 9; ring++) {
    for (let k = 0; k < 16; k++) {
      const a = spokes[k][Math.min(13, ring)], b = spokes[(k + 1) % 16][Math.min(13, ring + (R() < 0.5 ? 0 : 1))];
      if (R() < 0.75) strokeLine([a, [(a[0] + b[0]) / 2 + (R() - 0.5) * 12, (a[1] + b[1]) / 2 + (R() - 0.5) * 12], b], 'rgba(255,255,255,0.7)', 1.1);
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.fill();
  return (crackTex = tex(c));
}

let fabricTex = null;
function fabricTexture() {
  if (fabricTex) return fabricTex;
  const S = 128, c = canvas(S, S), g = c.getContext('2d');
  const R = rng(3);
  g.fillStyle = '#2d2d30'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
    const v = ((x + y) / 2) % 2 ? 0.07 : -0.05;
    const l = 45 + (v + (R() - 0.5) * 0.1) * 120;
    g.fillStyle = `rgb(${l},${l},${l + 2})`; g.fillRect(x, y, 2, 2);
  }
  const t = tex(c, { repeat: true });
  t.repeat.set(1, 1);
  return (fabricTex = t);
}

// --- paint damage: crease darkening, grime and streaky bare-metal scuffs where the
// lattice around a vertex has deformed (per-vertex `damage` attribute, 0..1)
const NOISE = `
float czHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float czNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(czHash(i), czHash(i + vec3(1, 0, 0)), f.x), mix(czHash(i + vec3(0, 1, 0)), czHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(czHash(i + vec3(0, 0, 1)), czHash(i + vec3(1, 0, 1)), f.x), mix(czHash(i + vec3(0, 1, 1)), czHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
// Specular occlusion toward the ground: the lower body mostly reflects its own shadowed
// underside and the dark road, not the bright lit ground of the environment map. Darkening
// reflections that point below the horizon gives painted panels the photographic
// "horizon line" along the shoulder and keeps the sills from looking chalky.
const HORIZON_SO = `
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
  {
    vec3 czRw = inverseTransformDirection( reflect( -geometryViewDir, geometryNormal ), viewMatrix );
    float czSO = mix( 0.3, 1.0, smoothstep( -0.24, 0.05, czRw.y ) );
    radiance *= czSO;
    #ifdef USE_CLEARCOAT
      vec3 czRc = inverseTransformDirection( reflect( -geometryViewDir, geometryClearcoatNormal ), viewMatrix );
      clearcoatRadiance *= mix( 0.3, 1.0, smoothstep( -0.24, 0.05, czRc.y ) );
    #endif
  }
#endif`;
function horizonSO(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>' + HORIZON_SO);
}

function paintDamageHi(sh) {
  horizonSO(sh);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float damage;\nvarying float vDamage;\nvarying vec3 vCarPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDamage = damage;\nvCarPos = position;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vDamage;\nvarying vec3 vCarPos;' + NOISE)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      diffuseColor.rgb *= 0.78 + 0.22 * smoothstep(0.1, 0.48, vCarPos.y); // ground occlusion
      float czD = smoothstep(0.06, 0.9, vDamage);
      if (czD > 0.002) {
        // dull, darkened paint in creased areas; a few long horizontal scrapes to bare metal
        float n2 = czNoise(vCarPos * vec3(9.0, 7.0, 9.0) + 3.7);
        float n1 = czNoise(vCarPos * vec3(2.5, 70.0, 70.0));
        float czBare = smoothstep(0.8, 0.9, n1) * smoothstep(0.55, 1.0, czD) * step(0.45, n2);
        diffuseColor.rgb *= 1.0 - czD * (0.3 + 0.25 * n2);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.34, 0.35), czBare);
        roughnessFactor = mix(mix(roughnessFactor, 0.62, czD * 0.8), 0.42, czBare);
        metalnessFactor = mix(metalnessFactor, 0.85, czBare);
      }`)
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
        material.clearcoat *= 1.0 - czD;
      #endif`);
}
function paintDamageLo(sh) {
  horizonSO(sh);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float damage;\nvarying float vDamage;\nvarying float vCarY;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDamage = damage;\nvCarY = position.y;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vDamage;\nvarying float vCarY;')
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      diffuseColor.rgb *= 0.78 + 0.22 * smoothstep(0.1, 0.48, vCarY);
      float czD = smoothstep(0.04, 0.85, vDamage);
      diffuseColor.rgb *= 1.0 - czD * 0.5;
      roughnessFactor = mix(roughnessFactor, 0.7, czD);`);
}

// tinted glass: see-through head-on, mirror-like at grazing angles. Written as
// premultiplied alpha so the reflection is added on top of what shows through instead of
// being scaled down by the opacity like ordinary alpha blending would (real glass
// reflects the sky at full strength however dark the tint is).
function glassFresnel(sh) {
  horizonSO(sh);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <opaque_fragment>', `
    float czF = 1.0 - saturate( dot( normalize( vViewPosition ), normal ) );
    float czA = mix( diffuseColor.a, 1.0, czF * czF * czF );
    gl_FragColor = vec4( totalDiffuse * czA + totalSpecular, czA );`)
    .replace('#include <premultiplied_alpha_fragment>', '');
}

const shared = new Map();
function sharedMaterials(quality) {
  if (shared.has(quality)) return shared.get(quality);
  const hi = quality !== 'low';
  const M = THREE.MeshStandardMaterial, P = hi ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const s = {};
  s.trim = hi ? new P({ color: '#060708', roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04 }) : new M({ color: '#0b0c0d', roughness: 0.45 });
  s.plastic = new M({ color: '#111213', roughness: 0.8 });
  s.soft = new M({ color: '#ffffff', roughness: 0.96, map: hi ? fabricTexture() : null });
  if (!hi) s.soft.color.set('#1c1c1e');
  s.interior = new M({ color: '#1a1a1c', roughness: 0.85 });
  s.chrome = new M({ color: '#f1f3f5', metalness: 1, roughness: 0.07 });
  s.lamp = hi ? new P({ color: '#c5cad0', metalness: 1, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 }) : new M({ color: '#b5bac0', metalness: 0.9, roughness: 0.25 });
  s.amber = new M({ color: '#d0700f', roughness: 0.25, emissive: '#ff7a0a', emissiveIntensity: 0.15 });
  s.head = new M({ color: '#ffffff', roughness: 0.2, emissive: '#eef4ff', emissiveIntensity: 2.6 });
  s.plate = new M({ map: plateTexture(), roughness: 0.42, metalness: 0.05 });
  s.glass = hi
    // double-sided on high: the far windows are seen from inside the cabin, so the view
    // through the car passes two tinted panes as it does in reality (one extra draw per car)
    ? new P({ color: '#0b1115', roughness: 0.015, metalness: 0, ior: 1.65, transparent: true, premultipliedAlpha: true, opacity: 0.74, envMapIntensity: 1.25, depthWrite: false, side: quality === 'high' ? THREE.DoubleSide : THREE.FrontSide })
    : new M({ color: '#0d1317', roughness: 0.06, metalness: 0.3, envMapIntensity: 1.4 });
  s.glass.onBeforeCompile = hi ? glassFresnel : horizonSO;
  s.trim.onBeforeCompile = horizonSO;
  s.cracked = new M({ map: crackTexture(), color: '#e3e8ec', roughness: 0.5, metalness: 0.05 });
  if (!hi) { s.plastic = s.trim; s.interior = s.trim; s.lamp = s.chrome; s.soft.roughness = 0.9; s.soft.color.set('#2a2a2c'); }
  shared.set(quality, s);
  return s;
}

const grilleMats = new Map();
function grilleMaterial(spec, quality) {
  const key = spec.id + ':' + quality;
  if (grilleMats.has(key)) return grilleMats.get(key);
  const kind = spec.visual.grille || { a4: 'slats', mustang: 'honeycomb' }[spec.id] || 'mesh';
  const m = quality === 'low'
    ? sharedMaterials(quality).trim
    : new THREE.MeshStandardMaterial({ map: grilleTexture(kind), roughness: 0.45, metalness: 0.4 });
  grilleMats.set(key, m);
  return m;
}

export function makeCarMaterials(spec, quality, paintHex) {
  const hi = quality !== 'low';
  const s = sharedMaterials(quality);
  const vp = spec.visual.paint;
  const metal = paintHex === spec.color ? vp.metal : 0.45;
  const rough = paintHex === spec.color ? vp.rough : 0.36;
  const paint = hi
    ? new THREE.MeshPhysicalMaterial({ color: paintHex, metalness: metal, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.03 })
    : new THREE.MeshStandardMaterial({ color: paintHex, metalness: metal * 0.8, roughness: Math.min(0.45, rough + 0.04) });
  paint.onBeforeCompile = hi ? paintDamageHi : paintDamageLo;
  const tail = hi
    ? new THREE.MeshPhysicalMaterial({ color: '#5a0307', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03, emissive: '#ff0602', emissiveIntensity: 0.06 })
    : new THREE.MeshStandardMaterial({ color: '#600409', roughness: 0.25, emissive: '#ff0602', emissiveIntensity: 0.1 });
  const tailLed = hi ? new THREE.MeshStandardMaterial({ color: '#3a0306', roughness: 0.3, emissive: '#ff0804', emissiveIntensity: 0.4 }) : tail;
  const list = new Array(SLOT_COUNT + 1);
  list[C.PAINT] = paint; list[C.TRIM] = s.trim; list[C.PLASTIC] = s.plastic; list[C.GRILLE] = grilleMaterial(spec, quality);
  list[C.SOFT] = s.soft; list[C.INTERIOR] = s.interior; list[C.CHROME] = s.chrome; list[C.LAMP] = s.lamp;
  list[C.AMBER] = s.amber; list[C.HEAD] = s.head; list[C.TAIL] = tail; list[C.TAILLED] = tailLed;
  list[C.PLATE] = s.plate; list[C.GLASS] = s.glass; list[CRACKED] = s.cracked;
  const own = [paint, tail];
  if (tailLed !== tail) own.push(tailLed);
  return {
    list, paint, tail, tailLed, own,
    setBrake(on) {
      tail.emissiveIntensity = on ? (hi ? 0.7 : 1.0) : (hi ? 0.05 : 0.08);
      if (tailLed !== tail) tailLed.emissiveIntensity = on ? 3.2 : 0.35;
    },
  };
}
