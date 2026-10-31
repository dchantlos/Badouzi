import test from "node:test";
import assert from "node:assert/strict";
import { DURATION_S, END, START, sampleReveal } from "./timeline.js";
import { createWakeForcing } from "./wake-forcing.js";

const contact = { minX: -20, maxX: 22, minY: -30, maxY: 40 };
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("shared forcing retains the native preview's contact footprint and cruise strength", () => {
  const forcing = createWakeForcing();
  const state = sampleReveal(31);
  forcing.update(state, 31, () => contact);
  const { source, packets } = forcing.snapshot();
  const scale = Math.cosh(END.y / 6378137);
  const cruiseSpeed = Math.hypot(START.x - END.x, START.y - END.y) / scale / (DURATION_S - 5 - 4);
  close(source.x, 1);
  close(source.y, Math.hypot(state.x - END.x, state.y - END.y) / scale + 5);
  assert.equal(source.radiusX, 21);
  assert.equal(source.radiusY, 35);
  close(source.power, cruiseSpeed / 3 * 0.65);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].radial, 0);
});

test("forward emergence adds radial energy before switching to a directional walking wake", () => {
  const forcing = createWakeForcing();
  forcing.update(sampleReveal(12), 12, () => contact);
  const emerging = forcing.snapshot();
  assert.equal(emerging.source.power, 1);
  assert.equal(emerging.packets[0].radial, 1);
  forcing.update(sampleReveal(31), 31, () => contact);
  const walking = forcing.snapshot();
  assert(walking.source.power > 0.5 && walking.source.power < 0.7);
  assert.equal(walking.packets[0].radial, 0);
});

test("expensive waterline sampling is cached for at least 0.18 seconds", () => {
  const forcing = createWakeForcing();
  let calls = 0;
  const getContact = () => { calls++; return contact; };
  for (const time of [0, 0.05, 0.17]) forcing.update(sampleReveal(time), time, getContact);
  assert.equal(calls, 1);
  forcing.update(sampleReveal(0.19), 0.19, getContact);
  assert.equal(calls, 2);
  forcing.update(sampleReveal(0.35), 0.35, getContact);
  assert.equal(calls, 2);
  forcing.update(sampleReveal(0.4), 0.4, getContact);
  assert.equal(calls, 3);
});

test("missing body contact removes the source without deleting the world-anchored trail", () => {
  const forcing = createWakeForcing();
  forcing.update(sampleReveal(31), 31, () => contact);
  const emitted = forcing.snapshot().packets[0];
  forcing.update(sampleReveal(31.25), 31.25, () => null);
  const snapshot = forcing.snapshot();
  assert.equal(snapshot.source, null);
  assert.equal(snapshot.packets.length, 1);
  assert.equal(snapshot.packets[0].x, emitted.x);
  assert.equal(snapshot.packets[0].y, emitted.y);
  assert.equal(forcing.active, true);
});

test("stopping ceases contact sampling and emission while existing waves finish fading", () => {
  const forcing = createWakeForcing();
  forcing.update(sampleReveal(31), 31, () => contact);
  forcing.update(sampleReveal(43.2), 43.2, () => contact);
  const unexpectedContact = () => assert.fail("Idle head motion must not resample the waterline");
  forcing.update(sampleReveal(44), 44, unexpectedContact);
  assert.equal(forcing.snapshot().source.power, 0);
  assert.equal(forcing.active, true);
  forcing.update(sampleReveal(62), 62, unexpectedContact);
  assert.equal(forcing.snapshot().packets.length, 0);
  assert.equal(forcing.active, false);
});

test("reset clears the contact cache as well as history so replay is identical", () => {
  const forcing = createWakeForcing();
  const run = () => {
    for (let time = 8; time <= 31; time += 0.25) forcing.update(sampleReveal(time), time, () => contact);
    return forcing.snapshot();
  };
  const first = run();
  forcing.reset();
  assert.deepEqual(forcing.snapshot(), { time: 0, source: null, packets: [] });
  assert.equal(forcing.active, false);
  assert.deepEqual(run(), first);
});

test("invalid clocks, footprints and sampling failures remain explicit", () => {
  for (const time of [-1, NaN, Infinity]) {
    assert.throws(() => createWakeForcing().update(sampleReveal(0), time, () => contact), RangeError);
  }
  const forcing = createWakeForcing();
  const error = new Error("Cannot read the model waterline");
  assert.throws(() => forcing.update(sampleReveal(8), 8, () => { throw error; }), error);
  assert.throws(() => forcing.update(sampleReveal(8), 8, () => ({ ...contact, maxX: contact.minX })), RangeError);
});
