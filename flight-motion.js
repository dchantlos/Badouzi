// First-person motion adapted from dchantlos/3dgs, with frame-independent easing.
export const FLIGHT_KEYS = new Set([
  "w", "a", "s", "d", "q", "e", "i", "k",
  "arrowup", "arrowdown", "arrowleft", "arrowright"
]);

const DEG = Math.PI / 180;
const VELOCITY_TAU = 0.32;
const LOOK_TAU = 0.06;
const YAW_RATE = 75;
const LOOK_SENSITIVITY = 0.12;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const heading = value => ((value % 360) + 360) % 360;

export function createFlightMotion(pose) {
  for (const key of ["x", "y", "z", "heading", "tilt"]) {
    if (!Number.isFinite(pose[key])) throw new TypeError(`Invalid drone camera ${key}`);
  }
  return {
    ...pose,
    targetHeading: pose.heading,
    targetTilt: pose.tilt,
    velocity: { x: 0, y: 0, z: 0 },
    cruise: 28
  };
}

export function changeFlightSpeed(state, deltaPixels) {
  state.cruise = clamp(state.cruise * Math.exp(-deltaPixels * 0.0012), 10, 1500);
}

export function lookFlight(state, dx, dy) {
  state.targetHeading = heading(state.targetHeading + dx * LOOK_SENSITIVITY);
  state.targetTilt = clamp(state.targetTilt - dy * LOOK_SENSITIVITY, 1, 179);
}

export function haltFlight(state) {
  state.velocity.x = state.velocity.y = state.velocity.z = 0;
  state.targetHeading = state.heading;
  state.targetTilt = state.tilt;
}

export function stepFlight(state, keys, elapsed) {
  const dt = clamp(elapsed, 0, 0.05);
  if (!dt) return false;
  const previous = [state.x, state.y, state.z, state.heading, state.tilt];
  const yaw = Number(keys.has("e") || keys.has("arrowright")) -
    Number(keys.has("q") || keys.has("arrowleft"));
  if (yaw) state.targetHeading = heading(state.targetHeading + yaw * YAW_RATE * dt);
  const lookEase = 1 - Math.exp(-dt / LOOK_TAU);
  const turn = heading(state.targetHeading - state.heading + 180) - 180;
  if (turn) state.heading = heading(Math.abs(turn) < 0.0001
    ? state.targetHeading : state.heading + turn * lookEase);
  const pitchDelta = state.targetTilt - state.tilt;
  if (pitchDelta) state.tilt = Math.abs(pitchDelta) < 0.0001
    ? state.targetTilt : state.tilt + pitchDelta * lookEase;

  const forward = Number(keys.has("w")) - Number(keys.has("s"));
  const strafe = Number(keys.has("d")) - Number(keys.has("a"));
  const lift = Number(keys.has("i") || keys.has("arrowup")) -
    Number(keys.has("k") || keys.has("arrowdown"));
  const h = state.heading * DEG;
  const pitch = (state.tilt - 90) * DEG;
  const direction = {
    x: Math.sin(h) * Math.cos(pitch) * forward + Math.cos(h) * strafe,
    y: Math.cos(h) * Math.cos(pitch) * forward - Math.sin(h) * strafe,
    z: Math.sin(pitch) * forward + lift
  };
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  const decay = Math.exp(-dt / VELOCITY_TAU);
  // cosh(y/R) is 1/cos(latitude) in Web Mercator; altitude is already metres.
  const horizontalScale = Math.min(Math.cosh(state.y / 6378137), 100);
  if (!magnitude && Math.hypot(...Object.values(state.velocity)) < 0.01) {
    state.velocity.x = state.velocity.y = state.velocity.z = 0;
  }
  for (const axis of ["x", "y", "z"]) {
    const target = magnitude > 0 ? direction[axis] / magnitude * state.cruise : 0;
    const before = state.velocity[axis];
    state.velocity[axis] = target + (before - target) * decay;
    const distance = target * dt + (before - target) * VELOCITY_TAU * (1 - decay);
    state[axis] += distance * (axis === "z" ? 1 : horizontalScale);
  }
  state.z = clamp(state.z, -1000, 5_000_000);
  return [state.x, state.y, state.z, state.heading, state.tilt]
    .some((value, index) => value !== previous[index]);
}
