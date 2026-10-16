// DOM: menus, HUD (tachometer + live damage map), banners, results.
import { CARS, CAR_ORDER } from '../vehicle/specs.js';
import { OBSTACLES } from './modes.js';

const $ = (s, r = document) => r.querySelector(s);

export const MODE_INFO = {
  free: { name: 'Free Roam', desc: 'Drive anywhere. The infield has jump ramps, a row of lamp posts and a concrete crash wall.' },
  race: { name: 'Race', desc: 'Circuit race against AI drivers on a 2.1 km road course. Damage stays on for the whole race.' },
  derby: { name: 'Demolition Derby', desc: 'A dirt bowl and a pack of AI cars. Last car with a working engine wins.' },
  lab: { name: 'Crash Test Lab', desc: 'Pick a speed and a barrier, then watch the impact in slow motion with a full damage report.' },
};

export class UI {
  constructor(game) {
    this.game = game;
    this.settings = loadSettings();
    this.sel = { mode: 'free', car: 'mustang', laps: 3, opponents: 3, derbyOpp: 4, speed: 56, obstacle: 'wall', target: 'a4', ...this.settings.sel };
    this.toastTimer = 0;
    this.bannerTimer = 0;
    this.hudTick = 0;
    this.tachCar = null; this.tachRpm = 0;
    document.fonts?.ready?.then(() => { this.tachCar = null; }); // redraw the tach numerals in the web font
    this.buildMenu();
    this.bindButtons();
    this.applySettings();
  }

  // ------------------------------------------------------------ menu
  buildMenu() {
    const modes = $('#modeList');
    modes.innerHTML = '';
    for (const [id, m] of Object.entries(MODE_INFO)) {
      const b = document.createElement('button');
      b.className = 'mode-tile';
      b.dataset.mode = id;
      b.setAttribute('role', 'radio');
      b.innerHTML = `<span class="tile-name">${m.name}</span><span class="tile-desc">${m.desc}</span>`;
      b.addEventListener('click', () => { this.sel.mode = id; this.refreshMenu(); });
      modes.appendChild(b);
    }
    const cars = $('#carList');
    cars.innerHTML = '';
    for (const id of CAR_ORDER) {
      const c = CARS[id];
      const b = document.createElement('button');
      b.className = 'car-tile';
      b.dataset.car = id;
      b.setAttribute('role', 'radio');
      b.innerHTML = `
        <span class="swatch" style="background:${c.color}"></span>
        <span class="car-name">${c.name}</span>
        <span class="car-trim">${c.trim} · ${c.colorName}</span>
        <dl class="spec">
          <div><dt>Power</dt><dd>${c.engine.powerLabel}</dd></div>
          <div><dt>Torque</dt><dd>${c.engine.torqueLabel}</dd></div>
          <div><dt>Weight</dt><dd>${c.mass.toLocaleString()} kg</dd></div>
          <div><dt>Drive</dt><dd>${c.drive.type}</dd></div>
          <div><dt>Gearbox</dt><dd>${c.trans.label}</dd></div>
          <div><dt>0–60 mph</dt><dd>${c.claimed060}</dd></div>
        </dl>
        <span class="car-blurb">${c.blurb}</span>`;
      b.addEventListener('click', () => { this.sel.car = id; this.refreshMenu(); this.game.showcase(id); });
      cars.appendChild(b);
    }
    const ob = $('#optObstacle');
    ob.innerHTML = Object.entries(OBSTACLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    const tg = $('#optTarget');
    tg.innerHTML = CAR_ORDER.map(k => `<option value="${k}">${CARS[k].name}</option>`).join('');

    $('#optLaps').addEventListener('input', e => { this.sel.laps = +e.target.value; this.refreshMenu(); });
    $('#optOpp').addEventListener('input', e => { this.sel.opponents = +e.target.value; this.refreshMenu(); });
    $('#optDerbyOpp').addEventListener('input', e => { this.sel.derbyOpp = +e.target.value; this.refreshMenu(); });
    $('#optSpeed').addEventListener('input', e => { this.sel.speed = +e.target.value; this.refreshMenu(); });
    ob.addEventListener('change', e => { this.sel.obstacle = e.target.value; this.refreshMenu(); });
    tg.addEventListener('change', e => { this.sel.target = e.target.value; this.refreshMenu(); });
    this.refreshMenu();
  }

  refreshMenu() {
    const s = this.sel;
    document.querySelectorAll('.mode-tile').forEach(b => { b.classList.toggle('sel', b.dataset.mode === s.mode); b.setAttribute('aria-checked', b.dataset.mode === s.mode); });
    document.querySelectorAll('.car-tile').forEach(b => { b.classList.toggle('sel', b.dataset.car === s.car); b.setAttribute('aria-checked', b.dataset.car === s.car); });
    $('#opts-race').hidden = s.mode !== 'race';
    $('#opts-derby').hidden = s.mode !== 'derby';
    $('#opts-lab').hidden = s.mode !== 'lab';
    $('#optLaps').value = s.laps; $('#vLaps').textContent = s.laps;
    $('#optOpp').value = s.opponents; $('#vOpp').textContent = s.opponents;
    $('#optDerbyOpp').value = s.derbyOpp; $('#vDerbyOpp').textContent = s.derbyOpp;
    $('#optSpeed').value = s.speed; $('#vSpeed').textContent = `${s.speed} km/h · ${Math.round(s.speed / 1.609)} mph`;
    $('#optObstacle').value = s.obstacle;
    $('#optTarget').value = s.target;
    $('#targetRow').hidden = !(s.obstacle === 'headon' || s.obstacle === 'tbone');
    $('#startBtn').textContent = s.mode === 'lab' ? 'Run crash test' : s.mode === 'race' ? 'Start race' : s.mode === 'derby' ? 'Enter the bowl' : 'Drive';
    this.settings.sel = { ...s };
    saveSettings(this.settings);
  }

  bindButtons() {
    const g = this.game;
    $('#startBtn').addEventListener('click', () => g.startMode(this.sel.mode, this.modeOptions()));
    $('#resumeBtn').addEventListener('click', () => g.setPaused(false));
    $('#restartBtn').addEventListener('click', () => g.restart());
    $('#menuBtn').addEventListener('click', () => g.toMenu());
    $('#resetCarBtn').addEventListener('click', () => { g.setPaused(false); g.resetPlayer(); });
    $('#resAgain').addEventListener('click', () => g.restart());
    $('#resMenu').addEventListener('click', () => g.toMenu());
    $('#resReplay').addEventListener('click', () => { this.hideResults(); g.startReplay({ speed: 0.5, cinematic: false, then: () => g.showResults(g.lastResults) }); });
    $('#replayExit').addEventListener('click', () => g.stopReplay());
    $('#replaySpeed').addEventListener('click', () => g.cycleReplaySpeed());

    const units = $('#setUnits'), quality = $('#setQuality'), tc = $('#setTC'), vol = $('#setVol');
    units.value = this.settings.units; quality.value = this.settings.quality; tc.checked = this.settings.tc; vol.value = this.settings.volume;
    units.addEventListener('change', () => { this.settings.units = units.value; this.applySettings(); });
    quality.addEventListener('change', () => { this.settings.quality = quality.value; this.applySettings(); this.toast('Graphics change applies after reload'); });
    tc.addEventListener('change', () => { this.settings.tc = tc.checked; this.applySettings(); });
    vol.addEventListener('input', () => { this.settings.volume = +vol.value; this.applySettings(); });
    $('#helpBtn').addEventListener('click', () => { $('#help').hidden = !$('#help').hidden; });
  }

  applySettings() {
    saveSettings(this.settings);
    this.game.audio.setVolume(this.settings.volume);
    for (const e of this.game.cars || []) e.vehicle.tractionControl = this.settings.tc;
  }

  modeOptions() {
    const s = this.sel;
    return { car: s.car, laps: s.laps, opponents: s.mode === 'derby' ? s.derbyOpp : s.opponents, speed: s.speed, obstacle: s.obstacle, target: s.target };
  }

  showMenu(on) {
    $('#menu').hidden = !on;
    $('#hud').hidden = on;
    $('#touch').hidden = on || !this.game.isTouch;
  }

  setPaused(on, mode) {
    $('#pause').hidden = !on;
    if (on) {
      const tp = $('#teleports');
      tp.innerHTML = '';
      const list = mode?.teleports?.();
      tp.hidden = !list;
      if (list) for (const [label, spot] of list) {
        const b = document.createElement('button');
        b.className = 'ghost';
        b.textContent = label;
        b.addEventListener('click', () => { this.game.setPaused(false); this.game.teleport(spot); });
        tp.appendChild(b);
      }
      $('#resetCarBtn').hidden = !mode?.onReset?.();
    }
  }

  // ------------------------------------------------------------ messages
  banner(title, sub = '', secs = 2) {
    const b = $('#banner');
    b.innerHTML = `<div class="b-title">${title}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    b.classList.add('show');
    this.bannerTimer = secs;
  }

  toast(text, secs = 2.4) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    this.toastTimer = secs;
  }

  showResults(card) {
    if (!card) return;
    const r = $('#results');
    $('#resTitle').textContent = card.title;
    const head = `<tr>${card.head.map(h => `<th>${h}</th>`).join('')}</tr>`;
    const rows = card.rows.map((row, i) => `<tr class="${i === card.highlight ? 'me' : ''}">${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    $('#resTable').innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
    r.hidden = false;
    $('#hud').hidden = true;
    $('#touch').hidden = true;
  }

  hideResults() {
    $('#results').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !this.game.isTouch;
  }

  showReplay(on, label) {
    $('#replayBar').hidden = !on;
    if (label) $('#replaySpeed').textContent = label;
    $('#touch').hidden = on || !this.game.isTouch || !$('#menu').hidden;
  }

  // ------------------------------------------------------------ HUD
  update(dt, car, mode) {
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) $('#banner').classList.remove('show'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) $('#toast').classList.remove('show'); }
    if (!car) return;
    this.hudTick -= dt;
    if (!this.game.isTouch) this.drawTach(car); // the touch HUD hides the tach
    if (this.hudTick > 0) return;
    this.hudTick = 0.1;
    const mph = this.settings.units === 'mph';
    $('#spd').textContent = Math.round(Math.abs(car.speedFwd) * (mph ? 2.237 : 3.6));
    $('#unit').textContent = mph ? 'mph' : 'km/h';
    $('#gear').textContent = car.engineDead ? '–' : car.gear === -1 ? 'R' : String(car.gear);
    $('#tcFlag').classList.toggle('on', car.tractionControl);
    $('#boostFlag').hidden = !car.spec.engine.turbo;
    $('#boostFlag').style.setProperty('--b', car.boost.toFixed(2));
    if (mode) {
      $('#modeName').textContent = mode.name;
      $('#modeInfo').innerHTML = mode.info().map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    }
    const eng = car.engineDead ? 'Dead' : Math.round(car.engineHealth * 100) + '%';
    $('#dEngine').textContent = eng;
    $('#dEngine').dataset.state = car.engineDead || car.engineHealth < 0.3 ? 'bad' : car.engineHealth < 0.8 ? 'warn' : 'ok';
    $('#dTemp').textContent = Math.round(car.engineTemp) + '°C' + (car.radiatorLeak > 0 ? ' · leak' : '');
    $('#dTemp').dataset.state = car.engineTemp > 120 ? 'bad' : car.radiatorLeak > 0 ? 'warn' : 'ok';
    const glass = Object.values(car.glass).filter(Boolean).length;
    $('#dGlass').textContent = glass ? `${glass} broken` : 'Intact';
    $('#dGlass').dataset.state = glass ? 'warn' : 'ok';
    $('#dCost').textContent = '$' + car.damageCost.toLocaleString();
    this.drawDamage(car);
  }

  drawTach(car) {
    const e = car.spec.engine;
    const maxR = Math.ceil((e.limiter + 300) / 1000) * 1000;
    // redraw only when the needle has moved about a pixel (or the car changed)
    const rpm = car.rpmShown;
    if (car === this.tachCar && Math.abs(rpm - this.tachRpm) < maxR * 0.002) return;
    this.tachCar = car; this.tachRpm = rpm;
    const cv = this.tachCv || (this.tachCv = $('#tach'));
    const ctx = this.tachCtx || (this.tachCtx = cv.getContext('2d'));
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W * 0.44;
    ctx.clearRect(0, 0, W, H);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = r => a0 + (a1 - a0) * Math.min(1, r / maxR);
    ctx.lineCap = 'butt';
    ctx.lineWidth = W * 0.05;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
    ctx.strokeStyle = '#d23a2a';
    ctx.beginPath(); ctx.arc(cx, cy, R, ang(e.redline), a1); ctx.stroke();
    ctx.strokeStyle = rpm > e.redline ? '#ff5a3c' : '#f2b705';
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, ang(rpm)); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 4; // half the stroke shows outside the glyph: ~1 CSS px on this 2x canvas
    ctx.lineJoin = 'round';
    ctx.font = `600 ${Math.round(W * 0.06)}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let r = 0; r <= maxR; r += 1000) {
      const a = ang(r), tx = cx + Math.cos(a) * R * 0.78, ty = cy + Math.sin(a) * R * 0.78;
      ctx.strokeText(String(r / 1000), tx, ty);
      ctx.fillText(String(r / 1000), tx, ty);
    }
  }

  drawDamage(car) {
    const cv = $('#dmgMap');
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const b = car.body, t = car.tpl, fr = car.frame;
    const L = car.spec.dims.length, Wd = car.spec.dims.width;
    const sc = Math.min((H - 16) / L, (W - 16) / Wd) * 0.95;
    const c = fr.c;
    const proj = (i) => {
      const dx = b.x[i * 3] - c[0], dy = b.x[i * 3 + 1] - c[1], dz = b.x[i * 3 + 2] - c[2];
      const lx = dx * fr.f[0] + dy * fr.f[1] + dz * fr.f[2];
      const lz = dx * fr.r[0] + dy * fr.r[1] + dz * fr.r[2];
      return [W / 2 + lz * sc, H / 2 - lx * sc];
    };
    ctx.lineWidth = 1.4;
    for (let k = 0; k < b.nb; k++) {
      const bm = t.beams[k];
      if (bm.zone === 'hub') continue;
      const strain = b.broken[k] ? 1 : Math.abs(b.rest[k] - b.rest0[k]) / b.rest0[k];
      if (b.broken[k]) continue;
      const [x1, y1] = proj(b.ba[k]), [x2, y2] = proj(b.bb[k]);
      ctx.strokeStyle = strain < 0.01 ? 'rgba(170,190,200,0.28)' : strain < 0.06 ? 'rgba(242,183,5,0.75)' : 'rgba(235,64,40,0.95)';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    for (const w of car.wheels) {
      const [x, y] = proj(w.node);
      ctx.fillStyle = w.detached ? '#eb4028' : '#d8dde0';
      if (w.detached) { ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✕', x, y + 4); }
      else ctx.fillRect(x - 3, y - 6, 6, 12);
    }
    // nose marker
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.moveTo(W / 2 - 5, 7); ctx.lineTo(W / 2 + 5, 7); ctx.lineTo(W / 2, 2); ctx.fill();
  }
}

function loadSettings() {
  const def = { units: (navigator.language || '').startsWith('en-US') ? 'mph' : 'kmh', quality: 'auto', tc: true, volume: 0.7, sel: {} };
  try { return { ...def, ...JSON.parse(localStorage.getItem('crumple-settings') || '{}') }; } catch { return def; }
}
function saveSettings(s) {
  try { localStorage.setItem('crumple-settings', JSON.stringify(s)); } catch { /* storage unavailable */ }
}
