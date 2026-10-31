import test from "node:test";
import assert from "node:assert/strict";
import { CAMERA_START, CHARGE_START_S, DURATION_S, sampleReveal } from "./timeline.js";
import { CLOSE_ARRIVE_S, PULLBACK_END_S, PULLBACK_START_S, sampleCinematicCamera } from "./cinematic-camera.js";

const near = (a, b, epsilon = 1e-7) => assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function relative(camera, time) {
  const model = sampleReveal(time);
  const scale = Math.cosh(model.y / 6378137);
  return { east: (camera.position.x - model.x) / scale, north: (camera.position.y - model.y) / scale };
}

test("the cinematic camera stays out of the unlit rise and starts on the existing view", () => {
  for (const time of [0, 5, 19, CHARGE_START_S - 0.001]) assert.equal(sampleCinematicCamera(time), null);
  assert.deepEqual(sampleCinematicCamera(CHARGE_START_S), CAMERA_START);
});

test("the charge-up shot is a close side view that tracks the moving creature", () => {
  for (const time of [CLOSE_ARRIVE_S, CLOSE_ARRIVE_S + 1, PULLBACK_START_S]) {
    const camera = sampleCinematicCamera(time);
    const offset = relative(camera, time);
    near(offset.east, 135);
    near(offset.north, 20);
    assert(camera.heading > 245 && camera.heading < 255);
    near(camera.position.z, 55);
  }
  assert(sampleCinematicCamera(CLOSE_ARRIVE_S + 1).position.y < sampleCinematicCamera(CLOSE_ARRIVE_S).position.y);
});

test("the close-up holds for only two seconds before the pullback", () => {
  assert.equal(PULLBACK_START_S - CLOSE_ARRIVE_S, 2);
  assert(sampleCinematicCamera(PULLBACK_START_S + 1).position.z > 55);
});

test("the final shot pulls back and rises behind him before the sequence ends", () => {
  const end = sampleCinematicCamera(PULLBACK_END_S);
  const offset = relative(end, PULLBACK_END_S);
  near(offset.east, 75);
  near(offset.north, 150);
  near(end.position.z, 98);
  assert(end.heading > 195 && end.heading < 205);
  assert(Math.hypot(offset.east, offset.north) > Math.hypot(135, 20));
  assert(PULLBACK_END_S < DURATION_S);
});

test("the whole path is continuous, eased and clear of the model", () => {
  let previous = sampleCinematicCamera(CHARGE_START_S);
  for (let frame = Math.round(CHARGE_START_S * 60) + 1; frame <= DURATION_S * 60; frame++) {
    const time = frame / 60;
    const camera = sampleCinematicCamera(time);
    const delta = Math.hypot(camera.position.x - previous.position.x,
      camera.position.y - previous.position.y, camera.position.z - previous.position.z);
    assert(delta < 3, `Camera cut at ${time}: ${delta} m`);
    assert(Math.abs(camera.heading - previous.heading) < 1);
    const offset = relative(camera, time);
    assert(Math.hypot(offset.east, offset.north) > 100);
    previous = camera;
  }
});

test("the final camera holds still after the sequence, and invalid clocks fail", () => {
  assert.deepEqual(sampleCinematicCamera(DURATION_S), sampleCinematicCamera(100));
  for (const value of [NaN, Infinity, undefined]) assert.throws(() => sampleCinematicCamera(value), TypeError);
});
