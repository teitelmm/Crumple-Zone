// Ring-buffer recorder of node positions, wheel poses and car frames for instant replay.

const WHEEL_F = 12; // center3 fwd3 up3 spin detached, pad
const FRAME_F = 12; // c f u r

export class Recorder {
  constructor(seconds = 12, fps = 60) {
    this.max = Math.round(seconds * fps);
    this.tracks = new Map();
    this.count = 0;
    this.head = 0;
  }

  reset() { this.tracks.clear(); this.count = 0; this.head = 0; }

  record(vehicles) {
    for (const v of vehicles) {
      let t = this.tracks.get(v);
      if (!t) {
        t = { nodes: new Float32Array(v.body.n * 3 * this.max), wheels: new Float32Array(4 * WHEEL_F * this.max), frames: new Float32Array(FRAME_F * this.max), extra: new Float32Array(2 * this.max), born: this.count };
        this.tracks.set(v, t);
      }
      const n3 = v.body.n * 3;
      t.nodes.set(v.body.x, this.head * n3);
      const wo = this.head * 4 * WHEEL_F;
      v.wheels.forEach((w, i) => {
        const o = wo + i * WHEEL_F;
        t.wheels.set(w.center, o); t.wheels.set(w.fwd, o + 3); t.wheels.set(w.up, o + 6);
        t.wheels[o + 9] = w.spinAngle; t.wheels[o + 10] = w.detached ? 1 : 0;
      });
      const fo = this.head * FRAME_F, fr = v.frame;
      t.frames.set(fr.c, fo); t.frames.set(fr.f, fo + 3); t.frames.set(fr.u, fo + 6); t.frames.set(fr.r, fo + 9);
      t.extra[this.head * 2] = v.speed;
      t.extra[this.head * 2 + 1] = v.brkEff;
    }
    this.head = (this.head + 1) % this.max;
    this.count = Math.min(this.count + 1, this.max);
  }

  // i = 0 .. count-1 (oldest .. newest)
  slot(i) { return (this.head - this.count + i + this.max * 2) % this.max; }

  sample(v, fi, out) {
    const t = this.tracks.get(v);
    if (!t) return null;
    const i0 = Math.floor(fi), i1 = Math.min(this.count - 1, i0 + 1), a = fi - i0;
    const s0 = this.slot(i0), s1 = this.slot(i1);
    const n3 = v.body.n * 3;
    const pos = out.pos || (out.pos = new Float64Array(n3));
    for (let k = 0; k < n3; k++) pos[k] = t.nodes[s0 * n3 + k] * (1 - a) + t.nodes[s1 * n3 + k] * a;
    const wheels = out.wheels || (out.wheels = [0, 1, 2, 3].map(() => ({ center: [0, 0, 0], fwd: [1, 0, 0], up: [0, 1, 0], spin: 0, detached: false })));
    for (let i = 0; i < 4; i++) {
      const o0 = s0 * 4 * WHEEL_F + i * WHEEL_F, o1 = s1 * 4 * WHEEL_F + i * WHEEL_F;
      const w = wheels[i];
      for (let k = 0; k < 3; k++) {
        w.center[k] = t.wheels[o0 + k] * (1 - a) + t.wheels[o1 + k] * a;
        w.fwd[k] = t.wheels[o0 + 3 + k] * (1 - a) + t.wheels[o1 + 3 + k] * a;
        w.up[k] = t.wheels[o0 + 6 + k] * (1 - a) + t.wheels[o1 + 6 + k] * a;
      }
      w.spin = t.wheels[o0 + 9] * (1 - a) + t.wheels[o1 + 9] * a;
      w.detached = t.wheels[o0 + 10] > 0.5;
    }
    const frame = out.frame || (out.frame = { c: [0, 0, 0], f: [0, 0, 0], u: [0, 0, 0], r: [0, 0, 0] });
    const f0 = s0 * FRAME_F, f1 = s1 * FRAME_F;
    for (let k = 0; k < 3; k++) {
      frame.c[k] = t.frames[f0 + k] * (1 - a) + t.frames[f1 + k] * a;
      frame.f[k] = t.frames[f0 + 3 + k] * (1 - a) + t.frames[f1 + 3 + k] * a;
      frame.u[k] = t.frames[f0 + 6 + k] * (1 - a) + t.frames[f1 + 6 + k] * a;
      frame.r[k] = t.frames[f0 + 9 + k] * (1 - a) + t.frames[f1 + 9 + k] * a;
    }
    out.speed = t.extra[s0 * 2];
    out.brake = t.extra[s0 * 2 + 1];
    return out;
  }
}
