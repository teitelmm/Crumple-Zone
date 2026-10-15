// Shader patches for world materials (MeshStandardMaterial + onBeforeCompile).
//
// Everything is gated by #defines so materials with the same feature set share
// one program; per-material values live in uniforms. Features:
//   macro   brightness variation at two large world scales (hides tiling)
//   tint    colour drift between two tints over the world (dry / lush grass ...)
//   detail  second, rotated sample of the albedo at another scale (anti-tiling)
//   patches sharp-edged blotches: asphalt repairs, oil stains
//   cracks  thin meandering cracks from noise isolines
//   roughA  roughness read from the normal map's alpha channel
//   grass   verge mask / mowing stripes / tree shade from a world map texture
//   track   painted edge lines, rubbered racing line and braking streaks (aTrack attribute)
//   haze    scene fog with a cap, so distant terrain keeps a silhouette
import * as THREE from 'three';

const VERT_HEAD = /* glsl */`
varying vec3 vEnvWorld;
#ifdef ENV_TRACK
attribute vec4 aTrack;
varying vec4 vTrack;
#endif
`;

const VERT_BODY = /* glsl */`
{
  vec4 envW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
  envW = instanceMatrix * envW;
  #endif
  vEnvWorld = ( modelMatrix * envW ).xyz;
  #ifdef ENV_TRACK
  vTrack = aTrack;
  #endif
}
`;

const FRAG_HEAD = /* glsl */`
varying vec3 vEnvWorld;
uniform sampler2D uEnvNoise;
uniform vec4 uMacro;    // amp, 1/scale1, 1/scale2, -
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform vec4 uDetail;   // scale, mix, offset
uniform vec4 uPatch;    // 1/scale, threshold, darken, roughness multiplier
uniform vec4 uCrack;    // 1/scale, width, darken, mask threshold
uniform sampler2D uWorldMap;
uniform vec4 uWorldXf;  // x0, z0, 1/size, stripe width
uniform vec4 uTrackP;   // half width, line sigma, rubber strength, edge dust
uniform vec3 uHaze;     // distance scale far out, max factor, altitude fade
#ifdef ENV_TRACK
varying vec4 vTrack;
#endif
`;

const FRAG_MAP = /* glsl */`
// two shared noise samples feed macro variation, tint and detail mixing
#if defined( ENV_MACRO ) || defined( ENV_TINT ) || defined( ENV_DETAIL )
  vec4 envN1 = texture2D( uEnvNoise, vEnvWorld.xz * uMacro.y );
  vec4 envN2 = texture2D( uEnvNoise, vEnvWorld.xz * uMacro.z + 0.31 );
#endif
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  #ifdef ENV_DETAIL
  {
    vec2 duv = mat2( 0.8, -0.6, 0.6, 0.8 ) * vMapUv * uDetail.x + uDetail.zw;
    vec4 det = texture2D( map, duv );
    sampledDiffuseColor = mix( sampledDiffuseColor, det, smoothstep( 0.3, 0.7, envN2.b ) * uDetail.y );
  }
  #endif
  diffuseColor *= sampledDiffuseColor;
#endif
`;

const FRAG_COLOR = /* glsl */`
float envRough = 1.0;
float envPaint = 0.0;
{
  vec2 envP = vEnvWorld.xz;
  #ifdef ENV_MACRO
    diffuseColor.rgb *= 1.0 + uMacro.x * ( ( envN1.r * 0.6 + envN2.g * 0.4 ) * 2.0 - 1.0 );
  #endif
  #ifdef ENV_TINT
    diffuseColor.rgb *= mix( uTintA, uTintB, smoothstep( 0.2, 0.8, envN2.r * 0.7 + envN1.b * 0.3 ) );
  #endif
  #ifdef ENV_PATCH
  {
    float pn = texture2D( uEnvNoise, envP * uPatch.x + vec2( 0.2, 0.7 ) ).b;
    float pw = fwidth( pn );
    float pm = smoothstep( uPatch.y - pw, uPatch.y + pw, pn );
    diffuseColor.rgb *= 1.0 - pm * uPatch.z;
    envRough *= mix( 1.0, uPatch.w, pm );
  }
  #endif
  #ifdef ENV_CRACKS
  {
    float cn = texture2D( uEnvNoise, envP * uCrack.x + vec2( 0.43, 0.29 ) ).g;
    float cw = fwidth( cn );
    float cl = 1.0 - smoothstep( uCrack.y, uCrack.y + cw, abs( cn - 0.5 ) );
    cl *= 1.0 - smoothstep( 0.004, 0.02, cw ); // fade out where too fine to resolve
    float cm = smoothstep( uCrack.w, uCrack.w + 0.08, texture2D( uEnvNoise, envP * uCrack.x * 0.23 + 0.5 ).r );
    diffuseColor.rgb *= 1.0 - cl * cm * uCrack.z;
  }
  #endif
  #ifdef ENV_GRASS
  {
    vec4 wm = texture2D( uWorldMap, ( envP - uWorldXf.xy ) * uWorldXf.z );
    float dist = wm.r * 64.0;
    float verge = 1.0 - smoothstep( 22.0, 48.0, dist );
    float sp = dist / uWorldXf.w;
    float sw = fwidth( sp ) * 1.5;
    float tri = abs( fract( sp ) - 0.5 ) * 2.0;
    float stripe = smoothstep( 0.5 - sw, 0.5 + sw, tri ) - 0.5;
    stripe *= 1.0 - smoothstep( 0.2, 0.45, sw );
    diffuseColor.rgb *= 1.0 + verge * stripe * 0.1;
    diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.93, 1.04, 0.9 ), verge );
    diffuseColor.rgb *= 1.0 - wm.g * 0.45;
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.25, 1.08, 0.78 ), wm.b * 0.8 );
  }
  #endif
  #ifdef ENV_TRACK
  {
    float lat = vTrack.x;
    float edge = uTrackP.x - abs( lat );
    float aw = fwidth( lat ) * 0.8;
    float streak = texture2D( uEnvNoise, vec2( lat * 0.09, vTrack.w * 0.0023 ) ).a;
    float dl = ( lat - vTrack.y ) / uTrackP.y;
    float rubber = exp( - dl * dl ) * uTrackP.z * ( 0.6 + 0.8 * streak );
    float brake = vTrack.z * smoothstep( 0.55, 0.8, streak ) * exp( - dl * dl * 0.35 );
    diffuseColor.rgb *= 1.0 - clamp( rubber + brake * 0.45, 0.0, 0.65 );
    envRough *= 1.0 - rubber * 0.3;
    float dust = ( 1.0 - smoothstep( 0.4, 2.2, edge ) ) * uTrackP.w;
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.35 + vec3( 0.012, 0.010, 0.007 ), dust );
    float line = smoothstep( 0.14 - aw, 0.14 + aw, edge ) - smoothstep( 0.42 - aw, 0.42 + aw, edge );
    float pw = texture2D( uEnvNoise, vec2( lat * 0.7, vTrack.w * 0.29 ) ).a;
    line *= 0.8 + 0.2 * pw;
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.62, 0.6 ), line );
    envPaint = line;
  }
  #endif
}
`;

const FRAG_ROUGH = /* glsl */`
#ifdef ENV_ROUGH_A
  roughnessFactor *= texture2D( normalMap, vNormalMapUv ).a;
#endif
roughnessFactor = mix( roughnessFactor * envRough, 0.5, envPaint );
`;

// Scene fog, but the fog distance shrinks with distance from the world centre
// (1 at the boundary, uHaze.x on the horizon) and is capped, so far ridges keep
// a silhouette while matching the regular fog where the terrain meets the grass.
const FRAG_FOG = /* glsl */`
#ifdef USE_FOG
  float envHs = mix( 1.0, uHaze.x, smoothstep( 780.0, 1700.0, length( vEnvWorld.xz ) ) );
  #ifdef FOG_EXP2
    float envFd = vFogDepth * envHs;
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * envFd * envFd );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth * envHs );
  #endif
  fogFactor = min( fogFactor, uHaze.y ) * ( 1.0 - clamp( vEnvWorld.y * uHaze.z, 0.0, 0.35 ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

const FEATURES = ['macro', 'tint', 'detail', 'patches', 'cracks', 'roughA', 'grass', 'track', 'haze'];

// Build a patched MeshStandardMaterial. `params` are normal material params,
// `o` selects features (see top of file) and their settings.
export function envMaterial(params, o = {}) {
  const m = new THREE.MeshStandardMaterial(params);
  return patchMaterial(m, o);
}

export function patchMaterial(m, o = {}) {
  const defines = m.defines || (m.defines = {});
  const key = [];
  for (const f of FEATURES) if (o[f]) { defines['ENV_' + f.toUpperCase().replace('PATCHES', 'PATCH').replace('ROUGHA', 'ROUGH_A')] = ''; key.push(f); }
  const U = {
    uEnvNoise: { value: o.noise || null },
    uMacro: { value: new THREE.Vector4(o.macro?.amp ?? 0.15, 1 / (o.macro?.s1 ?? 61), 1 / (o.macro?.s2 ?? 313), 0) },
    uTintA: { value: new THREE.Color(o.tint?.a ?? '#ffffff') },
    uTintB: { value: new THREE.Color(o.tint?.b ?? '#ffffff') },
    uDetail: { value: new THREE.Vector4(o.detail?.scale ?? 0.37, o.detail?.mix ?? 0.5, 0.13, 0.71) },
    uPatch: { value: new THREE.Vector4(1 / (o.patches?.scale ?? 40), o.patches?.thresh ?? 0.72, o.patches?.dark ?? 0.15, o.patches?.rough ?? 0.85) },
    uCrack: { value: new THREE.Vector4(1 / (o.cracks?.scale ?? 23), o.cracks?.width ?? 0.006, o.cracks?.dark ?? 0.5, o.cracks?.mask ?? 0.55) },
    uWorldMap: { value: o.grass?.map || null },
    uWorldXf: { value: new THREE.Vector4(o.grass?.x0 ?? -800, o.grass?.z0 ?? -800, 1 / (o.grass?.size ?? 1600), o.grass?.stripe ?? 5) },
    uTrackP: { value: new THREE.Vector4(o.track?.hw ?? 6.5, o.track?.sigma ?? 1.5, o.track?.rubber ?? 0.32, o.track?.dust ?? 0.35) },
    uHaze: { value: new THREE.Vector3(o.haze?.scale ?? 1, o.haze?.max ?? 1, o.haze?.alt ?? 0) },
  };
  m.userData.env = U;
  const prevCompile = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile(shader, renderer);
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    let fs = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * ( 1.0 - envPaint * 0.85 );'));
    if (o.haze) fs = fs.replace('#include <fog_fragment>', FRAG_FOG);
    shader.fragmentShader = fs;
  };
  const k = 'env:' + key.join(',');
  m.customProgramCacheKey = () => k;
  return m;
}

// Overlay materials for flat ground layers: drawn in renderOrder without depth
// writes so they never z-fight (see Environment.addGround).
export function groundMaterial(params, o, layer) {
  const m = envMaterial({ depthWrite: false, ...params }, o);
  m.userData.layer = layer;
  return m;
}
