// Deformable car mesh + wheels, driven by the soft-body node positions.
import * as THREE from 'three';
import { buildBodyMesh, deformInto, C } from '../vehicle/bodyshape.js';

const meshCache = new Map();
function getMesh(spec, tpl) {
  if (!meshCache.has(spec.id)) meshCache.set(spec.id, buildBodyMesh(spec, tpl));
  return meshCache.get(spec.id);
}

const wheelGeo = new Map();
function wheelGeometry(radius, width) {
  const key = radius + ':' + width;
  if (wheelGeo.has(key)) return wheelGeo.get(key);
  const tire = new THREE.CylinderGeometry(radius, radius, width, 28, 1).rotateX(Math.PI / 2);
  const sidewall = new THREE.TorusGeometry(radius * 0.86, radius * 0.11, 8, 28).translate(0, 0, width * 0.42);
  const rimR = radius * 0.66;
  const rim = new THREE.CylinderGeometry(rimR, rimR, width * 0.9, 24, 1).rotateX(Math.PI / 2);
  const spokes = [];
  for (let k = 0; k < 5; k++) {
    const s = new THREE.BoxGeometry(rimR * 1.9, rimR * 0.2, 0.03);
    s.rotateZ((k / 5) * Math.PI);
    s.translate(0, 0, width * 0.46);
    spokes.push(s);
  }
  const hub = new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.22, 0.05, 12).rotateX(Math.PI / 2).translate(0, 0, width * 0.47);
  const disc = new THREE.CylinderGeometry(rimR * 0.85, rimR * 0.85, 0.03, 20).rotateX(Math.PI / 2).translate(0, 0, width * 0.2);
  const g = { tire, sidewall, rim, spokes: mergeBoxes(spokes), hub, disc };
  wheelGeo.set(key, g);
  return g;
}

function mergeBoxes(list) {
  const pos = [], norm = [], idx = [];
  let off = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); norm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setIndex(idx);
  return out;
}

const tireMat = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
const rimMats = {
  a4: new THREE.MeshStandardMaterial({ color: '#b8bcc2', metalness: 0.85, roughness: 0.28 }),
  miata: new THREE.MeshStandardMaterial({ color: '#2d2f33', metalness: 0.7, roughness: 0.35 }),
  mustang: new THREE.MeshStandardMaterial({ color: '#8d9197', metalness: 0.85, roughness: 0.3 }),
};
const discMat = new THREE.MeshStandardMaterial({ color: '#6b6d70', metalness: 0.8, roughness: 0.5 });

export function makeWheelMesh(spec) {
  const d = spec.dims;
  const g = wheelGeometry(d.wheelRadius, d.tireWidth);
  const rimMat = rimMats[spec.id] || rimMats.a4;
  const grp = new THREE.Group();
  const spin = new THREE.Group();
  spin.add(new THREE.Mesh(g.tire, tireMat), new THREE.Mesh(g.sidewall, tireMat), new THREE.Mesh(g.rim, rimMat),
    new THREE.Mesh(g.spokes, rimMat), new THREE.Mesh(g.hub, rimMat));
  grp.add(spin);
  grp.add(new THREE.Mesh(g.disc, discMat));
  grp.userData.spin = spin;
  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return grp;
}

export class CarView {
  constructor(scene, vehicle, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.vehicle = vehicle;
    const spec = vehicle.spec;
    const src = getMesh(spec, vehicle.tpl);
    this.src = src;
    const g = new THREE.BufferGeometry();
    this.posArr = new Float32Array(src.positions.length);
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    this.colArr = new Float32Array(src.positions.length);
    g.setAttribute('color', new THREE.BufferAttribute(this.colArr, 3));
    g.setIndex(new THREE.BufferAttribute(src.indices, 1));
    this.geometry = g;
    this.palette = makePalette(vehicle.color);
    for (let i = 0; i < src.colors.length; i++) this.setColor(i, this.palette[src.colors[i]]);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.32, side: THREE.DoubleSide, envMapIntensity: 1.1 });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.wheels = vehicle.wheels.map(w => {
      const m = makeWheelMesh(spec);
      if (w.side < 0) m.scale.z = -1;
      scene.add(m);
      return m;
    });
    this.brakeOn = null;
    this.shattered = {};
    this.frame = 0;
    this.update(true);
  }

  setColor(i, c) { this.colArr[i * 3] = c.r; this.colArr[i * 3 + 1] = c.g; this.colArr[i * 3 + 2] = c.b; }

  recolorTag(tag, color) {
    const list = this.src.tags[tag];
    if (!list) return;
    for (const i of list) if (this.src.colors[i] === C.glass || this.src.colors[i] === C.tail || this.src.colors[i] === C.head) this.setColor(i, color);
    this.geometry.attributes.color.needsUpdate = true;
  }

  // positions: Float64Array of node positions (live or replay)
  update(force = false, positions = null, wheelStates = null) {
    const v = this.vehicle;
    deformInto(this.posArr, this.src.binding, positions || v.body.x);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();

    const braking = v.brkEff > 0.05 && !v.engineDead;
    if (braking !== this.brakeOn || force) {
      this.brakeOn = braking;
      this.recolorTag('tail', braking ? this.palette.brake : this.palette[C.tail]);
    }
    for (const k of Object.keys(v.glass)) {
      if (v.glass[k] && !this.shattered[k]) { this.shattered[k] = true; this.recolorTag(k, this.palette.cracked); }
      if (!v.glass[k] && this.shattered[k]) { this.shattered[k] = false; this.recolorTag(k, this.palette[C.glass]); }
    }

    const m = new THREE.Matrix4();
    v.wheels.forEach((w, i) => {
      const mesh = this.wheels[i];
      const st = wheelStates ? wheelStates[i] : null;
      if (st ? st.detached : w.detached) { mesh.visible = false; return; }
      mesh.visible = true;
      if (st) {
        const f = new THREE.Vector3(...st.fwd).normalize(), u = new THREE.Vector3(...st.up).normalize();
        m.makeBasis(f, u, new THREE.Vector3().crossVectors(f, u));
        mesh.quaternion.setFromRotationMatrix(m);
        mesh.position.set(st.center[0], st.center[1], st.center[2]);
        mesh.userData.spin.rotation.z = -st.spin;
      } else {
        m.makeBasis(new THREE.Vector3(...w.fwd), new THREE.Vector3(...w.up), new THREE.Vector3(...w.right));
        mesh.quaternion.setFromRotationMatrix(m);
        mesh.position.set(w.center[0], w.center[1], w.center[2]);
        mesh.userData.spin.rotation.z = -w.spinAngle;
      }
    });
  }

  resetVisualState() {
    for (const k of Object.keys(this.shattered)) { this.shattered[k] = false; this.recolorTag(k, this.palette[C.glass]); }
    this.update(true);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    for (const w of this.wheels) this.scene.remove(w);
  }
}

function makePalette(paint) {
  const c = (hex) => new THREE.Color(hex);
  const p = [];
  p[C.paint] = c(paint);
  p[C.glass] = c('#0d1217');
  p[C.black] = c('#121314');
  p[C.chrome] = c('#c9ccd0');
  p[C.head] = new THREE.Color(1.6, 1.6, 1.5);
  p[C.tail] = c('#9c1219');
  p[C.plate] = c('#e7e6df');
  p[C.under] = c('#161616');
  p[C.soft] = c('#18191a');
  p[C.grille] = c('#0b0b0c');
  p.brake = new THREE.Color(3.2, 0.12, 0.1);
  p.cracked = c('#8f9aa3');
  return p;
}
