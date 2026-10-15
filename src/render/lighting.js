// Sun light with a stable, texel-snapped shadow box that follows the player, plus
// the global shader tweaks that make fog and shadows match the sky:
//  - fog becomes aerial perspective: distance based (not view depth) and tinted
//    with the sky's horizon haze for that azimuth (bright toward the sun);
//  - directional shadows fade out near the edge of the shadow box instead of
//    stopping at a hard line.
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, HORIZON_COLOR, SUN_COLOR, SUN_DIR, SUN_ILLUMINANCE } from './sky.js';

let installed = false;
export function installLightingChunks() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  const ref = HORIZON_COLOR.toArray().map(x => Math.max(x, 1e-4).toFixed(6)).join(', ');
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogPos;\n#endif';
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogPos = mvPosition.xyz;\n#endif';
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogPos;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
${ATMOSPHERE_GLSL}
	const vec3 CZ_FOG_REF = vec3( ${ref} );
#endif`;
  // Fog(near, far): clear up to `near`, ~95% haze at `far`. fogColor tints the
  // haze relative to the reference horizon colour (unchanged colour = sky haze).
  C.fog_fragment = `#ifdef USE_FOG
	float fogDist = length( vFogPos );
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDist * fogDist );
	#else
		float fogT = max( fogDist - fogNear, 0.0 ) / max( fogFar - fogNear, 1.0 );
		float fogFactor = 1.0 - exp( -3.0 * pow( fogT, 2.2 ) );
	#endif
	vec3 fogDirW = ( vec4( vFogPos, 0.0 ) * viewMatrix ).xyz;
	vec3 fogCol = czHaze( fogDirW ) * ( fogColor / CZ_FOG_REF );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;
  // PBR materials take their ambient from the environment map (scene.environment,
  // built from the sky); the hemisphere light is the fallback ambient for
  // materials that can't do image-based lighting (Lambert, Phong, ...), so it
  // must not be counted twice.
  const hemi = '\t#if ( NUM_HEMI_LIGHTS > 0 )\n';
  if (C.lights_fragment_begin.includes(hemi)) {
    C.lights_fragment_begin = C.lights_fragment_begin.replace(hemi,
      '\t#if ( NUM_HEMI_LIGHTS > 0 ) && !( defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV ) )\n');
  }
  const needle = '\t\t}\n\t\treturn shadow;\n\t}\n\tvec2 cubeToUV';
  if (C.shadowmap_pars_fragment.includes(needle)) {
    C.shadowmap_pars_fragment = C.shadowmap_pars_fragment.replace(needle,
      '\t\t}\n\t\tvec2 czEdge = abs( shadowCoord.xy * 2.0 - 1.0 );\n' +
      '\t\tshadow = mix( shadow, 1.0, smoothstep( 0.8, 1.0, max( czEdge.x, czEdge.y ) ) );\n' +
      '\t\treturn shadow;\n\t}\n\tvec2 cubeToUV');
  }
}

const SHADOW = {
  high: { map: 4096, half: 75, normalBias: 0.025, bias: -0.00006 },
  medium: { map: 2048, half: 45, normalBias: 0.032, bias: -0.00008 },
};

export class SunRig {
  constructor(scene, quality) {
    const light = this.light = new THREE.DirectionalLight(SUN_COLOR, SUN_ILLUMINANCE);
    light.name = 'sun';
    this.dist = 130;
    const cfg = SHADOW[quality];
    light.castShadow = !!cfg;
    this.half = cfg ? cfg.half : 40;
    this.texel = 0;
    if (cfg) {
      light.shadow.mapSize.set(cfg.map, cfg.map);
      const cam = light.shadow.camera;
      cam.left = -cfg.half; cam.right = cfg.half; cam.top = cfg.half; cam.bottom = -cfg.half;
      cam.near = 1; cam.far = this.dist * 2;
      cam.updateProjectionMatrix();
      light.shadow.bias = cfg.bias;
      light.shadow.normalBias = cfg.normalBias;
      this.texel = (2 * cfg.half) / cfg.map;
    }
    // light-space axes, identical to the shadow camera's lookAt basis (up = +y)
    this.lz = SUN_DIR.clone();
    this.lx = new THREE.Vector3(0, 1, 0).cross(this.lz).normalize();
    this.ly = this.lz.clone().cross(this.lx);
    this._c = new THREE.Vector3();
    this._f = new THREE.Vector3();
    scene.add(light, light.target);
    this.follow(new THREE.Vector3());
  }

  // Centre the shadow box a little ahead of the camera around `focus`, snapped to
  // whole shadow-map texels in light space so edges don't shimmer as it moves.
  follow(focus, camera = null) {
    const c = this._c.copy(focus);
    if (camera) {
      camera.getWorldDirection(this._f);
      this._f.y = 0;
      if (this._f.lengthSq() > 1e-4) c.addScaledVector(this._f.normalize(), this.half * 0.4);
    }
    c.y = 0;
    if (this.texel > 0) {
      const t = this.texel;
      const x = Math.round(c.dot(this.lx) / t) * t;
      const y = Math.round(c.dot(this.ly) / t) * t;
      const z = c.dot(this.lz);
      c.copy(this.lx).multiplyScalar(x).addScaledVector(this.ly, y).addScaledVector(this.lz, z);
    }
    this.light.target.position.copy(c);
    this.light.position.copy(c).addScaledVector(SUN_DIR, this.dist);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
  }
}
