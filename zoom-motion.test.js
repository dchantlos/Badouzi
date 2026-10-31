import test from "node:test";
import assert from "node:assert/strict";
import { addWheelZoom, createZoomMotion, stepZoomMotion, wheelDeltaPixels } from "./zoom-motion.js";

const near = (a, b, epsilon = 1e-8) => assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function advance(state, seconds = 2, fps = 60) {
  let result;
  for (let frame = 0; frame < seconds * fps; frame++) result = stepZoomMotion(state, 1 / fps);
  return result;
}

test("wheel units are normalized consistently for mouse and trackpad input", () => {
  assert.equal(wheelDeltaPixels(-120, 0, 768), -120);
  assert.equal(wheelDeltaPixels(3, 1, 768), 48);
  assert.equal(wheelDeltaPixels(1, 2, 768), 768);
  assert.throws(() => wheelDeltaPixels(1, 3, 768), RangeError);
});

test("one notch eases in across many frames instead of making a camera jump", () => {
  const state = createZoomMotion(350);
  addWheelZoom(state, -120);
  const goal = 350 * Math.exp(-120 * 0.0008);
  let previous = 350;
  let largest = 0;
  let frames = 0;
  let result;
  do {
    result = stepZoomMotion(state, 1 / 60);
    assert(result.distance <= previous && result.distance >= goal - 1e-8);
    largest = Math.max(largest, previous - result.distance);
    previous = result.distance;
    frames++;
  } while (!result.done && frames < 180);
  assert(result.done);
  assert(frames >= 30 && frames < 100);
  assert(largest < 2.5);
  near(result.distance, goal);
});

test("zoom-out is eased and opposite notches restore the same distance", () => {
  const state = createZoomMotion(350);
  addWheelZoom(state, -120);
  advance(state);
  addWheelZoom(state, 120);
  const first = stepZoomMotion(state, 1 / 60);
  assert(first.distance < 350);
  near(advance(state).distance, 350);
});

test("bursts accumulate a destination without resetting velocity", () => {
  const state = createZoomMotion(350);
  addWheelZoom(state, -120);
  stepZoomMotion(state, 0.05);
  const velocity = state.velocity;
  addWheelZoom(state, -120);
  assert.equal(state.velocity, velocity);
  near(advance(state).distance, 350 * Math.exp(-240 * 0.0008));
});

test("reversing the wheel preserves velocity and smoothly changes direction", () => {
  const state = createZoomMotion(350);
  addWheelZoom(state, -120);
  advance(state, 0.1);
  const velocity = state.velocity;
  addWheelZoom(state, 240);
  assert.equal(state.velocity, velocity);
  assert(Number.isFinite(stepZoomMotion(state, 1 / 60).distance));
  near(advance(state).distance, 350 * Math.exp(120 * 0.0008));
});

test("zoom response is independent of normal rendering frame rate", () => {
  const slow = createZoomMotion(350);
  const fast = createZoomMotion(350);
  addWheelZoom(slow, -120);
  addWheelZoom(fast, -120);
  near(advance(slow, 0.5, 30).distance, advance(fast, 0.5, 120).distance);
});

test("a long stalled frame cannot consume the whole zoom", () => {
  const state = createZoomMotion(350);
  addWheelZoom(state, -120);
  const first = stepZoomMotion(state, 10);
  assert(first.distance > 345);
  assert.equal(first.done, false);
});

test("zoom stays outside the target surface and within its distance limits", () => {
  const state = createZoomMotion(100);
  addWheelZoom(state, -1e8);
  assert(advance(state).distance >= 2);
  addWheelZoom(state, 1e8);
  assert(advance(state).distance <= 30_000_000 + 1e-6);
});

test("completed zooms stop exactly rather than keeping the renderer busy", () => {
  const state = createZoomMotion(350);
  addWheelZoom(state, -120);
  const settled = advance(state);
  assert(settled.done);
  for (let i = 0; i < 10; i++) assert.deepEqual(stepZoomMotion(state, 1 / 60), settled);
});

test("invalid camera and input values fail explicitly", () => {
  for (const distance of [0, -1, NaN, Infinity]) assert.throws(() => createZoomMotion(distance), RangeError);
  assert.throws(() => addWheelZoom(createZoomMotion(100), NaN), TypeError);
  assert.throws(() => stepZoomMotion(createZoomMotion(100), -1), RangeError);
});
