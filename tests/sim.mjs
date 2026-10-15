// Headless physics checks: settle, acceleration, braking, cornering, crash.
// Run: node tests/sim.mjs [carId]
import { PhysicsWorld } from '../src/physics/softbody.js';
import { BoxCollider, CylinderCollider } from '../src/physics/colliders.js';
import { Vehicle } from '../src/vehicle/vehicle.js';
import { CARS, CAR_ORDER } from '../src/vehicle/specs.js';

const DT = 1 / 60;
const only = process.argv[2];
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL', msg); } };

function makeWorld(colliders = []) {
  return new PhysicsWorld({ colliders, surfaceAt: () => ({ mu: 1, roll: 0.015, type: 'asphalt' }) });
}

function run(world, cars, seconds, perFrame) {
  const frames = Math.round(seconds / DT);
  for (let f = 0; f < frames; f++) {
    for (const c of cars) c.update(DT);
    if (perFrame && perFrame(f * DT) === false) return f * DT;
    world.step(DT);
    for (const c of cars) c.postStep(DT);
  }
  return seconds;
}

for (const id of CAR_ORDER) {
  if (only && id !== only) continue;
  const spec = CARS[id];
  console.log(`\n=== ${spec.name} (${spec.mass} kg) nodes=${spec && new Vehicle(spec, makeWorld()).body.n} beams=${new Vehicle(spec, makeWorld()).body.nb}`);

  // 1. settle
  {
    const w = makeWorld();
    const car = new Vehicle(spec, w); w.add(car.body);
    car.spawn(0, 0, 0, 0, 0.05);
    const t0 = performance.now();
    run(w, [car], 3);
    const ms = (performance.now() - t0) / (3 / DT);
    car.computeFrame();
    const minY = Math.min(...Array.from({ length: car.body.n }, (_, i) => car.body.x[i * 3 + 1] - car.body.r[i]));
    const loads = car.wheels.map(x => (x.load / 9.81).toFixed(0)).join('/');
    console.log(`settle: comY=${car.frame.c[1].toFixed(3)} minClear=${minY.toFixed(3)} wheel loads kg=${loads} plastic=${car.body.plasticTotal.toFixed(4)} speed=${car.speed.toFixed(3)} ms/frame=${ms.toFixed(2)}`);
    check(car.speed < 0.05, 'car should be at rest');
    check(car.body.plasticTotal < 0.01, 'no deformation at rest');
    check(minY > 0.05, 'body should not touch ground');
  }

  // 2. acceleration 0-100 km/h and quarter mile
  {
    const w = makeWorld();
    const car = new Vehicle(spec, w); w.add(car.body);
    car.spawn(0, 0, 0);
    run(w, [car], 1);
    let t100 = null, t60 = null, x0 = car.frame.c[0], tq = null;
    car.controls.throttle = 1;
    let t = 0;
    run(w, [car], 30, (time) => {
      t = time;
      if (!t60 && car.speedFwd >= 26.82) t60 = time;
      if (!t100 && car.speedFwd >= 27.78) t100 = time;
      if (!tq && car.frame.c[0] - x0 >= 402) tq = time;
    });
    console.log(`accel: 0-60mph=${t60?.toFixed(2)}s 0-100=${t100?.toFixed(2)}s quarter=${tq?.toFixed(2)}s vmax(30s)=${(car.speed * 3.6).toFixed(0)} km/h gear=${car.gear} plastic=${car.body.plasticTotal.toFixed(4)} heading drift z=${car.frame.c[2].toFixed(2)}`);
    check(t60 && t60 < 9, '0-60 under 9 s');
    check(Math.abs(car.frame.c[2]) < 8, 'drives straight');
  }

  // 3. braking 100-0
  {
    const w = makeWorld();
    const car = new Vehicle(spec, w); w.add(car.body);
    car.spawn(0, 0, 0, 27.78);
    run(w, [car], 0.5);
    const x0 = car.frame.c[0];
    car.controls.brake = 1;
    const t = run(w, [car], 10, () => { if (car.speed < 0.3) return false; });
    console.log(`brake 100-0: ${(car.frame.c[0] - x0).toFixed(1)} m in ${t.toFixed(2)} s`);
    check(car.frame.c[0] - x0 < 50, 'braking distance < 50 m');
  }

  // 4. skidpad: constant steer at ~60 km/h
  {
    const w = makeWorld();
    const car = new Vehicle(spec, w); w.add(car.body);
    car.spawn(0, 0, 0, 16);
    car.controls.steer = 0.5;
    let maxLat = 0;
    run(w, [car], 6, () => {
      car.controls.throttle = car.speed < 16 ? 0.6 : 0.2;
      const v = car.vel, f = car.frame.f;
      const yaw = car.body.v; // unused
      maxLat = Math.max(maxLat, car.gForce);
    });
    console.log(`skidpad: speed=${(car.speed * 3.6).toFixed(0)} km/h upright=${car.frame.u[1].toFixed(2)} g≈${maxLat.toFixed(2)} plastic=${car.body.plasticTotal.toFixed(4)}`);
    check(car.frame.u[1] > 0.8, 'stays upright');
  }

  // 5. frontal wall crash at several speeds
  for (const kmh of [15, 30, 56, 90]) {
    const wall = new BoxCollider({ x: 20, y: 1.5, z: 0, hx: 1, hy: 1.5, hz: 6, mu: 0.6 });
    const w = makeWorld([wall]);
    const car = new Vehicle(spec, w); w.add(car.body);
    car.spawn(10, 0, 0, kmh / 3.6);
    run(w, [car], 3);
    console.log(`wall ${kmh} km/h: crush=${(car.crushDepth() * 100).toFixed(0)} cm peakG=${car.peakG.toFixed(1)} engine=${(car.engineHealth * 100).toFixed(0)}% leak=${car.radiatorLeak > 0} glass=${Object.values(car.glass).filter(Boolean).length} $${car.damageCost} wheelsOff=${car.wheels.filter(x => x.detached).length} upright=${car.frame.u[1].toFixed(2)} nan=${car.body.hasNaN()}`);
    check(!car.body.hasNaN(), 'no NaN');
  }

  // 6. pole side impact at 50 km/h
  {
    const pole = new CylinderCollider({ x: 15, z: 0, radius: 0.15, y1: 6 });
    const w = makeWorld([pole]);
    const car = new Vehicle(spec, w); w.add(car.body);
    car.spawn(5, 0, 0, 50 / 3.6);
    run(w, [car], 3);
    console.log(`pole 50 km/h: crush=${(car.crushDepth() * 100).toFixed(0)} cm maxDef=${(car.maxDeformation() * 100).toFixed(0)} cm peakG=${car.peakG.toFixed(1)} passedThrough=${car.frame.c[0] > 15.5}`);
    check(car.frame.c[0] < 15, 'pole should stop the car');
  }

  // 7. head-on car to car 50+50
  {
    const w = makeWorld();
    const a = new Vehicle(spec, w); w.add(a.body);
    const b = new Vehicle(spec, w); w.add(b.body);
    a.spawn(0, 0, 0, 50 / 3.6);
    b.spawn(14, 0, Math.PI, 50 / 3.6);
    run(w, [a, b], 3);
    console.log(`head-on 50+50: crushA=${(a.crushDepth() * 100).toFixed(0)} cm crushB=${(b.crushDepth() * 100).toFixed(0)} cm peakG=${a.peakG.toFixed(1)} gap=${(b.frame.c[0] - a.frame.c[0]).toFixed(2)}`);
    check(b.frame.c[0] - a.frame.c[0] > 2, 'cars must not pass through each other');
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
