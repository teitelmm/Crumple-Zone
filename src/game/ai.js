// AI drivers: racing line follower, derby rammer, and the crash-test cruise control.
import { trackProgress } from '../world/map.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function steerToward(v, tx, tz) {
  const f = v.frame.f, r = v.frame.r, c = v.frame.c;
  const dx = tx - c[0], dz = tz - c[2];
  const fwd = dx * f[0] + dz * f[2];
  const right = dx * r[0] + dz * r[2];
  const alpha = Math.atan2(right, fwd);
  const ld = Math.max(1, Math.hypot(dx, dz));
  const L = v.spec.dims.wheelbase;
  const delta = Math.atan2(2 * L * Math.sin(alpha), ld);
  const lock = v.spec.steerLock * Math.PI / 180;
  const sf = Math.max(0.12, 1 / Math.sqrt(1 + Math.pow(v.speed / 11, 2)));
  return { steer: clamp(delta / (lock * sf), -1, 1), alpha, dist: ld };
}

class StuckWatch {
  constructor() { this.t = 0; this.rev = 0; }
  update(dt, v, wantsToMove) {
    if (this.rev > 0) { this.rev -= dt; return true; }
    if (wantsToMove && v.speed < 1.2 && !v.engineDead) this.t += dt; else this.t = Math.max(0, this.t - dt * 2);
    if (this.t > 2.2) { this.t = 0; this.rev = 1.6; return true; }
    return false;
  }
}

export class RaceDriver {
  constructor(vehicle, track, skill = 1) {
    this.v = vehicle;
    this.track = track;
    this.skill = skill;
    this.idx = -1;
    this.offset = (Math.random() - 0.5) * 3;
    this.stuck = new StuckWatch();
    this.enabled = true;
  }

  update(dt) {
    const v = this.v, c = v.controls;
    if (!this.enabled) { c.throttle = 0; c.brake = 1; c.steer = 0; c.handbrake = 0; c.hold = 1; return; }
    c.hold = 0;
    const pts = this.track.pts, N = pts.length;
    const prog = trackProgress(this.track, v.frame.c[0], v.frame.c[2], this.idx);
    this.idx = prog.index;
    const look = 7 + v.speed * 0.55;
    const ahead = pts[(this.idx + Math.round(look / 2)) % N];
    const off = prog.dist > 20 ? 0 : this.offset;
    const tx = ahead.x - ahead.tz * off, tz = ahead.z + ahead.tx * off;
    const s = steerToward(v, tx, tz);
    let vt = Infinity;
    for (let k = 2; k < 8; k++) vt = Math.min(vt, pts[(this.idx + k) % N].vmax);
    vt *= this.skill;
    if (prog.dist > 12) vt = Math.min(vt, 18);
    const rev = this.stuck.update(dt, v, true);
    if (rev) {
      c.throttle = 0; c.brake = 1; c.steer = -s.steer; c.handbrake = 0;
      return;
    }
    const sp = v.speedFwd;
    if (sp < vt - 1) { c.throttle = clamp((vt - sp) / 4, 0.35, 1); c.brake = 0; }
    else if (sp > vt + 1.5) { c.throttle = 0; c.brake = clamp((sp - vt) / 6, 0.25, 1); }
    else { c.throttle = 0.35; c.brake = 0; }
    // smooth on the throttle mid-corner, lift if sliding
    c.throttle *= 1 - 0.55 * Math.min(1, Math.abs(s.steer));
    if (v.slideAmount > 0.5) c.throttle *= 0.4;
    c.steer = s.steer;
    c.handbrake = 0;
  }
}

export class DerbyDriver {
  constructor(vehicle, arena, getCars) {
    this.v = vehicle;
    this.arena = arena;
    this.getCars = getCars;
    this.target = null;
    this.retarget = 0;
    this.stuck = new StuckWatch();
    this.aggression = 0.75 + Math.random() * 0.25;
    this.delay = 0.5 + Math.random();
  }

  update(dt) {
    const v = this.v, c = v.controls;
    if (v.engineDead || v.out) { c.throttle = 0; c.brake = 0; c.steer = 0; return; }
    if (this.delay > 0) { this.delay -= dt; c.throttle = 0; c.brake = 1; c.hold = 1; return; }
    c.hold = 0;
    this.retarget -= dt;
    const cars = this.getCars().filter(o => o !== v && !o.out);
    if (!cars.length) { c.throttle = 0; c.brake = 1; c.steer = 0; return; }
    if (!this.target || this.target.out || this.retarget <= 0) {
      const me = v.frame.c;
      cars.sort((a, b) => dist2(a.frame.c, me) - dist2(b.frame.c, me));
      this.target = Math.random() < 0.7 ? cars[0] : cars[Math.floor(Math.random() * cars.length)];
      this.retarget = 4 + Math.random() * 4;
    }
    const t = this.target;
    const d = Math.sqrt(dist2(t.frame.c, v.frame.c));
    const lead = Math.min(1.2, d / Math.max(4, v.speed));
    let tx = t.frame.c[0] + t.vel[0] * lead, tz = t.frame.c[2] + t.vel[2] * lead;
    // stay off the wall
    const ax = v.frame.c[0] - this.arena.x, az = v.frame.c[2] - this.arena.z;
    const rr = Math.hypot(ax, az);
    const outward = (ax * v.frame.f[0] + az * v.frame.f[2]) / Math.max(1, rr);
    if (rr > this.arena.r - 9 && outward > 0.3) { tx = this.arena.x; tz = this.arena.z; }
    const s = steerToward(v, tx, tz);
    const rev = this.stuck.update(dt, v, true);
    if (rev || (Math.abs(s.alpha) > 2.3 && d < 14)) {
      c.throttle = 0; c.brake = 1; c.steer = -s.steer; c.handbrake = 0;
      return;
    }
    c.steer = s.steer;
    c.throttle = Math.abs(s.alpha) > 1.2 ? 0.55 : this.aggression;
    c.brake = 0;
    c.handbrake = Math.abs(s.alpha) > 1.4 && v.speed > 8 ? 1 : 0;
  }
}

export class CruiseDriver {
  constructor(vehicle, speed, heading) {
    this.v = vehicle;
    this.speed = speed;
    this.heading = heading;
    this.active = true;
  }
  update() {
    const v = this.v, c = v.controls;
    if (!this.active) { c.throttle = 0; c.brake = 0; c.steer = 0; return; }
    const err = v.speedFwd - this.speed;
    c.throttle = clamp(-err * 0.8 + 0.25, 0, 1);
    c.brake = err > 1.5 ? 0.3 : 0;
    const h = Math.atan2(v.frame.f[2], v.frame.f[0]);
    let dh = h - this.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    c.steer = clamp(-dh * 6, -0.4, 0.4);
    c.handbrake = 0;
  }
}

function dist2(a, b) { return (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2; }
