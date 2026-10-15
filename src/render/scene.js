// Renderer, sky, lighting, reflections and the frame render (post-processing goes here).
import * as THREE from 'three';
import { Environment } from './environment.js';

export function createRenderer(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#3f74b8') },
      mid: { value: new THREE.Color('#a9c6e2') },
      bottom: { value: new THREE.Color('#d9dccf') },
      sunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
      void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0),0.6)) : bottom;
      c = mix(bottom, c, smoothstep(-0.02, 0.06, h));
      float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0,0.9,0.7) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.18);
      gl_FragColor = vec4(c, 1.0); }`,
  });
}

export class WorldView {
  constructor(renderer, world, quality) {
    this.renderer = renderer;
    this.world = world;
    this.quality = quality;
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#c7d3dc', 250, 1300);

    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMaterial());
    sky.renderOrder = -20;
    sky.frustumCulled = false;
    scene.add(sky);
    this.sky = sky;

    // environment map for car paint reflections
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial());
    envScene.add(envSky);
    const envGround = new THREE.Mesh(new THREE.CircleGeometry(90, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4b5a3a' }));
    envGround.position.y = -2;
    envScene.add(envGround);
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();

    const hemi = new THREE.HemisphereLight('#cfe1f5', '#5b5a44', 0.9);
    scene.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight('#fff4e0', 2.6);
    sun.position.set(50, 60, 30);
    sun.castShadow = quality !== 'low';
    sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 200;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);
    this.sunOffset = new THREE.Vector3(50, 60, 30);

    this.env = new Environment(this);
  }

  followSun(target) {
    this.sun.position.set(target.x + this.sunOffset.x, target.y + this.sunOffset.y, target.z + this.sunOffset.z);
    this.sun.target.position.copy(target);
  }


  // ---- seams used by main.js
  addColliderMesh(c) { return this.env.addColliderMesh(c); }
  removeColliderMesh(c) { this.env.removeColliderMesh(c); }

  // called once per frame before render; focus = THREE.Vector3 the camera follows
  update(dt, camera, focus) {
    if (focus) this.followSun(focus);
    this.env.update(dt, camera);
  }

  setSize(w, h) {
    this.renderer.setSize(w, h, false);
  }

  render(camera) {
    this.renderer.render(this.scene, camera);
  }
}
