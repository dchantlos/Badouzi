const SENSITIVITY = 0.0008;
const SPRING_RATE = 12;

export function wheelDeltaPixels(deltaY, deltaMode, pageHeight) {
  if (!Number.isFinite(deltaY)) throw new TypeError("Wheel movement must be finite");
  if (deltaMode === 0) return deltaY;
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2 && Number.isFinite(pageHeight) && pageHeight > 0) return deltaY * pageHeight;
  throw new RangeError("Unsupported wheel units");
}

export function createZoomMotion(distance) {
  if (!Number.isFinite(distance) || distance <= 0) throw new RangeError("Zoom needs a positive camera distance");
  return {
    position: Math.log(distance),
    target: Math.log(distance),
    velocity: 0,
    min: Math.log(Math.min(2, distance)),
    max: Math.log(Math.max(30_000_000, distance))
  };
}

export function addWheelZoom(state, pixels) {
  if (!Number.isFinite(pixels)) throw new TypeError("Wheel movement must be finite");
  state.target = Math.max(state.min, Math.min(state.max, state.target + pixels * SENSITIVITY));
}

export function stepZoomMotion(state, elapsed) {
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError("Zoom elapsed time must be nonnegative and finite");
  const dt = Math.min(elapsed, 0.05);
  const offset = state.position - state.target;
  // Exact critically damped spring in log-distance: no per-notch restart,
  // consistent relative speed near the model and across the wider harbour.
  const term = state.velocity + SPRING_RATE * offset;
  const decay = Math.exp(-SPRING_RATE * dt);
  state.position = state.target + (offset + term * dt) * decay;
  state.velocity = (state.velocity - SPRING_RATE * term * dt) * decay;
  if (state.position < state.min || state.position > state.max) {
    state.position = Math.max(state.min, Math.min(state.max, state.position));
    state.velocity = 0;
  }
  const done = Math.abs(state.position - state.target) < 1e-6 && Math.abs(state.velocity) < 1e-5;
  if (done) {
    state.position = state.target;
    state.velocity = 0;
  }
  return { distance: Math.exp(state.position), done };
}
