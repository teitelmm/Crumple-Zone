// Vehicle definitions. Dimensions, masses and engine data follow the real
// production cars (US-market figures) closely enough for the sim to feel right.
// Local frame: x forward, y up, z right; origin at the middle of the car on the ground.

export const CARS = {
  a4: {
    id: 'a4',
    name: 'Audi A4',
    trim: '2.0 TFSI quattro · B9',
    color: '#24344f', // Navarra Blue
    colorName: 'Navarra Blue',
    blurb: 'All-wheel-drive sedan. Heavy and planted, it pushes wide when you overdo it.',
    mass: 1640,
    frontWeight: 0.57,
    dims: {
      length: 4.762, width: 1.847, height: 1.428, wheelbase: 2.82, frontOverhang: 0.92,
      trackF: 1.572, trackR: 1.555, clearance: 0.14, wheelRadius: 0.327, tireWidth: 0.245,
    },
    greenhouse: { aBase: 0.62, roofFront: -0.02, roofRear: -0.98, cBase: -1.42, roofHalf: 0.6, beltInset: 0.86 },
    // side profile: top surface height (hood, belt line, deck) from nose to tail
    top: [[2.381, 0.6], [2.33, 0.72], [2.2, 0.79], [1.6, 0.86], [0.62, 0.95], [-1.42, 1.0], [-2.0, 1.0], [-2.3, 0.93], [-2.381, 0.78]],
    bottom: [[2.381, 0.36], [2.2, 0.2], [1.95, 0.15], [-1.95, 0.15], [-2.25, 0.22], [-2.381, 0.38]],
    noseRound: 0.42, tailRound: 0.3,
    engine: {
      layout: 'Inline-4 turbo, 2.0 L', turbo: true, cylinders: 4,
      idle: 750, redline: 6500, limiter: 6700,
      torque: [[800, 200], [1500, 340], [1600, 370], [4500, 370], [5000, 353], [6000, 295], [6700, 230]],
      powerLabel: '248 hp', torqueLabel: '273 lb-ft',
    },
    trans: { type: 'dct', label: '7-speed S tronic', gears: [3.188, 2.19, 1.517, 1.057, 0.738, 0.557, 0.433], reverse: 2.9, final: 5.302, shiftTime: 0.09 },
    drive: { type: 'AWD', front: 0.6, label: 'quattro AWD' },
    vmax: 210 / 3.6,
    cdA: 0.27 * 2.3,
    tireMu: 1.02,
    brake: 1.05,
    susp: { restLen: 0.24, staticComp: 0.075, zeta: 0.42, arb: 0.55 },
    steerLock: 34,
    claimed060: '5.2 s',
  },

  miata: {
    id: 'miata',
    name: 'Mazda MX-5 Miata',
    trim: '2.0 Skyactiv-G · ND2',
    color: '#696c70', // Machine Gray Metallic
    colorName: 'Machine Gray',
    blurb: 'Light rear-drive roadster. Nimble and eager to slide, but it folds up fast in a hit.',
    mass: 1062,
    frontWeight: 0.5,
    dims: {
      length: 3.915, width: 1.735, height: 1.235, wheelbase: 2.31, frontOverhang: 0.8,
      trackF: 1.495, trackR: 1.505, clearance: 0.135, wheelRadius: 0.308, tireWidth: 0.205,
    },
    greenhouse: { aBase: 0.22, roofFront: -0.18, roofRear: -0.82, cBase: -1.02, roofHalf: 0.56, beltInset: 0.86, softTop: true },
    top: [[1.958, 0.55], [1.9, 0.66], [1.7, 0.72], [1.1, 0.77], [0.22, 0.82], [-1.02, 0.83], [-1.65, 0.84], [-1.9, 0.78], [-1.958, 0.64]],
    bottom: [[1.958, 0.32], [1.78, 0.18], [1.55, 0.135], [-1.55, 0.135], [-1.8, 0.2], [-1.958, 0.34]],
    noseRound: 0.38, tailRound: 0.26,
    engine: {
      layout: 'Inline-4, 2.0 L', turbo: false, cylinders: 4,
      idle: 800, redline: 7500, limiter: 7600,
      torque: [[800, 120], [2000, 170], [3000, 188], [4000, 205], [5000, 200], [6000, 192], [7000, 184], [7600, 165]],
      powerLabel: '181 hp', torqueLabel: '151 lb-ft',
    },
    trans: { type: 'manual', label: '6-speed manual', gears: [5.087, 2.991, 2.035, 1.594, 1.286, 1.0], reverse: 4.76, final: 2.866, shiftTime: 0.22 },
    drive: { type: 'RWD', front: 0, label: 'Rear-wheel drive' },
    vmax: 220 / 3.6,
    cdA: 0.34 * 1.75,
    tireMu: 1.0,
    brake: 1.0,
    susp: { restLen: 0.21, staticComp: 0.065, zeta: 0.38, arb: 0.4 },
    steerLock: 36,
    claimed060: '5.7 s',
  },

  mustang: {
    id: 'mustang',
    name: 'Ford Mustang EcoBoost',
    trim: '2.3 L EcoBoost · S550',
    color: '#9e1b22', // Race Red
    colorName: 'Race Red',
    blurb: 'Turbo muscle car with lots of torque. The rear steps out when you floor it.',
    mass: 1660,
    frontWeight: 0.53,
    dims: {
      length: 4.789, width: 1.916, height: 1.381, wheelbase: 2.72, frontOverhang: 0.94,
      trackF: 1.582, trackR: 1.648, clearance: 0.13, wheelRadius: 0.344, tireWidth: 0.255,
    },
    greenhouse: { aBase: 0.5, roofFront: -0.08, roofRear: -0.86, cBase: -1.7, roofHalf: 0.6, beltInset: 0.84, fastback: true },
    top: [[2.395, 0.58], [2.34, 0.7], [2.15, 0.79], [1.4, 0.86], [0.5, 0.93], [-1.7, 0.98], [-2.15, 0.99], [-2.33, 0.93], [-2.395, 0.76]],
    bottom: [[2.395, 0.34], [2.2, 0.19], [1.95, 0.13], [-1.95, 0.13], [-2.25, 0.21], [-2.395, 0.4]],
    noseRound: 0.3, tailRound: 0.22,
    engine: {
      layout: 'Inline-4 turbo, 2.3 L', turbo: true, cylinders: 4,
      idle: 700, redline: 6500, limiter: 6600,
      torque: [[800, 210], [1500, 330], [2500, 450], [3000, 475], [4000, 462], [5000, 428], [5500, 400], [6600, 320]],
      powerLabel: '310 hp', torqueLabel: '350 lb-ft',
    },
    trans: { type: 'auto', label: '10-speed automatic', gears: [4.696, 2.985, 2.146, 1.769, 1.52, 1.275, 1.0, 0.854, 0.689, 0.636], reverse: 4.866, final: 3.15, shiftTime: 0.14 },
    drive: { type: 'RWD', front: 0, label: 'Rear-wheel drive' },
    vmax: 233 / 3.6,
    cdA: 0.35 * 2.2,
    tireMu: 1.02,
    brake: 1.05,
    susp: { restLen: 0.24, staticComp: 0.075, zeta: 0.4, arb: 0.5 },
    steerLock: 33,
    claimed060: '5.3 s',
  },
};

export const CAR_ORDER = ['a4', 'miata', 'mustang'];

// Paint options for AI cars in the derby / race so the field isn't all one colour.
export const ALT_COLORS = ['#c9ccd1', '#1c1d20', '#2f5d3a', '#d8d2c4', '#3a6ea5', '#b5651d', '#5b2a86', '#e1b12c'];

// --- shape helpers shared by the lattice builder and the visual mesh ---

export function interp(profile, x) {
  // profile is ordered from nose (high x) to tail (low x)
  if (x >= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    const [x1, y1] = profile[i];
    const [x0, y0] = profile[i - 1];
    if (x >= x1) {
      const t = (x - x1) / (x0 - x1);
      return y1 + (y0 - y1) * t;
    }
  }
  return profile[profile.length - 1][1];
}

export function axles(spec) {
  const d = spec.dims;
  const fa = d.length / 2 - d.frontOverhang;
  return { fa, ra: fa - d.wheelbase };
}

// half width of the body (plan view) at station x
export function halfWidthAt(spec, x) {
  const d = spec.dims;
  const hw = d.width / 2;
  const xF = d.length / 2, xR = -d.length / 2;
  let f = 1;
  const nose = spec.noseRound, tail = spec.tailRound;
  if (x > xF - nose) {
    const t = Math.min(1, (x - (xF - nose)) / nose);
    f = Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 0.25);
  } else if (x < xR + tail) {
    const t = Math.min(1, ((xR + tail) - x) / tail);
    f = Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 0.25);
  }
  // slight coke-bottle / tumblehome taper toward the ends
  const mid = 1 - 0.025 * Math.pow(Math.abs(x) / (d.length / 2), 2);
  return hw * f * mid;
}

// x of the nose surface at lateral offset z (inverse of halfWidthAt near the front)
export function noseXAt(spec, z, front = true) {
  const d = spec.dims;
  const hw = d.width / 2 * 0.975;
  const round = front ? spec.noseRound : spec.tailRound;
  const u = Math.min(0.999, Math.abs(z) / hw);
  // invert f = (1 - t^2.2)^0.25  ->  t = (1 - f^4)^(1/2.2)
  const t = Math.pow(1 - Math.pow(u, 4), 1 / 2.2);
  return front ? d.length / 2 - round + t * round : -d.length / 2 + round - t * round;
}

export function bottomAt(spec, x) {
  const d = spec.dims;
  let y = interp(spec.bottom, x);
  const { fa, ra } = axles(spec);
  const archR = d.wheelRadius + 0.05;
  for (const ax of [fa, ra]) {
    const dx = x - ax;
    if (Math.abs(dx) < archR) {
      const ya = d.wheelRadius - 0.01 + Math.sqrt(archR * archR - dx * dx);
      if (ya > y) y = ya;
    }
  }
  return y;
}

export function topAt(spec, x) {
  return interp(spec.top, x);
}

// --- visual-only shape data (read by the render mesh builder, never by physics) ---
// Profiles are [x, y] pairs from nose to tail (car-local metres, y up); tip curves are
// [y, x] (side silhouette of the nose / tail). Detail coordinates are given in a view:
// 'f' front [z, y], 'r' rear [z, y], 's' right side [x, y], 't' top [x, z]; a third
// element overrides the view for one point. `mir` repeats a detail on the left side.
const VISUAL = {
  a4: {
    paint: { metal: 0.45, rough: 0.3 },
    floor: 0.15,
    width: [[2.2, 0.902], [1.9, 0.916], [1.46, 0.921], [1.0, 0.914], [0.2, 0.916], [-0.9, 0.92], [-1.36, 0.9235], [-1.9, 0.916], [-2.2, 0.902]],
    sill: [[2.381, 0.21], [2.2, 0.205], [1.9, 0.19], [1.0, 0.172], [-1.0, 0.172], [-1.8, 0.2], [-2.1, 0.26], [-2.381, 0.3]],
    shoulder: [[2.36, 0.7], [2.1, 0.75], [1.5, 0.802], [0.5, 0.833], [-0.8, 0.858], [-1.8, 0.875], [-2.381, 0.874]],
    belt: [[2.381, 0.73], [2.25, 0.775], [2.0, 0.81], [1.5, 0.865], [1.0, 0.92], [0.6, 0.955], [0, 0.968], [-1.0, 0.985], [-1.5, 0.998], [-2.0, 1.008], [-2.3, 0.998], [-2.381, 0.975]],
    hood: [[2.381, 0.74], [2.25, 0.79], [2.0, 0.83], [1.5, 0.885], [1.0, 0.935], [0.68, 0.963], [0.45, 0.935], [-1.58, 0.96], [-1.74, 1.024], [-2.0, 1.03], [-2.3, 1.012], [-2.381, 0.985]],
    inset: [[2.381, 0.045], [1.5, 0.06], [0.6, 0.07], [-1.5, 0.07], [-2.381, 0.05]],
    dome: [[2.25, 0], [1.9, 0.012], [1.1, 0.016], [0.72, 0.006]], domeW: 0.4,
    tuck: 0.035, crease: 0.012,
    lowerLine: { y: [[1.9, 0.4], [0.5, 0.405], [-0.8, 0.42], [-1.9, 0.45]], d: 0.012 },
    lower: { front: 0.255, rear: 0.37, side: 0 },
    nose: { R: 0.36, n: 2.6, tip: [[0.18, 2.29], [0.26, 2.34], [0.4, 2.374], [0.5, 2.381], [0.6, 2.373], [0.68, 2.345], [0.74, 2.295], [0.8, 2.255], [1.1, 2.22]] },
    tail: { R: 0.26, n: 3, tip: [[0.28, -2.29], [0.36, -2.35], [0.46, -2.376], [0.58, -2.381], [0.66, -2.37], [0.76, -2.364], [0.86, -2.36], [0.95, -2.345], [1.0, -2.318], [1.03, -2.275], [1.2, -2.25]] },
    arch: { gap: 0.055, lift: 0.025, flare: 0.017, flareW: 0.075 },
    gh: {
      xA: 0.6, cowl: 0.68, xC: -1.62, deck: -1.72,
      roof: { xf: -0.12, xfc: -0.07, xr: -1.22, xrc: -1.27, z: 0.64, edge: 1.395, drop: 0.02 },
      lines: [[0.6, -0.12, 'paint'], [0.545, -0.175, 'glass'], [-0.44, -0.5, 'black'], [-0.51, -0.57, 'glass'], [-1.13, -0.98, 'black'], [-1.16, -1.0, 'glass'], [-1.5, -1.18, 'paint'], [-1.62, -1.22, null]],
      bands: [0.04, 0.935], belt: 'chrome', frame: 'chrome',
      bulge: { front: 0.035, side: 0.012, rear: 0.025 },
    },
    interior: { seatX: -0.42, seatZ: 0.37, seatTop: 1.18, rearX: -1.22, rearTop: 1.12, wheel: [0.12, 1.03, -0.37], dash: [0.66, 0.2, 1.0] },
    wheel: { rim: 18, style: 'double5', face: 'silver', walls: 'silver', caliper: '#2b2c2f', spokes: 5 },
    details: [
      { t: 'fill', v: 'f', m: 'grille', uv: 0.045, off: 0.004, ring: { m: 'chrome', w: 0.017, off: 0.008 },
        top: [[0.42, 0.52], [0.4, 0.615], [0.33, 0.662], [0, 0.668], [-0.33, 0.662], [-0.4, 0.615], [-0.42, 0.52]],
        bot: [[0.42, 0.52], [0.41, 0.38], [0.355, 0.3], [0, 0.295], [-0.355, 0.3], [-0.41, 0.38], [-0.42, 0.52]] },
      { t: 'fill', v: 'f', m: 'lamp', mir: true, off: 0.009, wall: 'trim',
        top: [[0.44, 0.704], [0.6, 0.722], [0.76, 0.733], [2.19, 0.745, 's']],
        bot: [[0.455, 0.652], [0.6, 0.66], [0.72, 0.668], [0.8, 0.684], [2.23, 0.706, 's']] },
      { t: 'line', v: 'f', m: 'head', mir: true, off: 0.0115, w: 0.011, p: [[0.46, 0.695], [0.62, 0.712], [0.78, 0.722], [2.2, 0.732, 's']] },
      { t: 'fill', v: 'f', m: 'trim', mir: true, off: 0.0105, top: [[0.47, 0.677], [0.6, 0.685], [0.74, 0.694], [0.79, 0.699]], bot: [[0.476, 0.657], [0.6, 0.664], [0.72, 0.672], [0.79, 0.688]] },
      { t: 'disc', v: 'f', m: 'head', mir: true, c: [0.53, 0.669], r: 0.009, off: 0.012 },
      { t: 'disc', v: 'f', m: 'head', mir: true, c: [0.585, 0.673], r: 0.009, off: 0.012 },
      { t: 'disc', v: 'f', m: 'head', mir: true, c: [0.64, 0.678], r: 0.009, off: 0.012 },
      { t: 'disc', v: 'f', m: 'head', mir: true, c: [0.695, 0.683], r: 0.009, off: 0.012 },
      { t: 'fill', v: 'f', m: 'grille', mir: true, uv: 0.045, off: 0.004, ring: { m: 'trim', w: 0.012, off: 0.006 },
        top: [[0.5, 0.43], [0.66, 0.44], [0.8, 0.44]], bot: [[0.53, 0.285], [0.66, 0.288], [0.76, 0.292]] },
      { t: 'line', v: 'f', m: 'chrome', mir: true, w: 0.012, off: 0.008, p: [[0.52, 0.362], [0.79, 0.366]] },
      { t: 'plate', v: 'f', c: [0, 0.39] },
      { t: 'fill', v: 's', m: 'amber', mir: true, off: 0.004, top: [[2.21, 0.6], [2.13, 0.6]], bot: [[2.22, 0.578], [2.13, 0.578]] },
      { t: 'fill', v: 'r', m: 'tail', mir: true, off: 0.009, wall: 'trim',
        top: [[0.36, 0.962], [0.6, 0.97], [0.8, 0.968], [-2.24, 0.972, 's']],
        bot: [[0.36, 0.874], [0.6, 0.864], [0.8, 0.85], [-2.29, 0.852, 's']] },
      { t: 'line', v: 'r', m: 'tailled', mir: true, off: 0.0115, w: 0.011, p: [[0.38, 0.891], [0.6, 0.883], [0.8, 0.87], [-2.27, 0.872, 's']] },
      { t: 'line', v: 'r', m: 'tailled', mir: true, off: 0.0115, w: 0.008, p: [[0.38, 0.948], [0.6, 0.955], [0.79, 0.954]] },
      { t: 'fill', v: 'r', m: 'lamp', mir: true, off: 0.0105, top: [[0.39, 0.937], [0.5, 0.942]], bot: [[0.39, 0.918], [0.5, 0.916]] },
      { t: 'line', v: 'r', m: 'gap', w: 0.005, off: 0.002, p: [[-0.35, 0.95], [-0.35, 0.68], [-0.32, 0.64], [0.32, 0.64], [0.35, 0.68], [0.35, 0.95]] },
      { t: 'plate', v: 'r', c: [0, 0.775] },
      { t: 'fill', v: 'r', m: 'tail', mir: true, off: 0.004, top: [[0.62, 0.385], [0.8, 0.383]], bot: [[0.62, 0.365], [0.8, 0.363]] },
      { t: 'exhaust', c: [0.56, 0.27], r: 0.038, oval: 1.8, mir: true },
      { t: 'line', v: 'r', m: 'tailled', w: 0.014, off: 0.006, p: [[-0.22, 1.357], [0.22, 1.357]] },
      { t: 'mirror', c: [0.47, 0.985], m: 'paint' },
      { t: 'handle', c: [0.0, 0.858], m: 'chrome' },
      { t: 'handle', c: [-0.98, 0.872], m: 'chrome' },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.005, p: [[0.63, 0.952], [0.64, 0.6], [0.66, 0.235]] },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.005, p: [[-0.465, 0.972], [-0.47, 0.6], [-0.475, 0.22]] },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.005, p: [[-1.14, 0.99], [-1.12, 0.78], [-1.02, 0.71], [-0.95, 0.6], [-0.935, 0.23]] },
      { t: 'line', v: 's', m: 'gap', w: 0.004, circle: [-1.66, 0.84, 0.07] },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.004, p: [[2.235, 0.688], [2.0, 0.672], [1.79, 0.632]] },
      { t: 'line', v: 'r', m: 'gap', mir: true, w: 0.004, p: [[0.36, 0.645], [0.7, 0.652], [-2.34, 0.66, 's'], [-2.1, 0.665, 's'], [-1.9, 0.66, 's'], [-1.69, 0.632, 's']] },
      { t: 'line', v: 'r', m: 'chrome', w: 0.009, off: 0.006, p: [[-0.46, 0.345], [0.46, 0.345]] },
      { t: 'line', v: 't', m: 'gap', mir: true, w: 0.005, p: [[0.7, 0.832], [1.5, 0.808], [2.05, 0.77], [2.24, 0.66]] },
      { t: 'line', v: 't', m: 'gap', mir: true, w: 0.005, p: [[-1.76, 0.83], [-2.0, 0.84], [-2.22, 0.81]] },
      { t: 'line', v: 'f', m: 'plastic', w: 0.016, off: 0.008, p: [[-0.06, 1.0], [-0.64, 1.022]] },
      { t: 'line', v: 'f', m: 'plastic', w: 0.016, off: 0.008, p: [[0.5, 1.0], [-0.02, 1.012]] },
      { t: 'fin', x: -1.12, m: 'paint' },
    ],
  },

  miata: {
    paint: { metal: 0.58, rough: 0.38 },
    floor: 0.14,
    width: [[1.75, 0.83], [1.45, 0.858], [1.16, 0.8675], [0.85, 0.858], [0.4, 0.842], [-0.2, 0.84], [-0.8, 0.858], [-1.15, 0.8675], [-1.5, 0.858], [-1.75, 0.838]],
    sill: [[1.958, 0.21], [1.8, 0.2], [1.5, 0.172], [0.8, 0.162], [-0.8, 0.162], [-1.5, 0.19], [-1.8, 0.245], [-1.958, 0.28]],
    shoulder: [[1.92, 0.6], [1.6, 0.68], [1.16, 0.725], [0.7, 0.695], [0.1, 0.66], [-0.6, 0.68], [-1.15, 0.74], [-1.6, 0.75], [-1.958, 0.725]],
    belt: [[1.958, 0.61], [1.8, 0.67], [1.5, 0.745], [1.2, 0.772], [0.85, 0.77], [0.24, 0.79], [-0.4, 0.8], [-1.0, 0.83], [-1.2, 0.856], [-1.5, 0.852], [-1.8, 0.83], [-1.958, 0.79]],
    hood: [[1.958, 0.59], [1.8, 0.64], [1.5, 0.69], [1.1, 0.722], [0.6, 0.762], [0.32, 0.79], [0.2, 0.765], [-0.98, 0.79], [-1.16, 0.842], [-1.5, 0.848], [-1.8, 0.83], [-1.958, 0.8]],
    inset: [[1.958, 0.055], [1.2, 0.075], [0.3, 0.09], [-1.0, 0.095], [-1.958, 0.065]],
    tuck: 0.03, crease: 0.003,
    lower: { front: 0.225, rear: 0.31, side: 0 },
    nose: { R: 0.3, n: 2.2, tip: [[0.18, 1.86], [0.25, 1.92], [0.34, 1.952], [0.42, 1.958], [0.5, 1.946], [0.56, 1.918], [0.62, 1.865], [0.7, 1.81], [0.9, 1.78]] },
    tail: { R: 0.3, n: 2.5, tip: [[0.26, -1.88], [0.36, -1.935], [0.5, -1.958], [0.66, -1.955], [0.76, -1.93], [0.82, -1.895], [0.86, -1.855], [1.0, -1.83]] },
    arch: { gap: 0.045, lift: 0.015, flare: 0.022, flareW: 0.09 },
    gh: {
      xA: 0.25, cowl: 0.31, xC: -1.1, deck: -1.18, soft: true,
      roof: { xf: -0.19, xfc: -0.15, xr: -0.74, xrc: -0.79, z: 0.55, edge: 1.2, drop: 0.012, rearDrop: 0.04 },
      lines: [[0.25, -0.19, 'paint'], [0.2, -0.235, 'glass'], [-0.56, -0.6, 'soft'], [-1.1, -0.74, null]],
      bands: [0.035, 0.95], belt: 'trim', frame: 'trim',
      bulge: { front: 0.03, side: 0.01, rear: 0.03 },
    },
    interior: { seatX: -0.56, seatZ: 0.33, seatTop: 1.03, wheel: [-0.07, 0.86, -0.33], dash: [0.3, -0.05, 0.82] },
    wheel: { rim: 17, style: 'ten', face: 'gunmetal', walls: 'gunmetal', caliper: '#a3171c', spokes: 10 },
    details: [
      { t: 'fill', v: 'f', m: 'grille', uv: 0.04, off: 0.004, ring: { m: 'trim', w: 0.01, off: 0.006 },
        top: [[0.45, 0.43], [0.25, 0.452], [0, 0.458], [-0.25, 0.452], [-0.45, 0.43]],
        bot: [[0.4, 0.3], [0.3, 0.238], [0, 0.226], [-0.3, 0.238], [-0.4, 0.3]] },
      { t: 'fill', v: 'f', m: 'lamp', mir: true, off: 0.009, wall: 'trim',
        top: [[0.3, 0.6], [0.48, 0.618], [0.64, 0.636], [0.74, 0.65], [1.72, 0.676, 's']],
        bot: [[0.33, 0.546], [0.48, 0.55], [0.62, 0.563], [0.72, 0.58], [1.76, 0.626, 's']] },
      { t: 'fill', v: 'f', m: 'trim', mir: true, off: 0.0105, top: [[0.35, 0.598], [0.46, 0.61], [0.58, 0.622]], bot: [[0.37, 0.554], [0.46, 0.556], [0.58, 0.566]] },
      { t: 'disc', v: 'f', m: 'lamp', mir: true, c: [0.47, 0.583], r: 0.024, off: 0.0115 },
      { t: 'line', v: 'f', m: 'head', mir: true, off: 0.012, w: 0.008, p: [[0.36, 0.594], [0.5, 0.608], [0.64, 0.624], [0.73, 0.638], [1.73, 0.664, 's']] },
      { t: 'plate', v: 'f', c: [0, 0.31] },
      { t: 'fill', v: 's', m: 'amber', mir: true, off: 0.004, top: [[1.85, 0.48], [1.79, 0.48]], bot: [[1.86, 0.46], [1.79, 0.46]] },
      { t: 'fill', v: 'r', m: 'tail', mir: true, off: 0.009, wall: 'trim',
        top: [[0.47, 0.735], [0.62, 0.745], [0.74, 0.735], [-1.84, 0.752, 's']],
        bot: [[0.47, 0.69], [0.6, 0.682], [0.72, 0.675], [-1.87, 0.686, 's']] },
      { t: 'line', v: 'r', m: 'tailled', mir: true, off: 0.0115, w: 0.008, circle: [0.6, 0.712, 0.024] },
      { t: 'line', v: 'r', m: 'tailled', mir: true, off: 0.0115, w: 0.006, p: [[0.66, 0.71], [0.76, 0.705]] },
      { t: 'plate', v: 'r', c: [0, 0.47] },
      { t: 'fill', v: 'r', m: 'tail', mir: true, off: 0.004, top: [[0.6, 0.37], [0.74, 0.368]], bot: [[0.6, 0.352], [0.74, 0.35]] },
      { t: 'exhaust', c: [0.4, 0.27], r: 0.036, oval: 1, mir: true },
      { t: 'line', v: 'r', m: 'tailled', w: 0.012, off: 0.004, p: [[-0.12, 0.832], [0.12, 0.832]] },
      { t: 'mirror', c: [0.15, 0.832], m: 'paint' },
      { t: 'handle', c: [-0.4, 0.735], m: 'paint' },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.005, p: [[0.22, 0.785], [0.23, 0.5], [0.25, 0.23]] },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.005, p: [[-0.63, 0.805], [-0.66, 0.5], [-0.69, 0.22]] },
      { t: 'line', v: 's', m: 'gap', w: 0.004, circle: [-1.38, 0.77, 0.06] },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.004, p: [[1.75, 0.615], [1.6, 0.6], [1.45, 0.6]] },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.004, p: [[-1.87, 0.668], [-1.7, 0.638], [-1.5, 0.565]] },
      { t: 'line', v: 't', m: 'gap', mir: true, w: 0.005, p: [[0.34, 0.7], [1.0, 0.7], [1.6, 0.66], [1.82, 0.52]] },
      { t: 'line', v: 't', m: 'gap', mir: true, w: 0.005, p: [[-1.08, 0.7], [-1.5, 0.71], [-1.8, 0.67]] },
      { t: 'line', v: 'f', m: 'plastic', w: 0.015, off: 0.008, p: [[-0.05, 0.825], [-0.56, 0.84]] },
      { t: 'line', v: 'f', m: 'plastic', w: 0.015, off: 0.008, p: [[0.46, 0.825], [-0.02, 0.832]] },
    ],
  },

  mustang: {
    paint: { metal: 0.0, rough: 0.3 },
    floor: 0.14,
    width: [[2.2, 0.918], [1.8, 0.934], [1.45, 0.94], [1.0, 0.93], [0, 0.928], [-0.7, 0.94], [-1.27, 0.958], [-1.8, 0.95], [-2.2, 0.928]],
    sill: [[2.3945, 0.2], [2.2, 0.19], [1.9, 0.175], [1.0, 0.162], [-1.0, 0.162], [-1.8, 0.21], [-2.1, 0.27], [-2.3945, 0.3]],
    shoulder: [[2.36, 0.66], [2.1, 0.725], [1.5, 0.785], [0.5, 0.805], [-0.5, 0.825], [-1.27, 0.865], [-1.9, 0.878], [-2.3945, 0.88]],
    belt: [[2.3945, 0.725], [2.25, 0.77], [2.0, 0.81], [1.45, 0.865], [0.9, 0.91], [0.48, 0.93], [-0.5, 0.95], [-1.2, 0.985], [-1.74, 1.0], [-2.2, 0.995], [-2.3945, 0.975]],
    hood: [[2.3945, 0.735], [2.3, 0.765], [2.0, 0.812], [1.45, 0.87], [0.9, 0.915], [0.56, 0.94], [0.4, 0.91], [-1.6, 0.96], [-1.83, 1.0], [-2.2, 1.0], [-2.3945, 0.985]],
    dome: [[2.05, 0], [1.7, 0.018], [0.9, 0.024], [0.58, 0.008]],
    inset: [[2.3945, 0.06], [1.45, 0.085], [0.5, 0.09], [-0.6, 0.1], [-1.27, 0.125], [-1.9, 0.11], [-2.3945, 0.07]],
    tuck: 0.04, crease: 0.005,
    haunch: { A: 0.032, wx: 0.5, y0: 0.45, y1: 0.87 },
    lower: { front: 0.245, rear: 0.33, side: 0 },
    nose: { R: 0.36, n: 2.5, tip: [[0.16, 2.26], [0.22, 2.3], [0.36, 2.34], [0.5, 2.366], [0.62, 2.389], [0.68, 2.3945], [0.72, 2.372], [0.76, 2.315], [0.9, 2.27]] },
    tail: { R: 0.26, n: 3, tip: [[0.27, -2.3], [0.36, -2.365], [0.5, -2.392], [0.62, -2.3945], [0.72, -2.385], [0.79, -2.368], [0.88, -2.366], [0.95, -2.376], [0.985, -2.3945], [1.01, -2.37], [1.06, -2.3]] },
    arch: { gap: 0.055, lift: 0.025, flare: 0.016, flareW: 0.07 },
    gh: {
      xA: 0.48, cowl: 0.55, xC: -1.74, deck: -1.84,
      roof: { xf: -0.12, xfc: -0.07, xr: -0.86, xrc: -0.9, z: 0.6, edge: 1.35, drop: 0.015 },
      lines: [[0.48, -0.12, 'paint'], [0.42, -0.17, 'glass'], [-0.62, -0.58, 'black'], [-0.66, -0.61, 'glass'], [-1.2, -0.72, 'paint'], [-1.74, -0.86, null]],
      bands: [0.035, 0.94], belt: 'trim', frame: 'trim',
      bulge: { front: 0.035, side: 0.012, rear: 0.03 },
    },
    interior: { seatX: -0.5, seatZ: 0.38, seatTop: 1.16, rearX: -1.15, rearTop: 1.08, wheel: [0.05, 1.0, -0.38], dash: [0.55, 0.12, 0.97] },
    wheel: { rim: 19, style: 'five', face: 'machined', walls: 'dark', caliper: '#1d1e21', spokes: 5 },
    details: [
      { t: 'fill', v: 'f', m: 'grille', uv: 0.05, off: 0.004, ring: { m: 'trim', w: 0.014, off: 0.007 },
        top: [[0.47, 0.655], [0, 0.66], [-0.47, 0.655]], bot: [[0.565, 0.415], [0, 0.408], [-0.565, 0.415]] },
      { t: 'fill', v: 'f', m: 'trim', mir: true, off: 0.009, wall: 'trim',
        top: [[0.5, 0.682], [0.66, 0.7], [0.82, 0.71], [2.18, 0.726, 's']],
        bot: [[0.57, 0.602], [0.7, 0.619], [0.82, 0.636], [2.22, 0.672, 's']] },
      { t: 'fill', v: 'f', m: 'lamp', mir: true, off: 0.0105, top: [[0.79, 0.704], [0.84, 0.707], [2.19, 0.72, 's']], bot: [[0.79, 0.664], [0.84, 0.666], [2.21, 0.69, 's']] },
      { t: 'line', v: 'f', m: 'head', mir: true, off: 0.0115, w: 0.013, p: [[0.64, 0.633], [0.618, 0.672]] },
      { t: 'line', v: 'f', m: 'head', mir: true, off: 0.0115, w: 0.013, p: [[0.7, 0.641], [0.678, 0.68]] },
      { t: 'line', v: 'f', m: 'head', mir: true, off: 0.0115, w: 0.013, p: [[0.76, 0.649], [0.738, 0.688]] },
      { t: 'line', v: 'f', m: 'head', mir: true, off: 0.0115, w: 0.006, p: [[0.6, 0.62], [0.84, 0.653], [2.2, 0.682, 's']] },
      { t: 'disc', v: 'f', m: 'lamp', mir: true, c: [0.56, 0.648], r: 0.026, off: 0.0105 },
      { t: 'fill', v: 'f', m: 'grille', uv: 0.05, off: 0.004, ring: { m: 'plastic', w: 0.012, off: 0.006 },
        top: [[0.52, 0.355], [0, 0.358], [-0.52, 0.355]], bot: [[0.47, 0.225], [0, 0.222], [-0.47, 0.225]] },
      { t: 'disc', v: 'f', m: 'lamp', mir: true, c: [0.64, 0.3], r: 0.03, off: 0.006 },
      { t: 'plate', v: 'f', c: [0, 0.29] },
      { t: 'fill', v: 't', m: 'grille', mir: true, uv: 0.03, off: 0.004, ring: { m: 'trim', w: 0.008, off: 0.006 },
        top: [[1.62, 0.25], [1.98, 0.29]], bot: [[1.62, 0.36], [1.98, 0.4]] },
      { t: 'fill', v: 's', m: 'amber', mir: true, off: 0.004, top: [[2.2, 0.6], [2.12, 0.6]], bot: [[2.21, 0.578], [2.12, 0.578]] },
      { t: 'fill', v: 'r', m: 'trim', off: 0.003, top: [[-0.84, 0.95], [0, 0.955], [0.84, 0.95]], bot: [[-0.84, 0.802], [0, 0.8], [0.84, 0.802]] },
      { t: 'fill', v: 'r', m: 'tail', mir: true, off: 0.008, wall: 'trim', top: [[0.46, 0.936], [0.84, 0.936]], bot: [[0.46, 0.816], [0.84, 0.816]] },
      { t: 'fill', v: 'r', m: 'tailled', mir: true, off: 0.0105, top: [[0.505, 0.92], [0.555, 0.92]], bot: [[0.51, 0.832], [0.56, 0.832]] },
      { t: 'fill', v: 'r', m: 'tailled', mir: true, off: 0.0105, top: [[0.615, 0.92], [0.665, 0.92]], bot: [[0.62, 0.832], [0.67, 0.832]] },
      { t: 'fill', v: 'r', m: 'tailled', mir: true, off: 0.0105, top: [[0.725, 0.92], [0.775, 0.92]], bot: [[0.73, 0.832], [0.78, 0.832]] },
      { t: 'plate', v: 'r', c: [0, 0.6] },
      { t: 'fill', v: 'r', m: 'tail', mir: true, off: 0.004, top: [[0.66, 0.4], [0.82, 0.398]], bot: [[0.66, 0.382], [0.82, 0.38]] },
      { t: 'exhaust', c: [0.62, 0.285], r: 0.048, oval: 1, mir: true },
      { t: 'line', v: 'r', m: 'tailled', w: 0.013, off: 0.006, p: [[-0.2, 1.316], [0.2, 1.316]] },
      { t: 'mirror', c: [0.34, 0.955], m: 'paint' },
      { t: 'handle', c: [-0.22, 0.866], m: 'paint' },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.005, p: [[0.49, 0.93], [0.5, 0.6], [0.53, 0.24]] },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.005, p: [[-0.7, 0.962], [-0.72, 0.6], [-0.74, 0.22]] },
      { t: 'line', v: 's', m: 'gap', w: 0.004, side: -1, circle: [-1.62, 0.875, 0.075] },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.004, p: [[2.215, 0.66], [2.0, 0.632], [1.8, 0.622]] },
      { t: 'line', v: 's', m: 'gap', mir: true, w: 0.004, p: [[-2.36, 0.72], [-2.15, 0.715], [-1.9, 0.69], [-1.63, 0.66]] },
      { t: 'fill', v: 's', m: 'tail', mir: true, off: 0.004, top: [[-2.22, 0.78], [-2.3, 0.78]], bot: [[-2.22, 0.76], [-2.3, 0.76]] },
      { t: 'line', v: 't', m: 'gap', mir: true, w: 0.005, p: [[0.58, 0.83], [1.45, 0.815], [2.1, 0.76], [2.3, 0.6]] },
      { t: 'line', v: 't', m: 'gap', mir: true, w: 0.005, p: [[-1.86, 0.82], [-2.2, 0.82], [-2.27, 0.79]] },
      { t: 'line', v: 'f', m: 'plastic', w: 0.016, off: 0.008, p: [[-0.06, 0.975], [-0.64, 0.995]] },
      { t: 'line', v: 'f', m: 'plastic', w: 0.016, off: 0.008, p: [[0.5, 0.975], [-0.02, 0.985]] },
      { t: 'fin', x: -0.84, m: 'trim' },
    ],
  },
};
for (const id of Object.keys(VISUAL)) CARS[id].visual = VISUAL[id];
