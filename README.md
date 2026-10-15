# Crumple Zone

A soft-body car crash and racing game that runs in the browser on desktop and mobile. Every car is a node-and-beam structure (the same idea BeamNG.drive uses), so crashes come from the simulation rather than canned damage: bumpers fold, hoods buckle, wheels get shoved back or torn off, glass shatters, and the damage changes how the car drives.

## Cars

| Car | Engine | Power / torque | Weight | Drive | Gearbox |
| --- | --- | --- | --- | --- | --- |
| Audi A4 2.0 TFSI quattro (B9), Navarra Blue | 2.0 L turbo I4 | 248 hp / 273 lb-ft | 1,640 kg | AWD, 60:40 | 7-speed S tronic |
| Mazda MX-5 Miata (ND2), Machine Gray | 2.0 L I4 | 181 hp / 151 lb-ft | 1,062 kg | RWD | 6-speed manual (auto-shifted) |
| Ford Mustang EcoBoost (S550), Race Red | 2.3 L turbo I4 | 310 hp / 350 lb-ft | 1,660 kg | RWD | 10-speed automatic |

The EcoBoost Mustang uses Ford's 2.3 L turbocharged four-cylinder. Ford never sold a V6 EcoBoost Mustang; the older 3.7 L V6 was naturally aspirated.

Simulated 0–60 mph times land close to the published figures: A4 4.8 s (claimed 5.2), Miata 5.6 s (5.7), Mustang 5.2 s (5.3).

## Modes

- **Free Roam**: a proving ground with jump ramps, a row of lamp posts and a concrete crash wall, surrounded by a 2.1 km road circuit. You can teleport between areas from the pause menu.
- **Race**: 1–6 laps against up to five AI drivers. Damage stays on for the whole race.
- **Demolition Derby**: a dirt bowl with up to seven AI cars. A car is out when its engine dies, it stays rolled over or it loses two wheels.
- **Crash Test Lab**: pick a speed (10–160 km/h) and a barrier (full-width wall, 40% offset, pole, head-on or T-bone into another car). The impact replays at quarter speed, followed by a report with peak g, crush depth, cabin intrusion, engine state and a repair estimate.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Throttle | W / ↑ | RT | GAS |
| Brake, hold to reverse | S / ↓ | LT | BRAKE |
| Steer | A D / ← → | Left stick | ◀ ▶ |
| Handbrake | Space | A / B | HB |
| Camera | C | Y | camera button |
| Reset car | R | X | wrench button |
| Instant replay | V | Back | replay button |
| Slow motion | T | RB | hourglass button |
| Pause | Esc / P | Start | pause button |

## Running it

No build step is needed. The page loads Three.js from `vendor/`, so any static file server works:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To put it online with GitHub Pages, open **Settings → Pages** in this repository and set **Source** to **GitHub Actions**. After that, the workflow in `.github/workflows/pages.yml` deploys every push to the default branch.

## How the physics works

- `src/physics/softbody.js`: an XPBD solver with 16 substeps per frame. Beams are elastic up to a yield strain, then deform plastically (their rest length changes permanently), then break. Nodes collide with the ground, walls, ramps and poles, and with nodes of other cars.
- `src/vehicle/lattice.js`: builds each car's structure from its real dimensions. The crumple zones are softer than the passenger cell, and each beam's yield strength has a little random variation so panels fold unevenly.
- `src/vehicle/vehicle.js`: raycast suspension with anti-roll bars, a Pacejka-style tyre model with a friction circle and load sensitivity, and weight transfer through the contact patches. It also models the engine torque curve, turbo lag, automatic gear changes, ABS with brake distribution, traction control, and damage (engine health, radiator leaks and overheating, glass, wheel alignment, wheel loss).
- `src/vehicle/bodyshape.js`: the visible body is built procedurally. Each vertex is bound to a tetrahedron of lattice nodes, so the mesh deforms with the structure.

## Tests

```sh
node tests/sim.mjs   # settle, 0-60, braking, skidpad, wall/pole/head-on crashes for all three cars
node tests/ai.mjs    # each car laps the circuit with the AI driver
```
