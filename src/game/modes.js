// Game modes: Free Roam, Race, Demolition Derby, Crash Test Lab.
import { RaceDriver, DerbyDriver, CruiseDriver } from './ai.js';
import { trackProgress } from '../world/map.js';
import { BoxCollider, CylinderCollider } from '../physics/colliders.js';
import { CARS, CAR_ORDER, ALT_COLORS } from '../vehicle/specs.js';

const fmtTime = (t) => {
  if (t == null || !isFinite(t)) return '–:––.–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

function pickOpponents(n, playerCar) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = CAR_ORDER[(CAR_ORDER.indexOf(playerCar) + 1 + i) % CAR_ORDER.length];
    const color = i < CAR_ORDER.length - 1 ? CARS[id].color : ALT_COLORS[i % ALT_COLORS.length];
    out.push({ id, color: i % 2 === 1 ? ALT_COLORS[(i * 3) % ALT_COLORS.length] : color });
  }
  return out;
}

const AI_NAMES = ['R. Okafor', 'M. Lindqvist', 'J. Tanaka', 'S. Brennan', 'A. Moreau', 'D. Kowalski', 'L. Haddad'];

// ---------------------------------------------------------------- Free roam
export class FreeRoam {
  constructor(game, opts) { this.game = game; this.opts = opts; this.name = 'Free Roam'; }
  setup() {
    const g = this.game, s = g.world.spawns.free;
    this.player = g.spawnCar(this.opts.car, { isPlayer: true, ...s });
    g.ui.banner('Free Roam', 'Ramps, poles and a concrete wall are in the infield. The circuit runs around it.', 3.5);
  }
  update() {}
  info() {
    const p = this.player.vehicle;
    const raw = p.wheels.find(w => w.contact)?.surface || (p.airborne > 0.3 ? 'airborne' : '—');
    const surf = raw.charAt(0).toUpperCase() + raw.slice(1);
    return [
      ['Surface', surf],
      ['Airtime', p.airborne > 0.25 ? p.airborne.toFixed(1) + ' s' : '—'],
      ['Peak g', p.peakG.toFixed(1)],
    ];
  }
  onReset() { return 'repair'; }
  teleports() {
    const w = this.game.world;
    return [
      ['Proving ground', w.spawns.free],
      ['Circuit start', w.spawns.grid[1]],
      ['Derby bowl', { x: w.zones.derby.x, z: w.zones.derby.z - w.zones.derby.r + 6, heading: Math.PI / 2 }],
      ['Crash strip', w.spawns.lab],
    ];
  }
}

// ---------------------------------------------------------------- Race
export class Race {
  constructor(game, opts) { this.game = game; this.opts = opts; this.name = 'Race'; }
  setup() {
    const g = this.game, track = g.world.track;
    this.laps = this.opts.laps;
    this.entries = [];
    const opp = pickOpponents(this.opts.opponents, this.opts.car);
    const grid = g.world.spawns.grid;
    opp.forEach((o, i) => {
      const e = g.spawnCar(o.id, { color: o.color, name: AI_NAMES[i], ...grid[i] });
      e.driver = new RaceDriver(e.vehicle, track, 0.84 + Math.random() * 0.1 + i * 0.015);
      e.driver.enabled = false;
      this.entries.push(e);
    });
    this.player = g.spawnCar(this.opts.car, { isPlayer: true, name: 'You', ...grid[opp.length] });
    this.entries.push(this.player);
    for (const e of this.entries) {
      e.race = { crossings: 0, idx: -1, midSeen: true, lapStart: null, best: null, last: null, finished: null };
    }
    this.countdown = 3.5;
    this.lastBeep = 4;
    this.time = 0;
    this.finished = false;
    g.input.enabled = false;
  }

  update(dt) {
    const g = this.game, track = g.world.track, N = track.pts.length;
    if (this.countdown > 0) {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastBeep && n <= 3 && n >= 1) { this.lastBeep = n; g.audio.beep(520, 0.18); g.ui.banner(String(n), '', 0.9); }
      for (const e of this.entries) { e.vehicle.controls.brake = 1; e.vehicle.controls.throttle = 0; e.vehicle.controls.hold = 1; }
      if (this.countdown <= 0) {
        g.audio.beep(880, 0.4, 0.16);
        g.ui.banner('GO', '', 0.8);
        g.input.enabled = true;
        for (const e of this.entries) { e.vehicle.controls.hold = 0; if (e.driver) e.driver.enabled = true; }
      }
      return;
    }
    this.time += dt;
    for (const e of this.entries) {
      const r = e.race, v = e.vehicle;
      const prog = trackProgress(track, v.frame.c[0], v.frame.c[2], r.idx);
      const prev = r.idx;
      r.idx = prog.index;
      r.offTrack = prog.dist;
      if (prev >= 0 && !r.finished) {
        if (prev > N * 0.85 && r.idx < N * 0.15) {
          if (r.midSeen || r.crossings === 0) {
            r.crossings++;
            r.midSeen = false;
            if (r.lapStart != null) {
              r.last = this.time - r.lapStart;
              if (!r.best || r.last < r.best) r.best = r.last;
              if (e === this.player && r.crossings <= this.laps + 1) g.ui.toast(`Lap ${r.crossings - 1}: ${fmtTime(r.last)}${r.best === r.last ? ' · best' : ''}`);
            }
            r.lapStart = this.time;
            if (r.crossings > this.laps && !r.finished) {
              r.finished = this.time;
              if (e.driver) e.driver.skill = 0.5; // cool-down lap instead of parking on the line
            }
          }
        } else if (prev < N * 0.15 && r.idx > N * 0.85 && r.crossings > 0) {
          r.crossings--;
          r.midSeen = true;
        }
        if (r.idx > N * 0.45 && r.idx < N * 0.55) r.midSeen = true;
      }
    }
    if (this.player.race.finished && !this.finished) {
      this.finished = true;
      g.input.enabled = false;
      this.player.driver = new RaceDriver(this.player.vehicle, track, 0.55);
      const pos = this.standings().indexOf(this.player) + 1;
      g.ui.banner(`${ordinal(pos)} place`, `Race time ${fmtTime(this.player.race.finished - 0)}`, 3);
      setTimeout(() => g.showResults(this.resultsCard()), 2500);
    }
  }

  standings() {
    const N = this.game.world.track.pts.length;
    const score = e => e.race.finished ? 1e9 - e.race.finished : e.race.crossings * N + e.race.idx;
    return [...this.entries].sort((a, b) => score(b) - score(a));
  }

  info() {
    const r = this.player.race;
    const st = this.standings();
    const pos = st.indexOf(this.player) + 1;
    const lapNow = Math.max(1, Math.min(this.laps, r.crossings));
    return [
      ['Position', `${pos}/${this.entries.length}`],
      ['Lap', `${lapNow}/${this.laps}`],
      ['Lap time', r.lapStart != null && !r.finished ? fmtTime(this.time - r.lapStart) : '—'],
      ['Best', fmtTime(r.best)],
    ];
  }

  resultsCard() {
    const rows = this.standings().map((e, i) => [ordinal(i + 1), e.name, e.vehicle.spec.name, e.race.finished ? fmtTime(e.race.finished) : 'DNF', fmtTime(e.race.best)]);
    return { title: 'Race results', head: ['', 'Driver', 'Car', 'Time', 'Best lap'], rows, highlight: this.standings().indexOf(this.player) };
  }

  onReset(e) {
    // put the car back on the racing line at its current progress
    const track = this.game.world.track, N = track.pts.length;
    const p = track.pts[(Math.max(0, e.race.idx) + 2) % N];
    return { x: p.x, z: p.z, heading: p.heading, repair: true };
  }
}

// ---------------------------------------------------------------- Derby
export class Derby {
  constructor(game, opts) { this.game = game; this.opts = opts; this.name = 'Demolition Derby'; }
  setup() {
    const g = this.game, spots = g.world.spawns.derby, arena = g.world.zones.derby;
    this.entries = [];
    const n = this.opts.opponents;
    const opp = pickOpponents(n, this.opts.car);
    const step = spots.length / (n + 1);
    this.player = g.spawnCar(this.opts.car, { isPlayer: true, name: 'You', ...spots[0] });
    this.entries.push(this.player);
    opp.forEach((o, i) => {
      const e = g.spawnCar(o.id, { color: o.color, name: AI_NAMES[i], ...spots[Math.round((i + 1) * step) % spots.length] });
      e.driver = new DerbyDriver(e.vehicle, arena, () => this.entries.map(x => x.vehicle));
      this.entries.push(e);
    });
    for (const e of this.entries) { e.vehicle.out = false; e.idle = 0; e.flip = 0; }
    this.time = 0;
    this.over = false;
    g.ui.banner('Demolition Derby', 'Last car running wins. Ram them before they ram you.', 3);
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    for (const e of this.entries) {
      const v = e.vehicle;
      if (v.out) continue;
      e.idle = v.speed < 0.6 ? e.idle + dt : 0;
      e.flip = v.isUpsideDown() || v.frame.u[1] < 0.35 ? e.flip + dt : 0;
      let reason = null;
      if (v.engineDead) reason = 'engine destroyed';
      else if (e.flip > 6) reason = 'rolled over';
      else if (e.idle > 14 && e !== this.player) reason = 'stuck';
      else if (v.wheels.filter(w => w.detached).length >= 2) reason = 'lost two wheels';
      if (reason) {
        v.out = true;
        v.killEngine('out');
        g.ui.toast(`${e.name} is out: ${reason}`);
      }
    }
    const alive = this.entries.filter(e => !e.vehicle.out);
    if (!this.over && (alive.length <= 1 || this.player.vehicle.out)) {
      this.over = true;
      const won = alive.length === 1 && alive[0] === this.player;
      g.ui.banner(won ? 'You win' : 'Wrecked', won ? `Last car running after ${this.time.toFixed(0)} s` : `${alive.length} car${alive.length === 1 ? '' : 's'} still running`, 3);
      setTimeout(() => g.showResults(this.resultsCard(won)), 2600);
    }
  }

  info() {
    const alive = this.entries.filter(e => !e.vehicle.out).length;
    const p = this.player.vehicle;
    return [
      ['Cars running', `${alive}/${this.entries.length}`],
      ['Time', `${this.time.toFixed(0)} s`],
      ['Your damage', `$${p.damageCost.toLocaleString()}`],
    ];
  }

  resultsCard(won) {
    const rows = [...this.entries]
      .sort((a, b) => (a.vehicle.out - b.vehicle.out) || (a.vehicle.damageCost - b.vehicle.damageCost))
      .map(e => [e.vehicle.out ? 'Out' : 'Running', e.name, e.vehicle.spec.name, `$${e.vehicle.damageCost.toLocaleString()}`]);
    return { title: won ? 'Derby won' : 'Derby over', head: ['Status', 'Driver', 'Car', 'Repair bill'], rows, highlight: rows.findIndex(r => r[1] === 'You') };
  }

  onReset() { return 'upright'; }
}

// ---------------------------------------------------------------- Crash test lab
export const OBSTACLES = {
  wall: 'Rigid wall (full width)',
  offset: 'Offset barrier (40%)',
  pole: 'Pole (side-on)',
  headon: 'Head-on vs another car',
  tbone: 'T-bone into a parked car',
};

export class CrashLab {
  constructor(game, opts) { this.game = game; this.opts = opts; this.name = 'Crash Test Lab'; }
  setup() {
    const g = this.game, lab = g.world.zones.lab;
    const speed = this.opts.speed / 3.6;
    const x0 = lab.x + 40, z0 = lab.z;
    this.x0 = x0;
    this.colliders = [];
    this.entries = [];
    const startX = x0 - 26;
    const ob = this.opts.obstacle;
    let heading = 0, sz = z0;
    if (ob === 'pole') { heading = 0; sz = z0; }
    this.player = g.spawnCar(this.opts.car, { isPlayer: true, x: startX, z: sz, heading, speed });
    this.player.driver = new CruiseDriver(this.player.vehicle, speed, heading);
    this.entries.push(this.player);
    const pw = this.player.vehicle.spec.dims.width;
    if (ob === 'wall') {
      this.addCollider(new BoxCollider({ x: x0 + 1.5, y: 1.5, z: z0, hx: 1.5, hy: 1.5, hz: 4, tag: 'obstacle', mu: 0.6 }));
    } else if (ob === 'offset') {
      // barrier overlaps 40% of the car's width on the driver's (left) side
      const hz = 2.5;
      const edge = z0 - pw / 2 + pw * 0.4;
      this.addCollider(new BoxCollider({ x: x0 + 1.5, y: 1.0, z: edge - hz, hx: 1.5, hy: 1.0, hz, tag: 'obstacle', mu: 0.6 }));
    } else if (ob === 'pole') {
      this.addCollider(new CylinderCollider({ x: x0 + 0.5, z: z0 + 0.25, radius: 0.16, y1: 6, tag: 'pole' }));
    } else if (ob === 'headon') {
      const e = this.game.spawnCar(this.opts.target, { x: x0 + 26, z: z0 + 0.3, heading: Math.PI, speed, name: 'Target', color: this.opts.target === this.opts.car ? '#c9ccd1' : undefined });
      e.driver = new CruiseDriver(e.vehicle, speed, Math.PI);
      this.entries.push(e);
      this.target = e;
    } else if (ob === 'tbone') {
      const e = this.game.spawnCar(this.opts.target, { x: x0 + 2.5, z: z0, heading: Math.PI / 2, speed: 0, name: 'Target', color: this.opts.target === this.opts.car ? '#c9ccd1' : undefined });
      this.entries.push(e);
      this.target = e;
    }
    this.time = 0;
    this.impact = null;
    this.done = false;
    this.player.vehicle.peakG = 0;
    g.input.enabled = false;
    g.ui.banner('Crash test', `${Math.round(this.opts.speed)} km/h · ${OBSTACLES[ob]}`, 1.6);
  }

  addCollider(c) { this.colliders.push(c); this.game.addCollider(c); }

  teardown() { for (const c of this.colliders) this.game.removeCollider(c); this.colliders = []; }

  update(dt) {
    const g = this.game, v = this.player.vehicle;
    this.time += dt;
    if (!this.impact) {
      v.peakG = 0;
      if (this.target) this.target.vehicle.peakG = 0;
      const hit = v.body.plasticFrame > 0.004 || v.body.contactFrame > 0.02 || (this.target && this.target.vehicle.body.plasticFrame > 0.004);
      if (hit) {
        this.impact = { time: this.time, speed: this.lastSpeed ?? v.speed, frame: g.recorder.count };
        this.player.driver.active = false;
        if (this.target?.driver) this.target.driver.active = false;
      }
      this.lastSpeed = v.speed;
      if (this.time > 12) { this.impact = { time: this.time, speed: v.speed, frame: g.recorder.count }; }
    } else if (!this.done && this.time - this.impact.time > 2.2) {
      this.done = true;
      const startFrame = Math.max(0, g.recorder.count - Math.round((this.time - this.impact.time + 0.8) * 60));
      g.startReplay({ from: startFrame, speed: 0.25, cinematic: true, then: () => g.showResults(this.resultsCard()) });
    }
  }

  info() {
    const v = this.player.vehicle;
    return [
      ['Test speed', `${Math.round(this.opts.speed)} km/h`],
      ['Peak g', this.impact ? v.peakG.toFixed(1) : '—'],
      ['Crush', this.impact ? `${Math.round(v.crushDepth() * 100)} cm` : '—'],
    ];
  }

  resultsCard() {
    const v = this.player.vehicle;
    const crush = v.crushDepth(), intr = v.cabinIntrusion();
    const glass = Object.entries(v.glass).filter(([, b]) => b).length;
    const rating = intr < 0.06 ? 'Good' : intr < 0.12 ? 'Acceptable' : intr < 0.2 ? 'Marginal' : 'Poor';
    const rows = [
      ['Impact speed', `${(this.impact.speed * 3.6).toFixed(0)} km/h · ${(this.impact.speed * 2.237).toFixed(0)} mph`],
      ['Peak deceleration', `${v.peakG.toFixed(1)} g`],
      ['Front-to-rear crush', `${Math.round(crush * 100)} cm`],
      ['Cabin intrusion', `${Math.round(intr * 100)} cm`],
      ['Engine', v.engineDead ? 'Destroyed' : `${Math.round(v.engineHealth * 100)}%`],
      ['Glass panels broken', String(glass)],
      ['Wheels torn off', String(v.wheels.filter(w => w.detached).length)],
      ['Repair estimate', `$${v.damageCost.toLocaleString()}`],
      ['Safety cage rating', rating],
    ];
    if (this.target) rows.push(['Other car repair', `$${this.target.vehicle.damageCost.toLocaleString()}`]);
    return { title: `${v.spec.name} · ${OBSTACLES[this.opts.obstacle]}`, head: ['Measurement', 'Result'], rows, lab: true };
  }

  onReset() { return null; }
}

export const MODES = { free: FreeRoam, race: Race, derby: Derby, lab: CrashLab };
