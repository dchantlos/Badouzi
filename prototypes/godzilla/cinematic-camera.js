import { CAMERA_START, CHARGE_START_S, sampleReveal } from "./timeline.js";

export const CLOSE_ARRIVE_S = CHARGE_START_S + 6;
export const PULLBACK_START_S = CLOSE_ARRIVE_S + 2;
export const PULLBACK_END_S = 41;
const DEG = Math.PI / 180;
const scaleAt = y => Math.cosh(y / 6378137);
const mix = (a, b, t) => a + (b - a) * t;
const ease = t => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};
const close = { east: 135, north: 20, altitude: 55, targetEast: 0, targetNorth: -32, targetZ: 26 };
const rear = { east: 75, north: 150, altitude: 98, targetEast: 15, targetNorth: -5, targetZ: 20 };

// Begin on the existing establishing camera's sightline, not a new aim point.
const initialRange = (CAMERA_START.position.z - close.targetZ) / Math.tan((90 - CAMERA_START.tilt) * DEG);
const initialTarget = {
  x: CAMERA_START.position.x + Math.sin(CAMERA_START.heading * DEG) * initialRange * scaleAt(CAMERA_START.position.y),
  y: CAMERA_START.position.y + Math.cos(CAMERA_START.heading * DEG) * initialRange * scaleAt(CAMERA_START.position.y),
  z: close.targetZ
};

function shotAt(state, framing) {
  const scale = scaleAt(state.y);
  return {
    position: { x: state.x + framing.east * scale, y: state.y + framing.north * scale, z: framing.altitude },
    target: { x: state.x + framing.targetEast * scale, y: state.y + framing.targetNorth * scale, z: framing.targetZ }
  };
}

function interpolate(a, b, progress) {
  const result = { position: {}, target: {} };
  for (const part of ["position", "target"]) {
    for (const axis of ["x", "y", "z"]) result[part][axis] = mix(a[part][axis], b[part][axis], progress);
  }
  return result;
}

export function sampleCinematicCamera(seconds) {
  if (!Number.isFinite(seconds)) throw new TypeError("Cinematic time must be finite");
  if (seconds < CHARGE_START_S) return null;
  if (seconds === CHARGE_START_S) return CAMERA_START;
  const state = sampleReveal(seconds);
  const closeShot = shotAt(state, close);
  let shot;
  if (seconds < CLOSE_ARRIVE_S) {
    shot = interpolate({ position: CAMERA_START.position, target: initialTarget }, closeShot,
      ease((seconds - CHARGE_START_S) / (CLOSE_ARRIVE_S - CHARGE_START_S)));
  } else if (seconds < PULLBACK_START_S) {
    shot = closeShot;
  } else {
    shot = interpolate(closeShot, shotAt(state, rear),
      ease((seconds - PULLBACK_START_S) / (PULLBACK_END_S - PULLBACK_START_S)));
  }
  const scale = scaleAt(shot.position.y);
  const dx = (shot.target.x - shot.position.x) / scale;
  const dy = (shot.target.y - shot.position.y) / scale;
  return {
    position: { ...shot.position, spatialReference: { wkid: 3857 } },
    heading: (Math.atan2(dx, dy) / DEG + 360) % 360,
    tilt: 90 - Math.atan2(shot.position.z - shot.target.z, Math.hypot(dx, dy)) / DEG
  };
}
