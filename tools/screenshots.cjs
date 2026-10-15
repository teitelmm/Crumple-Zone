// Visual regression shots: renders a fixed set of views with headless Chromium
// (software WebGL) and reports page errors.
//
//   node tools/screenshots.cjs <baseURL> <outDir> [only=name,name]
//
// Serve the repo first, e.g. `python3 -m http.server 8123`. The shots freeze the
// simulation at a scripted moment, so the same views can be compared over time.
// Software rendering is slow (1-3 fps); the timing numbers it prints are not
// representative of real devices.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const [base = 'http://localhost:8123/', outDir = 'shots', onlyArg] = process.argv.slice(2);
const only = onlyArg ? onlyArg.replace(/^only=/, '').split(',') : null;
fs.mkdirSync(outDir, { recursive: true });

const DESKTOP = { viewport: { width: 1280, height: 720 } };
const PHONE = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

// Each scene: setup(g) runs in the page; returns nothing. Camera is placed by `cam`.
const SCENES = [
  { name: 'menu', ctx: DESKTOP, quality: 'high', menu: true },
  { name: 'car-a4', ctx: DESKTOP, quality: 'high', car: 'a4', cam: { yaw: 0.75, pitch: 0.18, dist: 6.2 } },
  { name: 'car-miata', ctx: DESKTOP, quality: 'high', car: 'miata', cam: { yaw: 2.4, pitch: 0.22, dist: 5.6 } },
  { name: 'car-mustang', ctx: DESKTOP, quality: 'high', car: 'mustang', cam: { yaw: -0.7, pitch: 0.15, dist: 6.4 } },
  { name: 'chase', ctx: DESKTOP, quality: 'high', mode: 'free', car: 'mustang', drive: 2.5 },
  { name: 'race', ctx: DESKTOP, quality: 'high', mode: 'race', car: 'a4', race: 9 },
  { name: 'crash', ctx: DESKTOP, quality: 'high', mode: 'lab', car: 'mustang', lab: { speed: 64, obstacle: 'offset' }, cam: { yaw: 0.9, pitch: 0.35, dist: 7 } },
  { name: 'derby', ctx: DESKTOP, quality: 'high', mode: 'derby', car: 'a4', sim: 12, cam: { yaw: 2.2, pitch: 0.45, dist: 14 } },
  { name: 'phone', ctx: PHONE, quality: 'low', mode: 'free', car: 'miata', drive: 2 },
];

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const report = [];
  for (const sc of SCENES) {
    if (only && !only.includes(sc.name)) continue;
    const ctx = await browser.newContext(sc.ctx);
    await ctx.addInitScript((q) => {
      try { localStorage.setItem('crumple-settings', JSON.stringify({ quality: q, units: 'mph', tc: true, volume: 0, sel: {} })); } catch {}
    }, sc.quality);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const t0 = Date.now();
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.game && window.game.view, null, { timeout: 60000 }).catch(() => errors.push('game did not start'));
    await page.waitForTimeout(1500);
    const info = await page.evaluate(async (sc) => {
      const g = window.game;
      if (!g) return { error: 'no game' };
      const step = (n) => { for (let i = 0; i < n; i++) { g.input.update(1 / 60); g.simulate(1 / 60); } };
      if (sc.menu) { step(30); return {}; }
      g.ui.sel.car = sc.car;
      if (sc.mode === 'lab') g.startMode('lab', { car: sc.car, speed: sc.lab.speed, obstacle: sc.lab.obstacle, target: 'a4' });
      else if (sc.mode) g.startMode(sc.mode, { ...g.ui.modeOptions(), car: sc.car, laps: 2, opponents: 3 });
      else {
        // studio shot: parked car on the infield
        g.startMode('free', { ...g.ui.modeOptions(), car: sc.car });
        g.teleport({ x: g.world.zones.infield.x + 20, z: g.world.zones.infield.z + 10, heading: 0.3 });
      }
      if (sc.drive) { g.input.keys.add('KeyW'); step(Math.round(sc.drive * 60)); g.input.keys.clear(); g.input.keys.add('KeyD'); step(20); g.input.keys.clear(); }
      if (sc.race) { step(Math.round(sc.race * 60)); }
      if (sc.mode === 'lab') { let n = 0; while (g.state === 'play' && n++ < 360) step(1); if (g.state === 'replay') g.stopReplay(true); }
      if (sc.sim) step(Math.round(sc.sim * 60));
      if (!sc.mode) step(90);
      for (const e of g.cars) e.view.update(true);
      document.getElementById('results').hidden = true;
      const v = g.player.vehicle;
      if (sc.cam) {
        g.rig.mode = 'orbit';
        g.rig.orbitYaw = Math.atan2(-v.frame.f[2], -v.frame.f[0]) + sc.cam.yaw;
        g.rig.orbitPitch = sc.cam.pitch; g.rig.orbitDist = sc.cam.dist;
        g.rig.snap();
        g.rig.update(1 / 60, v.frame, 0);
        document.getElementById('hud').hidden = true;
        document.getElementById('touch').hidden = true;
      } else {
        for (let i = 0; i < 30; i++) g.rig.update(1 / 60, v.frame, v.speed);
      }
      g.paused = true; // freeze physics; the render loop keeps drawing
      document.getElementById('pause').hidden = true;
      return { speed: Math.round(v.speed * 3.6), cars: g.cars.length, damage: v.damageCost };
    }, sc);
    // let a few frames render (software GL is slow)
    await page.waitForTimeout(sc.ctx === PHONE ? 2500 : 3500);
    const perf = await page.evaluate(() => new Promise(res => {
      let n = 0; const t0 = performance.now();
      const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(+(n / 1.5).toFixed(1)); };
      requestAnimationFrame(f);
    }));
    const file = path.join(outDir, sc.name + '.png');
    await page.screenshot({ path: file });
    report.push({ name: sc.name, file, ms: Date.now() - t0, swiftshaderFps: perf, info, errors });
    await ctx.close();
  }
  await browser.close();
  for (const r of report) console.log(JSON.stringify(r));
  const bad = report.filter(r => r.errors.length);
  if (bad.length) { console.log(`${bad.length} scene(s) had page errors`); process.exitCode = 1; }
})();
