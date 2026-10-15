import * as THREE from 'three';
import { PhysicsWorld } from './physics/softbody.js';
import { buildWorld } from './world/map.js';
import { Vehicle } from './vehicle/vehicle.js';
import { CARS } from './vehicle/specs.js';
import { createRenderer, WorldView } from './render/scene.js';
import { CarView } from './render/carview.js';
import { Effects } from './render/effects.js';
import { CameraRig } from './game/camera.js';
import { Input } from './game/input.js';
import { AudioEngine } from './game/audio.js';
import { Recorder } from './game/replay.js';
import { MODES } from './game/modes.js';
import { UI } from './game/ui.js';

const STEP = 1 / 60;

class Game {
  constructor() {
    this.isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
    this.audio = new AudioEngine();
    this.cars = [];
    this.ui = new UI(this);
    const q = this.ui.settings.quality;
    this.quality = q === 'auto' ? (this.isTouch ? 'low' : 'high') : q;

    this.world = buildWorld();
    this.physics = new PhysicsWorld({ colliders: [...this.world.colliders], surfaceAt: this.world.surfaceAt });
    const canvas = document.getElementById('view');
    this.renderer = createRenderer(canvas, this.quality);
    this.view = new WorldView(this.renderer, { ...this.world, colliders: this.physics.colliders }, this.quality);
    this.scene = this.view.scene;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.25, 3000);
    this.rig = new CameraRig(this.camera, canvas);
    this.effects = new Effects(this.scene);
    this.input = new Input();
    this.input.bindTouch(document.getElementById('touch'));
    this.input.bindTouch(document.getElementById('topbar'));
    this.recorder = new Recorder(12, 60);
    this.recAcc = 0;
    this.timeScale = 1;
    this.paused = false;
    this.state = 'menu';
    this.mode = null;
    this.player = null;
    this.replay = null;
    this.lastResults = null;

    this.input.on('camera', () => { if (this.state === 'play') this.ui.toast(this.rig.cycle(), 1.4); });
    this.input.on('reset', () => { if (this.state === 'play' && !this.paused) this.resetPlayer(); });
    this.input.on('pause', () => {
      if (this.state === 'replay') this.stopReplay();
      else if (this.state === 'play' && document.getElementById('results').hidden) this.setPaused(!this.paused);
    });
    this.input.on('slowmo', () => {
      if (this.state !== 'play') return;
      this.timeScale = this.timeScale === 1 ? 0.25 : 1;
      this.ui.toast(this.timeScale === 1 ? 'Normal speed' : 'Slow motion ×0.25', 1.2);
    });
    this.input.on('replay', () => {
      if (this.state === 'play' && !this.paused && this.recorder.count > 30) this.startReplay({ speed: 0.5 });
      else if (this.state === 'replay') this.stopReplay();
    });
    this.input.on('mute', () => { this.audio.setMuted(!this.audio.muted); this.ui.toast(this.audio.muted ? 'Sound off' : 'Sound on', 1.2); });
    this.input.on('horn', () => this.audio.horn());

    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play' && !this.paused) this.setPaused(true); });
    window.addEventListener('resize', () => this.resize());
    document.getElementById('fullscreenBtn').addEventListener('click', () => {
      const el = document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen?.();
      else el.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => this.ui.toast('Fullscreen is not available here'));
    });
    this.resize();
    this.ui.showMenu(true);
    this.showcase(this.ui.sel.car);
    document.getElementById('loading').hidden = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.lifted = null;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ cars
  spawnCar(id, o = {}) {
    const spec = CARS[id];
    const v = new Vehicle(spec, this.physics, { color: o.color || spec.color, name: o.name, isPlayer: o.isPlayer, tractionControl: this.ui.settings.tc });
    this.physics.add(v.body);
    v.spawn(o.x, o.z, o.heading || 0, o.speed || 0);
    const view = new CarView(this.scene, v);
    const entry = { vehicle: v, view, driver: null, name: o.name || spec.name, id: this.cars.length, isPlayer: !!o.isPlayer };
    this.cars.push(entry);
    if (o.isPlayer) this.player = entry;
    return entry;
  }

  clearCars() {
    for (const e of this.cars) { this.physics.remove(e.vehicle.body); e.view.dispose(); }
    this.cars = [];
    this.player = null;
    this.effects.clear();
    this.recorder.reset();
  }

  addCollider(c) { this.physics.colliders.push(c); this.view.addColliderMesh(c); }
  removeCollider(c) {
    const i = this.physics.colliders.indexOf(c);
    if (i >= 0) this.physics.colliders.splice(i, 1);
    this.view.removeColliderMesh(c);
  }

  showcase(id) {
    if (this.state !== 'menu') return;
    this.clearCars();
    const s = this.world.spawns.free;
    const e = this.spawnCar(id, { x: s.x + 12, z: s.z + 30, heading: 0.6 });
    this.showcaseCar = e;
    this.rig.cine = 1.2;
    this.rig.snap();
  }

  // ------------------------------------------------------------ flow
  startMode(id, opts) {
    this.audio.start();
    this.audio.setVolume(this.ui.settings.volume);
    this.teardownMode();
    this.clearCars();
    this.modeId = id; this.modeOpts = opts;
    this.state = 'play';
    this.paused = false;
    this.timeScale = 1;
    this.input.enabled = true;
    this.ui.showMenu(false);
    this.ui.hideResults();
    this.ui.setPaused(false);
    this.mode = new MODES[id](this, opts);
    this.mode.setup();
    this.rig.mode = 'chase';
    this.rig.snap();
  }

  teardownMode() {
    if (this.mode?.teardown) this.mode.teardown();
    this.mode = null;
  }

  restart() { this.stopReplay(true); this.startMode(this.modeId, this.modeOpts); }

  toMenu() {
    this.stopReplay(true);
    this.teardownMode();
    this.state = 'menu';
    this.paused = false;
    this.ui.setPaused(false);
    document.getElementById('results').hidden = true;
    this.ui.showMenu(true);
    this.audio.silence();
    this.showcase(this.ui.sel.car);
  }

  setPaused(p) {
    if (this.state !== 'play') return;
    this.paused = p;
    this.ui.setPaused(p, this.mode);
    if (p) this.audio.silence();
  }

  showResults(card) {
    if (this.state === 'menu') return;
    this.lastResults = card;
    this.audio.silence();
    this.ui.showResults(card);
  }

  resetPlayer() {
    const e = this.player;
    if (!e || !this.mode) return;
    const how = this.mode.onReset(e);
    if (!how) return;
    const v = e.vehicle;
    v.computeFrame();
    if (how === 'upright') {
      this.upright(v);
      this.ui.toast('Flipped upright', 1.2);
      return;
    }
    const spot = typeof how === 'object' ? how : { x: v.frame.c[0], z: v.frame.c[2], heading: Math.atan2(v.frame.f[2], v.frame.f[0]) };
    this.respawn(e, spot);
    this.ui.toast('Car reset and repaired', 1.4);
  }

  respawn(e, spot) {
    e.vehicle.spawn(spot.x, spot.z, spot.heading, 0);
    e.view.resetVisualState();
    this.rig.snap();
  }

  teleport(spot) { if (this.player) this.respawn(this.player, spot); }

  // rotate a (possibly bent) car back onto its wheels without repairing it
  upright(v) {
    const b = v.body, fr = v.frame, c = fr.c;
    let fx = fr.f[0], fz = fr.f[2];
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    const rx = -fz, rz = fx;
    for (let i = 0; i < b.n; i++) {
      const dx = b.x[i * 3] - c[0], dy = b.x[i * 3 + 1] - c[1], dz = b.x[i * 3 + 2] - c[2];
      const lx = dx * fr.f[0] + dy * fr.f[1] + dz * fr.f[2];
      const ly = dx * fr.u[0] + dy * fr.u[1] + dz * fr.u[2];
      const lz = dx * fr.r[0] + dy * fr.r[1] + dz * fr.r[2];
      b.x[i * 3] = c[0] + fx * lx + rx * lz;
      b.x[i * 3 + 1] = 1.0 + ly;
      b.x[i * 3 + 2] = c[2] + fz * lx + rz * lz;
    }
    for (let i = 0; i < b.n * 3; i++) { b.p[i] = b.x[i]; b.v[i] = 0; }
    v.computeFrame();
  }

  // ------------------------------------------------------------ replay
  startReplay({ from = 0, speed = 0.5, cinematic = false, then = null } = {}) {
    if (this.recorder.count < 2) { then?.(); return; }
    this.state = 'replay';
    this.replay = { t: from, speed, cinematic, then, end: this.recorder.count - 1 };
    this.audio.silence();
    this.ui.showReplay(true, `×${speed}`);
    document.getElementById('hud').classList.add('replaying');
  }

  cycleReplaySpeed() {
    if (!this.replay) return;
    const opts = [0.1, 0.25, 0.5, 1];
    this.replay.speed = opts[(opts.indexOf(this.replay.speed) + 1) % opts.length];
    this.ui.showReplay(true, `×${this.replay.speed}`);
  }

  stopReplay(silent = false) {
    if (!this.replay) return;
    const then = this.replay.then;
    this.replay = null;
    this.state = 'play';
    this.ui.showReplay(false);
    document.getElementById('hud').classList.remove('replaying');
    for (const e of this.cars) e.view.update(true);
    this.rig.snap();
    if (!silent && then) then();
  }

  updateReplay(dt) {
    const r = this.replay;
    r.t += dt * 60 * r.speed;
    if (r.t >= r.end) { this.stopReplay(); return; }
    let camFrame = null, camSpeed = 0;
    for (const e of this.cars) {
      const s = this.recorder.sample(e.vehicle, r.t, e.replayBuf || (e.replayBuf = {}));
      if (!s) continue;
      e.view.update(false, s.pos, s.wheels);
      if (e === this.player) { camFrame = s.frame; camSpeed = s.speed; }
    }
    if (camFrame) this.rig.update(dt, camFrame, camSpeed, r.cinematic);
  }

  // ------------------------------------------------------------ simulation
  simulate(dt) {
    const simDt = Math.min(dt, 1 / 30) * this.timeScale;
    const n = simDt > 1 / 50 ? 2 : 1;
    const h = simDt / n;
    this.physics.substeps = Math.max(4, Math.min(16, Math.round(16 * h / STEP)));
    const ctl = this.input.state;
    for (let k = 0; k < n; k++) {
      for (const e of this.cars) {
        if (e.driver) e.driver.update(h);
        else if (e === this.player && this.state === 'play') {
          const c = e.vehicle.controls;
          if (this.input.enabled) { c.throttle = ctl.throttle; c.brake = ctl.brake; c.steer = ctl.steer; c.handbrake = ctl.handbrake; }
          else if (this.mode?.name !== 'Race') { c.throttle = 0; c.brake = 0; c.handbrake = 0; }
        } else if (e === this.showcaseCar) {
          const c = e.vehicle.controls; c.throttle = 0; c.brake = 1; c.steer = 0;
        }
        e.vehicle.update(h);
      }
      this.physics.step(h);
      for (const e of this.cars) {
        e.vehicle.postStep(h);
        if (e.vehicle.events.some(ev => ev.type === 'nan')) this.respawn(e, { x: e.vehicle.frame.c[0] || 0, z: e.vehicle.frame.c[2] || 0, heading: 0 });
      }
      this.recAcc += h;
      while (this.recAcc >= STEP) { this.recAcc -= STEP; this.recorder.record(this.cars.map(c => c.vehicle)); }
    }
    if (this.mode && this.state === 'play') this.mode.update(simDt);
    this.carEffects(simDt);
  }

  carEffects(dt) {
    const fx = this.effects;
    const camPos = this.camera.position;
    const lowQ = this.quality === 'low';
    for (const e of this.cars) {
      const v = e.vehicle;
      const fr = v.frame;
      const dist = Math.hypot(fr.c[0] - camPos.x, fr.c[1] - camPos.y, fr.c[2] - camPos.z);
      const near = Math.max(0, 1 - dist / 80);
      for (const ev of v.events) {
        if (ev.type === 'wheelOff') {
          fx.looseWheel(v.spec, ev.pos, ev.vel, ev.wheel.side);
          if (e.isPlayer) this.ui.toast('Wheel torn off');
        } else if (ev.type === 'glass') {
          fx.glass(fr.c[0] + fr.u[0], fr.c[1] + fr.u[1] * 0.9, fr.c[2] + fr.u[2], v.vel[0], v.vel[1], v.vel[2]);
          if (near > 0) this.audio.glass();
        } else if (ev.type === 'engineDead' && e.isPlayer && ev.reason !== 'out') {
          this.ui.toast(ev.reason === 'overheated' ? 'Engine seized: overheated' : 'Engine destroyed');
        }
      }
      v.events.length = 0;
      const pl = v.body.plasticFrame;
      if (pl > 0.02 && near > 0) {
        this.audio.crash(pl * near * (this.timeScale < 1 ? 1.5 : 1));
        if (e.isPlayer) this.rig.addShake(Math.min(1, pl * 0.6));
        if (pl > 0.25) fx.debrisDust(fr.c[0], fr.c[1], fr.c[2], lowQ ? 4 : 10);
      }
      // sparks from metal on the ground or walls
      const sc = v.body.scrapes;
      for (let k = 0; k < sc.length; k += 4) for (let j = 0; j < (lowQ ? 1 : 3); j++) fx.spark(sc[k], sc[k + 1], sc[k + 2], v.vel[0] * 0.5, 0.5, v.vel[2] * 0.5);
      // tyres
      v.wheels.forEach((w, i) => {
        const key = e.id * 4 + i;
        if (!w.contact || w.detached) { fx.skids.add(key, 0, 0, 0, 0, 0, 0, 0); return; }
        const paved = w.surface === 'asphalt' || w.surface === 'concrete' || w.surface === 'kerb';
        const s = w.slide;
        fx.skids.add(key, w.hit[0], w.hit[1], w.hit[2], w.right[0], w.right[2], w.width, paved ? s : s * 0.6);
        if (s > 0.25 && Math.random() < (lowQ ? 0.35 : 0.9) * s) fx.tyreSmoke(w.hit[0], w.hit[1], w.hit[2], v.vel[0], v.vel[2], s, w.surface);
        else if (!paved && v.speed > 6 && Math.random() < 0.15) fx.tyreSmoke(w.hit[0], w.hit[1], w.hit[2], v.vel[0], v.vel[2], 0.2, w.surface);
      });
      // radiator steam / engine smoke from the nose
      if ((v.radiatorLeak > 0 && v.coolant > 0) || v.engineHealth < 0.4 || v.engineTemp > 125) {
        if (Math.random() < (lowQ ? 0.2 : 0.5)) {
          const nose = v.tpl.groups.noseCenter * 3;
          const px = (v.body.x[nose] + fr.c[0]) / 2, py = fr.c[1] + 0.5, pz = (v.body.x[nose + 2] + fr.c[2]) / 2;
          fx.steam(px, py, pz, v.engineHealth < 0.4 || v.engineDead);
        }
      }
    }
    fx.update(dt);
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.input.update(dt);

    if (this.state === 'replay') {
      this.updateReplay(dt);
    } else if (!this.paused) {
      this.simulate(dt);
      const target = this.state === 'menu' ? this.showcaseCar : this.player;
      if (target) {
        for (const e of this.cars) e.view.update();
        this.rig.update(dt, target.vehicle.frame, target.vehicle.speed, this.state === 'menu');
      }
    }
    const focus = this.state === 'menu' ? this.showcaseCar : this.player;
    if (focus) this.view.followSun(new THREE.Vector3(...focus.vehicle.frame.c));
    if (this.state === 'play' && this.player) {
      this.audio.update(this.player.vehicle, this.timeScale, this.paused);
      this.ui.update(dt, this.player.vehicle, this.mode);
    } else this.ui.update(dt, null, null);

    // portrait phones: lift the menu car into the strip above the menu panel
    const w = window.innerWidth, h = window.innerHeight;
    const lift = this.state === 'menu' && w / h < 0.8;
    if (lift !== this.lifted) {
      this.lifted = lift;
      if (lift) this.camera.setViewOffset(w, h, 0, h * 0.28, w, h); else this.camera.clearViewOffset();
      this.rig.cineDist = lift ? 15 : 8.5;
    }
    const pr = this.renderer.getPixelRatio();
    this.effects.setViewport(this.renderer.domElement.height || window.innerHeight * pr, this.camera.fov);
    this.renderer.render(this.scene, this.camera);
  }
}

try {
  window.game = new Game();
} catch (err) {
  console.error(err);
  const el = document.getElementById('loading');
  el.hidden = false;
  el.innerHTML = `<p>Crumple Zone couldn't start: ${String(err.message || err)}.</p><p>It needs a browser with WebGL enabled.</p>`;
}
