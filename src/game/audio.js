// Synthesised audio: engine, turbo, tyres, wind, crashes. No sample files.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.lastCrash = 0;
  }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    // noise buffer shared by tyres, wind and crashes
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // engine: two detuned saws + sub square through a shaper and resonant low-pass
    const eng = this.eng = {};
    eng.o1 = ctx.createOscillator(); eng.o1.type = 'sawtooth';
    eng.o2 = ctx.createOscillator(); eng.o2.type = 'sawtooth';
    eng.o3 = ctx.createOscillator(); eng.o3.type = 'square';
    eng.g1 = ctx.createGain(); eng.g1.gain.value = 0.5;
    eng.g2 = ctx.createGain(); eng.g2.gain.value = 0.3;
    eng.g3 = ctx.createGain(); eng.g3.gain.value = 0.35;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    eng.filter = ctx.createBiquadFilter(); eng.filter.type = 'lowpass'; eng.filter.Q.value = 3;
    eng.out = ctx.createGain(); eng.out.gain.value = 0;
    eng.o1.connect(eng.g1).connect(shaper);
    eng.o2.connect(eng.g2).connect(shaper);
    eng.o3.connect(eng.g3).connect(shaper);
    shaper.connect(eng.filter).connect(eng.out).connect(master);
    eng.o1.start(); eng.o2.start(); eng.o3.start();

    // turbo whistle
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine';
    this.turboGain = ctx.createGain(); this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(master);
    this.turbo.start();

    this.tyre = this.noiseLoop('bandpass', 1100, 6);
    this.wind = this.noiseLoop('lowpass', 500, 0.5);
    this.scrape = this.noiseLoop('bandpass', 3200, 2);
    this.prevBoost = 0;
  }

  noiseLoop(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { src, f, g };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // per-frame update from the player's car
  update(car, timeScale = 1, paused = false) {
    if (!this.ctx || !car) return;
    const t = this.ctx.currentTime;
    const e = car.spec.engine;
    const rpm = paused ? 0 : car.rpmShown;
    const fire = rpm / 60 * (e.cylinders / 2) * Math.max(0.35, timeScale);
    const on = !paused && !car.engineDead;
    const eng = this.eng;
    eng.o1.frequency.setTargetAtTime(Math.max(20, fire), t, 0.02);
    eng.o2.frequency.setTargetAtTime(Math.max(20, fire * 2.01), t, 0.02);
    eng.o3.frequency.setTargetAtTime(Math.max(10, fire * 0.5), t, 0.02);
    const load = car.thrEff;
    eng.filter.frequency.setTargetAtTime(300 + load * 1800 + rpm * 0.35, t, 0.03);
    const lim = car.limiterCut ? 0.4 : 1;
    eng.out.gain.setTargetAtTime(on ? (0.1 + load * 0.16) * lim : 0, t, 0.05);

    if (car.spec.engine.turbo && on) {
      this.turbo.frequency.setTargetAtTime(2500 + car.boost * 4500, t, 0.05);
      this.turboGain.gain.setTargetAtTime(car.boost * car.boost * 0.025, t, 0.05);
      if (this.prevBoost > 0.6 && car.thrEff < 0.1) this.blowOff(this.prevBoost);
      this.prevBoost = car.thrEff < 0.1 ? 0 : car.boost;
    } else this.turboGain.gain.setTargetAtTime(0, t, 0.05);

    const slide = paused ? 0 : car.slideAmount;
    const onTarmac = car.wheels.some(w => w.contact && (w.surface === 'asphalt' || w.surface === 'concrete' || w.surface === 'kerb'));
    this.tyre.g.gain.setTargetAtTime(onTarmac ? slide * 0.22 : slide * 0.06, t, 0.05);
    this.tyre.f.frequency.setTargetAtTime(900 + car.speed * 8, t, 0.1);
    const sp = paused ? 0 : car.speed;
    this.wind.g.gain.setTargetAtTime(Math.min(0.25, sp * sp * 0.00006), t, 0.1);
    const scraping = paused ? 0 : Math.min(1, car.body.scrapes.length / 8);
    this.scrape.g.gain.setTargetAtTime(scraping * 0.18, t, 0.04);
  }

  blowOff(amount) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.12 * amount, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + 0.4);
  }

  // intensity ~ metres of deformation this frame
  crash(intensity) {
    if (!this.ctx || intensity < 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastCrash < 0.05) return;
    this.lastCrash = t;
    const amp = Math.min(1, intensity * 1.6);
    // thud
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600 + amp * 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + amp * 0.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5); src.stop(t + 1);
    // metal ring
    for (let k = 0; k < 3; k++) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = 180 + Math.random() * 900;
      const og = ctx.createGain();
      og.gain.setValueAtTime(amp * 0.07, t);
      og.gain.exponentialRampToValueAtTime(0.0005, t + 0.3 + Math.random() * 0.5);
      o.connect(og).connect(this.master);
      o.start(t); o.stop(t + 1);
    }
  }

  glass() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + 0.7);
  }

  horn(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = o2.type = 'square';
    o1.frequency.value = 415; o2.frequency.value = 494;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.02);
    g.gain.setValueAtTime(0.08, t + 0.45);
    g.gain.linearRampToValueAtTime(0, t + 0.5);
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(this.master);
    o1.start(t); o2.start(t); o1.stop(t + 0.55); o2.stop(t + 0.55);
  }

  beep(freq = 660, dur = 0.15, vol = 0.12) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.eng.out.gain.setTargetAtTime(0, t, 0.05);
    this.turboGain.gain.setTargetAtTime(0, t, 0.05);
    for (const n of [this.tyre, this.wind, this.scrape]) n.g.gain.setTargetAtTime(0, t, 0.05);
  }
}
