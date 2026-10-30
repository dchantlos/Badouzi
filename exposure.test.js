import test from "node:test";
import assert from "node:assert/strict";
import { evaluateScenario, formatUSD, isAtOrBelowWater, summarizeCoverage } from "./exposure.js";

const UNIT_VALUES = { "Mooring Bollards": 1500, "Street Lights": 3200, building: 150000 };

function inputs({ bollards = [], lights = [], bim = [] } = {}) {
  const items = (category, zs) => zs.map((groundZ) => ({ category, groundZ }));
  return [
    { id: "bollards", label: "mooring bollards", singular: "mooring bollard", status: "ok", items: items("Mooring Bollards", bollards) },
    { id: "streetlights", label: "streetlights", singular: "streetlight", status: "ok", items: items("Street Lights", lights) },
    { id: "bim", label: "BIM building models", singular: "BIM building model", status: "ok", items: items("building", bim) }
  ];
}

test("one exposed asset per category totals US$154,700", () => {
  const r = evaluateScenario(inputs({ bollards: [2], lights: [2.5], bim: [1] }), 3, UNIT_VALUES);
  assert.equal(r.status, "complete");
  assert.equal(r.exposedCount, 3);
  assert.equal(r.value, 1500 + 3200 + 150000);
  assert.equal(formatUSD(r.value), "US$154,700");
});

test("a complete analysis with nothing exposed is a legitimate zero", () => {
  const r = evaluateScenario(inputs({ bollards: [9], lights: [9], bim: [9] }), 3, UNIT_VALUES);
  assert.equal(r.status, "complete");
  assert.equal(r.exposedCount, 0);
  assert.equal(r.value, 0);
  assert.equal(formatUSD(r.value), "US$0");
});

test("ground exactly at the waterline counts as exposed", () => {
  assert.equal(isAtOrBelowWater(3, 3), true);
  assert.equal(isAtOrBelowWater(3.01, 3), false);
  const r = evaluateScenario(inputs({ bollards: [3] }), 3, UNIT_VALUES);
  assert.equal(r.exposedCount, 1);
  assert.equal(r.exposed[0].depth, 0);
});

test("a missing unit value is flagged, never treated as zero", () => {
  const { "Street Lights": _omit, ...partialValues } = UNIT_VALUES;
  const r = evaluateScenario(inputs({ bollards: [2], lights: [2], bim: [2] }), 3, partialValues);
  assert.equal(r.status, "partial");
  assert.equal(r.countComplete, true);
  assert.equal(r.valueComplete, false);
  assert.equal(r.value, null);
  assert.equal(r.subtotal, 151500);
  assert.equal(r.exposed.find((e) => e.item.category === "Street Lights").unitValue, null);
  assert.match(r.problems.join(" "), /valuation unknown for 1 exposed streetlight$/);
});

test("invalid unit values (negative / NaN) are not valid valuations", () => {
  const r = evaluateScenario(inputs({ bollards: [2] }), 3, { ...UNIT_VALUES, "Mooring Bollards": -5 });
  assert.equal(r.status, "partial");
  assert.equal(r.value, null);
  const r2 = evaluateScenario(inputs({ bollards: [2] }), 3, { ...UNIT_VALUES, "Mooring Bollards": NaN });
  assert.equal(r2.value, null);
});

test("a failed input makes the result partial and withholds the total", () => {
  const data = inputs({ bollards: [2, 2], lights: [2], bim: [2] });
  data[0] = { id: "bollards", label: "mooring bollards", status: "failed", reason: "mooring bollard data unavailable" };
  const r = evaluateScenario(data, 3, UNIT_VALUES);
  assert.equal(r.status, "partial");
  assert.equal(r.countComplete, false);
  assert.equal(r.value, null);
  assert.equal(r.exposedCount, 2);
  assert.equal(r.subtotal, 153200);
  assert.deepEqual(r.problems, ["mooring bollard data unavailable"]);
  assert.equal(r.perInput[0].exposed, null);
});

test("all inputs failing is unavailable, not zero", () => {
  const failed = (id) => ({ id, label: id, status: "failed" });
  const r = evaluateScenario([failed("a"), { id: "b", label: "b", status: "missing" }], 3, UNIT_VALUES);
  assert.equal(r.status, "unavailable");
  assert.equal(r.exposedCount, null);
  assert.equal(r.value, null);
  assert.equal(r.subtotal, null);
});

test("items without a valid ground elevation are reported, not counted dry", () => {
  const data = inputs({ bollards: [2, null, NaN], lights: [2], bim: [] });
  data[2].items.push({ category: "building", groundZ: null, issue: "model failed to load" });
  const r = evaluateScenario(data, 3, UNIT_VALUES);
  assert.equal(r.status, "partial");
  assert.equal(r.value, null);
  assert.equal(r.exposedCount, 2);
  assert.match(r.problems.join(" | "), /2 mooring bollards not assessed \(no valid ground elevation\)/);
  assert.match(r.problems.join(" | "), /BIM building models not assessed \(model failed to load\)/);
  assert.equal(r.perInput[2].exposed, null);
});

test("raising the water level never reduces a complete count or value", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 8 - 1;
  const zs = (n) => Array.from({ length: n }, rand);
  const data = inputs({ bollards: zs(165), lights: zs(87), bim: zs(3) });
  let prev = { exposedCount: -1, value: -1 };
  for (const waterZ of [2.2, 3, 4, 5]) {
    const r = evaluateScenario(data, waterZ, UNIT_VALUES);
    assert.equal(r.status, "complete");
    assert.ok(r.exposedCount >= prev.exposedCount);
    assert.ok(r.value >= prev.value);
    prev = r;
  }
});

test("an input with no usable elevations is unavailable, not zero exposed", () => {
  const data = inputs({ bollards: [null, null], lights: [2], bim: [2] });
  const r = evaluateScenario(data, 3, UNIT_VALUES);
  assert.equal(r.status, "partial");
  assert.equal(r.perInput[0].exposed, null);
  assert.equal(r.exposedCount, 2);
  assert.deepEqual(r.problems, ["mooring bollards not assessed (no valid ground elevation)"]);

  const none = evaluateScenario(inputs({ bollards: [null], lights: [NaN], bim: [null] }), 3, UNIT_VALUES);
  assert.equal(none.status, "unavailable");
  assert.equal(none.exposedCount, null);
  assert.equal(none.subtotal, null);
  assert.equal(none.value, null);
});

test("an empty but successfully loaded layer is a valid zero", () => {
  const r = evaluateScenario(inputs({ bollards: [], lights: [9], bim: [9] }), 3, UNIT_VALUES);
  assert.equal(r.status, "complete");
  assert.equal(r.value, 0);
});

test("land sample excludes no-data samples and reports newly-below share", () => {
  const c = summarizeCoverage([0, 1, 2.2, 2.5, 3, 3.5, 6, null, NaN], 2.2, 3);
  assert.equal(c.total, 9);
  assert.equal(c.invalid, 2);
  assert.equal(c.valid, 7);
  assert.equal(c.dryLand, 4); // 2.5, 3, 3.5, 6
  assert.equal(c.newlyBelow, 2); // 2.5 and 3 (waterline inclusive)
  assert.equal(c.pct, 50);
});

test("land sample without dry-land samples has no percentage", () => {
  assert.equal(summarizeCoverage([0, 1, null], 2.2, 3).pct, null);
  assert.equal(summarizeCoverage([], 2.2, 3).pct, null);
});

test("currency formatting is explicit and never invents numbers", () => {
  assert.equal(formatUSD(848500), "US$848,500");
  assert.equal(formatUSD(null), "\u2014");
  assert.equal(formatUSD(NaN), "\u2014");
});
