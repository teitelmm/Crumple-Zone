// Vehicle = soft body + suspension + tyres + drivetrain + damage model.

import { SoftBody } from '../physics/softbody.js';
import { buildTemplate } from './lattice.js';

const templateCache = new Map();
export function getTemplate(spec) {
  if (!templateCache.has(spec.id)) templateCache.set(spec.id, buildTemplate(spec));
  return templateCache.get(spec.id);
}

const G = 9.81;
const RHO = 1.225;

// Pacejka "magic formula" shape (normalised, peak 1 at ~7.5° slip)
function pac(a) {
  const B = 14, C = 1.9, E = 0.97;
  const x = B * a;
  return Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Vehicle {
  constructor(spec, world, opts = {}) {
    this.spec = spec;
    this.world = world;
    this.tpl = getTemplate(spec);
    this.body = new SoftBody(this.tpl);
    this.body.userData = this;
    this.body.onSubstep = (h) => this.substep(h);
    this.color = opts.color || spec.color;
    this.name = opts.name || spec.name;
    this.isPlayer = !!opts.isPlayer;
    this.tractionControl = opts.tractionControl ?? true;
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, hold: 0 }; // hold: brake without shifting to reverse
    this.events = [];

    const d = spec.dims;
    const M = spec.mass;
    const frontLoad = M * G * spec.frontWeight / 2;
    const rearLoad = M * G * (1 - spec.frontWeight) / 2;
    this.wheels = this.tpl.hubs.map((h) => {
      const load = h.axle === 0 ? frontLoad : rearLoad;
      const k = load / spec.susp.staticComp;
      const c = 2 * spec.susp.zeta * Math.sqrt(k * load / G);
      const driven = spec.drive.type === 'AWD' || (spec.drive.type === 'RWD' ? h.axle === 1 : h.axle === 0);
      const share = spec.drive.type === 'AWD' ? (h.axle === 0 ? spec.drive.front : 1 - spec.drive.front) / 2 : 0.5;
      return {
        hub: h, node: h.node, attach: h.attach, axle: h.axle, side: h.side,
        steerable: h.axle === 0, driven, driveShare: driven ? share : 0,
        radius: d.wheelRadius, width: d.tireWidth,
        restLen: spec.susp.restLen, k, c, arb: k * spec.susp.arb,
        brakeShare: h.axle === 0 ? 0.36 : 0.14,
        grip: h.axle === 0 ? 1.0 : 1.1,
        comp: 0, prevComp: 0, contact: false, load: 0, staticLoad: load,
        susp: spec.susp.restLen,
        vLong: 0, slide: 0, spinning: false, locked: false,
        angle: 0, spinAngle: 0, toe: 0, toeRest: 0,
        detached: false, surface: 'asphalt',
        center: [0, 0, 0], fwd: [1, 0, 0], up: [0, 1, 0], right: [0, 0, 1],
        hit: [0, 0, 0], skid: 0,
      };
    });
    // per-substep scratch
    this.frame = { c: [0, 0, 0], f: [1, 0, 0], u: [0, 1, 0], r: [0, 0, 1] };
    this.vel = [0, 0, 0];
    this.resetState();
  }

  resetState() {
    const e = this.spec.engine;
    this.gear = 1;
    this.rpm = e.idle;
    this.rpmShown = e.idle;
    this.boost = 0;
    this.shiftTimer = 0;
    this.revTimer = 0;
    this.driveForce = 0;
    this.engineBrake = 0;
    this.limiterCut = false;
    this.engineHealth = 1;
    this.engineDead = false;
    this.coolant = 1;
    this.engineTemp = 90;
    this.radiatorLeak = 0;
    this.glass = { windshield: false, rearGlass: false, leftGlass: false, rightGlass: false };
    this.damageCost = 0;
    this.speed = 0;
    this.speedFwd = 0;
    this.steerAngle = 0;
    this.slideAmount = 0;
    this.spinAmount = 0;
    this.airborne = 0;
    this.peakG = 0;
    this.gForce = 0;
    this.lastVel = null;
    this.thrEff = 0;
    this.brkEff = 0;
    this.steerSm = 0;
    this.toeTimer = 0;
    for (const w of this.wheels) {
      w.detached = false; w.comp = 0; w.prevComp = 0; w.contact = false; w.spinAngle = 0;
      w.slide = 0; w.spinning = false; w.locked = false; w.susp = w.restLen; w.toe = 0;
    }
  }

  spawn(x, z, heading, speed = 0, y = 0) {
    const vx = Math.cos(heading) * speed, vz = Math.sin(heading) * speed;
    this.body.place(x, y, z, heading, vx, 0, vz);
    this.resetState();
    this.heading0 = heading;
    this.computeFrame();
    // toe reference (lattice isn't perfectly rectangular)
    for (const w of this.wheels) w.toeRest = this.measureToe(w);
    this.updateWheelVisuals(0);
  }

  computeFrame() {
    const x = this.body.x;
    const g = this.tpl.groups;
    const avg = (idx, out) => {
      let a = 0, b = 0, c = 0, n = 0;
      for (const i of idx) { if (!this.body.active[i]) continue; a += x[i * 3]; b += x[i * 3 + 1]; c += x[i * 3 + 2]; n++; }
      out[0] = a / n; out[1] = b / n; out[2] = c / n;
      return out;
    };
    const F = avg(g.front, [0, 0, 0]), R = avg(g.rear, [0, 0, 0]);
    const Lf = avg(g.left, [0, 0, 0]), Rt = avg(g.right, [0, 0, 0]);
    const fr = this.frame;
    let fx = F[0] - R[0], fy = F[1] - R[1], fz = F[2] - R[2];
    let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    let rx = Rt[0] - Lf[0], ry = Rt[1] - Lf[1], rz = Rt[2] - Lf[2];
    // up = right x fwd
    let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    // right = fwd x up
    rx = fy * uz - fz * uy; ry = fz * ux - fx * uz; rz = fx * uy - fy * ux;
    fr.f[0] = fx; fr.f[1] = fy; fr.f[2] = fz;
    fr.u[0] = ux; fr.u[1] = uy; fr.u[2] = uz;
    fr.r[0] = rx; fr.r[1] = ry; fr.r[2] = rz;
    this.body.centerPosition(fr.c);
  }

  measureToe(w) {
    const x = this.body.x, f = this.frame;
    const a = w.hub.toeA * 3, b = w.hub.toeB * 3;
    const vx = x[a] - x[b], vy = x[a + 1] - x[b + 1], vz = x[a + 2] - x[b + 2];
    return Math.atan2(vx * f.r[0] + vy * f.r[1] + vz * f.r[2], vx * f.f[0] + vy * f.f[1] + vz * f.f[2]);
  }

  // ---- called once per frame before physics
  update(dt) {
    const spec = this.spec, e = spec.engine, tr = spec.trans;
    const c = this.controls;
    this.computeFrame();
    const v = this.body.centerVelocity(this.vel);
    const f = this.frame.f;
    this.speed = Math.hypot(v[0], v[1], v[2]);
    this.speedFwd = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];

    // g-force from the change in centre-of-mass velocity
    if (this.lastVel && dt > 0) {
      const ax = (v[0] - this.lastVel[0]) / dt, ay = (v[1] - this.lastVel[1]) / dt + G, az = (v[2] - this.lastVel[2]) / dt;
      const gNow = Math.hypot(ax, ay - G, az) / G;
      this.gForce += (gNow - this.gForce) * Math.min(1, dt * 20);
      if (this.gForce > this.peakG) this.peakG = this.gForce;
    }
    this.lastVel = [v[0], v[1], v[2]];

    // gear selection / reverse
    if (this.gear >= 1) {
      if (c.brake > 0.5 && this.speedFwd < 0.8 && c.throttle < 0.1 && !c.hold) {
        this.revTimer += dt;
        if (this.revTimer > 0.3) { this.gear = -1; this.revTimer = 0; }
      } else this.revTimer = 0;
    } else if (c.throttle > 0.1 && this.speedFwd > -0.8) {
      this.gear = 1;
    }
    if (c.hold && this.gear === -1) this.gear = 1;
    const reversing = this.gear === -1;
    const thr = this.engineDead ? 0 : (reversing ? c.brake : c.throttle);
    const brk = reversing ? c.throttle : c.brake;
    this.thrEff = thr;
    this.brkEff = brk;

    const ratio = reversing ? tr.reverse : tr.gears[this.gear - 1];
    let wv = 0, wn = 0, anySpin = false;
    for (const w of this.wheels) {
      if (!w.driven || w.detached) continue;
      wv += Math.abs(w.vLong); wn++;
      if (w.spinning) anySpin = true;
    }
    wv = wn ? wv / wn : Math.abs(this.speedFwd);
    const r = spec.dims.wheelRadius;
    const rpmWheels = wv / r * 60 / (2 * Math.PI) * ratio * tr.final;

    let rpm = Math.max(rpmWheels, e.idle);
    const launch = e.idle + (tr.type === 'manual' ? 2900 : 1900) * thr;
    if (rpmWheels < launch && thr > 0.02) rpm = Math.max(rpm, launch);
    if (anySpin) rpm = Math.max(rpm, rpmWheels * 1.25 + 1200 * thr);
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      rpm = Math.max(e.idle, rpmWheels);
    }
    if (this.engineDead) rpm = 0;
    rpm = Math.min(rpm, e.limiter + 80);
    this.rpm = rpm;
    this.rpmShown += (rpm - this.rpmShown) * Math.min(1, dt * 14);

    // turbo spool
    if (e.turbo) {
      const target = thr * clamp((rpm - 1300) / 1700, 0, 1);
      const rate = target > this.boost ? 2.6 : 7;
      this.boost += (target - this.boost) * Math.min(1, dt * rate);
    }

    // rev limiter
    if (rpm >= e.limiter) this.limiterCut = true;
    else if (rpm < e.limiter - 250) this.limiterCut = false;

    let torque = this.torqueAt(rpm) * thr;
    if (e.turbo) torque *= 0.6 + 0.4 * this.boost;
    torque *= 0.25 + 0.75 * this.engineHealth;
    if (this.engineTemp > 118) torque *= clamp(1 - (this.engineTemp - 118) / 25, 0.2, 1);
    if (this.limiterCut) torque = 0;
    if (this.shiftTimer > 0) torque *= tr.type === 'manual' ? 0 : 0.5;
    if (this.speed > spec.vmax && !reversing) torque = 0;
    let drive = torque * ratio * tr.final * 0.88 / r;
    if (reversing) drive = -drive;
    if (reversing && this.speedFwd < -12) drive = 0;
    this.driveForce = drive;
    // engine braking when off throttle
    const peakT = Math.max(...e.torque.map(p => p[1]));
    this.engineBrake = thr < 0.05 && !this.engineDead && this.shiftTimer <= 0 ? peakT * 0.1 * ratio * tr.final / r * clamp(rpm / e.redline, 0, 1) : 0;

    // automatic shifting
    if (this.gear >= 1 && this.shiftTimer <= 0) {
      const span = e.redline - e.idle;
      const up = e.idle + span * (0.5 + 0.47 * thr);
      if (Math.abs(this.speedFwd) < 2 && this.gear > 1) this.gear = 1;
      else if (rpmWheels > up && this.gear < tr.gears.length && !anySpin) {
        this.gear++; this.shiftTimer = tr.shiftTime;
      } else if (this.gear > 1) {
        const after = rpmWheels * tr.gears[this.gear - 2] / tr.gears[this.gear - 1];
        const down = e.idle + span * (0.16 + 0.4 * thr);
        if (rpmWheels < down && after < up * 0.9) { this.gear--; this.shiftTimer = tr.shiftTime * 0.7; }
      }
    }

    // steering with speed-sensitive lock
    const lock = spec.steerLock * Math.PI / 180;
    const sf = 1 / Math.sqrt(1 + Math.pow(this.speed / 11, 2));
    this.steerAngle = c.steer * lock * Math.max(sf, 0.12);

    // overheating
    if (this.radiatorLeak > 0) this.coolant = Math.max(0, this.coolant - this.radiatorLeak * dt);
    const heatIn = this.engineDead ? 0 : (0.4 + thr * 1.6) * (rpm / e.redline);
    const lost = 1 - this.coolant;
    const airflow = 0.7 + 0.3 * Math.min(this.speed, 25) / 25;
    const targetTemp = this.engineDead ? 40 : 88 + heatIn * (7 + 85 * lost * lost) / airflow;
    this.engineTemp += (targetTemp - this.engineTemp) * Math.min(1, dt * 0.06);
    if (this.engineTemp > 140 && !this.engineDead) this.killEngine('overheated');
  }

  torqueAt(rpm) {
    const t = this.spec.engine.torque;
    if (rpm <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) {
      if (rpm <= t[i][0]) {
        const a = t[i - 1], b = t[i];
        return a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]);
      }
    }
    return t[t.length - 1][1];
  }

  killEngine(reason) {
    if (this.engineDead) return;
    this.engineDead = true;
    this.events.push({ type: 'engineDead', reason });
  }

  // ---- called every physics substep
  substep(h) {
    this.computeFrame();
    const body = this.body, x = body.x, vArr = body.v, a = body.a;
    const fr = this.frame, up = fr.u, fwd = fr.f, right = fr.r;
    const world = this.world;
    const spec = this.spec;

    // aerodynamic drag as uniform deceleration (no torque)
    const cv = body.centerVelocity(this.vel);
    const sp = Math.hypot(cv[0], cv[1], cv[2]);
    if (sp > 0.1) {
      const k = 0.5 * RHO * spec.cdA * sp / body.totalMass;
      for (let i = 0; i < body.n; i++) {
        a[i * 3] -= k * cv[0]; a[i * 3 + 1] -= k * cv[1]; a[i * 3 + 2] -= k * cv[2];
      }
    }

    const nrm = [0, 1, 0];
    const wheels = this.wheels;
    // pass 1: suspension raycasts
    for (const w of wheels) {
      if (w.detached) { w.contact = false; continue; }
      const i3 = w.node * 3;
      const maxT = w.restLen + w.radius;
      const t = world.raycast(body, x[i3], x[i3 + 1], x[i3 + 2], -up[0], -up[1], -up[2], maxT, nrm);
      w.prevComp = w.comp;
      if (t === Infinity) {
        w.contact = false; w.comp = 0; w.susp = w.restLen;
      } else {
        w.contact = true;
        w.comp = maxT - t;
        w.susp = Math.max(0, t - w.radius);
        w.n0 = nrm[0]; w.n1 = nrm[1]; w.n2 = nrm[2];
        w.hit[0] = x[i3] - up[0] * t; w.hit[1] = x[i3 + 1] - up[1] * t; w.hit[2] = x[i3 + 2] - up[2] * t;
      }
    }
    // electronic brake distribution: brake force follows each tyre's current load
    let loadSum = 0;
    for (const w of wheels) if (w.contact) loadSum += Math.max(0, w.k * w.comp) * (w.axle === 0 ? 1.12 : 0.88);
    let grounded = 0;
    // torque from tyre forces acting at the contact patch rather than the hub
    let tqx = 0, tqy = 0, tqz = 0;
    for (const w of wheels) {
      if (!w.contact) { w.load = 0; w.slide = 0; w.spinning = false; continue; }
      grounded++;
      const other = wheels.find(o => o !== w && o.axle === w.axle);
      const compVel = (w.comp - w.prevComp) / h;
      let Fs = w.k * w.comp + w.c * (compVel < 0 ? 1.3 : 1) * compVel;
      const travel = w.restLen * 0.92;
      if (w.comp > travel) Fs += w.k * 10 * (w.comp - travel);
      if (other && !other.detached) Fs += w.arb * (w.comp - (other.contact ? other.comp : 0));
      if (Fs < 0) Fs = 0;
      w.load = Fs;

      // contact patch velocity: average over the attach group
      let vx = 0, vy = 0, vz = 0, cnt = 0;
      for (const i of w.attach) {
        if (!body.active[i]) continue;
        vx += vArr[i * 3]; vy += vArr[i * 3 + 1]; vz += vArr[i * 3 + 2]; cnt++;
      }
      vx /= cnt; vy /= cnt; vz /= cnt;

      // wheel heading = chassis forward + steer + damage toe
      const ang = (w.steerable ? this.steerAngle : 0) + w.toe;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      let fx = fwd[0] * ca + right[0] * sa, fy = fwd[1] * ca + right[1] * sa, fz = fwd[2] * ca + right[2] * sa;
      const n0 = w.n0, n1 = w.n1, n2 = w.n2;
      const fd = fx * n0 + fy * n1 + fz * n2;
      fx -= n0 * fd; fy -= n1 * fd; fz -= n2 * fd;
      let fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      // side = f x n
      const sx = fy * n2 - fz * n1, sy = fz * n0 - fx * n2, sz = fx * n1 - fy * n0;

      const vL = vx * fx + vy * fy + vz * fz;
      const vS = vx * sx + vy * sy + vz * sz;
      w.vLong = vL;
      const surf = world.surfaceAt(w.hit[0], w.hit[2]);
      w.surface = surf.type;
      // mild load sensitivity
      // load sensitivity: a heavily loaded tyre grips proportionally less (gives natural understeer)
      const loadRatio = Fs / w.staticLoad;
      const mu = spec.tireMu * surf.mu * w.grip * clamp(1.14 - 0.14 * loadRatio, 0.72, 1.2);
      const Fmax = mu * Fs;

      // lateral demand first, so traction control can budget the friction circle
      const alpha = Math.atan2(vS, Math.max(Math.abs(vL), 2.5));
      const FyWant = Fmax * pac(alpha);

      // longitudinal
      let Fx = 0;
      let driving = false;
      if (w.driven && this.driveForce !== 0) {
        let Fd = this.driveForce * w.driveShare;
        if (this.tractionControl) {
          const room = Math.sqrt(Math.max(0, (Fmax * 0.95) ** 2 - FyWant * FyWant));
          const cap = Math.max(room, Fmax * 0.15);
          if (Math.abs(Fd) > cap) Fd = Math.sign(Fd) * cap;
        }
        Fx += Fd;
        driving = true;
      }
      if (w.driven && this.engineBrake > 0) Fx -= this.engineBrake * w.driveShare * clamp(vL / 1.5, -1, 1);
      const brakeTotal = this.brkEff * spec.mass * G * 1.2 * spec.brake;
      if (brakeTotal > 0 && loadSum > 0) {
        const share = Math.max(0, w.k * w.comp) * (w.axle === 0 ? 1.12 : 0.88) / loadSum;
        Fx -= brakeTotal * share * clamp(vL / 0.4, -1, 1);
      }
      Fx -= surf.roll * Fs * clamp(vL / 0.5, -1, 1);
      let latFactor = 1;
      w.locked = false;
      if (w.axle === 1 && this.controls.handbrake > 0.5) {
        Fx = -clamp(vL / 0.3, -1, 1) * Fmax * 0.8;
        latFactor = 0.4;
        w.locked = Math.abs(vL) > 0.5;
      }

      let Fy = -FyWant * latFactor;

      // friction circle
      w.spinning = false;
      if (Math.abs(Fx) > Fmax) {
        if (driving && Math.sign(Fx) === Math.sign(this.driveForce)) w.spinning = true;
        Fx = Math.sign(Fx) * Fmax * (w.spinning ? 0.82 : 0.97);
      }
      const latCap = Math.sqrt(Math.max(0, Fmax * Fmax - Fx * Fx));
      if (Fy > latCap) Fy = latCap; else if (Fy < -latCap) Fy = -latCap;

      w.slide = Math.abs(alpha) > 0.14 ? Math.min(1, (Math.abs(vS) - 1.2) / 6) : 0;
      if (w.locked) w.slide = Math.max(w.slide, Math.min(1, Math.abs(vL) / 10));
      if (w.spinning) w.slide = Math.max(w.slide, 0.7);
      if (w.slide < 0) w.slide = 0;

      // ground reaction acts along the contact normal, so a bent chassis can't push itself along
      const Fxw = n0 * Fs + fx * Fx + sx * Fy;
      const Fyw = n1 * Fs + fy * Fx + sy * Fy;
      const Fzw = n2 * Fs + fz * Fx + sz * Fy;
      // lever from hub to contact patch x horizontal tyre force
      {
        const hx = Fxw - n0 * Fs, hy = Fyw - n1 * Fs, hz = Fzw - n2 * Fs;
        const i3 = w.node * 3;
        const lx = w.hit[0] - x[i3], ly = w.hit[1] - x[i3 + 1], lz = w.hit[2] - x[i3 + 2];
        tqx += ly * hz - lz * hy; tqy += lz * hx - lx * hz; tqz += lx * hy - ly * hx;
      }
      let live = 0;
      for (const i of w.attach) if (body.active[i]) live++;
      for (const i of w.attach) {
        if (!body.active[i]) continue;
        const s = body.w[i] / live;
        a[i * 3] += Fxw * s; a[i * 3 + 1] += Fyw * s; a[i * 3 + 2] += Fzw * s;
      }
    }
    this.groundedWheels = grounded;
    if (grounded) this.applyTorque(tqx, tqy, tqz);
  }

  // Apply a pure torque to the soft body: angular acceleration α = I⁻¹τ about the
  // centre of mass, then every node gets a = α × r. Net force is zero and the
  // torque is exact, so roll moments can't leak into yaw on an asymmetric lattice.
  applyTorque(tx, ty, tz) {
    if (Math.abs(tx) + Math.abs(ty) + Math.abs(tz) < 1e-6) return;
    const b = this.body, x = b.x, a = b.a, idx = this.tpl.groups.lattice;
    let cx = 0, cy = 0, cz = 0, M = 0;
    for (const i of idx) { if (!b.active[i]) continue; const m = b.mass[i]; cx += x[i * 3] * m; cy += x[i * 3 + 1] * m; cz += x[i * 3 + 2] * m; M += m; }
    cx /= M; cy /= M; cz /= M;
    let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
    for (const i of idx) {
      if (!b.active[i]) continue;
      const m = b.mass[i];
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      Ixx += m * (ry * ry + rz * rz); Iyy += m * (rx * rx + rz * rz); Izz += m * (rx * rx + ry * ry);
      Ixy -= m * rx * ry; Ixz -= m * rx * rz; Iyz -= m * ry * rz;
    }
    // solve I α = τ (symmetric 3x3) by Cramer's rule
    const c00 = Iyy * Izz - Iyz * Iyz, c01 = Ixz * Iyz - Ixy * Izz, c02 = Ixy * Iyz - Ixz * Iyy;
    const det = Ixx * c00 + Ixy * c01 + Ixz * c02;
    if (Math.abs(det) < 1e-9) return;
    const c11 = Ixx * Izz - Ixz * Ixz, c12 = Ixy * Ixz - Ixx * Iyz, c22 = Ixx * Iyy - Ixy * Ixy;
    const ax = (c00 * tx + c01 * ty + c02 * tz) / det;
    const ay = (c01 * tx + c11 * ty + c12 * tz) / det;
    const az = (c02 * tx + c12 * ty + c22 * tz) / det;
    for (const i of idx) {
      if (!b.active[i]) continue;
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      a[i * 3] += ay * rz - az * ry;
      a[i * 3 + 1] += az * rx - ax * rz;
      a[i * 3 + 2] += ax * ry - ay * rx;
    }
  }

  // ---- called once per frame after physics
  postStep(dt) {
    const body = this.body;
    if (body.hasNaN()) { this.events.push({ type: 'nan' }); return; }
    this.computeFrame();
    // detach wheels whose hub has lost its mounts
    for (const w of this.wheels) {
      if (w.detached) continue;
      let alive = 0;
      for (let k = 0; k < body.nb; k++) if (!body.broken[k] && (body.ba[k] === w.node || body.bb[k] === w.node)) alive++;
      if (alive < 3) {
        w.detached = true;
        body.active[w.node] = 0;
        const i3 = w.node * 3;
        this.events.push({
          type: 'wheelOff', wheel: w,
          pos: [...w.center], vel: [body.v[i3], body.v[i3 + 1], body.v[i3 + 2]],
        });
      }
    }
    // Bent suspension: re-measure toe once the structure settles after a hit. Measuring
    // continuously would turn elastic chassis flex into rear-steer.
    if (body.plasticFrame > 0.02) this.toeTimer = 0.4;
    else if (this.toeTimer > 0) {
      this.toeTimer -= dt;
      if (this.toeTimer <= 0) {
        for (const w of this.wheels) {
          if (w.detached) continue;
          const toe = this.measureToe(w) - w.toeRest;
          w.toe = Math.abs(toe) < 0.012 ? 0 : clamp(toe, -0.3, 0.3) * 0.65;
        }
      }
    }
    this.evaluateDamage();
    this.airborne = this.groundedWheels === 0 ? this.airborne + dt : 0;

    let slide = 0, spin = 0;
    for (const w of this.wheels) { if (w.contact) slide = Math.max(slide, w.slide); if (w.spinning) spin = 1; }
    this.slideAmount = slide;
    this.spinAmount = spin;
    this.updateWheelVisuals(dt);
  }

  evaluateDamage() {
    const b = this.body, dg = this.tpl.damageGroups;
    const sumDef = idx => { let s = 0; for (const k of idx) s += Math.abs(b.rest[k] - b.rest0[k]) + (b.broken[k] ? 0.2 : 0); return s; };
    const maxStrain = idx => { let m = 0; for (const k of idx) { const s = b.broken[k] ? 1 : Math.abs(b.rest[k] - b.rest0[k]) / b.rest0[k]; if (s > m) m = s; } return m; };
    const eng = sumDef(dg.engine);
    const health = clamp(1 - (eng - 1.2) / 10.5, 0, 1);
    if (health < this.engineHealth) this.engineHealth = health;
    if (this.engineHealth <= 0.02) this.killEngine('wrecked');
    const rad = sumDef(dg.radiator);
    if (rad > 0.6) this.radiatorLeak = clamp((rad - 0.6) * 0.004, 0.002, 0.03);
    for (const key of ['windshield', 'rearGlass', 'leftGlass', 'rightGlass']) {
      const hit = maxStrain(dg[key]) > 0.025 || (key === 'windshield' && eng > 8.5);
      if (!this.glass[key] && hit) {
        this.glass[key] = true;
        this.events.push({ type: 'glass', panel: key });
      }
    }
    // repair estimate: parts + labour, in dollars
    let wheelsOff = 0;
    for (const w of this.wheels) if (w.detached) wheelsOff++;
    const glassN = Object.values(this.glass).filter(Boolean).length;
    // net (not cumulative) deformation, so two cars grinding together don't run up the bill
    let net = 0;
    for (let k = 0; k < b.nb; k++) net += b.broken[k] ? 0.15 : Math.abs(b.rest[k] - b.rest0[k]);
    this.netDeform = net;
    this.damageCost = Math.round((net * 1900 + glassN * 450 + wheelsOff * 1400 + (1 - this.engineHealth) * 6500) / 10) * 10;
  }

  updateWheelVisuals(dt) {
    const x = this.body.x, fr = this.frame;
    for (const w of this.wheels) {
      if (w.detached) continue;
      const i3 = w.node * 3;
      const off = w.hub.wheelOffset * w.side;
      const s = w.susp;
      w.center[0] = x[i3] + fr.r[0] * off - fr.u[0] * s;
      w.center[1] = x[i3 + 1] + fr.r[1] * off - fr.u[1] * s;
      w.center[2] = x[i3 + 2] + fr.r[2] * off - fr.u[2] * s;
      const ang = (w.steerable ? this.steerAngle : 0) + w.toe;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let k = 0; k < 3; k++) {
        w.fwd[k] = fr.f[k] * ca + fr.r[k] * sa;
        w.right[k] = fr.r[k] * ca - fr.f[k] * sa;
        w.up[k] = fr.u[k];
      }
      let omega;
      if (w.locked) omega = 0;
      else if (w.spinning) omega = (w.vLong + Math.sign(this.driveForce) * 12) / w.radius;
      else if (w.contact) omega = w.vLong / w.radius;
      else omega = (w.omega || 0) * 0.995;
      w.omega = omega;
      w.spinAngle += omega * dt;
    }
  }

  // crush depth: shortening of the nose-to-tail centre line (metres)
  crushDepth() {
    const x = this.body.x, g = this.tpl.groups, n = this.tpl.nodes;
    const a = g.noseCenter * 3, b = g.tailCenter * 3;
    const len = Math.hypot(x[a] - x[b], x[a + 1] - x[b + 1], x[a + 2] - x[b + 2]);
    const len0 = Math.hypot(n[g.noseCenter].x - n[g.tailCenter].x, n[g.noseCenter].y - n[g.tailCenter].y, 0);
    return Math.max(0, len0 - len);
  }

  // max intrusion of any lattice node relative to its rest position in the car frame
  maxDeformation() {
    const b = this.body, n = this.tpl.nodes, fr = this.frame;
    // compare distances between nodes and centre instead of absolute positions
    let worst = 0;
    const c = fr.c;
    const lc = this.tpl.restCom || (this.tpl.restCom = restCom(this.tpl));
    for (const i of this.tpl.groups.lattice) {
      const dx = b.x[i * 3] - c[0], dy = b.x[i * 3 + 1] - c[1], dz = b.x[i * 3 + 2] - c[2];
      const lx = dx * fr.f[0] + dy * fr.f[1] + dz * fr.f[2];
      const ly = dx * fr.u[0] + dy * fr.u[1] + dz * fr.u[2];
      const lz = dx * fr.r[0] + dy * fr.r[1] + dz * fr.r[2];
      const e = Math.hypot(lx - (n[i].x - lc[0]), ly - (n[i].y - lc[1]), lz - (n[i].z - lc[2]));
      if (e > worst) worst = e;
    }
    return worst;
  }

  // passenger-cell intrusion: how far cabin nodes moved relative to the cabin itself
  cabinIntrusion() {
    const g = this.spec.greenhouse, n = this.tpl.nodes, b = this.body, fr = this.frame;
    const ids = this.tpl.cabinIds || (this.tpl.cabinIds = this.tpl.groups.lattice.filter(i => n[i].x <= g.aBase + 0.05 && n[i].x >= g.cBase - 0.05));
    let c = [0, 0, 0], c0 = [0, 0, 0];
    for (const i of ids) { for (let k = 0; k < 3; k++) c[k] += b.x[i * 3 + k]; c0[0] += n[i].x; c0[1] += n[i].y; c0[2] += n[i].z; }
    for (let k = 0; k < 3; k++) { c[k] /= ids.length; c0[k] /= ids.length; }
    let worst = 0;
    for (const i of ids) {
      const dx = b.x[i * 3] - c[0], dy = b.x[i * 3 + 1] - c[1], dz = b.x[i * 3 + 2] - c[2];
      const lx = dx * fr.f[0] + dy * fr.f[1] + dz * fr.f[2];
      const ly = dx * fr.u[0] + dy * fr.u[1] + dz * fr.u[2];
      const lz = dx * fr.r[0] + dy * fr.r[1] + dz * fr.r[2];
      const e = Math.hypot(lx - (n[i].x - c0[0]), ly - (n[i].y - c0[1]), lz - (n[i].z - c0[2]));
      if (e > worst) worst = e;
    }
    return worst;
  }

  isUpsideDown() { return this.frame.u[1] < -0.2; }
}

function restCom(tpl) {
  let sx = 0, sy = 0, sz = 0, m = 0;
  for (const n of tpl.nodes) { sx += n.x * n.mass; sy += n.y * n.mass; sz += n.z * n.mass; m += n.mass; }
  return [sx / m, sy / m, sz / m];
}
