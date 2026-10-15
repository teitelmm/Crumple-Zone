// Chase / bumper / hood / orbit cameras, plus a slow cinematic orbit for replays.
import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'far', 'hood', 'orbit'];
const LABELS = { chase: 'Chase cam', far: 'Wide chase', hood: 'Hood cam', orbit: 'Orbit cam (drag to look)' };

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3(0, 5, -10);
    this.look = new THREE.Vector3();
    this.flatFwd = new THREE.Vector3(1, 0, 0);
    this.orbitYaw = 0.6; this.orbitPitch = 0.35; this.orbitDist = 9;
    this.cine = 0;
    this.shake = 0;
    this.dragging = null;
    this.initialized = false;

    dom.addEventListener('pointerdown', (e) => {
      if (e.target !== dom) return;
      this.dragging = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging || e.pointerId !== this.dragging.id) return;
      const dx = e.clientX - this.dragging.x, dy = e.clientY - this.dragging.y;
      this.dragging.x = e.clientX; this.dragging.y = e.clientY;
      this.orbitYaw -= dx * 0.008;
      this.orbitPitch = Math.max(-0.1, Math.min(1.3, this.orbitPitch + dy * 0.006));
    });
    window.addEventListener('pointerup', () => { this.dragging = null; });
    dom.addEventListener('wheel', (e) => { this.orbitDist = Math.max(4, Math.min(30, this.orbitDist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });
  }

  cycle() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    if (this.mode === 'orbit') this.orbitYaw = Math.atan2(-this.flatFwd.z, -this.flatFwd.x);
    return LABELS[this.mode];
  }

  snap() { this.initialized = false; }

  addShake(a) { this.shake = Math.min(1.2, this.shake + a); }

  // frame: { c, f, u, r } of the followed car; speed in m/s
  update(dt, frame, speed, cinematic = false) {
    const cam = this.camera;
    const c = new THREE.Vector3(...frame.c);
    const f = new THREE.Vector3(...frame.f);
    const u = new THREE.Vector3(...frame.u);
    const flat = new THREE.Vector3(f.x, 0, f.z);
    if (flat.lengthSq() > 0.01) {
      flat.normalize();
      const k = 1 - Math.exp(-dt * (speed > 3 ? 4 : 1.5));
      this.flatFwd.lerp(flat, this.initialized ? k : 1).normalize();
    }
    let targetPos, targetLook, fov = 60;
    const mode = cinematic ? 'cine' : this.mode;
    if (mode === 'chase' || mode === 'far') {
      const far = mode === 'far';
      const dist = (far ? 9.5 : 6.2) + Math.min(speed, 50) * 0.03;
      targetPos = c.clone().addScaledVector(this.flatFwd, -dist).add(new THREE.Vector3(0, far ? 3.4 : 2.1, 0));
      targetLook = c.clone().addScaledVector(this.flatFwd, 2.5).add(new THREE.Vector3(0, 0.9, 0));
      fov = 58 + Math.min(speed, 60) * 0.22;
    } else if (mode === 'hood') {
      targetPos = c.clone().addScaledVector(f, 0.2).addScaledVector(u, 1.05);
      targetLook = targetPos.clone().addScaledVector(f, 10).addScaledVector(u, -0.3);
      fov = 70;
    } else {
      if (mode === 'cine') { this.cine += dt * 0.35; }
      const yaw = mode === 'cine' ? this.cine : this.orbitYaw;
      const pitch = mode === 'cine' ? (this.cineDist > 10 ? 0.2 : 0.28) : this.orbitPitch;
      const dist = mode === 'cine' ? (this.cineDist || 8.5) : this.orbitDist;
      targetPos = c.clone().add(new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).multiplyScalar(dist));
      targetLook = c.clone().add(new THREE.Vector3(0, 0.5, 0));
      fov = 55;
    }
    if (!this.initialized || mode === 'hood') {
      this.pos.copy(targetPos);
      this.look.copy(targetLook);
      this.initialized = true;
    } else {
      const kp = 1 - Math.exp(-dt * (mode === 'orbit' || mode === 'cine' ? 12 : 7));
      const kl = 1 - Math.exp(-dt * 14);
      this.pos.lerp(targetPos, kp);
      this.look.lerp(targetLook, kl);
    }
    if (this.pos.y < 0.4) this.pos.y = 0.4;
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.25;
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.shake *= Math.exp(-dt * 6);
    }
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }
}
