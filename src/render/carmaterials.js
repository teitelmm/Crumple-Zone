// Car materials: clear-coated paint with a damage layer, tinted glass, trim, lights,
// plates. Shared materials are cached per quality tier; paint, tail lights and the baked
// "rest" material are per car (colour and brake state differ) and are pooled, not
// disposed, so a restart or showcase switch never recompiles their shader programs.
//
// Draw-call budget: the plain (untextured) slots of a tier are not separate materials.
// Their colour, roughness, metalness and emission are baked into vertex attributes
// (bakeAttributes) and drawn with one MeshStandardMaterial, so a car body costs
// paint + rest + glass on phones (plus grille / plate and the clear-coated trim, lamps
// and tail lenses on the higher tiers).
import * as THREE from 'three';
import { C, SLOT_COUNT } from '../vehicle/bodyshape.js';

export const CRACKED = SLOT_COUNT; // material index of shattered glass
export const GLASS_BACK = SLOT_COUNT + 1; // inner faces of the glass (high: seen through the cabin)

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
// Cap the sun's direct specular. A glossy panel near the sun's mirror direction would
// otherwise reach hundreds of times the bloom threshold and smear a whole panel (or a
// 1-px glint) into a white blob. Paint's base layer (the flakes under the clear coat) is
// held just below white: seen toward the sun at a grazing angle its broad lobe would
// otherwise clip a whole boot lid; the clear coat and trim keep a bright, bloomable glint.
const specCap = (base) => `
  reflectedLight.directSpecular = min( reflectedLight.directSpecular, vec3( ${base.toFixed(1)} ) );
  #ifdef USE_CLEARCOAT
    clearcoatSpecularDirect = min( clearcoatSpecularDirect, vec3( 40.0 ) );
  #endif`;
const CAP_PAINT = specCap(2.5), CAP_GLOSS = specCap(40);
function capSpec(sh, cap = CAP_GLOSS) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>' + cap);
}
function glossShader(sh) { horizonSO(sh); capSpec(sh); }

function paintDamageHi(sh) {
  horizonSO(sh); capSpec(sh, CAP_PAINT);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float damage;\nvarying float vDamage;\nvarying vec3 vCarPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDamage = damage;\nvCarPos = position;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vDamage;\nvarying vec3 vCarPos;' + NOISE)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      diffuseColor.rgb *= 0.78 + 0.22 * smoothstep(0.1, 0.48, vCarPos.y); // ground occlusion
      float czD = smoothstep(0.06, 0.9, vDamage);
      if (czD > 0.002) {
        // dull, darkened paint in creased areas; a few long horizontal scrapes to bare
        // metal (a few cm tall, faded out where they would shrink below a pixel)
        float n2 = czNoise(vCarPos * vec3(9.0, 7.0, 9.0) + 3.7);
        float n1 = czNoise(vCarPos * vec3(2.0, 14.0, 14.0));
        float czBare = smoothstep(0.72, 0.92, n1) * smoothstep(0.55, 1.0, czD) * step(0.45, n2);
        czBare *= 1.0 - smoothstep(0.02, 0.08, fwidth(n1));
        diffuseColor.rgb *= 1.0 - czD * (0.3 + 0.25 * n2);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.34, 0.35), czBare);
        roughnessFactor = mix(mix(roughnessFactor, 0.62, czD * 0.8), 0.55, czBare);
        metalnessFactor = mix(metalnessFactor, 0.85, czBare);
      }`)
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
        material.clearcoat *= 1.0 - czD;
      #endif`);
}
function paintDamageLo(sh) {
  horizonSO(sh); capSpec(sh, CAP_PAINT);
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

// --- per-vertex PBR: roughness / metalness from a `czRM` attribute (vec2), colour from
// vertex colours. Used for the merged wheel (tyre + rim finishes in one draw) and, with
// emission, for the baked body slots.
const RM_DECL = 'attribute vec2 czRM;\nvarying vec2 vCzRM;';
export function vertexRM(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + RM_DECL)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCzRM = czRM;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vCzRM;')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vCzRM.x;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vCzRM.y;');
}
// baked body slots: + emission (`czEmit`: rgb = radiance with the brakes off, a = factor
// when braking) and the per-car brake uniform
function restShader(sh) {
  horizonSO(sh); capSpec(sh);
  sh.uniforms.czBrake = this.userData.czBrake;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + RM_DECL + '\nattribute vec4 czEmit;\nvarying vec4 vCzEmit;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCzRM = czRM;\nvCzEmit = czEmit;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float czBrake;\nvarying vec2 vCzRM;\nvarying vec4 vCzEmit;')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vCzRM.x;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vCzRM.y;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vCzEmit.rgb * mix( 1.0, vCzEmit.a, czBrake );');
}

// --- baked slots. `e` = emissive colour, `ei` = its intensity with the brakes off,
// `eb` = intensity while braking (tail lights). The soft top's fabric is drawn without
// texture coordinates on every tier, so it is a plain colour (the fabric's mean).
const PLAIN = { c: '#0b0c0d', r: 0.45, m: 0 };
const AMBER = { c: '#d0700f', r: 0.25, m: 0, e: '#ff7a0a', ei: 0.15 };
const HEAD = { c: '#ffffff', r: 0.2, m: 0, e: '#eef4ff', ei: 2.6 };
const SOFT = { c: '#2e2e30', r: 0.95, m: 0 };
const LOOK_LOW = {
  [C.TRIM]: PLAIN, [C.PLASTIC]: PLAIN, [C.GRILLE]: PLAIN, [C.INTERIOR]: PLAIN,
  [C.SOFT]: { c: '#2a2a2c', r: 0.9, m: 0 },
  [C.CHROME]: { c: '#f1f3f5', r: 0.1, m: 1 }, [C.LAMP]: { c: '#f1f3f5', r: 0.1, m: 1 },
  [C.AMBER]: AMBER, [C.HEAD]: HEAD,
  [C.TAIL]: { c: '#600409', r: 0.25, m: 0, e: '#ff0602', ei: 0.08, eb: 1.0 },
  [C.TAILLED]: { c: '#600409', r: 0.25, m: 0, e: '#ff0602', ei: 0.08, eb: 1.0 },
  [C.PLATE]: { c: '#ffffff', r: 0.42, m: 0.05 },
};
const LOOK_HI = {
  [C.TRIM]: { c: '#060708', r: 0.2, m: 0 },
  [C.LAMP]: { c: '#c5cad0', r: 0.2, m: 1 },
  [C.TAIL]: { c: '#5a0307', r: 0.22, m: 0, e: '#ff0602', ei: 0.05, eb: 0.7 },
  [C.SOFT]: SOFT,
  [C.PLASTIC]: { c: '#111213', r: 0.8, m: 0 },
  [C.CHROME]: { c: '#f1f3f5', r: 0.1, m: 1 },
  [C.AMBER]: AMBER, [C.HEAD]: HEAD,
  [C.TAILLED]: { c: '#3a0306', r: 0.3, m: 0, e: '#ff0804', ei: 0.35, eb: 3.2 },
  [C.INTERIOR]: { c: '#1a1a1c', r: 0.85, m: 0 },
};
// slots drawn by the baked material, per tier (contiguous in bodyshape SLOT_ORDER)
const BAKED = {
  low: [C.GRILLE, C.PLATE, C.TRIM, C.LAMP, C.TAIL, C.SOFT, C.PLASTIC, C.CHROME, C.AMBER, C.HEAD, C.TAILLED, C.INTERIOR],
  medium: [C.TRIM, C.LAMP, C.TAIL, C.SOFT, C.PLASTIC, C.CHROME, C.AMBER, C.HEAD, C.TAILLED, C.INTERIOR],
  high: [C.SOFT, C.PLASTIC, C.CHROME, C.AMBER, C.HEAD, C.TAILLED, C.INTERIOR],
};
const tierOf = q => (q === 'low' ? 'low' : q === 'medium' ? 'medium' : 'high');

// Static per-vertex attribute arrays for the baked slots of one body mesh (shared by every
// car of that model and tier; each car wraps them in its own BufferAttributes, since
// disposing a geometry deletes the GL buffers of all its attributes). On phones the number plate is part of it too, through an
// atlas whose bottom strip is white: plate vertices map into the plate, the others onto
// the strip.
const bakeCache = new WeakMap();
export function bakeAttributes(src, quality) {
  const tier = tierOf(quality);
  let byTier = bakeCache.get(src);
  if (!byTier) bakeCache.set(src, byTier = {});
  if (byTier[tier]) return byTier[tier];
  const nv = src.vertexCount, look = tier === 'low' ? LOOK_LOW : LOOK_HI, baked = new Set(BAKED[tier]);
  const col = new Float32Array(nv * 3), rm = new Float32Array(nv * 2), emit = new Float32Array(nv * 4);
  const uv = tier === 'low' ? src.uvs.slice() : null;
  const c = new THREE.Color(), e = new THREE.Color();
  for (const gr of src.groups) {
    if (!baked.has(gr.slot) || !gr.count) continue;
    const L = look[gr.slot];
    c.set(L.c);
    if (L.e) e.set(L.e).multiplyScalar(L.ei); else e.setRGB(0, 0, 0);
    const brake = L.e && L.eb ? L.eb / L.ei : 1;
    for (let i = gr.start; i < gr.start + gr.count; i++) {
      const v = src.indices[i];
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      rm[v * 2] = L.r; rm[v * 2 + 1] = L.m;
      emit[v * 4] = e.r; emit[v * 4 + 1] = e.g; emit[v * 4 + 2] = e.b; emit[v * 4 + 3] = brake;
      if (uv) {
        if (gr.slot === C.PLATE) uv[v * 2 + 1] = PLATE_V0 + (1 - PLATE_V0) * src.uvs[v * 2 + 1];
        else { uv[v * 2] = 0.5; uv[v * 2 + 1] = PLATE_V0 / 2; }
      }
    }
  }
  return (byTier[tier] = { color: col, czRM: rm, czEmit: emit, uv });
}

const PLATE_V0 = 32 / 160; // atlas: plate in the top 128 rows, white strip below
let plateAtlasTex = null;
function plateAtlas() {
  if (plateAtlasTex) return plateAtlasTex;
  const c = canvas(256, 160), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 160);
  g.drawImage(plateTexture().image, 0, 0);
  return (plateAtlasTex = tex(c));
}

const shared = new Map();
function sharedMaterials(quality) {
  if (shared.has(quality)) return shared.get(quality);
  const tier = tierOf(quality), hi = tier !== 'low';
  const M = THREE.MeshStandardMaterial, P = THREE.MeshPhysicalMaterial;
  const s = {};
  if (tier === 'high') {
    s.trim = new P({ color: '#060708', roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04 });
    s.lamp = new P({ color: '#c5cad0', metalness: 1, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 });
    s.trim.onBeforeCompile = s.lamp.onBeforeCompile = glossShader;
  }
  if (hi) s.plate = new M({ map: plateTexture(), roughness: 0.42, metalness: 0.05 });
  if (hi) {
    s.glass = new P({ color: '#0b1115', roughness: 0.04, metalness: 0, ior: 1.65, transparent: true, premultipliedAlpha: true, opacity: 0.74, envMapIntensity: 1.25, depthWrite: false });
    s.glass.onBeforeCompile = glassFresnel;
    // high: the far windows are also drawn from inside the cabin, so the view through the
    // car passes two tinted panes as it does in reality. A separate back-face material
    // (drawn first) instead of DoubleSide, which three would re-version twice per draw.
    if (tier === 'high') {
      s.glassBack = s.glass.clone();
      s.glassBack.side = THREE.BackSide;
      s.glassBack.onBeforeCompile = glassFresnel;
    }
  } else {
    s.glass = new M({ color: '#0d1317', roughness: 0.06, metalness: 0.3, envMapIntensity: 1.4 });
    s.glass.onBeforeCompile = horizonSO;
  }
  s.cracked = new M({ map: crackTexture(), color: '#e3e8ec', roughness: 0.5, metalness: 0.05 });
  shared.set(quality, s);
  return s;
}

const grilleMats = new Map();
function grilleMaterial(spec) {
  if (grilleMats.has(spec.id)) return grilleMats.get(spec.id);
  const kind = spec.visual.grille || { a4: 'slats', mustang: 'honeycomb' }[spec.id] || 'mesh';
  const m = new THREE.MeshStandardMaterial({ map: grilleTexture(kind), roughness: 0.45, metalness: 0.4 });
  grilleMats.set(spec.id, m);
  return m;
}

// per-car materials (paint, baked rest, high-tier tail lens), pooled per tier
const pools = new Map();
function newCarSet(tier) {
  const hi = tier !== 'low';
  const paint = hi
    ? new THREE.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.06 })
    : new THREE.MeshStandardMaterial();
  paint.onBeforeCompile = hi ? paintDamageHi : paintDamageLo;
  const rest = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, map: hi ? null : plateAtlas() });
  rest.userData.czBrake = { value: 0 };
  rest.onBeforeCompile = restShader;
  let tail = null;
  if (tier === 'high') {
    tail = new THREE.MeshPhysicalMaterial({ color: '#5a0307', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03, emissive: '#ff0602', emissiveIntensity: 0.05 });
    tail.onBeforeCompile = glossShader;
  }
  return { paint, rest, tail };
}

export function makeCarMaterials(spec, quality, paintHex) {
  const tier = tierOf(quality), hi = tier !== 'low';
  const s = sharedMaterials(tier);
  if (!pools.has(tier)) pools.set(tier, []);
  const pool = pools.get(tier);
  const set = pool.pop() || newCarSet(tier);
  const { paint, rest, tail } = set;
  // Metallic paint is a dielectric base with a little flake under a sharp clear coat:
  // keeping base metalness low and its lobe broad stops whole panels clipping to white
  // when the car is between the camera and the sun; the clear coat carries the gloss.
  const vp = spec.visual.paint, own = paintHex === spec.color;
  const metal = own ? vp.metal : 0.45, rough = own ? vp.rough : 0.36;
  paint.color.set(paintHex);
  if (hi) { paint.metalness = Math.min(0.2, metal * 0.35); paint.roughness = Math.max(0.42, rough + 0.1); paint.specularIntensity = 0.6; }
  else { paint.metalness = metal * 0.5; paint.roughness = Math.min(0.48, Math.max(0.4, rough + 0.06)); }

  const list = new Array(SLOT_COUNT + 2).fill(null);
  for (const k of BAKED[tier]) list[k] = rest;
  list[C.PAINT] = paint;
  if (tier === 'high') { list[C.TRIM] = s.trim; list[C.LAMP] = s.lamp; list[C.TAIL] = tail; }
  if (hi) { list[C.GRILLE] = grilleMaterial(spec); list[C.PLATE] = s.plate; }
  list[C.GLASS] = s.glass; list[CRACKED] = s.cracked; list[GLASS_BACK] = s.glassBack || null;
  let released = false;
  return {
    list, paint, rest, tail, doubleGlass: !!s.glassBack,
    setBrake(on) {
      rest.userData.czBrake.value = on ? 1 : 0;
      if (tail) tail.emissiveIntensity = on ? 0.7 : 0.05;
    },
    // back to the pool: the materials (and so their compiled programs) stay alive
    release() {
      if (released) return;
      released = true;
      rest.userData.czBrake.value = 0;
      pool.push(set);
    },
  };
}
