import test from "node:test";
import assert from "node:assert/strict";
import { APPROACH_START_S, DURATION_S, END, HEIGHT_M, RISE_END_S, START, VILLAGE_TARGET, WALK_CYCLES, WATER_Z, sampleReveal } from "./timeline.js";

test("the establishing shot keeps the entire model below water", () => {
  for (const time of [-1, 0, 3, 5]) {
    const state = sampleReveal(time);
    assert(HEIGHT_M * (0.5 - state.anchorZ) < 0);
    assert.equal(state.rise, 0);
    assert.equal(state.approach, 0);
  }
});

test("the final silhouette is 55 metres above water, with legs concealed", () => {
  const state = sampleReveal(DURATION_S);
  assert.equal(HEIGHT_M * (0.5 - state.anchorZ), 55);
  assert.equal(state.z, WATER_Z);
  assert.equal(state.done, true);
});

test("rise and approach are monotonic, bounded, and do not bounce", () => {
  let previous = sampleReveal(0);
  for (let time = 0.1; time <= DURATION_S + 8; time += 0.1) {
    const current = sampleReveal(time);
    assert(current.rise >= previous.rise && current.rise <= 1);
    assert(current.approach >= previous.approach && current.approach <= 1);
    assert(current.anchorZ <= previous.anchorZ && current.anchorZ >= 0);
    assert(current.x >= Math.min(START.x, END.x) && current.x <= Math.max(START.x, END.x));
    assert(current.y >= Math.min(START.y, END.y) && current.y <= Math.max(START.y, END.y));
    previous = current;
  }
});

test("the approach starts only after the rise has finished", () => {
  assert.equal(APPROACH_START_S, RISE_END_S);
  for (const time of [0, 5, 16, RISE_END_S]) assert.equal(sampleReveal(time).approach, 0);
  assert.equal(sampleReveal(APPROACH_START_S).rise, 1);
  assert(sampleReveal(APPROACH_START_S + 0.1).approach > 0);
});

test("the completed reveal holds still rather than looping", () => {
  assert.deepEqual(sampleReveal(DURATION_S), sampleReveal(100));
});

test("the model faces along its approach rather than sliding sideways", () => {
  const heading = sampleReveal(20).heading * Math.PI / 180;
  const length = Math.hypot(END.x - START.x, END.y - START.y);
  assert(Math.abs(-Math.sin(heading) - (END.x - START.x) / length) < 1e-10);
  assert(Math.abs(-Math.cos(heading) - (END.y - START.y) / length) < 1e-10);
});

test("the model faces the village throughout the rise and approaches it", () => {
  let previousDistance = Infinity;
  for (const time of [0, 5, 12, 16, 24, 32, DURATION_S]) {
    const state = sampleReveal(time);
    const dx = VILLAGE_TARGET.x - state.x;
    const dy = VILLAGE_TARGET.y - state.y;
    const distance = Math.hypot(dx, dy);
    const heading = state.heading * Math.PI / 180;
    const alignment = -Math.sin(heading) * dx / distance - Math.cos(heading) * dy / distance;
    assert(Math.abs(alignment - 1) < 1e-10);
    assert(distance <= previousDistance);
    previousDistance = distance;
  }
  assert(END.y < START.y);
  assert(sampleReveal(0).heading >= 0 && sampleReveal(0).heading < 15);
});

test("the longer approach keeps travel distance synchronized to three gait cycles", () => {
  assert.equal(WALK_CYCLES, 3);
  const distancePerCycle = Math.hypot(END.x - START.x, END.y - START.y) / WALK_CYCLES;
  assert(Math.abs(distancePerCycle - Math.hypot(20, 40) / 2) < 1e-8);
});

test("separating the rise and walk preserves the three-cycle distance and pace", () => {
  assert.equal(DURATION_S, 43);
  assert.equal(DURATION_S - APPROACH_START_S, 24);
  const distance = Math.hypot(END.x - START.x, END.y - START.y);
  assert(Math.abs(distance / (DURATION_S - APPROACH_START_S) - Math.hypot(20, 40) / 16) < 1e-8);
  assert.equal(sampleReveal(32).done, false);
  assert(sampleReveal(32).approach < 1);
  assert.equal(sampleReveal(DURATION_S).done, true);
});

test("dorsal emission charges from the tail upward after emergence without flashing", () => {
  assert.deepEqual(sampleReveal(0).glow, { tail: 0, back: 0, crown: 0 });
  assert.deepEqual(sampleReveal(21).glow, { tail: 0, back: 0, crown: 0 });
  const progressing = sampleReveal(26).glow;
  assert(progressing.tail > progressing.back && progressing.back > progressing.crown);
  assert.deepEqual(sampleReveal(31).glow, { tail: 1, back: 1, crown: 1 });
  let previous = sampleReveal(0).glow;
  for (let time = 0.1; time <= DURATION_S; time += 0.1) {
    const current = sampleReveal(time).glow;
    for (const region of ["tail", "back", "crown"]) {
      assert(current[region] >= previous[region] && current[region] <= 1);
    }
    previous = current;
  }
});

test("there is no emission during the rise or the uncharged start of the walk", () => {
  for (let frame = 0; frame <= 21 * 30; frame++) {
    const state = sampleReveal(frame / 30);
    assert.deepEqual(state.glow, { tail: 0, back: 0, crown: 0 });
  }
  const firstCharge = sampleReveal(21 + 1 / 30);
  assert.equal(firstCharge.rise, 1);
  assert(firstCharge.approach > 0);
  assert(firstCharge.glow.tail > 0);
  assert.equal(firstCharge.glow.back, 0);
  assert.equal(firstCharge.glow.crown, 0);
});

test("invalid time is reported explicitly", () => {
  for (const time of [NaN, Infinity, -Infinity, undefined]) {
    assert.throws(() => sampleReveal(time), TypeError);
  }
});
