// Keyboard, gamepad and on-screen touch controls merged into one control state.

const KEYMAP = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
};
const ACTIONS = {
  KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyP: 'pause', KeyT: 'slowmo', KeyV: 'replay', KeyM: 'mute', KeyH: 'horn',
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, hb: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.listeners = {};
    this.digitalSteer = 0;
    this.padPrev = [];
    this.enabled = true;
    this.lastDevice = 'keyboard';

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (Object.values(KEYMAP).flat().includes(e.code) || ACTIONS[e.code]) e.preventDefault();
      if (!e.repeat && ACTIONS[e.code]) this.emit(ACTIONS[e.code]);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(action, cb) { (this.listeners[action] ||= []).push(cb); }
  emit(action) { if (!this.enabled && action !== 'pause') return; (this.listeners[action] || []).forEach(cb => cb()); }

  bindTouch(root) {
    const holds = root.querySelectorAll('[data-hold]');
    holds.forEach(el => {
      const key = el.dataset.hold;
      const pointers = new Set();
      const set = () => { this.touch[key] = pointers.size > 0; el.classList.toggle('on', pointers.size > 0); };
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); pointers.add(e.pointerId); this.lastDevice = 'touch'; set(); });
      const up = (e) => { pointers.delete(e.pointerId); set(); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', e => e.preventDefault());
    });
    root.querySelectorAll('[data-tap]').forEach(el => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.emit(el.dataset.tap); });
    });
  }

  key(name) { return KEYMAP[name].some(k => this.keys.has(k)); }

  update(dt) {
    const s = this.state;
    let thr = this.key('throttle') || this.touch.gas ? 1 : 0;
    let brk = this.key('brake') || this.touch.brake ? 1 : 0;
    let hb = this.key('handbrake') || this.touch.hb ? 1 : 0;
    let dir = (this.key('right') || this.touch.right ? 1 : 0) - (this.key('left') || this.touch.left ? 1 : 0);

    // gamepad (standard mapping)
    let analogSteer = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
      if (Math.abs(ax) > 0.12) analogSteer = Math.sign(ax) * (Math.abs(ax) - 0.12) / 0.88;
      if (rt > 0.05) thr = Math.max(thr, rt);
      if (lt > 0.05) brk = Math.max(brk, lt);
      if (p.buttons[0]?.pressed || p.buttons[1]?.pressed) hb = 1;
      if (analogSteer !== null || rt > 0.05 || lt > 0.05) this.lastDevice = 'gamepad';
      const map = { 3: 'camera', 2: 'reset', 9: 'pause', 8: 'replay', 5: 'slowmo' };
      for (const [b, act] of Object.entries(map)) {
        const pressed = !!p.buttons[b]?.pressed;
        const key = p.index + ':' + b;
        if (pressed && !this.padPrev[key]) this.emit(act);
        this.padPrev[key] = pressed;
      }
      break;
    }

    if (analogSteer !== null) {
      this.digitalSteer = analogSteer;
    } else if (dir !== 0) {
      // ramp toward full lock; faster when reversing direction
      const rate = Math.sign(this.digitalSteer) !== dir && this.digitalSteer !== 0 ? 6 : 2.6;
      this.digitalSteer += dir * rate * dt;
      this.digitalSteer = Math.max(-1, Math.min(1, this.digitalSteer));
    } else {
      const back = 5 * dt;
      this.digitalSteer = Math.abs(this.digitalSteer) < back ? 0 : this.digitalSteer - Math.sign(this.digitalSteer) * back;
    }
    if (!this.enabled) { thr = 0; brk = 0; }
    s.throttle = thr; s.brake = brk; s.handbrake = hb; s.steer = this.digitalSteer;
    return s;
  }
}
