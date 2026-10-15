// Daylight atmosphere. One sun direction drives the sky dome, the sun light, the
// aerial-perspective haze (fog) and the reflection environment, so paint, glass,
// distant terrain and the sky all agree.
//
// Units: linear HDR radiance where the sun's irradiance is SUN_ILLUMINANCE (the
// DirectionalLight intensity). The sky model is a cheap single-scattering
// approximation (Rayleigh + Mie with an air-mass optical depth), white balanced
// for daylight so sunlit white surfaces read white.
import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;
const SUN_ELEVATION = deg(37);
const SUN_AZIMUTH = deg(31); // measured from +x toward +z

// unit vector pointing at the sun
export const SUN_DIR = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
);
// irradiance of the sun at normal incidence (DirectionalLight intensity)
export const SUN_ILLUMINANCE = 8.5;

const LAMBDA = [680, 550, 440];
const TAU_R = LAMBDA.map(l => 0.097 * Math.pow(550 / l, 4)); // Rayleigh zenith optical depth
const TAU_M = LAMBDA.map(l => 0.05 * Math.pow(550 / l, 1.3)); // aerosol (light summer haze)
const TAU = TAU_R.map((r, i) => r + TAU_M[i]);
const MIE_G = 0.76;
const MULTI = 0.14; // multiple-scattering fill, keeps the zenith from going navy
const SKY_GAIN = 1.65; // artistic: a brighter sky than strict single scattering

function airmass(mu) {
  mu = Math.min(1, Math.max(0, mu));
  const zen = Math.acos(mu) * 180 / Math.PI;
  return 1 / (mu + 0.50572 * Math.pow(Math.max(96.07995 - zen, 1e-3), -1.6364));
}

const sunT = TAU.map(t => Math.exp(-t * airmass(SUN_DIR.y)));
const sunTMax = Math.max(...sunT);
const WB = sunT.map(t => Math.pow(t / sunTMax, -0.85)); // daylight white balance
// colour of direct sunlight after white balance (slightly warm)
export const SUN_COLOR = new THREE.Color(...sunT.map((t, i) => (t / sunTMax) * WB[i] / Math.max(...sunT.map((u, j) => (u / sunTMax) * WB[j]))));
const K = sunT.map((t, i) => SUN_ILLUMINANCE * t * WB[i] * SKY_GAIN / (4 * Math.PI));
const EXT0 = TAU.map(t => 1 - Math.exp(-t * airmass(0)));

function scatter(nu, ext, out) {
  const pr = 0.75 * (1 + nu * nu);
  const gg = MIE_G * MIE_G;
  const pm = (1 - gg) / Math.pow(1 + gg - 2 * MIE_G * nu, 1.5);
  for (let i = 0; i < 3; i++) out[i] = K[i] * ((TAU_R[i] * (pr + MULTI) + TAU_M[i] * pm) / TAU[i]) * ext[i];
  return out;
}

// CPU mirrors of the GLSL below (used for fog colour, fills and clear colour)
export function skyRadiance(dir, out = [0, 0, 0]) {
  const m = airmass(Math.max(dir.y, 0));
  const ext = TAU.map(t => 1 - Math.exp(-t * m));
  return scatter(dir.x * SUN_DIR.x + dir.y * SUN_DIR.y + dir.z * SUN_DIR.z, ext, out);
}
export function hazeRadiance(dir, out = [0, 0, 0]) {
  const l = Math.hypot(dir.x, dir.z) || 1;
  return scatter((dir.x * SUN_DIR.x + dir.z * SUN_DIR.z) / l, EXT0, out);
}

// average horizon haze over all azimuths: the reference fog colour
export const HORIZON_COLOR = (() => {
  const acc = [0, 0, 0], tmp = [0, 0, 0];
  const n = 64;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    hazeRadiance({ x: Math.cos(a), y: 0, z: Math.sin(a) }, tmp);
    for (let i = 0; i < 3; i++) acc[i] += tmp[i] / n;
  }
  return new THREE.Color(acc[0], acc[1], acc[2]);
})();

// cosine-weighted sky irradiance on an upward-facing surface (no sun)
export const SKY_IRRADIANCE = (() => {
  const acc = [0, 0, 0], tmp = [0, 0, 0];
  const na = 32, ne = 16;
  for (let j = 0; j < ne; j++) {
    const mu = (j + 0.5) / ne; // uniform in cos(theta)
    const s = Math.sqrt(1 - mu * mu);
    for (let k = 0; k < na; k++) {
      const a = (k / na) * Math.PI * 2;
      skyRadiance({ x: s * Math.cos(a), y: mu, z: s * Math.sin(a) }, tmp);
      // integral of L cos dω = ∫∫ L mu dmu dphi
      for (let i = 0; i < 3; i++) acc[i] += tmp[i] * mu * (1 / ne) * (2 * Math.PI / na);
    }
  }
  return new THREE.Color(acc[0], acc[1], acc[2]);
})();

const v3 = (a) => `vec3(${a.map(x => x.toFixed(6)).join(', ')})`;
const CLOUD_SUN = SUN_COLOR.toArray().map(c => c * SUN_ILLUMINANCE * 0.27);
const CLOUD_AMB = SKY_IRRADIANCE.toArray().map(c => c * 0.55);
const GROUND_ALBEDO = [0.085, 0.095, 0.07];
const GROUND = GROUND_ALBEDO.map((a, i) => a / Math.PI * (SUN_ILLUMINANCE * SUN_DIR.y * SUN_COLOR.toArray()[i] + SKY_IRRADIANCE.toArray()[i]));
const HILLS = [0.045, 0.06, 0.04].map((a, i) => a / Math.PI * (SUN_ILLUMINANCE * 0.5 * SUN_COLOR.toArray()[i] + SKY_IRRADIANCE.toArray()[i]));

// Shared GLSL: czSky(dir) (sky radiance above the horizon), czHaze(dir) (horizon
// haze for that azimuth = the colour distant things fade into).
export const ATMOSPHERE_GLSL = /* glsl */`
const vec3 CZ_SUN = ${v3(SUN_DIR.toArray())};
const vec3 CZ_TAU_R = ${v3(TAU_R)};
const vec3 CZ_TAU_M = ${v3(TAU_M)};
const vec3 CZ_K = ${v3(K)};
const vec3 CZ_EXT0 = ${v3(EXT0)};
const float CZ_G = ${MIE_G.toFixed(4)};
const float CZ_MULTI = ${MULTI.toFixed(4)};
const vec3 CZ_WR = CZ_K * CZ_TAU_R / ( CZ_TAU_R + CZ_TAU_M );
const vec3 CZ_WM = CZ_K * CZ_TAU_M / ( CZ_TAU_R + CZ_TAU_M );
vec3 czScatter( float nu, vec3 ext ) {
  float pr = 0.75 * ( 1.0 + nu * nu ) + CZ_MULTI;
  float x = 1.0 + CZ_G * CZ_G - 2.0 * CZ_G * nu;
  float pm = ( 1.0 - CZ_G * CZ_G ) / ( x * sqrt( x ) );
  return ( CZ_WR * pr + CZ_WM * pm ) * ext;
}
vec3 czHaze( vec3 d ) {
  vec2 h = d.xz;
  float l = length( h );
  h = l > 1e-5 ? h / l : vec2( 1.0, 0.0 );
  return czScatter( dot( h, CZ_SUN.xz ), CZ_EXT0 );
}
`;

const SKY_GLSL = ATMOSPHERE_GLSL + /* glsl */`
float czAirmass( float mu ) {
  mu = clamp( mu, 0.0, 1.0 );
  float zen = degrees( acos( mu ) );
  return 1.0 / ( mu + 0.50572 * pow( max( 96.07995 - zen, 1e-3 ), -1.6364 ) );
}
vec3 czSky( vec3 d ) {
  vec3 ext = 1.0 - exp( -( CZ_TAU_R + CZ_TAU_M ) * czAirmass( max( d.y, 0.0 ) ) );
  return czScatter( dot( d, CZ_SUN ), ext );
}
`;

// Tileable cloud noise. R: billowy low-frequency fbm (value noise + inverted
// Worley), G: high-frequency detail fbm, B: very low frequency coverage field.
export function makeCloudTexture(size = 256) {
  let seed = 9871;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lattice = (p) => { const a = new Float32Array(p * p); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function valueNoise(grid, p, x, y) { // x,y in [0,p)
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = fade(x - xi), fy = fade(y - yi);
    const x0 = xi % p, y0 = yi % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = grid[y0 * p + x0], b = grid[y0 * p + x1], c = grid[y1 * p + x0], d = grid[y1 * p + x1];
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  }
  function fbm(periods) {
    const grids = periods.map(p => lattice(p));
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, norm = 0;
      for (let o = 0; o < periods.length; o++) {
        const p = periods[o];
        v += amp * valueNoise(grids[o], p, x / size * p, y / size * p);
        norm += amp; amp *= 0.5;
      }
      out[y * size + x] = v / norm;
    }
    return out;
  }
  function worley(cells) {
    const pts = [];
    for (let i = 0; i < cells * cells; i++) pts.push([rnd(), rnd()]);
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const px = x / size * cells, py = y / size * cells;
      const cx = Math.floor(px), cy = Math.floor(py);
      let best = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const gx = cx + i, gy = cy + j;
        const pt = pts[((gy + cells) % cells) * cells + ((gx + cells) % cells)];
        const dx = gx + pt[0] - px, dy = gy + pt[1] - py;
        best = Math.min(best, dx * dx + dy * dy);
      }
      out[y * size + x] = 1 - Math.min(1, Math.sqrt(best));
    }
    return out;
  }
  const normalize = (a) => {
    let lo = Infinity, hi = -Infinity;
    for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) / (hi - lo || 1);
    return a;
  };
  const base = fbm([4, 8, 16, 32, 64]);
  const cells = worley(6), cells2 = worley(12);
  const r = normalize(base.map((v, i) => v * 0.55 + cells[i] * 0.3 + cells2[i] * 0.15));
  const g = normalize(fbm([16, 32, 64, 128]));
  const b = normalize(fbm([2, 4]));
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r[i] * 255; data[i * 4 + 1] = g[i] * 255; data[i * 4 + 2] = b[i] * 255; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position.z = gl_Position.w; // on the far plane
}`;

const SKY_FRAG = SKY_GLSL + /* glsl */`
uniform sampler2D uClouds;
uniform float uTime;
uniform float uCover;
varying vec3 vDir;
const vec3 CZ_CLOUD_SUN = ${v3(CLOUD_SUN)};
const vec3 CZ_CLOUD_AMB = ${v3(CLOUD_AMB)};
const vec3 CZ_GROUND = ${v3(GROUND)};
const vec3 CZ_HILLS = ${v3(HILLS)};

float czHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }

// soft fair-weather cumulus on a plane, lit from the sun by a second tap
// (no early-outs before the texture taps: keeps mip selection well defined)
vec4 czClouds( vec3 d ) {
  vec2 p = d.xz / ( max( d.y, 0.0 ) + 0.07 );
  vec2 wind = vec2( 0.0042, 0.0017 ) * uTime;
  vec2 uv = p * 0.3 + wind;
  float region = texture2D( uClouds, p * 0.053 + vec2( 0.31, 0.77 ) + wind * 0.25 ).b;
  float n = texture2D( uClouds, uv ).r;
  float det = texture2D( uClouds, uv * 3.3 + vec2( 0.17, 0.43 ) + wind * 1.7 ).g;
  float erode = ( 1.0 - det ) * 0.3;
  float dens = n - erode;
  float cover = uCover + ( 0.5 - region ) * 0.4;
  float a = smoothstep( cover, cover + 0.26, dens );
  float n2 = texture2D( uClouds, uv + normalize( CZ_SUN.xz ) * 0.045 ).r - erode;
  float lit = clamp( 0.6 + ( dens - n2 ) * 4.5, 0.1, 1.0 );
  float thick = smoothstep( cover + 0.05, cover + 0.45, dens );
  float nu = max( dot( d, CZ_SUN ), 0.0 );
  vec3 col = CZ_CLOUD_AMB * ( 1.0 - 0.35 * thick ) + CZ_CLOUD_SUN * lit * ( 1.0 - 0.55 * thick );
  col += CZ_CLOUD_SUN * ( 1.0 - a ) * 2.5 * pow( nu, 10.0 ); // silver lining near the sun
  float hz = 1.0 - smoothstep( 0.0, 0.32, d.y );
  col = mix( col, czHaze( d ) * 1.08, hz * 0.75 );
  a *= smoothstep( 0.01, 0.1, d.y );
  return vec4( col, a );
}

void main() {
  vec3 d = normalize( vDir );
  vec3 col = d.y > 0.0 ? czSky( d ) : czHaze( d );
#ifdef CZ_ENV
  // reflection environment: lit ground below, a distant hazy tree line on the horizon, no sun disc
  if ( d.y < 0.0 ) {
    float t = 1.3 / max( -d.y, 1e-4 );
    float f = 1.0 - exp( -3.0 * pow( t / 2200.0, 2.2 ) );
    col = mix( CZ_GROUND, col, f );
  } else {
    float az = atan( d.z, d.x );
    float band = 0.03 + 0.012 * sin( az * 3.0 + 1.3 ) + 0.008 * sin( az * 7.0 + 0.4 ) + 0.004 * sin( az * 19.0 + 2.0 );
    float hills = 1.0 - smoothstep( band - 0.004, band + 0.004, d.y );
    col = mix( col, mix( CZ_HILLS, czHaze( d ), 0.45 ), hills );
    vec4 c = czClouds( d );
    col = mix( col, c.rgb, c.a * ( 1.0 - hills ) );
  }
#else
  vec4 c = czClouds( d );
  col = mix( col, c.rgb, c.a );
  // sun disc with limb darkening (clamped to stay inside half-float range)
  float cosA = dot( d, CZ_SUN );
  float disc = smoothstep( 0.99994, 0.999975, cosA );
  float limb = 1.0 - 0.45 * ( 1.0 - smoothstep( 0.99994, 0.99999, cosA ) );
  col += vec3( 1.0, 0.97, 0.92 ) * 400.0 * disc * limb * ( 1.0 - c.a );
#endif
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += ( czHash( gl_FragCoord.xy ) - 0.5 ) / 255.0;
}`;

export function makeSkyMaterial(cloudTex, { env = false, cover = 0.56 } = {}) {
  return new THREE.ShaderMaterial({
    name: env ? 'SkyEnv' : 'Sky',
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    defines: env ? { CZ_ENV: '' } : {},
    uniforms: {
      uClouds: { value: cloudTex },
      uTime: { value: 0 },
      uCover: { value: cover },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });
}

// Sky dome: drawn first (renderOrder -20), centred on the camera every frame,
// projected onto the far plane so the camera far distance never clips it.
export class SkyDome {
  constructor(scene, quality) {
    this.cloudTex = makeCloudTexture(quality === 'low' ? 128 : 256);
    this.material = makeSkyMaterial(this.cloudTex);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, quality === 'low' ? 32 : 48, quality === 'low' ? 16 : 24), this.material);
    this.mesh.renderOrder = -20;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'sky';
    scene.add(this.mesh);
    this.time = 0;
  }

  update(dt, camera) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    if (camera) {
      this.mesh.position.copy(camera.position);
      this.mesh.updateMatrix();
    }
  }

  // Prefiltered environment for PBR materials, rendered from the same sky (with
  // a lit ground, a hazy horizon band and clouds; the sun's specular comes from
  // the DirectionalLight instead of the disc).
  buildEnvironment(renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const mat = makeSkyMaterial(this.cloudTex, { env: true });
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), mat));
    const rt = pm.fromScene(envScene, 0, 0.1, 100);
    pm.dispose();
    mat.dispose();
    envScene.children[0].geometry.dispose();
    return rt.texture;
  }
}
