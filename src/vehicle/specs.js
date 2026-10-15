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
