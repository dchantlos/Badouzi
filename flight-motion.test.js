import test from "node:test";
import assert from "node:assert/strict";
import {
  createFlightMotion, changeFlightSpeed, haltFlight, lookFlight, stepFlight
} from "./flight-motion.js";

const pose = { x: 0, y: 0, z: 200, heading: 90, tilt: 90 };
const near = (actual, expected, tolerance = 1e-8) =>
  assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function advance(state, keys, seconds = 1, fps = 60) {
  for (let frame = 0; frame < seconds * fps; frame++) stepFlight(state, new Set(keys), 1 / fps);
}

test("entry preserves the camera exactly and idle frames do not write a pose", () => {
  const state = createFlightMotion({ ...pose, heading: 0, tilt: 0 });
  for (let i = 0; i < 180; i++) assert.equal(stepFlight(state, new Set(), 1 / 60), false);
  assert.equal(state.z, pose.z);
  assert.equal(state.heading, 0);
  assert.equal(state.tilt, 0);
});

test("forward flight eases in with the reference 0.32-second time constant", () => {
  const state = createFlightMotion(pose);
  advance(state, ["w"]);
  near(state.velocity.x, 28 * (1 - Math.exp(-1 / 0.32)));
  near(state.x, 28 * (1 - 0.32 * (1 - Math.exp(-1 / 0.32))));
  near(state.y, 0);
  near(state.z, 200);
});

test("forward and backward follow pitch, while altitude keys stay vertical", () => {
  const forward = createFlightMotion({ ...pose, tilt: 60 });
  const back = createFlightMotion({ ...pose, tilt: 60 });
  const up = createFlightMotion({ ...pose, tilt: 60 });
  advance(forward, ["w"]);
  advance(back, ["s"]);
  advance(up, ["arrowup"]);
  assert(forward.z < 200);
  assert(back.z > 200);
  near(forward.x, -back.x);
  near(up.x, 0);
  assert(up.z > 200);
});

test("diagonal inputs never exceed the configured cruise speed", () => {
  const straight = createFlightMotion(pose);
  const diagonal = createFlightMotion(pose);
  advance(straight, ["w"]);
  advance(diagonal, ["w", "d", "i"]);
  near(Math.hypot(...Object.values(diagonal.velocity)), Math.hypot(...Object.values(straight.velocity)));
});

test("horizontal speed is corrected for Mercator latitude, not altitude", () => {
  const equator = createFlightMotion(pose);
  const sixty = createFlightMotion({ ...pose, y: 6378137 * Math.log(Math.tan(Math.PI / 4 + Math.PI / 6)) });
  advance(equator, ["w", "i"]);
  advance(sixty, ["w", "i"]);
  near(sixty.x, equator.x * 2);
  near(sixty.z, equator.z);
});

test("wheel speed is exponential and bounded", () => {
  const state = createFlightMotion(pose);
  changeFlightSpeed(state, -100);
  near(state.cruise, 28 * Math.exp(0.12));
  changeFlightSpeed(state, 1e6);
  assert.equal(state.cruise, 10);
  changeFlightSpeed(state, -1e6);
  assert.equal(state.cruise, 1500);
});

test("mouse look eases through the heading seam by the shortest turn", () => {
  const state = createFlightMotion({ ...pose, heading: 359 });
  lookFlight(state, 25, -10);
  stepFlight(state, new Set(), 1 / 60);
  assert(state.heading > 359 && state.heading < 360);
  assert(state.tilt > 90 && state.tilt < 91.2);
  advance(state, [], 2);
  near(state.heading, 2);
  near(state.tilt, 91.2);
  lookFlight(state, 0, 1e6);
  assert.equal(state.targetTilt, 1);
});

test("turning aliases agree and opposing inputs cancel", () => {
  const e = createFlightMotion(pose);
  const arrow = createFlightMotion(pose);
  const cancelled = createFlightMotion(pose);
  advance(e, ["e"]);
  advance(arrow, ["arrowright"]);
  advance(cancelled, ["w", "s", "a", "d", "q", "e", "i", "k"]);
  near(e.heading, arrow.heading);
  assert(e.heading > pose.heading);
  assert.equal(cancelled.x, 0);
  assert.equal(cancelled.heading, pose.heading);
});

test("release coasts smoothly to an exact stop so the scene can settle", () => {
  const state = createFlightMotion(pose);
  advance(state, ["w"]);
  const previousSpeed = state.velocity.x;
  stepFlight(state, new Set(), 1 / 60);
  assert(state.velocity.x > 0 && state.velocity.x < previousSpeed);
  advance(state, [], 4);
  assert.equal(state.velocity.x, 0);
  assert.equal(stepFlight(state, new Set(), 1 / 60), false);
});

test("blur or exit halts both movement and pending mouse look", () => {
  const state = createFlightMotion(pose);
  advance(state, ["w"]);
  lookFlight(state, 400, 40);
  haltFlight(state);
  assert.deepEqual(state.velocity, { x: 0, y: 0, z: 0 });
  assert.equal(stepFlight(state, new Set(), 1 / 60), false);
});

test("translation easing is frame-rate independent and long stalls are capped", () => {
  const at30 = createFlightMotion(pose);
  const at120 = createFlightMotion(pose);
  advance(at30, ["w"], 1, 30);
  advance(at120, ["w"], 1, 120);
  near(at30.x, at120.x);
  const stalled = createFlightMotion(pose);
  stepFlight(stalled, new Set(["w"]), 30);
  assert(stalled.x < 0.2);
});

test("invalid camera data fails explicitly", () => {
  assert.throws(() => createFlightMotion({ ...pose, z: NaN }), /Invalid drone camera z/);
});
