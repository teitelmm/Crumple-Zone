// Renderer, lighting, sky and all static world visuals.
import * as THREE from 'three';
import { makeTextures } from './textures.js';
import { TRACK_WIDTH } from '../world/map.js';

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
    this.T = makeTextures();
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

    this.buildGround();
    this.buildTrack();
    this.buildColliders();
    this.buildScenery();
  }

  followSun(target) {
    this.sun.position.set(target.x + this.sunOffset.x, target.y + this.sunOffset.y, target.z + this.sunOffset.z);
    this.sun.target.position.copy(target);
  }

  mat(map, opts = {}) {
    return new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, ...opts });
  }

  // Ground layers (grass, pads, road, kerbs, lines) are drawn first, in order, without
  // writing depth, so they can never z-fight however coarse the device's depth buffer is.
  overlay(map, layer, opts = {}) {
    const m = this.mat(map, { depthWrite: false, ...opts });
    m.userData.layer = layer;
    return m;
  }

  addGround(mesh) {
    mesh.renderOrder = -10 + (mesh.material.userData.layer || 0);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  buildGround() {
    const { scene, T } = this;
    T.grass.repeat.set(600, 600);
    this.addGround(new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), this.overlay(T.grass, 0)));
    const z = this.world.zones;
    const pad = (x, zz, w, l, tex, rep, y = 0.01) => {
      const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rep[0], rep[1]);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), this.overlay(t, 1));
      m.position.set(x, y, zz);
      return this.addGround(m);
    };
    pad(z.infield.x, z.infield.z, z.infield.w, z.infield.l, T.asphalt, [z.infield.w / 12, z.infield.l / 12]);
    pad(z.lab.x, z.lab.z, z.lab.w, z.lab.l, T.concrete, [z.lab.w / 9, z.lab.l / 7]);
    pad(-30, -170, 14, 60, T.asphalt, [1.2, 5]);
    pad(0, -305, 14, 130, T.asphalt, [1.2, 11]);
    pad(0, 350, 14, 120, T.asphalt, [1.2, 10]);
    // lab centre line dashes
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(z.lab.w, 1.2).rotateX(-Math.PI / 2),
      this.overlay(T.dash, 3, { transparent: true, roughness: 0.8 }));
    T.dash.rotation = Math.PI / 2;
    T.dash.repeat.set(1, 40);
    dash.position.set(z.lab.x, 0.02, z.lab.z + 3.2);
    this.addGround(dash);
    const dash2 = dash.clone(); dash2.position.z = z.lab.z - 3.2; this.addGround(dash2);
    // derby dirt
    const dirt = new THREE.Mesh(new THREE.CircleGeometry(z.derby.r + 2, 48).rotateX(-Math.PI / 2), this.overlay(T.dirt, 1));
    dirt.position.set(z.derby.x, 0.012, z.derby.z);
    this.addGround(dirt);
  }

  buildTrack() {
    const { track } = this.world;
    const pts = track.pts, N = pts.length;
    const pos = [], uv = [], idx = [];
    const hw = TRACK_WIDTH / 2;
    for (let i = 0; i <= N; i++) {
      const p = pts[i % N];
      const nx = -p.tz, nz = p.tx;
      const v = (i === N ? track.length : p.s) / 14;
      pos.push(p.x - nx * hw, 0.025, p.z - nz * hw, p.x + nx * hw, 0.025, p.z + nz * hw);
      uv.push(0, v, 1, v);
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.addGround(new THREE.Mesh(g, this.overlay(this.T.track, 2, { roughness: 0.85 })));

    // kerbs on the inside of tight corners
    const kp = [], kuv = [], ki = [];
    let run = null;
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const tight = Math.abs(p.curv) > 1 / 110;
      if (tight) {
        const side = p.curv > 0 ? 1 : -1;
        const nx = -p.tz * side, nz = p.tx * side;
        const base = kp.length / 3;
        kp.push(p.x + nx * hw, 0.04, p.z + nz * hw, p.x + nx * (hw + 1.5), 0.06, p.z + nz * (hw + 1.5));
        kuv.push(0, p.s / 4, 1, p.s / 4);
        if (run !== null && run === i - 1) {
          if (side > 0) ki.push(base - 2, base, base - 1, base - 1, base, base + 1);
          else ki.push(base - 2, base - 1, base, base - 1, base + 1, base);
        }
        run = i;
      }
    }
    const kg = new THREE.BufferGeometry();
    kg.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
    kg.setAttribute('uv', new THREE.Float32BufferAttribute(kuv, 2));
    kg.setIndex(ki);
    kg.computeVertexNormals();
    this.addGround(new THREE.Mesh(kg, this.overlay(this.T.kerb, 3, { side: THREE.DoubleSide })));

    // start/finish line and gantry
    const s = this.world.spawns.start;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH, 1.6).rotateX(-Math.PI / 2), this.overlay(this.T.checker, 4));
    this.T.checker.repeat.set(8, 1);
    line.position.set(s.x, 0.035, s.z);
    line.rotation.y = -s.heading + Math.PI / 2;
    this.addGround(line);
    const gantry = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: '#d7d9db', metalness: 0.6, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.5, 0.4), steel);
      post.position.set(0, 3.25, side * (TRACK_WIDTH / 2 + 1.5));
      post.castShadow = true;
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, TRACK_WIDTH + 3.4), new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.6 }));
    beam.position.y = 6.2;
    beam.castShadow = true;
    gantry.add(beam);
    gantry.position.set(s.x, 0, s.z);
    gantry.rotation.y = -s.heading;
    this.scene.add(gantry);
  }

  buildColliders() {
    const { T } = this;
    const mats = {
      tyres: this.mat(T.tyres, { roughness: 0.95 }),
      concrete: this.mat(T.barrier, { roughness: 0.9 }),
      jersey: this.mat(T.barrier, { roughness: 0.9 }),
      boundary: new THREE.MeshStandardMaterial({ color: '#6b7a5a', roughness: 1 }),
      ramp: new THREE.MeshStandardMaterial({ color: '#c9c7c0', roughness: 0.85, map: T.concrete }),
      pole: new THREE.MeshStandardMaterial({ color: '#9da3a8', metalness: 0.7, roughness: 0.35 }),
      tyrestack: this.mat(T.tyres, { roughness: 0.95 }),
      obstacle: this.mat(T.barrier, { roughness: 0.85 }),
    };
    this.colliderMats = mats;
    this.colliderMeshes = new Map();
    for (const c of this.world.colliders) this.addColliderMesh(c);
  }

  addColliderMesh(c) {
    const mats = this.colliderMats;
    let mesh;
    if (c.type === 'box' && c.ramp) {
      mesh = rampMesh(c.ramp, mats.ramp, this.T);
    } else if (c.type === 'box') {
      const g = new THREE.BoxGeometry(c.hx * 2, c.hy * 2, c.hz * 2);
      if (c.tag === 'tyres' || c.tag === 'concrete' || c.tag === 'jersey' || c.tag === 'obstacle') {
        // stretch the texture along the long axis
        const uvA = g.attributes.uv;
        const along = Math.max(c.hx, c.hz) * 2;
        for (let i = 0; i < uvA.count; i++) uvA.setX(i, uvA.getX(i) * along / (c.tag === 'tyres' ? 4 : 6));
      }
      mesh = new THREE.Mesh(g, mats[c.tag] || mats.concrete);
      const R = c.R;
      const m = new THREE.Matrix4().set(R[0], R[1], R[2], c.cx, R[3], R[4], R[5], c.cy, R[6], R[7], R[8], c.cz, 0, 0, 0, 1);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m);
      if (c.tag === 'boundary') mesh.visible = false;
    } else if (c.type === 'cyl') {
      if (c.tag === 'pole') {
        mesh = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(c.radius * 0.8, c.radius, c.y1, 12), mats.pole);
        shaft.position.y = c.y1 / 2;
        shaft.castShadow = true;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.18), mats.pole);
        arm.position.set(0.8, c.y1 - 0.1, 0);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.35), new THREE.MeshStandardMaterial({ color: '#f5f2df', emissive: '#6b6750' }));
        lamp.position.set(1.6, c.y1 - 0.2, 0);
        mesh.add(shaft, arm, lamp);
        mesh.position.set(c.cx, 0, c.cz);
      } else {
        const g = new THREE.CylinderGeometry(c.radius, c.radius, c.y1 - c.y0, 20);
        mesh = new THREE.Mesh(g, mats[c.tag] || mats.tyrestack);
        mesh.position.set(c.cx, (c.y0 + c.y1) / 2, c.cz);
      }
    }
    if (!mesh) return;
    mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(mesh);
    this.colliderMeshes.set(c.id, mesh);
    return mesh;
  }

  removeColliderMesh(c) {
    const m = this.colliderMeshes.get(c.id);
    if (m) { this.scene.remove(m); this.colliderMeshes.delete(c.id); }
  }

  buildScenery() {
    const { world } = this;
    // trees scattered away from paved areas
    const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6).translate(0, 1.2, 0);
    const crownG = new THREE.ConeGeometry(2.0, 5.5, 7).translate(0, 4.6, 0);
    const count = this.quality === 'low' ? 220 : 520;
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: '#4a3826', roughness: 1 }), count);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: '#2f4a28', roughness: 1 }), count);
    let s = 12345;
    const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const m = new THREE.Matrix4();
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 20000) {
      const x = (r() - 0.5) * 1380, z = (r() - 0.5) * 1380;
      if (world.surfaceAt(x, z).type !== 'grass') continue;
      if (nearTrack(world.track, x, z, 26)) continue;
      if (Math.hypot(x - world.zones.derby.x, z - world.zones.derby.z) < world.zones.derby.r + 14) continue;
      if (Math.abs(z - world.zones.lab.z) < 40 && Math.abs(x) < 200) continue;
      if (Math.abs(x - world.zones.infield.x) < 125 && Math.abs(z - world.zones.infield.z) < 135) continue;
      const sc = 0.7 + r() * 0.8;
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6), new THREE.Vector3(sc, sc * (0.8 + r() * 0.5), sc));
      trunks.setMatrixAt(placed, m);
      crowns.setMatrixAt(placed, m);
      placed++;
    }
    trunks.count = crowns.count = placed;
    crowns.castShadow = true;
    this.scene.add(trunks, crowns);

    // distant hills: broad, low, tinted toward the sky so they read as distance
    const hills = new THREE.Group();
    const hm = new THREE.MeshLambertMaterial({ color: '#6f8a7c', flatShading: true, fog: false });
    const hm2 = new THREE.MeshLambertMaterial({ color: '#8ea3a6', flatShading: true, fog: false });
    for (let k = 0; k < 34; k++) {
      const a = (k / 34) * Math.PI * 2 + r() * 0.12;
      const far = k % 2 === 0;
      const rad = far ? 1250 + r() * 120 : 1000 + r() * 120;
      const h = far ? 110 + r() * 120 : 50 + r() * 60;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), far ? hm2 : hm);
      hill.scale.set(220 + r() * 160, h, 160 + r() * 120);
      hill.rotation.y = -a;
      hill.position.set(Math.cos(a) * rad, -4, Math.sin(a) * rad);
      hills.add(hill);
    }
    this.scene.add(hills);

    // grandstand by the start line
    const st = world.spawns.start;
    const stand = new THREE.Group();
    const standMat = new THREE.MeshStandardMaterial({ color: '#b9bcc0', roughness: 0.8 });
    const seatMat = new THREE.MeshStandardMaterial({ color: '#2b4f7e', roughness: 0.7 });
    for (let k = 0; k < 6; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(40, 0.8, 1.6), k % 2 ? seatMat : standMat);
      step.position.set(0, 0.4 + k * 0.8, k * 1.6);
      step.castShadow = step.receiveShadow = true;
      stand.add(step);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(42, 0.3, 11), standMat);
    roof.position.set(0, 8.5, 4);
    roof.castShadow = true;
    stand.add(roof);
    stand.position.set(st.x + Math.sin(st.heading) * 22, 0, st.z - Math.cos(st.heading) * 22);
    stand.rotation.y = -st.heading + Math.PI;
    this.scene.add(stand);

    // crash lab target boards and light rig
    const lab = world.zones.lab;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ map: this.T.target, roughness: 0.6 }));
    board.position.set(lab.x + 120, 3, lab.z - lab.l / 2 + 1);
    this.scene.add(board);
    const board2 = board.clone();
    board2.position.set(lab.x + 120, 3, lab.z + lab.l / 2 - 1);
    board2.rotation.y = Math.PI;
    this.scene.add(board2);
  }
}

function nearTrack(track, x, z, d) {
  const pts = track.pts;
  for (let i = 0; i < pts.length; i += 3) if ((pts[i].x - x) ** 2 + (pts[i].z - z) ** 2 < d * d) return true;
  return false;
}

function rampMesh(r, mat, T) {
  // wedge: top face rises from ground at the start to `height` at the end
  const L = r.run, W = r.width / 2, H = r.height;
  const v = [
    0, 0, -W, L, H, -W, L, 0, -W,
    0, 0, W, L, 0, W, L, H, W,
    0, 0, -W, 0, 0, W, L, H, W, 0, 0, -W, L, H, W, L, H, -W,
    L, 0, -W, L, H, -W, L, H, W, L, 0, -W, L, H, W, L, 0, W,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  const uv = [];
  for (let i = 0; i < v.length / 3; i++) uv.push(v[i * 3] / 4, v[i * 3 + 2] / 4);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, [mat][0]);
  m.material = mat.clone();
  m.material.side = THREE.DoubleSide;
  const grp = new THREE.Group();
  grp.add(m);
  // hazard stripe on the lip
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, r.width), new THREE.MeshStandardMaterial({ map: T.barrier, roughness: 0.8 }));
  lip.position.set(L - 0.15, H + 0.02, 0);
  lip.rotation.z = r.deg * Math.PI / 180;
  grp.add(lip);
  grp.position.set(r.x, 0, r.z);
  grp.rotation.y = -r.heading;
  return grp;
}
