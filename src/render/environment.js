// Static world visuals: ground layers, circuit, collider meshes, landscape,
// buildings and props. Pure presentation: physics lives in src/world/map.js
// and is never changed from here.
//
// Modules: textures.js (procedural maps), envshader.js (ground shader
// patches), envgeom.js (batching / instancing helpers), envtrack.js (circuit),
// envcolliders.js (collider meshes), envprops.js (buildings and dressing),
// envterrain.js (terrain, mountains, trees, grass).
import * as THREE from 'three';
import { makeTextures, DECALS } from './textures.js';
import { envMaterial, groundMaterial } from './envshader.js';
import { Batch, boxUV, chunkedInstances, rng, trs } from './envgeom.js';
import { analyseTrack, buildTrack, buildTrackside } from './envtrack.js';
import { ColliderViews } from './envcolliders.js';
import { Kit, buildGantry, buildPits, buildGrandstands, buildInfield, buildDerbyProps, buildLabProps, coneGeometry } from './envprops.js';
import { makeTerrain, buildTerrain, buildFlora, buildPerimeter, fillWorldMap, makeWorldMap, grassOptions } from './envterrain.js';

const BLOCK_CELL = 4, BLOCK_HALF = 800, BLOCK_N = (BLOCK_HALF * 2) / BLOCK_CELL;

export class Environment {
  // view: WorldView (gives scene, world, quality, renderer)
  constructor(view) {
    this.view = view;
    this.scene = view.scene;
    this.world = view.world;
    this.quality = this.q = view.quality;
    this.T = makeTextures(view.renderer, this.q);
    this.worldMap = makeWorldMap();
    this.blockGrid = new Uint8Array(BLOCK_N * BLOCK_N);
    this.shadeRects = [];
    this.paintBatch = new Batch();
    this.decalBatch = new Batch();
    this.fenceBatch = new Batch();
    this.buildMaterials();

    const A = this.track = analyseTrack(this.world);
    this.buildGround();
    buildTrack(this, A);
    this.colliders = new ColliderViews(this);

    // one kit per zone: merged meshes stay local, so they are culled per area
    const cones = [];
    const kit = new Kit(this);
    buildGantry(this, kit);
    buildPits(this, kit);
    kit.flush();
    buildGrandstands(this, kit);
    kit.flush();
    buildInfield(this, kit, cones);
    kit.flush();
    buildDerbyProps(this, kit);
    kit.flush();
    buildLabProps(this, kit, cones);
    kit.flush();
    buildTrackside(this, A);
    this.buildCones(cones);

    const TR = makeTerrain();
    buildTerrain(this, TR);
    const treePos = buildFlora(this, TR, A);
    buildPerimeter(this);
    fillWorldMap(this, treePos);
    this.flushOverlays();
  }

  // per-frame hook for animated scenery; camera is the active camera
  update(dt, camera) {}

  // ---------------------------------------------------------------- materials
  buildMaterials() {
    const T = this.T, hi = this.q !== 'low';
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const M = this.M = {};
    M.paintVC = std({ vertexColors: true, roughness: 0.6, metalness: 0.05 });
    M.steelVC = std({ vertexColors: true, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide });
    M.steel = std({ color: '#aeb4b8', roughness: 0.38, metalness: 0.75 });
    M.wall = envMaterial({ map: T.wall, normalMap: hi ? T.wallN : null, vertexColors: true, roughness: hi ? 1 : 0.85 },
      { noise: T.noise, macro: { amp: 0.08, s1: 11, s2: 53 }, roughA: hi });
    M.belt = envMaterial({ map: T.belt, normalMap: hi ? T.beltN : null, roughness: hi ? 1 : 0.7 },
      { noise: T.noise, macro: { amp: 0.08, s1: 17, s2: 71 }, roughA: hi });
    M.rubber = std({ color: '#151617', roughness: 0.86 });
    M.hazard = std({ map: T.hazard, roughness: 0.55 });
    M.lamp = std({ color: '#f4f1e4', emissive: '#fff3d6', emissiveIntensity: 0.6, roughness: 0.3 });
    M.redLamp = std({ color: '#2a0303', emissive: '#ff2a12', emissiveIntensity: 0.35, roughness: 0.2 });
    M.honeycomb = std({ map: T.honeycomb, roughness: 0.35, metalness: 0.65 });
    M.deck = envMaterial({ map: T.asphalt, normalMap: hi ? T.asphaltN : null, roughness: hi ? 1 : 0.85, color: '#a8a8a8' },
      { noise: T.noise, roughA: hi });
    M.glass = std({ map: T.glass, roughness: 0.06, metalness: 0.1, envMapIntensity: 1.4 });
    M.door = std({ map: T.door, roughness: 0.45, metalness: 0.5 });
    M.cladding = std({ map: T.cladding, vertexColors: true, roughness: 0.5, metalness: 0.35 });
    M.ads = std({ map: T.ads, roughness: 0.5 });
    M.crowd = std({ map: T.crowd, vertexColors: true, roughness: 0.9 });
    M.people = std({ vertexColors: true, roughness: 0.85 });
    M.skin = std({ color: '#c8956e', roughness: 0.8 });
    M.target = std({ map: T.target, roughness: 0.6, side: THREE.DoubleSide });
    if (hi) {
      // leaf cards: alpha tested, two-sided, and keeping the crown normals on back faces
      M.foliage = std({ map: T.leaves, vertexColors: true, roughness: 0.85, alphaTest: 0.42, side: THREE.DoubleSide, alphaToCoverage: this.q === 'high' });
      M.foliage.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
      };
      M.foliage.customProgramCacheKey = () => 'foliage';
      M.foliageFar = envMaterial({ vertexColors: true, roughness: 0.92 }, { haze: { scale: 0.6, max: 0.86 } });
      M.tuft = std({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    } else {
      M.foliage = new THREE.MeshLambertMaterial({ vertexColors: true });
      M.foliageFar = M.foliage;
      M.tuft = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    }
    M.paint = new THREE.MeshStandardMaterial({ map: T.paint, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.55 });
    M.decal = new THREE.MeshStandardMaterial({ map: T.decals, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.6 });
    M.fence = new THREE.MeshStandardMaterial({ map: T.fence, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 });

    // ground layers
    const noise = T.noise;
    this.padMat = groundMaterial({ map: T.asphalt, normalMap: hi ? T.asphaltN : null, normalScale: new THREE.Vector2(0.8, 0.8), roughness: hi ? 1 : 0.86 }, {
      noise, macro: { amp: 0.13, s1: 41, s2: 173 }, detail: this.q === 'high' ? { scale: 0.29, mix: 0.5 } : null,
      patches: { scale: 34, thresh: 0.7, dark: 0.18, rough: 1.06 }, cracks: hi ? { scale: 11, width: 0.0018, dark: 0.4, mask: 0.62 } : null, roughA: hi,
    }, 1);
    this.labMat = groundMaterial({ map: T.concrete, normalMap: hi ? T.concreteN : null, roughness: hi ? 1 : 0.82 }, {
      noise, macro: { amp: 0.1, s1: 29, s2: 151 }, patches: { scale: 26, thresh: 0.74, dark: 0.22, rough: 0.75 }, roughA: hi,
    }, 1);
  }

  groundMat(kind) { return kind === 'pit' ? this.padMat : this.padMat; }

  // Ground layers (grass, pads, road, kerbs, lines) are drawn first, in order, without
  // writing depth, so they can never z-fight however coarse the device's depth buffer is.
  overlay(map, layer, opts = {}) {
    return groundMaterial({ map, roughness: 0.92, ...opts }, { noise: this.T.noise, macro: { amp: 0.1 } }, layer);
  }

  addGround(mesh) {
    mesh.renderOrder = -10 + (mesh.material.userData.layer || 0);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------- ground
  buildGround() {
    const { T } = this;
    const z = this.world.zones;
    // grass out to where the terrain takes over, as 40 m cells with holes under
    // the big paved areas (less overdraw)
    const grass = new Batch();
    const C = 40, E = 760;
    const covered = (x0, z0, x1, z1) => {
      const corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]];
      const inRect = (r) => corners.every(([x, zz]) => Math.abs(x - r.x) <= r.w / 2 && Math.abs(zz - r.z) <= r.l / 2);
      const inDisc = corners.every(([x, zz]) => Math.hypot(x - z.derby.x, zz - z.derby.z) <= z.derby.r + 2);
      return inRect(z.infield) || inRect(z.lab) || inDisc;
    };
    for (let x0 = -E; x0 < E; x0 += C) for (let z0 = -E; z0 < E; z0 += C) {
      if (covered(x0, z0, x0 + C, z0 + C)) continue;
      grass.add(new THREE.PlaneGeometry(C, C).rotateX(-Math.PI / 2).translate(x0 + C / 2, 0, z0 + C / 2), null, null, boxUV(T.tile.grass));
    }
    this.grassMat = groundMaterial({ map: T.grass, roughness: 0.95 }, grassOptions(this), 0);
    this.addGround(new THREE.Mesh(grass.build(false), this.grassMat));

    // asphalt infield pad and access roads (one mesh)
    const pads = new Batch();
    const plane = (x, zz, w, l) => new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).translate(x, 0, zz);
    const uvA = boxUV(T.tile.asphalt);
    pads.add(plane(z.infield.x, z.infield.z, z.infield.w, z.infield.l), null, null, uvA);
    for (const [x, zz, w, l] of [[-30, -170, 14, 60], [0, -305, 14, 130], [0, 350, 14, 120]]) pads.add(plane(x, zz, w, l), null, null, uvA);
    const padMesh = this.addGround(new THREE.Mesh(pads.build(false), this.padMat));
    padMesh.position.y = 0.01;
    // crash lab concrete
    const lab = plane(z.lab.x, z.lab.z, z.lab.w, z.lab.l);
    worldUV(lab, T.tile.concrete);
    this.addGround(new THREE.Mesh(lab, this.labMat));
    this.buildDerbyFloor();
  }

  // dirt disc on a polar grid; vertex colours carry the rutted wheel tracks
  buildDerbyFloor() {
    const d = this.world.zones.derby, hi = this.q !== 'low';
    const R = d.r + 2, rings = hi ? 110 : 55, segs = hi ? 160 : 96;
    const P = [d.x, 0.012, d.z], C = [1, 1, 1], U = [d.x / this.T.tile.dirt, d.z / this.T.tile.dirt];
    const idx = [];
    const r = rng(9);
    const wob = Array.from({ length: 8 }, () => [r() * 6.28, 1 + Math.floor(r() * 3), 0.6 + r() * 1.4]);
    const lanes = [37.5, 31, 24.5, 17, 9];
    const tile = this.T.tile.dirt;
    for (let k = 1; k <= rings; k++) {
      const rad = R * k / rings;
      for (let s = 0; s < segs; s++) {
        const a = s / segs * Math.PI * 2;
        const x = d.x + Math.cos(a) * rad, z = d.z + Math.sin(a) * rad;
        P.push(x, 0.012, z);
        U.push(x / tile, z / tile);
        let v = 1.0;
        lanes.forEach((L, i) => {
          const [ph, f, amp] = wob[i];
          const c = L + Math.sin(a * f + ph) * amp;
          for (const o of [-0.85, 0.85]) {
            const t = (rad - c - o) / 0.4;
            v -= Math.exp(-t * t) * (0.34 - i * 0.03) * (0.6 + 0.4 * Math.sin(a * 7 + i));
          }
          const ridge = (rad - c) / 1.6;
          v += Math.exp(-ridge * ridge) * 0.05;
        });
        v *= 1 - Math.max(0, (rad - (R - 5)) / 5) * 0.18; // damp by the wall
        v *= 1 + Math.max(0, 1 - rad / 10) * 0.08;        // dusty centre
        C.push(v * 1.02, v, v * 0.97);
      }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let k = 1; k < rings; k++) {
      const a0 = 1 + (k - 1) * segs, a1 = 1 + k * segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
    g.setIndex(idx);
    // fix winding to face up
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const ax = P[ix[i] * 3], az = P[ix[i] * 3 + 2];
      const bx = P[ix[i + 1] * 3] - ax, bz = P[ix[i + 1] * 3 + 2] - az, cx = P[ix[i + 2] * 3] - ax, cz = P[ix[i + 2] * 3 + 2] - az;
      if (bz * cx - bx * cz < 0) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    }
    const mat = groundMaterial({ map: this.T.dirt, normalMap: hi ? this.T.dirtN : null, vertexColors: true, roughness: hi ? 1 : 0.95 }, {
      noise: this.T.noise, macro: { amp: 0.1, s1: 17, s2: 61 }, tint: { a: '#d9c6a8', b: '#ffffff', scale: 60 }, roughA: hi,
    }, 1);
    this.addGround(new THREE.Mesh(g, mat));
  }

  // ---------------------------------------------------------------- paint & decals
  quad(batch, corners, color, uvs = null) {
    // corners: 4 x [x, z] in order around the quad
    const P = [], U = [];
    for (const [x, z] of corners) P.push(x, 0.035, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const [a, b, c] = corners;
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0;
    g.setIndex(up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    batch.add(g, null, color, uvs ? null : boxUV(this.T.tile.paint));
  }

  paintLine(x0, z0, x1, z1, w, color, dash = 0, gap = 0) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / L, dz = (z1 - z0) / L, nx = -dz * w / 2, nz = dx * w / 2;
    const seg = (a, b) => this.quad(this.paintBatch, [[x0 + dx * a - nx, z0 + dz * a - nz], [x0 + dx * b - nx, z0 + dz * b - nz], [x0 + dx * b + nx, z0 + dz * b + nz], [x0 + dx * a + nx, z0 + dz * a + nz]], color);
    if (!dash) seg(0, L);
    else for (let s = 0; s < L; s += dash + gap) seg(s, Math.min(L, s + dash));
  }

  // rectangle w (local x) by l (local z) turned by a three.js yaw; outline > 0 draws only the border
  paintRect(cx, cz, w, l, yaw, color, outline = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (u, v) => [cx + u * c + v * s, cz - u * s + v * c];
    if (!outline) { this.quad(this.paintBatch, [P(-w / 2, -l / 2), P(w / 2, -l / 2), P(w / 2, l / 2), P(-w / 2, l / 2)], color); return; }
    const o = outline;
    const corners = [P(-w / 2, -l / 2), P(w / 2, -l / 2), P(w / 2, l / 2), P(-w / 2, l / 2)];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
      this.paintLine(ax, az, bx, bz, o, color);
    }
  }

  paintArc(cx, cz, r, w, a0, a1, color) {
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * r / 1.2));
    for (let k = 0; k < n; k++) {
      const t0 = a0 + (a1 - a0) * k / n, t1 = a0 + (a1 - a0) * (k + 1) / n;
      const p = (t, rr) => [cx + Math.cos(t) * rr, cz + Math.sin(t) * rr];
      this.quad(this.paintBatch, [p(t0, r - w / 2), p(t1, r - w / 2), p(t1, r + w / 2), p(t0, r + w / 2)], color);
    }
  }

  // decal from the atlas: w along the reader's right, l along heading (text up)
  decal(name, cx, cz, w, l, heading, color) {
    const R = DECALS[name];
    if (!R) return;
    const fx = Math.cos(heading), fz = Math.sin(heading), rx = -fz, rz = fx;
    const p = (u, v) => [cx + rx * (u - 0.5) * w + fx * (v - 0.5) * l, cz + rz * (u - 0.5) * w + fz * (v - 0.5) * l];
    this.quad(this.decalBatch, [p(0, 0), p(1, 0), p(1, 1), p(0, 1)], color, [R[0], R[1], R[2], R[1], R[2], R[3], R[0], R[3]]);
  }

  fenceStrip(x0, z0, x1, z1, y0, h) {
    const L = Math.hypot(x1 - x0, z1 - z0), t = this.T.tile.fence;
    const g = new THREE.PlaneGeometry(L, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / t, uv.getY(i) * h / t);
    this.fenceBatch.add(g, trs((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0)));
  }

  flushOverlays() {
    const add = (batch, mat, layer) => {
      if (batch.empty) return;
      const m = new THREE.Mesh(batch.build(true), mat);
      m.renderOrder = -10 + layer;
      m.receiveShadow = true;
      this.scene.add(m);
    };
    add(this.paintBatch, this.M.paint, 5);
    add(this.decalBatch, this.M.decal, 5.5);
    if (!this.fenceBatch.empty) this.scene.add(new THREE.Mesh(this.fenceBatch.build(false), this.M.fence));
  }

  buildCones(list) {
    if (!list.length) return;
    const r = rng(4);
    const items = list.map(([x, z]) => ({ m: trs(x, 0, z, r() * 6.28) }));
    this.instances(coneGeometry(), this.M.paintVC, items, 400, { castShadow: this.q !== 'low' });
  }

  // ---------------------------------------------------------------- placement helpers
  instances(geo, mat, items, cell, opts) {
    const r = chunkedInstances(geo, mat, items, cell, opts);
    this.scene.add(r.group);
    return r;
  }

  block(x, z, rad) { this.blockRect(x - rad, z - rad, x + rad, z + rad); }

  blockRect(x0, z0, x1, z1) {
    const c = (v) => Math.max(0, Math.min(BLOCK_N - 1, Math.floor((v + BLOCK_HALF) / BLOCK_CELL)));
    for (let j = c(Math.min(z0, z1)); j <= c(Math.max(z0, z1)); j++)
      for (let i = c(Math.min(x0, x1)); i <= c(Math.max(x0, x1)); i++) this.blockGrid[j * BLOCK_N + i] = 1;
  }

  blocked(x, z, rad = 0) {
    const c = (v) => Math.floor((v + BLOCK_HALF) / BLOCK_CELL);
    const i0 = c(x - rad), i1 = c(x + rad), j0 = c(z - rad), j1 = c(z + rad);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= BLOCK_N || j >= BLOCK_N) continue;
      if (this.blockGrid[j * BLOCK_N + i]) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- colliders
  addColliderMesh(c) { return this.colliders.add(c); }
  removeColliderMesh(c) { this.colliders.remove(c); }
}

// uvs = world x/z over tile size (for geometry already in world position)
function worldUV(g, tile) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
}
