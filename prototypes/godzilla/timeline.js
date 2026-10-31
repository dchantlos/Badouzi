export const HEIGHT_M = 110;
export const WATER_Z = 5;
export const WALK_CYCLES = 3;
export const RISE_END_S = 19;
export const APPROACH_START_S = RISE_END_S;
const CHARGE_START_S = APPROACH_START_S + 2;
export const DURATION_S = APPROACH_START_S + WALK_CYCLES * 8;
export const START = { x: 13557775, y: 2893705 };
export const VILLAGE_TARGET = { x: 13557724, y: 2893140 };
const villageDistance = Math.hypot(VILLAGE_TARGET.x - START.x, VILLAGE_TARGET.y - START.y);
// The baked stride covers half the original two-cycle projected path.
const approachDistance = Math.hypot(20, 40) / 2 * WALK_CYCLES;
export const END = {
  x: START.x + (VILLAGE_TARGET.x - START.x) / villageDistance * approachDistance,
  y: START.y + (VILLAGE_TARGET.y - START.y) / villageDistance * approachDistance
};

export const CAMERA_START = {
  position: { x: 13557909, y: 2894087, z: 211, spatialReference: { wkid: 3857 } },
  heading: 195,
  tilt: 62
};
export const CAMERA_END = {
  position: { x: 13557890, y: 2894020, z: 190, spatialReference: { wkid: 3857 } },
  heading: 196,
  tilt: 64
};

function smoothstep(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

export function sampleArmMotion({ rise, approach }) {
  if (![rise, approach].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError("Arm motion needs rise and approach values between zero and one");
  }
  const strength = smoothstep((rise - 0.25) / 0.75);
  const phase = approach * Math.PI * 2 * WALK_CYCLES;
  const radians = degrees => degrees * Math.PI / 180 * strength;
  const arm = (offset, side) => {
    const angle = phase + offset;
    return {
      shoulderPitch: radians(-14 - 6 * Math.sin(angle)),
      shoulderSpread: radians(side * (14 + 3 * Math.sin(angle))),
      elbowFlex: radians(-25 - 10 * Math.sin(angle - 0.3)),
      wristPitch: radians(3 * Math.sin(angle - 0.6))
    };
  };
  return { left: arm(0, 1), right: arm(Math.PI, -1) };
}

export function sampleReveal(seconds) {
  if (!Number.isFinite(seconds)) throw new TypeError("Reveal time must be finite");
  const rise = smoothstep((seconds - 5) / (RISE_END_S - 5));
  const approach = smoothstep((seconds - APPROACH_START_S) / (DURATION_S - APPROACH_START_S));
  return {
    x: START.x + (END.x - START.x) * approach,
    y: START.y + (END.y - START.y) * approach,
    z: WATER_Z,
    heading: 180 + Math.atan2(END.x - START.x, END.y - START.y) * 180 / Math.PI,
    anchorZ: 0.56 * (1 - rise),
    glow: {
      tail: smoothstep((seconds - CHARGE_START_S) / 6),
      back: smoothstep((seconds - CHARGE_START_S - 2) / 6),
      crown: smoothstep((seconds - CHARGE_START_S - 4) / 6)
    },
    rise,
    approach,
    done: seconds >= DURATION_S
  };
}
