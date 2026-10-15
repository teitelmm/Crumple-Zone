// Headless AI lap test: one car per model laps the circuit with the race driver.
// Run: node tests/ai.mjs [carId] [seconds]
import { PhysicsWorld } from '../src/physics/softbody.js';
import { Vehicle } from '../src/vehicle/vehicle.js';
import { CARS, CAR_ORDER } from '../src/vehicle/specs.js';
import { buildWorld, trackProgress } from '../src/world/map.js';
import { RaceDriver } from '../src/game/ai.js';

const world = buildWorld();
const secs = +(process.argv[3] || 120);
const DT = 1 / 60;
let fail = 0;
for (const id of CAR_ORDER) {
  if (process.argv[2] && process.argv[2] !== 'all' && id !== process.argv[2]) continue;
  const phys = new PhysicsWorld({ colliders: world.colliders, surfaceAt: world.surfaceAt });
  const v = new Vehicle(CARS[id], phys);
  phys.add(v.body);
  const s = world.spawns.grid[0];
  v.spawn(s.x, s.z, s.heading, 0);
  const d = new RaceDriver(v, world.track, 0.92);
  d.offset = 0;
  let maxOff = 0, offTime = 0, lapStart = null, laps = [], prevIdx = -1, crossings = 0, stuck = 0;
  const N = world.track.pts.length;
  for (let f = 0; f < secs / DT; f++) {
    d.update(DT); v.update(DT); phys.step(DT); v.postStep(DT);
    const p = trackProgress(world.track, v.frame.c[0], v.frame.c[2], prevIdx);
    if (prevIdx > N * 0.85 && p.index < N * 0.15) { crossings++; if (lapStart !== null) laps.push((f * DT - lapStart).toFixed(1)); lapStart = f * DT; }
    prevIdx = p.index;
    maxOff = Math.max(maxOff, p.dist);
    if (p.dist > 7) offTime += DT;
    if (v.speed < 1) stuck += DT;
  }
  console.log(`${id}: laps=${laps.join(', ')} crossings=${crossings} maxOff=${maxOff.toFixed(1)}m offTime=${offTime.toFixed(1)}s stuck=${stuck.toFixed(1)}s damage=$${v.damageCost} progress idx=${prevIdx}/${N}`);
  if (laps.length === 0) fail++;
}
process.exit(fail ? 1 : 0);
