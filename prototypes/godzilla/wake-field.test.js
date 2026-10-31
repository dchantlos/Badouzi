import test from "node:test";
import assert from "node:assert/strict";
import { END, START } from "./timeline.js";
import { WAKE_GRID, WAKE_LIFETIME_S, createWakeField, wakeCoordinates } from "./wake-field.js";

const source = { x: 0, y: 30, radiusX: 10, radiusY: 20, speed: 3, surge: 0 };
const nearZero = value => assert(Math.abs(value) < 1e-8);
function strongest(field, fromY = -30, toY = 100) {
  let height = 0, foam = 0;
  for (let x = -45; x <= 45; x += 2) for (let y = fromY; y <= toY; y += 2) {
    const point = field.sample(x, y);
    height = Math.max(height, Math.abs(point.height));
    foam = Math.max(foam, point.foam);
  }
  return { height, foam };
}

test("the wake frame uses true metres, with positive Y trailing offshore", () => {
  const end = wakeCoordinates(END.x, END.y);
  nearZero(end.x);
  nearZero(end.y);
  const start = wakeCoordinates(START.x, START.y);
  nearZero(start.x);
  assert(start.y > 100 && start.y < 103);
});

test("no contact or no movement produces no new disturbance", () => {
  const field = createWakeField();
  field.update(0, null);
  assert.equal(field.active, false);
  field.update(2, { ...source, speed: 0, surge: 0 });
  assert.equal(field.active, false);
  assert.deepEqual(field.sample(0, 0), { height: 0, foam: 0 });
});

test("moving contact produces a bow crest outside the front of the body", () => {
  const field = createWakeField();
  field.update(1, source);
  const bow = field.sample(0, source.y - source.radiusY - 3.5);
  assert(bow.height > 0.02);
  assert(bow.foam > 0.02);
});

test("older disturbances remain in the water after the source moves on", () => {
  const field = createWakeField();
  field.update(0, { ...source, y: 0 });
  field.update(5, { ...source, y: -40 });
  assert.equal(field.packetCount, 2);
  const trail = strongest(field, 15, 65);
  assert(trail.height > 0.005);
  assert(trail.foam > 0.01);
});

test("the effect is masked out inside the current body and at every grid edge", () => {
  const field = createWakeField();
  for (let time = 0; time <= 8; time++) field.update(time, source);
  const centre = field.sample(source.x, source.y);
  nearZero(centre.height);
  nearZero(centre.foam);
  for (const [x, y] of [
    [WAKE_GRID.minX, 30], [WAKE_GRID.maxX, 30], [0, WAKE_GRID.minY], [0, WAKE_GRID.maxY]
  ]) {
    const edge = field.sample(x, y);
    nearZero(edge.height);
    nearZero(edge.foam);
  }
});

test("the trail fades naturally instead of freezing when movement stops", () => {
  const field = createWakeField();
  for (let time = 0; time <= 8; time++) field.update(time, source);
  field.update(9, { ...source, speed: 0 });
  assert.equal(field.active, true);
  field.update(9 + WAKE_LIFETIME_S, { ...source, speed: 0 });
  assert.equal(field.active, false);
  assert.equal(field.packetCount, 0);
  const quiet = strongest(field);
  nearZero(quiet.height);
  nearZero(quiet.foam);
});

test("wave heights, foam values and history size stay bounded", () => {
  const field = createWakeField();
  for (let time = 0; time < 80; time += 0.2) {
    field.update(time, { ...source, y: 100 - time * 2, surge: 6 });
    assert(field.packetCount <= 18);
  }
  for (let x = -100; x <= 100; x += 4) for (let y = -90; y <= 220; y += 4) {
    const value = field.sample(x, y);
    assert(value.height >= -0.25 && value.height <= 0.7);
    assert(value.foam >= 0 && value.foam <= 1);
  }
});

test("reset removes all old waves and repeats the same controlled input", () => {
  const field = createWakeField();
  const run = () => {
    for (let time = 0; time <= 8; time++) field.update(time, { ...source, y: 30 - time * 2 });
    return field.sample(12, 50);
  };
  const first = run();
  field.reset();
  assert.equal(field.active, false);
  assert.deepEqual(run(), first);
});

test("invalid clocks and source geometry surface errors", () => {
  const field = createWakeField();
  assert.throws(() => field.update(NaN, source), RangeError);
  assert.throws(() => field.update(1, { ...source, radiusX: 0 }), RangeError);
  field.reset();
  field.update(5, source);
  assert.throws(() => field.update(4, source), RangeError);
});

test("GPU snapshots cannot mutate the native field or change after later updates", () => {
  const field = createWakeField();
  field.update(1, source);
  const first = field.snapshot();
  const before = structuredClone(first);
  field.update(2.2, { ...source, y: 20 });
  assert.deepEqual(first, before);
  const current = field.snapshot();
  const expected = structuredClone(current);
  current.source.x = 1000;
  current.packets[0].power = 0;
  current.packets.push({ ...current.packets[0] });
  assert.deepEqual(field.snapshot(), expected);
});
